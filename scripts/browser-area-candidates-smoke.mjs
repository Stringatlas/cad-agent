// Task066 isolated acceptance: node --import tsx scripts/browser-area-candidates-smoke.mjs [artifacts]
// pnpm build first. AREA_CANDIDATE_COUNT=3..20 (default 5); selects [third, first].
// Headless owned Chrome; ephemeral HTTP/Vite/project/source.
// Only provider transport is mocked. Fixture-only Vite seam calls the real AOI callback.
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

const candidateCount = Number(process.env.AREA_CANDIDATE_COUNT ?? 5);
assert.ok(Number.isInteger(candidateCount) && candidateCount >= 1 && candidateCount <= 20, 'AREA_CANDIDATE_COUNT must be an integer from 1 to 20');
assert.ok(candidateCount >= 3, 'Task066 requires at least three provisional alternatives to prove subset/reordering');
const finalCount = 2;
const rationale = 'Mock model preference: visible ground context near this measured point; reordered from numeric evidence.';
const uncertainty = 'Synthetic fixture only; occluded surfaces and utilities remain unknown.';
let scenario = 'assessed';
let provisional, finalSelections;
const ranks = Array.from({ length: finalCount }, (_, i) => i + 1);
const directory = resolve(process.argv[2] ?? '/tmp/task066-browser');
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task066-browser-owned-'));
const report = { status: 'failed', candidateCount, error: undefined, checks: [], errors: [], screenshots: [], viewports: {}, visualReview: 'Automated assertions cover function only; inspect saved screenshots separately for visual acceptance.', ownership: 'Own headless browser; ephemeral backend/project/source and Vite on OS-assigned ports. No requests to production :5173/:3001 or any pre-existing fixture. Mock provider only; real model route, engine, tool transport, UI and Three renderer. AOI seeded via fixture-only transformed callback (no production source edits).' };
let browser, page, server, vite;
const bodies = [], toolResults = [], captures = [];
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
async function assertReadableLabels(selected) {
  await page.waitForFunction(count => JSON.parse(document.querySelector('[data-testid="toronto-viewer"]')?.dataset.areaCandidateLabels ?? '[]').length === count, finalCount);
  const boxes = JSON.parse(await page.getByTestId('toronto-viewer').getAttribute('data-area-candidate-labels'));
  const canvas = await page.getByTestId('toronto-viewer').locator('canvas').boundingBox();
  const panel = await page.getByTestId('area-candidate-shortlist').boundingBox();
  assert.deepEqual(boxes.map(box => box.text), ranks.map(rank => `C${rank}`));
  assert.deepEqual(boxes.filter(box => box.selected).map(box => box.rank), selected ? [selected] : []);
  for (const box of boxes) {
    assert.ok(box.x >= 11 && box.y >= 11 && box.x + box.width <= canvas.width - 11 && box.y + box.height <= canvas.height - 11, 'labels must remain inside the canvas');
    assert.ok(box.x + canvas.x + box.width <= panel.x || panel.x + panel.width <= box.x + canvas.x || box.y + canvas.y + box.height <= panel.y || panel.y + panel.height <= box.y + canvas.y, 'labels must not be obscured by the visible shortlist');
    for (const other of boxes.filter(other => other.rank !== box.rank)) assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y, 'actual projected label rectangles must not overlap');
  }
  // Inspect actual rendered pixels, not just marker/annotation counts. Capture is
  // the real synchronous WebGL path, also proving capture annotations are updated.
  const capture = await page.evaluate(() => globalThis.__task065.capture({ kind: 'current' }));
  const pixels = await page.evaluate(async ({ dataUrl, boxes, size }) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return boxes.map(box => {
      const scaleX = image.width / size.width, scaleY = image.height / size.height;
      const data = context.getImageData(Math.round((box.x + 9) * scaleX), Math.round((box.y + 5) * scaleY), Math.round((box.width - 18) * scaleX), Math.round((box.height - 10) * scaleY)).data;
      let ink = 0, background = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 65 && data[i + 1] < 85 && data[i + 2] < 125) ink++;
        if (data[i] > 170 && data[i + 1] > 170 && data[i + 2] > 120) background++;
      }
      return { rank: box.rank, ink, background };
    });
  }, { dataUrl: capture.image.dataUrl, boxes, size: canvas });
  for (const pixel of pixels) { assert.ok(pixel.ink >= 20, `C${pixel.rank} must have rendered dark text`); assert.ok(pixel.background >= 100, `C${pixel.rank} must have a rendered light label background`); }
  return { boxes, pixels };
}
async function shot(name) {
  await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(directory, name + '.png') }); report.screenshots.push(name + '.png');
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
  let round = 0;
  const cameraState = async () => page.getByTestId('toronto-viewer').evaluate(el => ({ camera: JSON.parse(el.dataset.camera), target: JSON.parse(el.dataset.cameraTarget) }));
  server = createDemoServer({ datasetRoot: root, projectPath: join(root, 'project.json'), provider: { mode: 'api-key', apiKey: 'synthetic-test-only' }, modelTransport: async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    for (const input of body.input ?? []) if (input.type === 'function_call_output') {
      const value = JSON.parse(input.output); if (!toolResults.some(r => r.callId === input.call_id)) toolResults.push({ callId: input.call_id, value });
    }
    const call = (name, args) => ({ type: 'function_call', namespace: 'scene', name, call_id: `task066_${page.viewportSize().width}_${scenario}_${round}_${name}`, arguments: JSON.stringify(args) });
    const phase = round++;
    let output;
    if (phase === 0) output = [call('scan_area_candidates', { settings: { maxCandidates: candidateCount, spacingMeters: 2, clearanceRadiusMeters: .5, maxGroundReliefMeters: .25, minPoleDistanceMeters: 0, ranking: 'flat-ground' } })];
    else if (phase === 1) {
      provisional = toolResults.at(-1).value;
      assert.equal(provisional.kind, 'area-candidate-result');
      assert.equal(provisional.result.assessment.kind, 'provisional');
      assert.equal(provisional.result.candidates.length, candidateCount);
      assert.equal(await page.getByTestId('area-candidate-shortlist').getByRole('heading').textContent(), 'Provisional locations');
      await shot(`${scenario}-${page.viewportSize().width}-provisional`);
      output = [call('capture_scene', provisional.candidateAssessmentCapture)];
    } else if (phase === 2 && scenario === 'assessed') {
      const capture = toolResults.at(-1).value;
      assert.equal(capture.status, 'captured');
      assert.ok(capture.candidateCaptureId, 'actual targeted capture must produce a usable evidence receipt');
      const images = (body.input ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'input_image');
      const delivered = images.find(image => image.image_url?.startsWith('data:image/') && createHash('sha256').update(Buffer.from(image.image_url.split(',')[1], 'base64')).digest('hex') === capture.observation.image.sha256);
      assert.ok(delivered, 'next real provider request must contain exact targeted capture bytes (not merely an initial/history image) before finalization');
      await writeFile(join(directory, `${page.viewportSize().width}-delivered-assessment.jpg`), Buffer.from(delivered.image_url.split(',')[1], 'base64'));
      finalSelections = [provisional.result.candidates[2], provisional.result.candidates[0]];
      output = [call('finalize_area_candidates', { scanId: provisional.result.assessment.scanId, captureId: capture.candidateCaptureId, selections: finalSelections.map(c => ({ candidateId: c.id, rationale, uncertainty })) })];
    } else {
      if (scenario === 'assessed') {
        const finalized = toolResults.at(-1).value;
        assert.equal(finalized.result?.assessment?.kind, 'model-assessed', JSON.stringify(finalized));
        assert.deepEqual(finalized.result.candidates.map(c => c.id), finalSelections.map(c => c.id));
      } else assert.notEqual(toolResults.at(-1).value.status, 'captured', 'fixture capture failure must be reported truthfully');
      output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: scenario === 'assessed' ? 'Model chose two locations in a different order from the provisional pool. These synthetic judgements are not suitability verification. No geometry was created.' : 'Visual assessment unavailable: capture failed. Numerical locations remain provisional; no assessed recommendations or geometry created.' }] }];
    }
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const backend = `http://127.0.0.1:${server.address().port}`;
  const seam = { name: 'task065-isolated-aoi-seam', enforce: 'pre', transform(code, id) { if (!id.endsWith('/Toronto.svelte')) return; const needle = 'onMount(() => {'; assert.equal(code.split(needle).length, 2); return code.replace(needle, `${needle}\n    globalThis.__task065 = { selectArea, capture: request => viewer.capture(request) };`).replace('capture: request => current.capture(request)', "capture: request => { if (globalThis.__task066Unavailable) throw new Error('Fixture capture unavailable'); return current.capture(request); }"); } };
  // Local-only model/auth APIs whitelist the backend origin. Rewrite only our fixture proxy.
  const proxyOptions = { target: backend, changeOrigin: true, configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', backend)); } };
  const proxy = Object.fromEntries(['/auth/', '/datasets/', '/project', '/chat/', '^/auth/status$', '^/auth/logout$'].map(key => [key, proxyOptions]));
  const reservation = createNetServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  vite = await createServer({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts'), plugins: [seam], server: { host: '127.0.0.1', port, strictPort: true, proxy } });
  await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  report.origin = origin; report.backend = backend;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('request', request => { assert.ok(!/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)\//.test(request.url()), 'must never touch production listeners'); });
  const authority = async () => { const out = {}; for (const path of ['/datasets/toronto3d/cad', '/datasets/toronto3d/overrides', '/datasets/toronto3d/objects']) { const response = await fetch(backend + path); out[path] = { status: response.status, body: await response.json() }; } return out; };
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(size); await page.goto(origin + '/?smoke');
    await page.getByTestId('toronto-viewer').locator('canvas').waitFor();
    await page.waitForFunction(() => globalThis.__task065 && document.querySelector('[data-testid="model-select"]')?.value === 'fixture-model' && document.querySelector('[data-testid="toronto-viewer"]')?.dataset.ready === 'true');
    await page.waitForTimeout(600);
    await shot(`${name}-01-idle`);
    const initial = await authority();
    for (const snapshot of Object.values(initial)) assert.equal(snapshot.status, 200, 'authority comparison must use successful snapshots');
    await save(`${name}-initial-authorities.json`, initial);
    await page.evaluate(() => globalThis.__task065.selectArea([[0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100]]));
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    round = 0; scenario = 'assessed';
    const beforeCamera = await cameraState();
    await page.getByTestId('local-draft').fill(`Scan this entire 100 × 100 meter area and show ${candidateCount} candidate POINT locations. Use exploratory 2m spacing, .5m observed-obstacle radius, .25m relief, zero pole exclusion; flat ground ranking. Do not create geometry.`);
    await page.getByTestId('send-local-draft').click();
    await page.waitForFunction(count => JSON.parse(document.querySelector('[data-testid="toronto-viewer"]').dataset.areaCandidates ?? '[]').length === count, finalCount);
    await page.waitForFunction(() => document.querySelector('[data-testid="model-chat"]')?.dataset.state !== 'streaming');
    assert.deepEqual(await cameraState(), beforeCamera, 'targeted assessment capture must preserve live camera and orbit target');
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByRole('heading').textContent(), 'Model-assessed locations');
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByText(rationale, { exact: true }).count(), finalCount);
    await page.getByTestId('area-candidate-shortlist').waitFor({ state: 'attached' });
    const markers = JSON.parse(await page.getByTestId('toronto-viewer').getAttribute('data-area-candidates'));
    assert.deepEqual(markers.map(p => p.rank), ranks);
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByRole('button').count(), finalCount);
    assert.deepEqual(markers.map(p => p.position), finalSelections.map(c => c.position));
    await shot(`${name}-02-chat-results`);
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    await page.getByTestId('area-candidate-shortlist').getByText('Scan evidence', { exact: true }).click();
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByText(uncertainty, { exact: false }).count(), finalCount);
    const unselectedLabels = await assertReadableLabels();
    await shot(`${name}-03-scene-candidates`);
    let selectedLabels;
    await page.getByTestId('area-candidate-2').click();
    assert.equal(await page.getByTestId('area-candidate-2').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(250);
    selectedLabels = await assertReadableLabels(2);
    await shot(`${name}-03b-selected-C2`);
    const capture = await page.evaluate(() => globalThis.__task065.capture({ kind: 'current' })); captures.push(capture);
    assert.equal(capture.coverage.layers.areaCandidatePoints, finalCount);
    const image = capture.image; assert.ok(image?.dataUrl?.startsWith('data:image/'));
    await writeFile(join(directory, `${name}-capture.jpg`), Buffer.from(image.dataUrl.split(',')[1], 'base64'));
    report.viewports[name] = { size, markers, unselectedLabels, selectedLabels, captureMetadata: { ...capture, image: { ...image, dataUrl: '[saved separately]' } } };
    assert.deepEqual(await authority(), initial, 'scanning/capturing must not mutate point/CAD/object authority');
    assert.equal(await page.getByTestId('toronto-cad-proposal').count(), 0);
    assert.equal(await page.getByTestId('scene-object-proposal').count(), 0);
    await page.evaluate(() => globalThis.__task065.selectArea([[10, 10, 100], [90, 10, 100], [90, 90, 100], [10, 90, 100]]));
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="toronto-viewer"]').dataset.areaCandidates ?? '[]').length === 0);
    assert.equal(await page.getByTestId('area-candidate-shortlist').count(), 0);
    await shot(`${name}-04-area-invalidated`);
    report.checks.push(`${name}: real chat → real 1ha scan of ${candidateCount} provisional points → targeted capture → delivered image → mock model subset/reorder to C1–C2 with rationale/uncertainty; camera preserved; no mutation; AOI invalidation`);
    scenario = 'unavailable'; round = 0;
    await page.evaluate(() => { globalThis.__task066Unavailable = true; globalThis.__task065.selectArea([[0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100]]); });
    if (name === 'mobile') await page.getByRole('button', { name: 'Toggle chat', exact: true }).click();
    await page.getByTestId('local-draft').fill('Find candidate locations; if visual capture is unavailable leave them provisional.');
    await page.getByTestId('send-local-draft').click();
    await page.getByText('Visual assessment unavailable: capture failed.', { exact: false }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="model-chat"]')?.dataset.state !== 'streaming');
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByRole('heading').textContent(), 'Provisional locations');
    assert.equal(await page.getByTestId('area-candidate-shortlist').getByRole('button').count(), candidateCount);
    assert.equal(await page.getByText('Model-assessed locations', { exact: true }).count(), 0);
    await shot(`${name}-05-capture-unavailable`);
    if (name === 'mobile') { await page.getByRole('button', { name: 'Toggle chat', exact: true }).click(); await shot(`${name}-06-unavailable-scene`); }
    assert.deepEqual(await authority(), initial);
    report.checks.push(`${name}: injected capture error truthfully reported; all numerical points remain provisional, no assessed heading or authority mutation`);
  }
  const scans = toolResults.filter(r => r.value?.kind === 'area-candidate-result' && r.value.result.assessment.kind === 'provisional');
  assert.equal(scans.length, 4); for (const scan of scans) { assert.equal(scan.value.result.status, 'complete'); assert.equal(scan.value.result.evidence.sourcePointsExamined, 120000); assert.equal(scan.value.result.candidates.length, candidateCount); }
  const captured = toolResults.filter(r => r.value?.status === 'captured'); assert.equal(captured.length, 2);
  for (const item of captured) assert.equal(item.value.observation.coverage.layers.areaCandidatePoints, candidateCount);
  assert.equal(toolResults.filter(r => r.value?.result?.assessment?.kind === 'model-assessed').length, 2);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.error = String(error?.stack ?? error); if (page) try { await shot('failure'); } catch {} process.exitCode = 1;
} finally {
  // Provider bodies include synthetic scene images, never a credential or opaque reasoning.
  await save('actual-provider-bodies.json', bodies); await save('tool-results.json', toolResults); await save('report.json', report);
  await browser?.close(); await vite?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, directory, checks: report.checks, error: report.error }, null, 2));
}
