// Built application + actual prepared STPLS3D; fake provider only, isolated local backend/tab.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';

const artifacts = resolve(process.argv[3] ?? '/tmp/task081-browser');
await mkdir(artifacts, { recursive: true });
const report = { status: 'failed', checks: [], screenshots: [], errors: [], requests: [] };
let browser, context, front;
let round = 0;
const tool = (name, args, id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id: `cloud_${id}`, arguments: JSON.stringify(args) });
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'synthetic-cloud-browser-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'cloud-browser-fixture' }] });
  const body = JSON.parse(String(init.body));
  report.requests.push({ tools: body.tools[0].tools.map(t => t.name), inputs: body.input.filter(i => i.type === 'function_call_output').map(i => ({ call_id: i.call_id, output: JSON.parse(i.output) })) });
  let output;
  switch (round++) {
    case 0: output = [tool('inspect_scene', {})]; break;
    case 1: output = [tool('load_skill', { skillId: 'scene-inspection' }, 'inspection'), tool('load_skill', { skillId: 'visual-inspection' }, 'visual')]; break;
    case 2: output = [tool('capture_scene', { kind: 'current', colorMode: 'instance' }, 'capture_instance')]; break;
    case 3: output = [tool('capture_scene', { kind: 'current', colorMode: 'semantic' }, 'capture_semantic')]; break;
    case 4: {
      const captured = body.input.findLast(i => i.type === 'function_call_output' && i.call_id === 'cloud_capture_semantic');
      const observation = JSON.parse(captured.output).observation;
      output = [tool('resolve_visual_pixel', { observationId: observation.observationId, x: Math.floor(observation.viewport.width / 2), y: Math.floor(observation.viewport.height / 2) })]; break;
    }
    case 5: output = [tool('query_points', { operation: 'nearest', position: [0, 0, 0], label: 14, maxResults: 1 })]; break;
    case 6: {
      const query = body.input.findLast(i => i.type === 'function_call_output' && i.call_id === 'cloud_query_points');
      const reference = JSON.parse(query.output).points[0].selectReference;
      output = [tool('select_reference', reference)]; break;
    }
    default: output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Inspected STPLS3D Scene 1, queried original fence points, and attached a verified source reference.' }] }];
  }
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true,
    configure(p) { p.on('proxyReq', request => request.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  const base = `http://127.0.0.1:${front.httpServer.address().port}`;
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('the server responded with a status of 503')) report.errors.push(message.text()); });
  const shot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => ({ headers: document.querySelectorAll('.workspace-header').length,
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight }));
    assert.equal(layout.headers, 1); assert(layout.scrollWidth <= layout.width && layout.scrollHeight <= layout.height);
    await page.screenshot({ path: `${artifacts}/${name}.png` }); report.screenshots.push(`${name}.png`);
  };
  await page.goto(base);
  await page.getByLabel('STPLS3D scene', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] button[aria-pressed="true"]')?.textContent?.trim() === 'RGB' && !document.querySelector('[data-testid="point-cloud-workspace"] [role="status"]'));
  await page.locator('[data-testid="point-cloud-workspace"] canvas').waitFor();
  assert.equal(await page.getByLabel('STPLS3D scene', { exact: true }).locator('option').count(), 29);
  assert.equal(await page.getByLabel('Scene source').inputValue(), 'cloud');
  assert.equal(await page.getByLabel('Scene source').locator('option').filter({ hasText: 'DALES' }).count(), 0);
  await shot('desktop-rgb');
  const canvas = page.locator('[data-testid="point-cloud-workspace"] canvas');
  const identity = await canvas.evaluate(el => { el.dataset.testIdentity = 'retained'; return { width: el.width, height: el.height }; });
  for (const mode of ['Instance', 'Semantic', 'RGB']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    assert.equal(await canvas.getAttribute('data-test-identity'), 'retained', 'mode switch must retain render resources and camera');
    assert.equal(await page.getByRole('button', { name: mode, exact: true }).getAttribute('aria-pressed'), 'true');
    if (mode !== 'RGB') await shot(`desktop-${mode.toLowerCase()}`);
  }
  report.checks.push('29 scenes, STPLS3D default, DALES removed, RGB/instance/semantic modes retain canvas');
  for (const scene of ['occc', 'ra', 'usc', 'wmsc']) {
    await page.getByLabel('STPLS3D scene', { exact: true }).selectOption(`stpls3d-realworld-${scene}`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="point-cloud-workspace"] [role="status"]'));
    assert.equal(await page.locator('[data-testid="point-cloud-workspace"] [role="alert"]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Instance', exact: true }).isDisabled(), true);
    for (const mode of ['Semantic', 'RGB']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      assert.equal(await page.getByRole('button', { name: mode, exact: true }).getAttribute('aria-pressed'), 'true');
      await shot(`realworld-${scene}-${mode.toLowerCase()}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Semantic', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await shot('realworld-mobile-semantic');
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-1');
  await page.waitForFunction(() => !document.querySelector('[data-testid="point-cloud-workspace"] [role="status"]'));
  await page.getByRole('button', { name: 'RGB', exact: true }).click();
  report.checks.push('All four real-world scenes render RGB/semantic, expose no instance capability, and fit desktop/mobile layouts');
  await page.waitForFunction(() => { const host = document.querySelector('[data-testid="point-cloud-workspace"] .viewport'); return Number(host?.dataset.adaptivePoints) > 100000 && host?.dataset.adaptivePending === '0' && !host?.dataset.adaptiveError; }, undefined, { timeout: 90000 });
  // Actual browser capture bridge + exact source query + browser selection, without live inference.
  await page.getByTestId('local-draft').fill('Inspect the current scene and attach a fence source point.');
  await page.getByTestId('send-local-draft').click();
  await page.getByText('Inspected STPLS3D Scene 1, queried original fence points, and attached a verified source reference.', { exact: true }).waitFor({ timeout: 60000 });
  const outputs = report.requests.flatMap(r => r.inputs);
  const instanceCapture = outputs.find(o => o.call_id === 'cloud_capture_instance')?.output;
  const semanticCapture = outputs.find(o => o.call_id === 'cloud_capture_semantic')?.output;
  assert.equal(instanceCapture?.status, 'captured'); assert.equal(semanticCapture?.status, 'captured');
  assert.deepEqual(instanceCapture.observation.camera, semanticCapture.observation.camera, 'capture modes preserve camera');
  assert(outputs.some(o => o.call_id === 'cloud_resolve_visual_pixel' && ['resolved', 'ambiguous', 'no-hit'].includes(o.output.result?.status)));
  assert(outputs.some(o => o.call_id === 'cloud_select_reference' && o.output.status === 'selected'));
  assert(report.requests.every(r => !r.tools.includes('propose_cad_box') && !r.tools.includes('propose_point_move')));
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).getAttribute('aria-pressed'), 'true', 'capture must restore live mode');
  await page.getByTestId('draft-attachments').locator('summary').first().click();
  await page.getByText('Point 1 · Fence', { exact: true }).waitFor();
  await shot('desktop-agent-selection');
  report.checks.push('Fake-provider capture, full-source native-label query and source reference selection complete; no mutation tools on read-only adapter');
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-25');
  await page.waitForFunction(() => !document.querySelector('[data-testid="point-cloud-workspace"] [role="status"]'));
  await page.getByTestId('local-draft').waitFor();
  assert.equal(await page.getByText('Point 1 · Fence', { exact: true }).count(), 0);
  report.checks.push('Scene switch clears old references and conversation continuation');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await page.getByRole('button', { name: 'Instance', exact: true }).click();
  await shot('mobile-instance');
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    canvas: document.querySelector('[data-testid="point-cloud-workspace"] canvas').getBoundingClientRect().toJSON() }));
  assert(layout.scroll <= layout.width && layout.canvas.width > 300 && layout.canvas.height > 400);
  await page.getByRole('button', { name: 'Semantic', exact: true }).click();
  await shot('mobile-semantic');
  // Error/recovery and quick switch must not publish a late response into another frame.
  await page.setViewportSize({ width: 1440, height: 900 });
  let hold;
  const pending = new Promise(resolve => { hold = resolve; });
  await page.route('**/datasets/prepared/stpls3d-24/sample?**', route => hold(route));
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-24');
  const held = await pending;
  await page.getByText('Loading scene…', { exact: true }).waitFor(); await shot('desktop-loading');
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile-loading');
  await held.fulfill({ status: 503, body: '{}' });
  await page.getByRole('alert').waitFor(); await shot('mobile-error');
  await page.setViewportSize({ width: 1440, height: 900 }); await shot('desktop-error');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute('**/datasets/prepared/stpls3d-24/sample?**');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('[data-testid="point-cloud-workspace"] [role="status"]'));
  await page.getByLabel('Scene source').selectOption('toronto');
  await page.locator('[data-testid="toronto-viewer"] canvas').waitFor({ timeout: 20000 });
  await shot('mobile-toronto');
  await page.getByLabel('Scene source').selectOption('cloud');
  await page.locator('[data-testid="point-cloud-workspace"] canvas').waitFor();
  report.checks.push('Mobile controls, native color key, error/retry, Toronto adapter and switching back');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} finally {
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close();
  await new Promise(resolve => server.close(resolve)); server.closeAllConnections();
  await front?.httpServer.close();
}
console.log(JSON.stringify({ status: report.status, artifacts, checks: report.checks.length }));
