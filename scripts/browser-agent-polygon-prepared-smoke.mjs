// Sparse native artifact with independently known keys; real built viewer/browser RPC,
// fixture-only provider. No live inference, operator tabs or alternate renderer.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud.ts';
const directory = resolve(process.argv[3] ?? '/tmp/agent-view-browser'); await mkdir(directory, { recursive: true });
const root = await mkdtemp('/tmp/capture-grounding-fixture-'); await mkdir(join(root, 'octree'));
const id = 'stpls3d-1', xyz = [[200, 200, 100], ...Array.from({ length: 8 }, (_, i) => { const c = Math.round((-500 + 500 / 2 ** (i + 1)) * 1000) / 1000; return [c, c, c]; })];
const targetPoint = xyz.at(-1);
const descriptor = { version: 1, format: 'potree2-uncompressed', id, frameId: 'grounding-local', coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [1000, 2000, 3000] }, sources: [{ id: 1, name: 'fixture', points: xyz.length }], semantics: { attribute: 'semantic_id', type: 'uint8', classes: { '1': 'Fixture source' } } };
const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: xyz.length, scale: [.001, .001, .001], offset: [0, 0, 0], hierarchy: { firstChunkSize: xyz.length * 22 }, boundingBox: { min: [-500, -500, -500], max: [500, 500, 500] }, attributes: [
  { name: 'position', type: 'int32', size: 12, min: [-500, -500, -500], max: [500, 500, 500] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'semantic_id', type: 'uint8', size: 1 }] };
