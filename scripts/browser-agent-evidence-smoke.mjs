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
const report = { status: 'failed', checks: [], errors: [] };
let browser, context, front, page, queryId, captureId, pixelId, observationId, resolveReady, release;
const ready = new Promise(r => resolveReady = r), gate = new Promise(r => release = r);
const firstText = 'Measure this original point, capture it and retain factual evidence.';
const followupText = 'Continue this conversation and retrieve the original measurement receipt.';
const tool = (name, args, call_id) => ({ type: 'function_call', namespace: 'scene', name, arguments: JSON.stringify(args), call_id });
const server = createDemoServer({ datasetRoot: join(root, 'no-toronto'), preparedClouds: { [id]: root }, provider: { mode: 'api-key', apiKey: 'fixture-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'evidence-fixture' }] });
  const body = JSON.parse(String(init.body)), last = body.input.findLast(item => item.type === 'function_call_output');
  const followup = body.input.some(item => item.role === 'user' && item.content === followupText);
  let output;
  if (followup) {
    if (!body.instructions.includes('Runtime skill scene-inspection:\n')) output = [tool('load_skill', { skillId: 'scene-inspection' }, 'load-followup')];
    else if (last.call_id === 'load-followup') output = [tool('get_scene_evidence', { evidenceId: queryId }, 'followup-lookup')];
    else { report.followup = JSON.parse(last.output); assert.equal(report.followup.status, 'available'); assert.equal(report.followup.receipt.evidenceId, queryId); output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Earlier measurement receipt retained.' }] }]; }
  } else if (!last) output = [tool('load_skill', { skillId: 'scene-inspection' }, 'load-inspection'), tool('load_skill', { skillId: 'visual-inspection' }, 'load-visual')];
  else if (last.call_id === 'load-visual') output = [tool('query_points', { operation: 'nearest', position: targetPoint, maxResults: 1 }, 'query')];
  else if (last.call_id === 'query') { report.query = JSON.parse(last.output); queryId = report.query.explorationEvidence.evidenceId; assert(queryId); output = [tool('get_scene_evidence', { evidenceId: queryId }, 'query-lookup')]; }
  else if (last.call_id === 'query-lookup') {
    report.queryLookup = JSON.parse(last.output); assert.equal(report.queryLookup.status, 'available'); const projection = report.queryLookup.receipt.projection;
    assert.equal(projection.tool, 'query_points'); assert.deepEqual(projection.result.witnesses[0].position, targetPoint); assert.equal(projection.result.count, 1);
    resolveReady(); await gate;
    output = [tool('capture_scene', { kind: 'frame', target: { kind: 'reference', reference: projection.result.witnesses[0].reference, spanMeters: 4 }, orientation: 'top' }, 'capture')];
  } else if (last.call_id === 'capture') {
    report.capture = JSON.parse(last.output); assert.equal(report.capture.status, 'captured'); captureId = report.capture.explorationEvidence.evidenceId; observationId = report.capture.observation.observationId; assert(captureId);
    const o = report.capture.observation, size = o.crop ? { width: o.crop.outputWidth, height: o.crop.outputHeight } : o.viewport;
    output = [tool('resolve_visual_pixel', { observationId, x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }, 'pixel')];
  } else if (last.call_id === 'pixel') {
    report.pixel = JSON.parse(last.output); assert.equal(report.pixel.result.status, 'resolved'); pixelId = report.pixel.explorationEvidence.evidenceId; assert(pixelId);
    output = [tool('get_scene_evidence', { evidenceId: captureId }, 'capture-lookup'), tool('get_scene_evidence', { evidenceId: pixelId }, 'pixel-lookup')];
  } else if (last.call_id === 'pixel-lookup') {
    const lookup = id => JSON.parse(body.input.findLast(item => item.type === 'function_call_output' && item.call_id === id).output);
    report.captureLookup = lookup('capture-lookup'); report.pixelLookup = lookup('pixel-lookup');
    assert.equal(report.captureLookup.receipt.projection.authority.status, 'unknown'); assert.equal(report.captureLookup.receipt.projection.effective.kind, 'framed');
    assert.equal(report.pixelLookup.receipt.projection.result.recordValidation, 'server-verified-original-record');
    assert(!JSON.stringify([report.captureLookup, report.pixelLookup]).includes('data:image'));
    output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Evidence receipts retained without geometry changes.' }] }];
  } else throw new Error('Unexpected evidence fixture sequence');
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9223'); context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${front.httpServer.address().port}/?smoke=1`);
  const host = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.adaptivePoints) > 0);
  await page.getByTestId('local-draft').fill(firstText); await page.getByTestId('send-local-draft').click();
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Evidence fixture did not reach capture gate')), 30000); ready.then(() => { clearTimeout(timer); resolve(); }, reject); });
  const box = await host.locator('canvas').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 5 }); await page.mouse.up();
  await page.setViewportSize({ width: 1300, height: 850 });
  await page.waitForFunction(() => { const camera = document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.camera; const s = window.__evidenceStable ??= { camera: '', count: 0 }; s.count = s.camera === camera ? s.count + 1 : 0; s.camera = camera; return s.count >= 5; });
  report.before = await host.evaluate(el => ({ camera: el.dataset.camera, target: el.dataset.cameraTarget })); release();
  await page.getByText('Evidence receipts retained without geometry changes.', { exact: true }).waitFor();
  report.after = await host.evaluate(el => ({ camera: el.dataset.camera, target: el.dataset.cameraTarget })); assert.deepEqual(report.after, report.before);
  await page.getByTestId('local-draft').fill(followupText); await page.getByTestId('send-local-draft').click(); await page.getByText('Earlier measurement receipt retained.', { exact: true }).waitFor();
  await page.screenshot({ path: `${directory}/desktop.png` }); await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click(); await page.screenshot({ path: `${directory}/mobile.png` });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(report.errors, []);
  report.status = 'passed'; report.checks.push('Real source query/capture/server-verified pixel receipts and typed lookups; follow-up without New chat; no image rehydration; user camera restored', 'Desktop/mobile and no page errors');
} finally {
  release?.(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2)); await context?.close(); await browser?.close(); await front?.close();
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, checks: report.checks, directory }));
