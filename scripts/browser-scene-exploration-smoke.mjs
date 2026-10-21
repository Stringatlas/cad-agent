// Task069: node --import tsx scripts/browser-scene-exploration-smoke.mjs [artifact directory]
// Run pnpm build first. Mock provider only; isolated real source/backend/Vite/WebGL.
// No AOI seam, numeric scan, paid inference or geometry mutations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { createServer } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { denseGround } from '../tests/fixtures/area-candidate-source.ts';

const directory = resolve(process.argv[2] ?? '/tmp/task069-browser');
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task069-browser-owned-'));
const report = { status: 'failed', error: undefined, checks: [], errors: [], screenshots: [], viewports: {},
  ownership: 'Own headless Chrome with ephemeral profile, source, project, backend and Vite on OS-assigned ports. Provider only mocked. Capture seam exposes existing capture for pixel inspection only; it does not inject marks/AOI or replace product callbacks.',
  visualReview: 'Inspect saved screenshots separately; automated assertions are not visual certification.',
  missingSkills: ['pi-browser-harness', 'spatial-rendering'] };
let browser, page, server, vite;
let round = 0, scenario = 'explore', viewport = '', initialMarks, revisedMarks;
const bodies = [], toolResults = [];
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
const mark = (position, id) => ({ ...(id ? { id } : {}), position,
  rationale: 'Model-chosen ground hypothesis; compare local context.', uncertainty: 'Occlusions and underground utilities remain unknown.' });