const payload = Buffer.alloc(xyz.length * 25), hierarchy = Buffer.alloc(xyz.length * 22);
for (let i = 0; i < xyz.length; i++) {
  xyz[i].forEach((n, a) => payload.writeInt32LE(n * 1000, i * 25 + a * 4));
  for (let a = 0; a < 3; a++) payload.writeUInt16LE(65535, i * 25 + 12 + a * 2);
  payload.writeUInt16LE(1, i * 25 + 18); payload.writeUInt32LE(i, i * 25 + 20); payload[i * 25 + 24] = 1;
  hierarchy[i * 22] = i === xyz.length - 1 ? 1 : 0; hierarchy[i * 22 + 1] = i === xyz.length - 1 ? 0 : 1;
  hierarchy.writeUInt32LE(1, i * 22 + 2); hierarchy.writeBigUInt64LE(BigInt(i * 25), i * 22 + 6); hierarchy.writeBigUInt64LE(25n, i * 22 + 14);
}
await Promise.all([writeFile(join(root, 'cloud.json'), JSON.stringify(descriptor)), writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)), writeFile(join(root, 'octree/hierarchy.bin'), hierarchy), writeFile(join(root, 'octree/octree.bin'), payload)]);
const reader = createPreparedCloudRegistry({ [id]: root }).open(id), info = await reader.info();
const report = { status: 'failed', checks: [], events: [], errors: [], nodeRequests: [] };
let browser, context, front, page, resolveCapture, releasePixel;
const captured = new Promise(r => resolveCapture = r), pixelGate = new Promise(r => releasePixel = r);
let rounds = 0, pixel = false;
const regionBinding = { sourceId: id, sourceRevision: info.revision, frameId: descriptor.frameId, units: 'm', origin: descriptor.coordinates.localOrigin };
const polygonRequest = (radius, orientation = 'top') => ({ kind: 'frame', target: { kind: 'region', region: { binding: regionBinding, shape: { kind: 'polygon-prism', polygon: [[-1,-1],[1,-1],[1,1],[0,.5],[-1,1]].map(([x,y]) => [targetPoint[0]+x*radius,targetPoint[1]+y*radius]), z: { min: targetPoint[2]-radius, max: targetPoint[2]+radius } } } }, orientation });
let lastPolygonId;
const tool = (name, args, call_id) => ({ type: 'function_call', namespace: 'scene', name, arguments: JSON.stringify(args), call_id });
const server = createDemoServer({ datasetRoot: join(root, 'no-toronto'), preparedClouds: { [id]: root }, provider: { mode: 'api-key', apiKey: 'grounding-fixture-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'grounding-fixture' }] });
  const body = JSON.parse(String(init.body)), last = body.input.findLast(i => i.type === 'function_call_output');
  rounds++;
  let output;
  if (!last) {
    assert(body.tools[0].tools.find(t => t.name === 'capture_scene').parameters.properties.kind.enum.includes('frame'));
    output = [tool('load_skill', { skillId: 'visual-inspection' }, 'skill_one')]; }
  else if (last.call_id === 'skill_one') output = [tool('capture_scene', polygonRequest(2), 'capture_one')];
  else if (last.call_id === 'capture_one') {
    const result = JSON.parse(last.output); report.capture = result;
    assert.equal(result.status, 'captured'); assert.equal(result.observation.coverage.grounding.status, 'ready');
    assert(result.observation.coverage.captureDetail.targetNodeCount > JSON.parse(report.before.nodes).length, 'capture must borrow additional native nodes beyond the restored live target');
    resolveCapture(); await pixelGate;
    const o = result.observation, size = o.crop ? { width: o.crop.outputWidth, height: o.crop.outputHeight } : o.viewport;
    assert.deepEqual(o.coverage.agentView.pivot, targetPoint); assert.equal(o.coverage.agentView.targetKind, 'declared-polygon-prism'); assert.equal(o.coverage.agentView.fitMethod, 'enclosing-box'); assert.deepEqual(o.coverage.agentView.region, polygonRequest(2).target.region);
    output = [tool('capture_scene', { kind: 'relative', observationId: o.observationId, azimuthDeltaDegrees: 90, elevationDeltaDegrees: -45, distanceScale: .75 }, 'relative_one')];
  } else if (last.call_id === 'relative_one') {
    const result = JSON.parse(last.output); report.relative = result; assert.equal(result.status, 'captured');
    assert.equal(result.observation.coverage.agentView.azimuthDegrees, 135); assert.equal(result.observation.coverage.agentView.elevationDegrees, 45);
    assert.deepEqual(result.observation.coverage.agentView.pivot, targetPoint); assert.equal(result.observation.coverage.agentView.fitGuaranteed, false); assert.deepEqual(result.observation.coverage.agentView.region, report.capture.observation.coverage.agentView.region); assert.equal(result.observation.coverage.agentView.fitMethod, 'enclosing-box');
    output = [tool('capture_scene', polygonRequest(4, 'oblique'), 'box_one')];
  } else if (last.call_id === 'box_one') {
    const result = JSON.parse(last.output); report.box = result; assert.equal(result.status, 'captured');
    const o = result.observation, size = o.crop ? { width: o.crop.outputWidth, height: o.crop.outputHeight } : o.viewport;
    lastPolygonId = o.observationId; assert.equal(o.coverage.agentView.targetKind, 'declared-polygon-prism'); assert.equal(o.coverage.agentView.fitMethod, 'enclosing-box'); assert.equal(o.coverage.agentView.fitGuaranteed, true);
    output = [tool('resolve_visual_pixel', { observationId: o.observationId, x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }, 'pixel_one')];
  } else if (last.call_id === 'pixel_one') {
    report.pixel = JSON.parse(last.output); pixel = true;
    const invalid = polygonRequest(2); invalid.target.region.shape.polygon = [[0,0],[1,1],[0,1],[1,0]];
    output = [tool('capture_scene', invalid, 'polygon_bad')];
  } else if (last.call_id === 'polygon_bad') {
    report.invalidPolygon = JSON.parse(last.output); assert.deepEqual(report.invalidPolygon, { status: 'unavailable', reason: 'invalid-region' });
    output = [tool('capture_scene', { kind: 'relative', observationId: lastPolygonId, azimuthDeltaDegrees: 0, elevationDeltaDegrees: 0, distanceScale: 1 }, 'view_bad')];
  } else if (last.call_id === 'view_bad') {
    report.recovery = JSON.parse(last.output); assert.deepEqual(report.recovery, { status: 'unavailable', reason: 'view-unavailable' });
    output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Captured source verified after restoration.' }] }];
  } else throw new Error('Unexpected fixture tool sequence');
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9223');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(e.message)); page.on('request', r => { if (r.url().includes('/display-node?')) report.nodeRequests.push(r.url()); });
  await page.goto(`http://127.0.0.1:${front.httpServer.address().port}/?smoke=1`);
  const host = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  await page.waitForFunction(() => { const d = document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset; return Number(d?.adaptivePoints) > 0 && d?.adaptivePending === '0'; });
  report.before = await host.evaluate(el => ({ nodes: el.dataset.adaptiveNodes, camera: el.dataset.camera, target: el.dataset.cameraTarget }));
  await page.getByTestId('local-draft').fill('Frame the polygon prism, orbit/dolly, verify a captured source point, and recover from invalid polygon topology.'); await page.getByTestId('send-local-draft').click();
  await Promise.race([captured, new Promise((_, reject) => setTimeout(() => reject(new Error('Capture fixture did not arrive')), 30000))]);
  const box = await host.locator('canvas').boundingBox(); await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 5 }); await page.mouse.up();
  await page.setViewportSize({ width: 1300, height: 850 });
  await page.waitForFunction(() => { const camera = document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.camera; const s = window.__polygonStable ??= { camera: '', count: 0 }; s.count = s.camera === camera ? s.count + 1 : 0; s.camera = camera; return s.count >= 5; });
  report.after = await host.evaluate(el => ({ nodes: el.dataset.adaptiveNodes, camera: el.dataset.camera, target: el.dataset.cameraTarget }));
  assert.notEqual(report.after.camera, report.before.camera, 'human navigation happened before pixel resolution');
  releasePixel(); await page.getByText('Captured source verified after restoration.', { exact: true }).waitFor(); assert(pixel);
  report.restored = await host.evaluate(el => ({ camera: el.dataset.camera, target: el.dataset.cameraTarget }));
  assert.equal(report.restored.camera, report.after.camera); assert.equal(report.restored.target, report.after.target);
  assert.equal(report.pixel.result.status, 'resolved'); assert.equal(report.pixel.recordValidation, 'server-verified-original-record');
  assert.equal(report.pixel.visibilityValidation, 'browser-observed-not-server-verified');
  const p = report.pixel.result.provenance;
  const original = await reader.queryOriginal(info.revision, { operation: 'key', key: p.key, maxResults: 1 });
  assert.deepEqual(p.key, { sourceFileId: 1, sourceRow: xyz.length - 1 }); assert.deepEqual(p.position, original.points[0].position); assert.deepEqual(p.position, targetPoint);
  assert.equal(p.frameId, descriptor.frameId); assert.deepEqual(p.origin, descriptor.coordinates.localOrigin);
  await page.screenshot({ path: `${directory}/restored-grounded.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click(); await page.screenshot({ path: `${directory}/mobile.png` });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(report.errors, []);
  report.rounds = rounds; report.checks.push('Concave polygon-prism frame -> relative orbit/dolly after user navigation/resize -> enclosing-box polygon frame -> source-grounded pixel -> invalid polygon revokes prior view ID, all within one turn; user controls retained', 'Mobile viewport fits; no page errors'); report.status = 'passed';
} finally {
  releasePixel?.(); if (page && !page.isClosed()) { report.finalText = await page.locator('body').innerText(); await page.screenshot({ path: `${directory}/final.png` }); }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2)); await context?.close(); await browser?.close(); await front?.close();
  await new Promise(r => { server.closeAllConnections(); server.close(r); }); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, checks: report.checks, directory }));
