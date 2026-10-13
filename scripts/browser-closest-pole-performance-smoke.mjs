// Task008 only: existing servers + exact, parent-owned CDP tab. No launch, new
// tab, browser/tab shutdown, geometry fabrication, dataset/cache mutation.
// Usage: node scripts/browser-closest-pole-performance-smoke.mjs CDP EXACT_URL
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const directory = new URL('../artifacts/closest-pole-performance/browser/', import.meta.url);
const TIMEOUT = 30_000, QUERY_TIMEOUT = 60_000;
const CAMERA_EPSILON_METERS = 1e-6; // One micrometer, not a rounding/quantization boundary.
const report = {
  status: 'failed', task: '008', consoleCaptured: false, observationError: '', messages: [], checks: [],
  screenshots: [], queries: [], requests: [], layouts: [], observations: [], cameraStability: [], cameraComparisons: [],
  latencyScope: 'Real ungated native gesture/retry to validated UI completion; no cold/warm inference. Gated cancellation timing is separate, never a latency benchmark.',
};
let browser, page, routeHandler, gate;
const seenObservations = new Set();
const observations = [];
const queryURL = url => new URL(url).pathname === '/datasets/toronto3d/closest-pole';
const now = () => performance.now();
const artifact = name => fileURLToPath(new URL(name, directory));
async function bounded(promise, label, milliseconds = TIMEOUT) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function save(name, value) { await writeFile(artifact(name), JSON.stringify(value, null, 2) + '\n'); }
function canonical(request) {
  return { requestId: request.requestId, datasetId: request.datasetId,
    expectedArtifactRevision: request.expectedArtifactRevision, units: request.units, frameId: request.frameId,
    input: { kind: request.input.kind, key: { sourceFileId: request.input.key.sourceFileId, sourceRow: request.input.key.sourceRow } },
    filter: { schema: request.filter.schema, attribute: request.filter.attribute, value: request.filter.value },
    metric: request.metric, domain: { kind: request.domain.kind } };
}
function validateTerminal(raw, request) {
  assert.ok(raw.endsWith('\n'), 'NDJSON must end with EOF after complete frames');
  const frames = raw.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(frames[0].type, 'start'); assert.deepEqual(frames[0].request, request);
  const phases = ['index', 'resolve', 'search', 'verify-resolve', 'verify'];
  let previous;
  for (const [i, frame] of frames.entries()) {
    assert.equal(frame.requestId, request.requestId);
    assert.equal(frame.artifactRevision, request.expectedArtifactRevision);
    if (i === 0) continue;
    if (i === frames.length - 1) { assert.equal(frame.type, 'result'); continue; }
    assert.equal(frame.type, 'progress'); const progress = frame.progress;
    assert.ok(phases.includes(progress.phase));
    for (const key of ['scannedPoints', 'payloadBytes']) assert.ok(Number.isSafeInteger(progress[key]) && progress[key] >= 0);
    if (previous) {
      assert.ok(phases.indexOf(progress.phase) >= phases.indexOf(previous.phase));
      if (progress.phase === previous.phase) {
        assert.ok(progress.scannedPoints >= previous.scannedPoints);
        assert.ok(progress.payloadBytes >= previous.payloadBytes);
      }
    }
    previous = progress;
  }
  const result = frames.at(-1).result;
  assert.equal(result.status, 'verified-found'); assert.equal(result.complete, true);
  assert.deepEqual(result.request, request); assert.deepEqual(request, canonical(request));
  assert.equal(request.datasetId, 'toronto3d'); assert.equal(request.input.kind, 'point-ref');
  assert.equal(request.units, 'm'); assert.equal(request.frameId, 'toronto3d-local-v1');
  assert.equal(request.metric, 'euclidean-3d'); assert.equal(request.domain.kind, 'whole-dataset');
  assert.deepEqual(request.filter, { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 });
  assert.equal(result.dataset.id, request.datasetId); assert.equal(result.dataset.revision, request.expectedArtifactRevision);
  assert.equal(result.dataset.totalPoints, 78320210);
  assert.deepEqual(result.dataset.coordinates, { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] });
  const { search, verification } = result;
  assert.equal(search.algorithm, 'pole-category-index-v1'); assert.equal(search.completion, 'indexed');
  assert.equal(search.arithmetic, 'xyz-binary64-v1'); assert.equal(verification.verifier, 'pole-category-linear-v1');
  assert.equal(search.index.points, 897825); assert.match(search.index.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(verification.index, search.index); assert.equal(verification.scannedPoints, search.index.points);
  assert.ok(search.scannedPoints > 0 && search.scannedPoints <= search.index.points);
  const requestHash = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
  const statsFields = ['scannedPoints', 'matchingPoints', 'hierarchyChunks', 'payloadNodes', 'hierarchyBytes', 'payloadBytes', 'metadataBytes', 'maxReadBytes', 'resolutionPoints', 'resolutionPayloadBytes'];
  for (const evidence of [search, verification]) {
    for (const key of statsFields) assert.ok(Number.isSafeInteger(evidence[key]) && evidence[key] >= 0, key);
    assert.equal(evidence.artifactRevision, request.expectedArtifactRevision);
    assert.equal(evidence.requestHash, requestHash); assert.equal(evidence.matchingPoints, 897825);
    assert.equal(evidence.resolutionPoints, 1); assert.ok(evidence.resolutionPayloadBytes > 0 && evidence.resolutionPayloadBytes <= 256);
    assert.equal(evidence.hierarchyChunks, 0); assert.equal(evidence.payloadNodes, 0); assert.equal(evidence.hierarchyBytes, 0);
    assert.ok(evidence.maxReadBytes <= 4 * 1024 * 1024);
  }
  assert.equal(search.payloadBytes, 0); assert.ok(verification.payloadBytes <= 256);
  assert.equal(search.resolutionPayloadBytes, verification.resolutionPayloadBytes);
  assert.match(search.configHash, /^[a-f0-9]{64}$/); assert.match(search.traversalHash, /^[a-f0-9]{64}$/);
  assert.match(verification.transcriptHash, /^[a-f0-9]{64}$/);
  const nearest = result.nearest; assert.equal(nearest.label, 6);
  assert.ok(Number.isInteger(nearest.key.sourceFileId) && nearest.key.sourceFileId >= 1 && nearest.key.sourceFileId <= 4);
  assert.ok(Number.isInteger(nearest.key.sourceRow) && nearest.key.sourceRow >= 0 && nearest.key.sourceRow <= 0xffffffff);
  for (const position of [nearest.position, result.queryPosition]) {
    assert.ok(Array.isArray(position) && position.length === 3 && position.every(Number.isFinite));
  }
  const [dx, dy, dz] = nearest.position.map((n, i) => n - result.queryPosition[i]);
  assert.equal(nearest.distanceSquared, (dx * dx + dy * dy) + dz * dz);
  assert.equal(nearest.distanceMeters, Math.sqrt(nearest.distanceSquared));
  if (result.sourceReads) {
    for (const n of Object.values(result.sourceReads)) assert.ok(Number.isSafeInteger(n) && n >= 0);
    assert.ok(result.sourceReads.maxReadBytes <= 4 * 1024 * 1024);
  }
  return { frames, result };
}
function findProvenance(request, result) {
  for (const sample of [...observations].reverse()) {
    if (sample.dataset.revision !== request.expectedArtifactRevision) continue;
    for (let i = 0; i < sample.count; i++) {
      if (sample.sourceIds[i * 2] === request.input.key.sourceFileId && sample.sourceIds[i * 2 + 1] === request.input.key.sourceRow) {
        const position = sample.positions.slice(i * 3, i * 3 + 3);
        assert.deepEqual(position, result.queryPosition, 'Original binary64 observation, not GPU coordinates');
        return { key: request.input.key, position, revision: sample.dataset.revision, sampleHash: sample.sampleHash, count: sample.count, lod: sample.lod, observationIndex: i };
      }
    }
  }
  assert.fail('Selected source key not in an actual captured display observation');
}
async function capturedBody(url) {
  await page.waitForFunction(url => window.__task008Fetches?.some(entry => entry.url === url && entry.done), url, { timeout: QUERY_TIMEOUT });
  const entries = await page.evaluate(url => window.__task008Fetches.filter(entry => entry.url === url && entry.done), url);
  assert.equal(entries.length, 1, 'Exactly one observer clone for each real query response');
  const entry = entries[0]; assert.ok(!entry.error, entry.error); return entry.body;
}
async function waitReady() {
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-display-status"]')?.textContent?.startsWith('Ready') && document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-ready') === 'true', undefined, { timeout: TIMEOUT });
  await page.waitForFunction(() => window.__task008Fetches?.some(entry => entry.url.includes('/observation?purpose=display') && entry.done && !entry.error), undefined, { timeout: TIMEOUT });
  const entries = await page.evaluate(() => window.__task008Fetches.filter(entry => entry.url.includes('/observation?purpose=display') && entry.done && !entry.error));
  for (const entry of entries) {
    if (seenObservations.has(entry.id)) continue;
    seenObservations.add(entry.id); assert.equal(entry.status, 200);
    const sample = JSON.parse(entry.body); observations.push(sample);
    report.observations.push({ count: sample.count, sampleHash: sample.sampleHash, lod: sample.lod, revision: sample.dataset.revision });
  }
  assert.equal(await page.getByTestId('pole-gpu-error').count(), 0);
}
async function waitPhase(phase) {
  await page.waitForFunction(phase => document.querySelector('[data-testid="pole-status"]')?.textContent === phase, phase, { timeout: TIMEOUT });
}
function cameraDistance(a, b) {
  const left = JSON.parse(a), right = JSON.parse(b);
  for (const value of [left, right]) assert.ok(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite));
  return Math.hypot(...left.map((n, i) => n - right[i]));
}
function compareCamera(actual, expected, label) {
  const displacementMeters = cameraDistance(actual, expected);
  report.cameraComparisons.push({ label, actual: JSON.parse(actual), expected: JSON.parse(expected), displacementMeters, toleranceMeters: CAMERA_EPSILON_METERS });
  assert.ok(displacementMeters <= CAMERA_EPSILON_METERS, `${label}: camera displaced ${displacementMeters}m`);
}
async function stableCamera() {
  const samples = [], started = now();
  for (let i = 0; i < 30; i++) {
    const raw = await page.getByTestId('pole-viewer').getAttribute('data-camera');
    assert.ok(raw); cameraDistance(raw, raw);
    samples.push({ milliseconds: now() - started, camera: JSON.parse(raw) });
    // Three consecutive 200ms intervals must fit within one micrometer of the
    // latest raw position. Avoid quantized strings, which can alternate across a
    // rounding boundary despite only binary64 ULP drift in OrbitControls.
    const window = samples.slice(-4);
    if (window.length === 4 && window.every(sample => cameraDistance(JSON.stringify(sample.camera), raw) <= CAMERA_EPSILON_METERS)) {
      report.cameraStability.push({ settled: true, toleranceMeters: CAMERA_EPSILON_METERS, samples });
      return raw;
    }
    await delay(200);
  }
  report.cameraStability.push({ settled: false, toleranceMeters: CAMERA_EPSILON_METERS, samples });
  assert.fail('Camera did not settle in six seconds');
}
async function target() {
  await page.getByTestId('pole-viewer').scrollIntoViewIfNeeded();
  const box = await page.getByTestId('pole-viewer').boundingBox();
  const point = JSON.parse(await page.getByTestId('pole-viewer').getAttribute('data-pick-point'));
  assert.ok(box && Array.isArray(point));
  assert.ok(point[0] > 0 && point[0] < box.width && point[1] > 0 && point[1] < box.height, 'Smoke point must actually be visible in the canvas');
  return { x: box.x + point[0], y: box.y + point[1] };
}
async function gesture(modifier, point, dragReturn = false, shift = false) {
  await bounded((async () => {
    try {
      if (shift) await page.keyboard.down('Shift');
      await page.keyboard.down(modifier); await page.mouse.move(point.x, point.y); await page.mouse.down();
      if (dragReturn) {
        await page.mouse.move(point.x + 30, point.y + 20, { steps: 5 });
        await page.mouse.move(point.x, point.y, { steps: 5 });
      }
      await page.mouse.up();
    } finally {
      await page.keyboard.up(modifier); if (shift) await page.keyboard.up('Shift');
    }
  })(), 'native modified pointer gesture');
}
async function completedUI(result) {
  await waitPhase('verified-found');
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-query-winner') === 'true', undefined, { timeout: TIMEOUT });
  assert.equal(await page.getByTestId('pole-viewer').getAttribute('data-query-selected'), 'true');
  const selected = await page.getByTestId('pole-selection').locator('dd').allTextContents();
  assert.deepEqual(selected, [`${result.request.input.key.sourceFileId} / ${result.request.input.key.sourceRow}`, result.queryPosition.join(', '), result.dataset.revision]);
  const returned = await page.getByTestId('pole-result').locator('dd').allTextContents();
  assert.deepEqual(returned, [String(result.nearest.distanceMeters), `${result.nearest.key.sourceFileId} / ${result.nearest.key.sourceRow}`, result.nearest.position.join(', ')]);
  const text = await page.locator('main').innerText();
  assert.match(text, /Independent verifier: 897[,.\s]?825 indexed Pole records/);
  assert.match(text, /Complete category index: 897[,.\s]?825 points/);
  assert.match(text, /independently checked against all indexed Pole points/);
  assert.doesNotMatch(text, /Independent verifier: [\d,.\s]+ source records/);
  assert.equal(await page.getByTestId('pole-error').count(), 0);
  assert.equal(await page.getByTestId('pole-gpu-error').count(), 0);
}
async function measuredQuery(name, action, expected) {
  const prior = report.requests.length, started = now();
  const responsePromise = page.waitForResponse(response => queryURL(response.url()), { timeout: QUERY_TIMEOUT });
  const [response] = await Promise.all([responsePromise, bounded(Promise.resolve().then(action), 'native query/retry action')]);
  assert.equal(response.status(), 200); assert.match(response.headers()['content-type'] ?? '', /^application\/x-ndjson/);
  const request = JSON.parse(new URL(response.url()).searchParams.get('request'));
  const raw = await capturedBody(response.url());
  const eof = now(); const { frames, result } = validateTerminal(raw, request);
  const provenance = findProvenance(request, result);
  await completedUI(result); const ended = now();
  assert.equal(report.requests.length, prior + 1, 'Exactly one real query per native pick/retry');
  if (expected) {
    assert.deepEqual(request.input, expected.request.input); assert.deepEqual(result.queryPosition, expected.queryPosition);
    assert.deepEqual(result.nearest, expected.nearest); assert.deepEqual(result.search.index, expected.search.index);
    assert.notEqual(request.requestId, expected.request.requestId);
  }
  const timing = { name, gated: false, requestToEOFMilliseconds: eof - report.requests.at(-1).milliseconds,
    networkTimings: response.request().timing(), gestureToEOFMilliseconds: eof - started,
    gestureToVerifiedUIMilliseconds: ended - started, requestId: request.requestId };
  await writeFile(artifact(`${name}.ndjson`), raw); await save(`${name}-result.json`, { timing, provenance, result, frames });
  report.queries.push({ ...timing, provenance, evidence: `${name}-result.json`, ndjson: `${name}.ndjson` });
  return result;
}
async function screenshot(name) {
  await page.screenshot({ path: artifact(name), fullPage: true, timeout: TIMEOUT }); report.screenshots.push(name);
}
async function layout(name, narrow) {
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="pole-viewer"]'), canvas = host?.querySelector('canvas');
    if (!host || !canvas) return false;
    const h = host.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    return h.width > 0 && h.height > 0 && Math.abs(h.width - c.width) < 2 && Math.abs(h.height - c.height) < 2;
  }, undefined, { timeout: TIMEOUT });
  const value = await page.getByTestId('pole-viewer').evaluate(host => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const canvas = host.querySelector('canvas'), aside = document.querySelector('main aside'), section = host.closest('section');
    return { host: rect(host), canvas: rect(canvas), aside: rect(aside), section: rect(section), viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, backing: { width: canvas.width, height: canvas.height }, pixelRatio: Math.min(devicePixelRatio, 2) };
  });
  assert.ok(value.host.x >= 0 && value.host.right <= value.viewport.width + 2);
  assert.ok(value.documentWidth <= value.viewport.width + 2, 'No horizontal layout overflow');
  assert.ok(Math.abs(value.backing.width - value.canvas.width * value.pixelRatio) <= 2);
  assert.ok(Math.abs(value.backing.height - value.canvas.height * value.pixelRatio) <= 2);
  if (narrow) assert.ok(value.aside.y >= value.section.bottom - 2, 'Responsive sidebar below canvas');
  else assert.ok(value.aside.x >= value.section.right - 2, 'Wide sidebar alongside canvas');
  report.layouts.push({ name, ...value });
}
async function negativeQueries(label, action) {
  const prior = report.requests.length; await bounded(Promise.resolve().then(action), label); await delay(300);
  assert.equal(report.requests.length, prior, label); report.checks.push(label);
}