const positions = [[35.375, 42.125, .1], [60.2, 55.7, .1], [45.1, 62.6, .1]];
const revisedPosition = [46.4, 61.1, .1];
const cameraState = async () => page.getByTestId('toronto-viewer').evaluate(el => ({ camera: JSON.parse(el.dataset.camera), target: JSON.parse(el.dataset.cameraTarget) }));
const liveMarks = async () => JSON.parse(await page.getByTestId('toronto-viewer').getAttribute('data-scene-marks') ?? '[]');
async function shot(name) {
  await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(directory, name + '.png') }); report.screenshots.push(name + '.png');
}
async function deliveredCapture(body, capture) {
  assert.equal(capture.status, 'captured', JSON.stringify(capture));
  const images = (body.input ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'input_image');
  const delivered = images.find(image => image.image_url?.startsWith('data:image/') && createHash('sha256').update(Buffer.from(image.image_url.split(',')[1], 'base64')).digest('hex') === capture.observation.image.sha256);
  assert.ok(delivered, 'next provider request must contain exact custom capture bytes');
  await writeFile(join(directory, `${viewport}-delivered-custom-capture.jpg`), Buffer.from(delivered.image_url.split(',')[1], 'base64'));
}
async function readableLabels(selected) {
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="toronto-viewer"]').dataset.sceneMarkLabels ?? '[]').length === 2);
  const boxes = JSON.parse(await page.getByTestId('toronto-viewer').getAttribute('data-scene-mark-labels'));
  const canvas = await page.getByTestId('toronto-viewer').locator('canvas').boundingBox();
  const panel = await page.getByTestId('scene-mark-list').boundingBox();
  assert.deepEqual(boxes.map(box => box.text), ['C1', 'C2']);
  assert.deepEqual(boxes.filter(box => box.selected).map(box => box.rank), selected ? [selected] : []);
  for (const box of boxes) {
    assert.ok(box.x >= 11 && box.y >= 11 && box.x + box.width <= canvas.width - 11 && box.y + box.height <= canvas.height - 11, 'label inside canvas');
    assert.ok(box.x + canvas.x + box.width <= panel.x || panel.x + panel.width <= box.x + canvas.x || box.y + canvas.y + box.height <= panel.y || panel.y + panel.height <= box.y + canvas.y, 'label not obscured by hypothesis panel');
    for (const other of boxes.filter(other => other.rank !== box.rank)) assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y, 'labels do not overlap');
  }
  const capture = await page.evaluate(() => globalThis.__task069.capture({ kind: 'current' }));
  assert.equal(capture.coverage.layers.areaCandidatePoints, 2);
  const pixels = await page.evaluate(async ({ dataUrl, boxes, size }) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return boxes.map(box => {
      const scaleX = image.width / size.width, scaleY = image.height / size.height;
      const data = context.getImageData(Math.round((box.x + 9) * scaleX), Math.round((box.y + 5) * scaleY), Math.round((box.width - 18) * scaleX), Math.round((box.height - 10) * scaleY)).data;
      let ink = 0, background = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i] < 65 && data[i + 1] < 85 && data[i + 2] < 125) ink++; if (data[i] > 170 && data[i + 1] > 170 && data[i + 2] > 120) background++; }
      return { rank: box.rank, ink, background };
    });
  }, { dataUrl: capture.image.dataUrl, boxes, size: canvas });
  for (const pixel of pixels) { assert.ok(pixel.ink >= 20, `C${pixel.rank} rendered text`); assert.ok(pixel.background >= 100, `C${pixel.rank} rendered background`); }
  await writeFile(join(directory, `${viewport}-${selected ? 'selected' : 'marked'}-capture.jpg`), Buffer.from(capture.image.dataUrl.split(',')[1], 'base64'));
  return { boxes, pixels, capture: { ...capture, image: { ...capture.image, dataUrl: '[saved separately]' } } };
}
try {
  const raw = denseGround(100);
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: raw.length, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0, 0, -1], max: [100, 100, 1] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [100, 100, 0] },
    { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
    { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(raw.length * 28);
  raw.forEach((p, i) => { p.xyz.forEach((n, a) => payload.writeInt32LE(Math.round(n * 1000), i * 28 + a * 4)); for (let a = 0; a < 3; a++) payload.writeUInt16LE(30000, i * 28 + 12 + a * 2); payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24); });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(raw.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? raw.length : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  server = createDemoServer({ datasetRoot: root, projectPath: join(root, 'project.json'), provider: { mode: 'api-key', apiKey: 'synthetic-test-only' }, modelTransport: async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    for (const input of body.input ?? []) if (input.type === 'function_call_output') {
      const value = JSON.parse(input.output); if (!toolResults.some(r => r.callId === input.call_id)) toolResults.push({ callId: input.call_id, value });
    }
    const call = (name, args = {}, id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id: `task069_${viewport}_${scenario}_${id}`, arguments: JSON.stringify(args) });
    const result = id => { const value = toolResults.find(r => r.callId === `task069_${viewport}_${scenario}_${id}`)?.value; assert.ok(value, `missing ${scenario}/${id}`); return value; };
    const phase = round++;
    let output;
    if (scenario === 'explore') {
      switch (phase) {
        case 0: {
          const names = body.tools[0].tools.map(t => t.name);
          assert.ok(names.includes('query_points')); assert.ok(names.includes('set_scene_marks'));
          assert.ok(!names.includes('scan_area_candidates')); assert.ok(!names.includes('search_placement_sites'));
          output = [call('inspect_scene'), call('load_skill', { skillId: 'candidate-assessment' })]; break;
        }
        case 1:
          assert.ok(result('inspect_scene').sceneBounds);
          output = [call('capture_scene', { kind: 'camera', position: [50, -50, 100], target: [50, 50, 0], up: [0, 0, 1], colorMode: 'rgb' })]; break;
        case 2:
          await deliveredCapture(body, result('capture_scene'));
          output = [call('set_scene_marks', { expectedRevision: 0, marks: positions.map(p => mark(p)) }, 'invent')]; break;
        case 3:
          initialMarks = result('invent'); assert.equal(initialMarks.annotationRevision, 1);
          assert.deepEqual(initialMarks.marks.map(m => m.position), positions);
          assert.ok(initialMarks.marks.every(m => m.observationId === result('capture_scene').observation.observationId));
          output = [call('query_points', { operation: 'radius', position: positions[2], radiusMeters: 2.75, maxResults: 4 })]; break;
        case 4: {
          const query = result('query_points'); assert.equal(query.domain, 'original-source-points');
          assert.equal(query.complete, true); assert.ok(query.totalCount > 4); assert.equal(query.points.length, 4);
          output = [call('set_scene_marks', { expectedRevision: 1, marks: [mark(revisedPosition, initialMarks.marks[2].id), mark(positions[0], initialMarks.marks[0].id)] }, 'revise')]; break;
        }
        case 5:
          revisedMarks = result('revise'); assert.equal(revisedMarks.annotationRevision, 2);
          assert.deepEqual(revisedMarks.marks.map(m => [m.id, m.rank, m.position]), [[initialMarks.marks[2].id, 1, revisedPosition], [initialMarks.marks[0].id, 2, positions[0]]]);
          output = [call('set_scene_marks', { expectedRevision: 1, marks: [] }, 'stale')]; break;
        case 6:
          assert.equal(result('stale').kind, 'scene-marks-conflict'); assert.deepEqual(result('stale').current, revisedMarks);
          output = [call('get_scene_marks')]; break;
        case 7:
          assert.deepEqual(result('get_scene_marks'), revisedMarks);
          output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Recovered stale annotation revision by reading current hypotheses. C1 and C2 are model-chosen provisional locations; utilities and occlusions remain unknown. No geometry was created.' }] }]; break;
        default: assert.fail(`unexpected exploration round ${phase}`);
      }
    } else {
      if (phase === 0) output = [call('load_skill', { skillId: 'candidate-assessment' })];
      else if (phase === 1) output = [call('get_scene_marks')];
      else if (phase === 2 && scenario === 'resume') {
        assert.deepEqual(result('get_scene_marks'), revisedMarks);
        output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The same hypotheses remain in this conversation.' }] }];
      } else if (phase === 2 && scenario === 'reset') {
        assert.equal(result('get_scene_marks').annotationRevision, 0); assert.deepEqual(result('get_scene_marks').marks, []);
        output = [call('set_scene_marks', { expectedRevision: 0, marks: [mark([51.125, 49.375, .1])] }, 'new')];
      } else if (phase === 3 && scenario === 'reset') {
        assert.equal(result('new').annotationRevision, 1);
        output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'New conversation started at annotation revision zero and placed a new provisional C1.' }] }];
      } else assert.fail(`unexpected ${scenario} round ${phase}`);
    }
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const backend = `http://127.0.0.1:${server.address().port}`;
  const seam = { name: 'task069-inspect-capture-only', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/Toronto.svelte')) return;
    const needle = 'onMount(() => {'; assert.equal(code.split(needle).length, 2);
    return code.replace(needle, `${needle}\n    globalThis.__task069 = { capture: request => viewer.capture(request) };`);
  } };
  const proxyOptions = { target: backend, changeOrigin: true, configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', backend)); } };
  const proxy = Object.fromEntries(['/auth/', '/datasets/', '/project', '/chat/', '^/auth/status$', '^/auth/logout$'].map(key => [key, proxyOptions]));
  const reservation = createNetServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  vite = await createServer({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts'), plugins: [seam], server: { host: '127.0.0.1', port, strictPort: true, proxy } });
  await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  report.origin = origin; report.backend = backend;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('response', async response => { if (response.url().includes('/chat/turn')) { try { await writeFile(join(directory, `${viewport}-${scenario}-stream.ndjson`), await response.text()); } catch {} } });
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('request', request => { assert.ok(!/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)\//.test(request.url()), 'must not touch production listeners'); });
  const authority = async () => { const out = {}; for (const path of ['/datasets/toronto3d/cad', '/datasets/toronto3d/overrides', '/datasets/toronto3d/objects']) { const response = await fetch(backend + path); out[path] = { status: response.status, body: await response.json() }; } return out; };
  const send = async text => { await page.getByTestId('local-draft').fill(text); await page.getByTestId('send-local-draft').click(); };
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    viewport = name; scenario = 'explore'; round = 0;
    await page.setViewportSize(size); await page.goto(origin + '/?smoke');
    await page.getByTestId('toronto-viewer').locator('canvas').waitFor();
    await page.waitForFunction(() => globalThis.__task069 && document.querySelector('[data-testid="model-select"]')?.value === 'fixture-model' && document.querySelector('[data-testid="toronto-viewer"]')?.dataset.ready === 'true');
    await page.waitForTimeout(600); await shot(`${name}-01-idle`);
    const initial = await authority(); for (const snapshot of Object.values(initial)) assert.equal(snapshot.status, 200);
    await save(`${name}-initial-authorities.json`, initial);
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    const before = await cameraState();
    await send('Explore the scene and mark your own locations, inspect a chosen local radius, then revise and reorder two hypotheses. Do not create geometry.');
    await page.getByText('Recovered stale annotation revision', { exact: false }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="model-chat"]')?.dataset.state !== 'streaming');
    assert.equal(round, 8, 'skills load in a prior provider request, not bypassed');
    assert.deepEqual(await cameraState(), before, 'custom capture and marks preserve live camera and orbit target');
    assert.deepEqual((await liveMarks()).map(m => [m.id, m.rank, m.position]), revisedMarks.marks.map(m => [m.id, m.rank, m.position]));
    // Bring the recovered answer into the mobile transcript viewport for visual review.
    await page.getByText('Recovered stale annotation revision', { exact: false }).scrollIntoViewIfNeeded();
    await shot(`${name}-02-recovery-chat`);
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    const unselected = await readableLabels(); await shot(`${name}-03-marked`);
    await page.getByTestId('scene-mark-2').click();
    assert.equal(await page.getByTestId('scene-mark-2').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(350);
    const selected = await readableLabels(2); await shot(`${name}-04-selected`);
    report.viewports[name] = { size, unselected, selected, finalMarks: await liveMarks(), cameraPreserved: true };
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    scenario = 'resume'; round = 0;
    await send('Continue inspecting the same hypotheses; do not replace or clear them.');
    await page.getByText('The same hypotheses remain', { exact: false }).waitFor();
    assert.equal((await liveMarks()).length, 2, 'regular send retains annotations');
    await page.getByTestId('model-new-chat').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="toronto-viewer"]').dataset.sceneMarks ?? '[]').length === 0);
    assert.equal(await page.getByTestId('scene-mark-list').count(), 0, 'New chat clears UI and renderer');
    await shot(`${name}-05-new-chat-clear`);
    scenario = 'reset'; round = 0;
    await send('Start fresh; mark one location in this new conversation.');
    await page.getByText('New conversation started at annotation revision zero', { exact: false }).waitFor();
    assert.equal((await liveMarks()).length, 1, 'lower annotation revision accepted after reset');
    assert.deepEqual((await liveMarks())[0].position, [51.125, 49.375, .1]);
    await shot(`${name}-06-new-chat-remarked`);
    assert.equal(await page.getByTestId('area-candidate-shortlist').count(), 0);
    assert.equal(await page.getByTestId('toronto-cad-proposal').count(), 0); assert.equal(await page.getByTestId('scene-object-proposal').count(), 0);
    const final = await authority(); await save(`${name}-final-authorities.json`, final);
    assert.deepEqual(final, initial, 'exploration/captures/marks/recovery/new chat do not mutate point/CAD/object authorities');
    report.checks.push(`${name}: actual skill load rounds; inspect bounds; delivered custom camera capture; arbitrary own coordinates; real radius query; stable-ID move/remove/reorder to C1/C2; stale revision conflict/read recovery; readable marked/selected labels; camera preserved; regular send retains marks; real New chat clears state/renderer then accepts revision 0; no AOI/scan or geometry mutation`);
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) {
  report.error = String(error?.stack ?? error); if (page) try { await shot('failure'); } catch {} process.exitCode = 1;
} finally {
  await save('actual-provider-bodies.json', bodies); await save('tool-results.json', toolResults); await save('report.json', report);
  await browser?.close(); await vite?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, directory, checks: report.checks, error: report.error }, null, 2));
}
