// Built viewer, actual RA terrain rasters and real agent dispatch; provider responses are a local fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
const artifacts = process.argv[3] ?? '/tmp/terrain-browser';
await mkdir(artifacts, { recursive: true });
const report = { status: 'failed', checks: [], outputs: [], errors: [], screenshots: [] };
const tool = (name, args, call_id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id, arguments: JSON.stringify(args) });
let round = 0, browser, context, front;
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'fixture-terrain-browser-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'terrain-browser-fixture' }] });
  const body = JSON.parse(String(init.body));
  for (const item of body.input.filter(i => i.type === 'function_call_output')) report.outputs.push({ id: item.call_id, result: JSON.parse(item.output) });
  assert(body.tools[0].tools.some(t => t.name === 'terrain_image'));
  for (const item of body.input) for (const content of Array.isArray(item.content) ? item.content : []) {
    if (content.type === 'input_image' && content.image_url.startsWith('data:image/png;base64,')) await writeFile(`${artifacts}/agent-terrain-image.png`, Buffer.from(content.image_url.split(',')[1], 'base64'));
  }
  const output = round++ === 0 ? [tool('load_skill', { skillId: 'elevation-models' }, 'elevation_skill'), tool('load_skill', { skillId: 'visual-inspection' }, 'visual_skill')]
    : round === 2 ? [tool('query_terrain_region', { polygon: [[-60,-60],[60,-60],[60,60],[-60,60]] }), tool('filter_terrain_regions', { polygon: [[-60,-60],[60,-60],[60,60],[-60,60]], maxSlopeDegrees: 5, minArea: 30, maxHeightAboveGround: null, maxRegions: 3 }), tool('terrain_profile', { start: [-60,0], end: [60,0], samples: 32 }), tool('terrain_image', { polygon: [[-60,-60],[60,-60],[60,60],[-60,60]], layer: 'slope', maxSize: 256 }), tool('capture_scene', { kind: 'current' })]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Queried regional terrain, filtered connected patches and sampled a profile; inspected the coordinate-bound slope image.' }] }];
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
  await layer('slope'); await shot('desktop-slope');
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).isDisabled(), true);
  await page.getByLabel('Elevation color key').getByText('Ground slope · °', { exact: true }).waitFor();
  const canvas = host.locator('canvas'), box = await canvas.boundingBox();
  // Select an actually rendered supported pixel; slope deliberately has large NoData holes.
  const rasterPixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const buffer = document.createElement('canvas'); buffer.width = image.width; buffer.height = image.height;
    const drawing = buffer.getContext('2d'); drawing.drawImage(image, 0, 0); const bytes = drawing.getImageData(0, 0, image.width, image.height).data;
    const hits = [];
    for (let y = Math.floor(image.height * .35); y < image.height * .85; y += 13) for (let x = Math.floor(image.width * .15); x < image.width * .8; x += 13) {
      const at = (y * image.width + x) * 4;
      if (bytes[at] > 70 && bytes[at + 2] > 90) hits.push({ x, y });
    }
    return hits.slice(0, 20);
  }, (await canvas.screenshot()).toString('base64'));
  assert(rasterPixels.length, 'Slope must have rendered supported cells');
  for (const position of rasterPixels) {
    await canvas.click({ position }); await page.waitForTimeout(150);
    if (await page.getByText('Elevation cell', { exact: true }).count()) break;
  }
  await page.getByText('Elevation cell', { exact: true }).waitFor(); await shot('desktop-cell');
  await layer('dsm'); await shot('desktop-dsm');
  await layer('slope');
  report.checks.push('Actual RA slope renders on supported DTM with a degree key; derived picking and DSM switching pass');
  await page.getByTestId('local-draft').fill('Inspect regional terrain, filter connected patches, sample a profile and inspect a mapped slope image.');
  await page.getByTestId('send-local-draft').click();
  await page.getByText('Queried regional terrain, filtered connected patches and sampled a profile; inspected the coordinate-bound slope image.', { exact: true }).waitFor({ timeout: 60000 });
  for (const name of ['query_terrain_region', 'filter_terrain_regions', 'terrain_profile', 'terrain_image']) {
    const result = report.outputs.find(o => o.id === name)?.result; assert.equal(result?.kind, 'terrain-analysis'); assert.equal(result.frameId, 'stpls3d-realworld-ra-local');
  }
  const mapped = report.outputs.find(o => o.id === 'terrain_image').result; assert(mapped.result.mapping); assert(mapped.image.sha256);
  const capture = report.outputs.find(o => o.id === 'capture_scene')?.result;
  assert.equal(capture?.status, 'captured'); assert.equal(capture.observation.coverage.kind, 'prepared-elevation-surface'); assert.equal(capture.observation.coverage.surfaceLayer, 'slope');
  report.checks.push('Actual skill loading, four terrain tools, model image input and slope capture round trip pass; no live inference');
  // Fail one derived raster request and recover without losing scene/camera ownership.
  await page.getByLabel('Surface layer', { exact: true }).selectOption('points');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'points');
  let fail = true;
  await page.route('**/terrain-grid?**', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.getByLabel('Surface layer', { exact: true }).selectOption('slope'); await page.getByRole('button', { name: 'Retry layer', exact: true }).waitFor(); await shot('layer-error');
  fail = false; await page.getByRole('button', { name: 'Retry layer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'slope');
  assert.equal(await page.getByRole('button', { name: 'Retry layer', exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click(); await shot('mobile-slope');
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, canvas: document.querySelector('[data-testid="point-cloud-workspace"] canvas').getBoundingClientRect().toJSON() }));
  assert(layout.scroll <= layout.width && layout.canvas.height > 400);
  await layer('dsm'); await shot('mobile-dsm');
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-wmsc');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.cloudId === 'stpls3d-realworld-wmsc' && document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'points');
  assert.equal(await page.getByText('Elevation cell', { exact: true }).count(), 0);
  await layer('slope'); await shot('mobile-wmsc-slope');
  report.checks.push('Layer retry, mobile controls/key, negative elevations and scene-switch clearing pass');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} finally {
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ status: report.status, artifacts, checks: report.checks }));