await mkdir(directory, { recursive: true });
try {
  const [endpoint, exactURL] = process.argv.slice(2);
  assert.ok(endpoint && exactURL && process.argv.length === 4, 'Supply CDP endpoint and exact existing unique URL (both required)');
  const parsed = new URL(exactURL);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === '4175', 'Use the existing local preview on :4175');
  assert.ok(parsed.searchParams.has('smoke'), 'Exact parent-owned URL must enable smoke instrumentation');
  report.endpoint = endpoint; report.exactURL = exactURL;
  browser = await chromium.connectOverCDP(endpoint, { timeout: 5000, noDefaults: true });
  const matches = browser.contexts().flatMap(context => context.pages()).filter(candidate => candidate.url() === exactURL);
  assert.equal(matches.length, 1, 'Exactly one pre-existing tab must match URL; never fall back to another tab');
  page = matches[0]; page.setDefaultTimeout(TIMEOUT); page.setDefaultNavigationTimeout(TIMEOUT);
  page.on('console', message => report.messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) })); report.consoleCaptured = true;
  page.on('request', request => {
    if (queryURL(request.url())) report.requests.push({ request: JSON.parse(new URL(request.url()).searchParams.get('request')), milliseconds: now(), gated: !!gate && !gate.completed });
  });
  // Chrome155's CDP Network.getResponseBody does not reliably retain streaming
  // Fetch bodies. Observe a cloned response in-page without modifying bytes or
  // the product consumer; timings include this instrumentation overhead.
  await page.addInitScript(() => {
    if (window.__task008FetchObserverInstalled) return;
    window.__task008FetchObserverInstalled = true;
    window.__task008Fetches = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = response.url;
      if (url.includes('/datasets/toronto3d/')) {
        const entry = { id: window.__task008Fetches.length, url, status: response.status, done: false };
        window.__task008Fetches.push(entry);
        response.clone().text().then(body => { entry.body = body; entry.done = true; }, error => { entry.error = String(error); entry.done = true; });
      }
      return response;
    };
  });
  report.responseCapture = 'Unmodified in-page Fetch response clones; real query timings include observer overhead. Cancelled observation bodies are not used for provenance.';
  await bounded(page.setViewportSize({ width: 1440, height: 1100 }), 'wide viewport');
  await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(page.url(), exactURL);
  await page.getByRole('button', { name: 'Closest pole', exact: true }).click(); await waitReady();
  // Deterministic root LOD yields an actual visible source point, not a synthetic
  // coordinate; the raycaster may pick a neighbour, so validate its provenance.
  await page.getByTestId('pole-depth').selectOption('0'); await waitReady();
  await layout('wide-initial', false); const point = await target(); const camera = await stableCamera();
  for (const modifier of ['Meta', 'Control']) {
    await negativeQueries(`${modifier}+Shift precedence does not query`, () => gesture(modifier, point, false, true));
    await negativeQueries(`${modifier} drag returning to origin does not query`, () => gesture(modifier, point, true));
  }
  compareCamera(await stableCamera(), camera, 'Intercepted gestures do not orbit');
  const first = await measuredQuery('cmd-real-query', () => gesture('Meta', point));
  compareCamera(await stableCamera(), camera, 'Query completion never auto-frames');
  report.checks.push('Native Cmd visible-point pick, original observation provenance, indexed terminal/hash/UI binding, no auto camera move');

  // Buffer an unmodified REAL backend result before deliberately holding it.
  // This gate is solely for deterministic cancellation coverage, not latency.
  let release, gateReadyResolve, gateReadyReject;
  const held = new Promise(resolve => { release = resolve; });
  const gateReady = new Promise((resolve, reject) => { gateReadyResolve = resolve; gateReadyReject = reject; });
  gate = { gated: true, completed: false, release, status: 'holding-real-response', started: now() };
  routeHandler = async route => {
    try {
      const request = JSON.parse(new URL(route.request().url()).searchParams.get('request'));
      const started = now(); const response = await route.fetch({ timeout: QUERY_TIMEOUT, maxRetries: 0 });
      assert.equal(response.status(), 200); assert.match(response.headers()['content-type'] ?? '', /^application\/x-ndjson/);
      const body = await bounded(response.body(), 'gated real backend EOF', QUERY_TIMEOUT);
      const { result } = validateTerminal(body.toString('utf8'), request);
      assert.deepEqual(result.nearest, first.nearest); assert.deepEqual(request.input, first.request.input);
      gate.result = result; gate.backendMilliseconds = now() - started;
      await writeFile(artifact('cancel-gated-real-response.ndjson'), body);
      await save('cancel-gated-real-response.json', { gated: true, measurementExcluded: true, request, result });
      gateReadyResolve();
      await bounded(held, 'explicit cancellation gate release');
      gate.released = now();
      try {
        // Fulfil original status, headers and exact bytes. If browser cancellation
        // rejects delivery, record it; either way the abandoned result must not publish.
        await route.fulfill({ response, body }); gate.delivery = 'fulfilled-original-response';
      } catch (error) { gate.delivery = 'aborted-client-refused-delivery'; gate.deliveryError = String(error); }
    } catch (error) {
      gate.error = String(error); gateReadyReject(error); await route.abort().catch(() => {});
    } finally { gate.completed = true; }
  };
  await page.route('**/datasets/toronto3d/closest-pole?*', routeHandler);
  const beforeGate = report.requests.length; await gesture('Control', await target());
  await bounded(gateReady, 'real cancellation response ready', QUERY_TIMEOUT + 5000);
  assert.equal(report.requests.length, beforeGate + 1);
  await waitPhase('resolving'); assert.equal(await page.getByTestId('pole-cancel').isEnabled(), true);
  assert.equal(await page.getByTestId('pole-retry').isEnabled(), false);
  compareCamera(await stableCamera(), camera, 'Pending gated query never auto-frames');
  await page.getByTestId('pole-cancel').click(); await waitPhase('cancelled-incomplete');
  assert.equal(await page.getByTestId('pole-retry').isEnabled(), true);
  await page.getByTestId('pole-clear').click(); await waitPhase('idle');
  gate.release();
  await bounded((async () => { while (!gate.completed) await delay(25); })(), 'gate handler completion');
  assert.ok(!gate.error, gate.error); await page.unroute('**/datasets/toronto3d/closest-pole?*', routeHandler); routeHandler = undefined;
  await delay(700); await waitPhase('idle');
  assert.equal(await page.getByTestId('pole-result').count(), 0); assert.equal(await page.getByTestId('pole-selection').count(), 0);
  assert.equal(await page.getByTestId('pole-viewer').getAttribute('data-query-selected'), 'false');
  assert.equal(await page.getByTestId('pole-viewer').getAttribute('data-query-winner'), 'false');
  assert.equal(report.requests.length, beforeGate + 1); compareCamera(await stableCamera(), camera, 'Cancellation and late response do not move camera');
  report.cancellation = { gated: true, realResultUnmodified: true, latencyExcluded: true, backendMillisecondsNotUITiming: gate.backendMilliseconds,
    delivery: gate.delivery, deliveryError: gate.deliveryError, afterLateRelease: 'idle/no-selection/no-result/no-markers', passed: true };
  report.checks.push('Real response gate: Cancel active, Cancel+clear, release late real response suppressed');

  // Cancel/Clear buttons can scroll the document; re-resolve native coordinates.
  const ctrl = await measuredQuery('ctrl-real-reselect', async () => gesture('Control', await target()), first);
  const retried = await measuredQuery('retry-real-query', () => page.getByTestId('pole-retry').click(), ctrl);
  compareCamera(await stableCamera(), camera, 'Reselection/retry does not move camera');
  report.checks.push('Native Ctrl reselect and Retry same selection succeed with identical provenance/winner/index');
  await page.getByTestId('pole-frame').click();
  await page.waitForFunction(before => {
    const current = JSON.parse(document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') ?? 'null');
    return current && current.some((n, j) => Math.abs(n - JSON.parse(before)[j]) > 1e-3);
  }, camera, { timeout: TIMEOUT });
  await stableCamera(); await screenshot('wide-result.png');
  report.checks.push('Selected/winner marker flags and displayed geometry; Frame result explicitly moves camera (screenshot evidence)');
  const winnerText = await page.getByTestId('pole-result').innerText();
  await negativeQueries('Display LOD change does not query or change winner', async () => {
    await page.getByTestId('pole-depth').selectOption('3'); await waitReady();
    await completedUI(retried); assert.equal(await page.getByTestId('pole-result').innerText(), winnerText);
  });
  await negativeQueries('Ordinary orbit and zoom change camera without querying', async () => {
    await page.getByTestId('pole-viewer').scrollIntoViewIfNeeded();
    const box = await page.getByTestId('pole-viewer').boundingBox(), before = await stableCamera();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 30, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(before => {
      const current = JSON.parse(document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') ?? 'null');
      return current && current.some((n, j) => Math.abs(n - JSON.parse(before)[j]) > 1e-3);
    }, before, { timeout: TIMEOUT });
    const orbit = await stableCamera(); await page.mouse.wheel(0, -200);
    await page.waitForFunction(before => {
      const current = JSON.parse(document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') ?? 'null');
      return current && current.some((n, j) => Math.abs(n - JSON.parse(before)[j]) > 1e-3);
    }, orbit, { timeout: TIMEOUT });
    await stableCamera(); assert.equal(await page.getByTestId('pole-result').innerText(), winnerText);
  });
  const beforeResize = report.requests.length;
  await bounded(page.setViewportSize({ width: 700, height: 950 }), 'narrow viewport');
  await layout('narrow', true); await completedUI(retried); await screenshot('narrow.png');
  assert.equal(report.requests.length, beforeResize); report.checks.push('Narrow layout, canvas CSS/backing bounds, no horizontal overflow or resize query');

  // Scene-source tabs, not Chrome tabs. Retain the detached element so disposal
  // is checked directly: its canvas removed and animation data stops updating.
  const oldHost = await page.getByTestId('pole-viewer').elementHandle();
  await page.getByRole('button', { name: 'Toronto3D preview', exact: true }).click();
  await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]', { timeout: TIMEOUT });
  assert.equal(await page.getByTestId('pole-viewer').count(), 0);
  assert.deepEqual(await oldHost.evaluate(host => ({ connected: host.isConnected, canvases: host.querySelectorAll('canvas').length })), { connected: false, canvases: 0 });
  const oldCamera = await oldHost.getAttribute('data-camera'); await delay(300); assert.equal(await oldHost.getAttribute('data-camera'), oldCamera);
  await page.getByRole('button', { name: 'Synthetic demo', exact: true }).click();
  await page.waitForSelector('[data-testid="viewer"][data-ready="true"]', { timeout: TIMEOUT });
  await bounded(page.setViewportSize({ width: 1440, height: 1100 }), 'final wide viewport');
  await page.getByRole('button', { name: 'Closest pole', exact: true }).click(); await waitReady(); await waitPhase('idle');
  assert.equal(await page.getByTestId('pole-viewer').getAttribute('data-query-selected'), 'false');
  assert.equal(await page.getByTestId('pole-result').count(), 0); assert.equal(report.requests.length, beforeResize);
  assert.equal(await page.getByTestId('pole-viewer').locator('canvas').count(), 1); await oldHost.dispose();
  await page.getByTestId('pole-depth').selectOption('0'); await waitReady(); const finalCamera = await stableCamera();
  const finalResult = await measuredQuery('remount-real-query', async () => gesture('Control', await target()), first);
  compareCamera(await stableCamera(), finalCamera, 'Remounted query completion never auto-frames'); await layout('wide-final', false);
  await page.getByTestId('pole-frame').click();
  await page.waitForFunction(before => {
    const current = JSON.parse(document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') ?? 'null');
    return current && current.some((n, j) => Math.abs(n - JSON.parse(before)[j]) > 1e-3);
  }, finalCamera, { timeout: TIMEOUT });
  await stableCamera(); await completedUI(finalResult); await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot('wide-final-result.png');
  report.checks.push('Scene switch disposes old canvas/animation; remount starts idle, native query succeeds; final wide result retained');
  assert.equal(page.url(), exactURL); assert.ok(!report.observationError, report.observationError);
  assert.deepEqual(report.messages, [], 'No captured console messages or page errors');
  report.final = { url: page.url(), viewport: page.viewportSize(), phase: await page.getByTestId('pole-status').textContent(), winner: finalResult.nearest, index: finalResult.search.index, retainedForParentInspection: true };
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  console.error('Task008 closest-Pole browser check failed: ' + error);
  if (page && !page.isClosed()) await screenshot('failure.png').catch(() => {});
} finally {
  // Always release interception, including assertion failures. Never close a page,
  // context or the real browser; close() on this CDP connection only disconnects.
  gate?.release();
  if (page && routeHandler) await bounded(page.unroute('**/datasets/toronto3d/closest-pole?*', routeHandler), 'remove gate').catch(error => { report.cleanupError = String(error); });
  if (gate && !gate.completed) await bounded((async () => { while (!gate.completed) await delay(25); })(), 'gate cleanup', QUERY_TIMEOUT + 5000).catch(error => { report.cleanupError = String(error); });
  if (page && !page.isClosed()) report.cancelledObservationCaptures = await page.evaluate(() => (window.__task008Fetches ?? []).filter(entry => entry.url.includes('/observation?') && entry.error).map(({ url, error }) => ({ url, error }))).catch(() => []);
  if (browser) await bounded(browser.close(), 'disconnect CDP', 5000).catch(error => { report.disconnectError = String(error); });
  if (report.cleanupError || report.disconnectError) { report.status = 'failed'; process.exitCode = 1; }
  await save('timings.json', { status: report.status, scope: report.latencyScope, ungated: report.queries, gatedCancellation: report.cancellation });
  await save('report.json', report);
}
