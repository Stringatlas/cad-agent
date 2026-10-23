// Built app, actual native artifacts and existing capture broker; provider is a local fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';

const directory = resolve(process.argv[3] ?? '/tmp/capture-lod-browser');
await mkdir(directory, { recursive: true });
const report = { status: 'failed', checks: [], captures: [], errors: [], modelRequests: [], nodeRequests: [], screenshots: [] };
let browser, context, front, page, requestedCamera;
let sequence = 0, turn = 0;
const consumed = new Set();
const call = (name, args, id) => ({ type: 'function_call', namespace: 'scene', name, call_id: id, arguments: JSON.stringify(args) });
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'capture-fixture-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'capture-fixture' }] });
  const body = JSON.parse(String(init.body));
  report.modelRequests.push(body.input.filter(i => i.type === 'function_call_output').map(i => ({ id: i.call_id, status: JSON.parse(i.output)?.status, kind: JSON.parse(i.output)?.kind })));
  const last = body.input.findLast(i => i.type === 'function_call_output');
  let output;
  if (last?.call_id.startsWith('capture_') && !consumed.has(last.call_id)) {
    consumed.add(last.call_id);
    const result = JSON.parse(last.output);
    report.captures.push({ id: last.call_id, result });
    if (result.observation) {
      const image = body.input.filter(i => i.role === 'user').flatMap(i => Array.isArray(i.content) ? i.content : []).findLast(i => i.type === 'input_image');
      if (image?.image_url?.startsWith('data:')) { const name = `${last.call_id}.png`; await writeFile(`${directory}/${name}`, Buffer.from(image.image_url.split(',')[1], 'base64')); report.screenshots.push(name); }
    }
    output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Capture check ${last.call_id} finished.` }] }];
  } else if (last?.call_id.startsWith('skill_') && !consumed.has(last.call_id)) {
    consumed.add(last.call_id);
    output = [call('capture_scene', requestedCamera, `capture_${++sequence}`)];
  } else {
    output = [call('load_skill', { skillId: 'visual-inspection' }, `skill_${++turn}`)];
  }
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('request', req => { if (req.url().includes('/display-node?')) report.nodeRequests.push(req.url()); });
  const base = `http://127.0.0.1:${front.httpServer.address().port}`;
  await page.goto(`${base}/?smoke=1`);
  const cloud = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  const settle = host => page.waitForFunction(selector => { const el = document.querySelector(selector); return Number(el?.dataset.adaptivePoints) > 0 && el?.dataset.adaptivePending === '0' && !el?.dataset.adaptiveError; }, host, { timeout: 90000 });
  await page.getByTestId('point-cloud-workspace').getByText('Display', { exact: true }).click();
  await page.getByLabel('Display quality').selectOption('light');
  await page.getByTestId('point-cloud-workspace').getByText('Display', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.pointBudget === '500000');
  await settle('[data-testid="point-cloud-workspace"] .viewport');
  const info = await (await page.request.get(`${base}/datasets/prepared/stpls3d-1`)).json();
  const focus = info.bounds.min.map((n, i) => n + (info.bounds.max[i] - n) * (i === 2 ? .2 : .25));
  requestedCamera = { kind: 'camera', position: [focus[0], focus[1], info.bounds.max[2] + 20], target: focus, colorMode: 'semantic' };
  const before = await cloud.evaluate(el => ({ nodes: el.dataset.adaptiveNodes, points: el.dataset.adaptivePoints }));
  const entered = gate(), release = gate(); let hold = true;
  await page.route('**/datasets/prepared/*/display-node?**', async route => { if (hold) { hold = false; entered.release(); await release.promise; } try { await route.continue(); } catch {} });
  async function send(text) { await page.getByTestId('local-draft').fill(text); await page.getByTestId('send-local-draft').click(); }
  await send('Capture the requested off-screen region.');
  await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Capture did not request off-screen detail')), 20000))]);
  assert.equal(report.captures.length, 0, 'capture cannot finish while admitted target node is held');
  assert.deepEqual(await cloud.evaluate(el => ({ nodes: el.dataset.adaptiveNodes, points: el.dataset.adaptivePoints })), before);
  const box = await cloud.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).getAttribute('aria-pressed'), 'true');
  release.release(); await page.getByText('Capture check capture_1 finished.', { exact: true }).waitFor();
  const first = report.captures[0].result; assert.equal(first.status, 'captured');
  assert.deepEqual(first.observation.camera.position, requestedCamera.position);
  assert.equal(first.observation.coverage.complete, false); assert.equal(first.observation.coverage.captureDetail.status, 'ready');
  assert(first.observation.coverage.captureDetail.targetPointCount > 0 && first.observation.coverage.captureDetail.targetPointCount <= 500000);
  await settle('[data-testid="point-cloud-workspace"] .viewport');
  await page.unroute('**/datasets/prepared/*/display-node?**');
  const calls = report.nodeRequests.length;
  await send('Capture the same region again.'); await page.getByText('Capture check capture_2 finished.', { exact: true }).waitFor();
  assert.equal(report.captures[1].result.status, 'captured'); assert.equal(report.nodeRequests.length, calls, 'same capture target reuses the shared CPU cache');
  assert(report.modelRequests.at(-1).some(result => result.id === 'capture_1' && result.status === 'captured'), 'follow-up retains the first capture tool evidence without New chat');
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${directory}/cloud-restored.png` }); report.screenshots.push('cloud-restored.png');
  report.checks.push('Off-screen delayed native target awaited; live geometry retained during loading/navigation; semantic capture restores RGB; repeated target uses cache');
  report.checks.push('Same-cloud follow-up reaches fixture provider with prior capture evidence, without New chat');
  // A failed capture must report unavailable and retain the live display.
  const hierarchy = await (await page.request.get(`${base}/datasets/prepared/stpls3d-1/display-hierarchy?revision=${info.revision}`)).json();
  const fetched = new Set(report.nodeRequests.map(url => new URL(url).searchParams.get('name')));
  const uncached = hierarchy.nodes.filter(n => n.count > 0 && !fetched.has(n.name)).sort((a, b) => b.name.length - a.name.length)[0];
  assert(uncached, 'fixture must retain an uncached native branch');
  const center = uncached.bounds.min.map((n, i) => (n + uncached.bounds.max[i]) / 2);
  requestedCamera = { ...requestedCamera, position: [center[0], center[1], center[2] + 10], target: center };
  let failed = false;
  await page.route('**/datasets/prepared/*/display-node?**', route => { failed = true; return route.fulfill({ status: 503, body: '{}' }); });
  await send('Capture another uncached region.'); await page.getByText('Capture check capture_3 finished.', { exact: true }).waitFor();
  assert(failed); assert.equal(report.captures[2].result.status, 'unavailable');
  assert(Number(await cloud.getAttribute('data-adaptive-points')) > 0);
  await page.screenshot({ path: `${directory}/cloud-capture-error.png` }); report.screenshots.push('cloud-capture-error.png');
  await page.unroute('**/datasets/prepared/*/display-node?**');
  report.checks.push('Failed capture node returns unavailable with user geometry retained');
  await page.getByLabel('Scene source').selectOption('toronto'); await settle('[data-testid="toronto-viewer"]');
  requestedCamera = { kind: 'top-down', colorMode: 'type' };
  const host = page.getByTestId('toronto-viewer');
  const camera = await host.getAttribute('data-camera'), orbit = await host.getAttribute('data-camera-target');
  await send('Capture Toronto top-down.'); await page.getByText('Capture check capture_4 finished.', { exact: true }).waitFor();
  const toronto = report.captures[3].result; assert.equal(toronto.status, 'captured');
  assert.equal(toronto.observation.coverage.captureDetail.status, 'ready'); assert.equal(toronto.observation.coverage.complete, false);
  assert.equal(await host.getAttribute('data-camera'), camera); assert.equal(await host.getAttribute('data-camera-target'), orbit);
  assert.deepEqual(toronto.observation.camera.up, [0, 1, 0]);
  await page.screenshot({ path: `${directory}/toronto-restored.png` }); report.screenshots.push('toronto-restored.png');
  report.checks.push('Toronto top-down uses capture-owned LOD and preserves live camera/orbit');
  await page.getByTestId('display-quality').locator(':scope > summary').click();
  await page.getByText('Detail settings', { exact: true }).click();
  await page.getByTestId('adaptive-display-toggle').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.dataset.adaptivePoints === '0');
  await page.getByTestId('display-quality').locator(':scope > summary').click();
  await send('Capture Toronto with background detail disabled.'); await page.getByText('Capture check capture_5 finished.', { exact: true }).waitFor();
  assert.equal(report.captures[4].result.status, 'captured');
  assert.equal(await page.getByTestId('adaptive-display-toggle').isChecked(), false);
  assert.equal(await host.getAttribute('data-adaptive-points'), '0');
  const disabledCalls = report.nodeRequests.length;
  await send('Repeat the disabled-detail capture.'); await page.getByText('Capture check capture_6 finished.', { exact: true }).waitFor();
  assert.equal(report.captures[5].result.status, 'captured');
  assert.equal(report.nodeRequests.length, disabledCalls, 'capture-only scheduler retains its bounded cache');
  assert.equal(await host.getAttribute('data-adaptive-points'), '0');
  report.checks.push('Toronto captures work with background detail disabled, reuse cache and leave the setting/overview unchanged');
  await page.getByLabel('Scene source').selectOption('cloud'); await settle('[data-testid="point-cloud-workspace"] .viewport');
  await page.getByLabel('Surface layer').selectOption('dtm');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="point-cloud-workspace"] .viewport');
    return el?.dataset.surfaceLayer === 'dtm' && Number(el.dataset.surfaceCells) > 0;
  });
  requestedCamera = { kind: 'current' };
  await send('Capture the derived ground raster.'); await page.getByText('Capture check capture_7 finished.', { exact: true }).waitFor();
  const raster = report.captures[6].result;
  assert.equal(raster.status, 'captured'); assert.equal(raster.observation.coverage.kind, 'prepared-elevation-surface');
  assert.equal(raster.observation.coverage.displayedPointCount, 0);
  assert.equal(raster.observation.coverage.grounding.status, 'unavailable', 'Derived raster imagery must not advertise ready original-point grounding');
  await page.screenshot({ path: `${directory}/raster-ungroundable.png` }); report.screenshots.push('raster-ungroundable.png');
  report.checks.push('Real prepared DTM image remains captureable while original-point grounding is explicitly unavailable');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await page.screenshot({ path: `${directory}/mobile-restored.png` }); report.screenshots.push('mobile-restored.png');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(report.errors, []); report.status = 'passed';
} finally {
  if (page && !page.isClosed()) { report.finalText = await page.locator('body').innerText(); await page.screenshot({ path: `${directory}/final.png` }); }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close(); await new Promise(r => server.close(r));
}
console.log(JSON.stringify({ status: report.status, checks: report.checks, directory }));
