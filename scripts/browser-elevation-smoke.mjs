// Built viewer, actual RA GeoTIFFs and real agent dispatch; provider responses are a local fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
const artifacts = process.argv[3] ?? '/tmp/elevation-browser';
await mkdir(artifacts, { recursive: true });
const report = { status: 'failed', checks: [], outputs: [], errors: [], screenshots: [] };
const tool = (name, args, call_id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id, arguments: JSON.stringify(args) });
let round = 0, browser, context, front;
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'fixture-elevation-browser-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'elevation-browser-fixture' }] });
  const body = JSON.parse(String(init.body));
  for (const item of body.input.filter(i => i.type === 'function_call_output')) report.outputs.push({ id: item.call_id, result: JSON.parse(item.output) });
  assert(body.tools[0].tools.some(t => t.name === 'query_elevation'));
  const output = round++ === 0 ? [tool('load_skill', { skillId: 'elevation-models' }, 'elevation_skill'), tool('load_skill', { skillId: 'visual-inspection' }, 'visual_skill')]
    : round === 2 ? [tool('query_elevation', { x: 0, y: 0 }), tool('capture_scene', { kind: 'current' })]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Queried the original RA DTM and DSM cell with supporting point counts; the captured raster is a derived display.' }] }];
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', request => request.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222'); context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  const host = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  const shot = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path: `${artifacts}/${name}.png` }); report.screenshots.push(`${name}.png`); };
  const layer = async mode => {
    await page.getByLabel('Surface layer', { exact: true }).selectOption(mode);
    await page.waitForFunction(expected => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === expected && Number(document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceCells) > 0, mode);
  };
  await page.goto(`http://127.0.0.1:${front.httpServer.address().port}`);
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-ra');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.cloudId === 'stpls3d-realworld-ra' && !!document.querySelector('[aria-label="Surface layer"]'));
  await layer('dtm'); await shot('desktop-dtm');
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).isDisabled(), true);
  await page.getByLabel('Elevation color key').getByText('Ground elevation · m', { exact: true }).waitFor();
  const canvas = host.locator('canvas'), box = await canvas.boundingBox();
  for (const [x, y] of [[.5, .5], [.45, .6], [.6, .5], [.4, .55]]) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    await page.waitForTimeout(100);
    if (await page.getByText('Elevation cell', { exact: true }).count()) break;
  }
  await page.getByText('Elevation cell', { exact: true }).waitFor(); await shot('desktop-cell');
  await layer('dsm'); await shot('desktop-dsm');
  await page.getByLabel('Elevation color key').getByText('Surface elevation · m', { exact: true }).waitFor();
  report.checks.push('Actual RA classified DTM and DSM render with an elevation key; raster click inspects the full-resolution cell');
  await page.getByTestId('local-draft').fill('Query the RA terrain and surface elevation at local XY 0, 0 and capture this layer.');
  await page.getByTestId('send-local-draft').click();
  await page.getByText('Queried the original RA DTM and DSM cell with supporting point counts; the captured raster is a derived display.', { exact: true }).waitFor({ timeout: 60000 });
  const result = report.outputs.find(o => o.id === 'query_elevation')?.result;
  assert.equal(result?.kind, 'elevation-query'); assert.equal(result.frameId, 'stpls3d-realworld-ra-local'); assert.equal(result.units, 'm');
  assert(result.dtm !== null && result.dsm >= result.dtm && result.support.groundPoints >= 3);
  const capture = report.outputs.find(o => o.id === 'capture_scene')?.result;
  assert.equal(capture?.status, 'captured'); assert.equal(capture.observation.coverage.kind, 'prepared-elevation-surface'); assert.equal(capture.observation.coverage.surfaceLayer, 'dsm');
  report.checks.push('Actual runtime skill loading, agent elevation query and derived-surface capture round trip pass; no live inference');
  // Fail one derived raster request and recover without losing scene/camera ownership.
  await page.getByLabel('Surface layer', { exact: true }).selectOption('points');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'points');
  let fail = true;
  await page.route('**/elevation-grid?**', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.getByLabel('Surface layer', { exact: true }).selectOption('dtm'); await page.getByRole('button', { name: 'Retry layer', exact: true }).waitFor(); await shot('layer-error');
  fail = false; await page.getByRole('button', { name: 'Retry layer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'dtm');
  assert.equal(await page.getByRole('button', { name: 'Retry layer', exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click(); await shot('mobile-dtm');
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, canvas: document.querySelector('[data-testid="point-cloud-workspace"] canvas').getBoundingClientRect().toJSON() }));
  assert(layout.scroll <= layout.width && layout.canvas.height > 400);
  await layer('dsm'); await shot('mobile-dsm');
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-wmsc');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.cloudId === 'stpls3d-realworld-wmsc' && document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'points');
  assert.equal(await page.getByText('Elevation cell', { exact: true }).count(), 0);
  await layer('dtm'); await shot('mobile-wmsc-dtm');
  report.checks.push('Layer retry, mobile controls/key, negative elevations and scene-switch clearing pass');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} finally {
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ status: report.status, artifacts, checks: report.checks }));
