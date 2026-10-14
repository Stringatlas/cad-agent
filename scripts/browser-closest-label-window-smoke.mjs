// Task009: actual prepared data, built UI, existing CDP Chrome. Own only :3002/:4175 and one new tab.
// Usage: node scripts/browser-closest-label-window-smoke.mjs [CDP] [OS-temp evidence directory]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'spatial-task009-browser-'));
await mkdir(directory, { recursive: true });
const report = { status: 'failed', task: '009', directory, checks: [], messages: [], network: [], queries: [], screenshots: [], ownership: 'Only script-created tab and process groups on 3002/4175; no Chrome launch or server3001 changes.' };
let browser, page, gate;
const children = [], captures = [], requests = [], observations = [], crops = [];
const queryURL = url => new URL(url).pathname === '/datasets/toronto3d/closest-label';
const cropURL = url => new URL(url).pathname === '/datasets/toronto3d/crop';
const TIMEOUT = 30_000, QUERY_TIMEOUT = 180_000;
async function save(name, value) { await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n'); }
async function start(name, args, ready) {
  const child = spawn('pnpm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push({ child, name });
  let output = '', exited = false;
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; }); child.on('exit', () => { exited = true; }); child.on('error', error => { output += error; exited = true; });
  child.output = () => output;
  for (let i = 0; i < 100 && !output.includes(ready); i++) { assert.ok(!exited, `${name}: ${output}`); await delay(100); }
  assert.ok(output.includes(ready), `${name} startup failed: ${output}`);
}
async function ready() {
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-display-status"]')?.textContent?.startsWith('Ready') && document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-ready') === 'true', undefined, { timeout: TIMEOUT });
  assert.equal(await page.getByTestId('pole-gpu-error').count(), 0);
}
async function phase(value, timeout = TIMEOUT) {
  await page.waitForFunction(value => document.querySelector('[data-testid="pole-status"]')?.textContent === value, value, { timeout });
}
async function target(detail = false) {
  const host = page.getByTestId('pole-viewer'); await host.scrollIntoViewIfNeeded();
  const box = await host.boundingBox(), value = JSON.parse(await host.getAttribute(detail ? 'data-detail-pick-point' : 'data-pick-point'));
  assert.ok(box && Array.isArray(value));
  assert.ok(value[0] > 1 && value[0] < box.width - 1 && value[1] > 1 && value[1] < box.height - 1, 'Provenance smoke point is inside viewport');
  return { x: box.x + value[0], y: box.y + value[1], box };
}
async function gesture(point, modifier = 'Meta', shift = false, delta) {
  try {
    if (shift) await page.keyboard.down('Shift'); if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    if (delta) await page.mouse.move(point.x + delta[0], point.y + delta[1], { steps: 5 });
    await page.mouse.up();
  } finally { if (modifier) await page.keyboard.up(modifier); if (shift) await page.keyboard.up('Shift'); }
}
async function captured(url, timeout = QUERY_TIMEOUT) {
  await page.waitForFunction(url => window.__task009Fetches?.some(entry => entry.url === url && entry.done), url, { timeout });
  const entries = await page.evaluate(url => window.__task009Fetches.filter(entry => entry.url === url && entry.done), url);
  assert.equal(entries.length, 1); assert.ok(!entries[0].error, entries[0].error); return entries[0];
}
function frames(raw) {
  assert.ok(raw.endsWith('\n')); return raw.trimEnd().split('\n').map(line => JSON.parse(line));
}
async function refreshCaptures() {
  const entries = await page.evaluate(() => window.__task009Fetches.filter(entry => entry.done && !entry.error));
  for (const entry of entries) {
    if (captures.includes(entry.id)) continue; captures.push(entry.id);
    if (entry.url.includes('/observation?')) observations.push(JSON.parse(entry.body));
    if (cropURL(entry.url)) crops.push({ url: entry.url, frames: frames(entry.body) });
  }
}
function originalPosition(key, detail) {
  const samples = detail ? crops.flatMap(crop => crop.frames.filter(event => event.type === 'batch')) : observations;
  for (const sample of samples.slice().reverse()) {
    for (let i = 0; i < (sample.sourceIds?.length ?? 0) / 2; i++) if (sample.sourceIds[i * 2] === key.sourceFileId && sample.sourceIds[i * 2 + 1] === key.sourceRow) return sample.positions.slice(i * 3, i * 3 + 3);
  }
  assert.fail(`Selected key ${JSON.stringify(key)} missing in captured ${detail ? 'detail' : 'overview'} provenance`);
}
async function query(name, label, action, detail = false) {
  const before = requests.filter(r => queryURL(r.url)).length, started = performance.now();
  const responsePromise = page.waitForResponse(response => queryURL(response.url()) && JSON.parse(new URL(response.url()).searchParams.get('request')).filter.value === label, { timeout: QUERY_TIMEOUT });
  await action(); const response = await responsePromise; assert.equal(response.status(), 200);
  const request = JSON.parse(new URL(response.url()).searchParams.get('request'));
  assert.equal(request.filter.value, label); assert.deepEqual(request.domain, { kind: 'whole-dataset' }); assert.equal(request.input.kind, 'point-ref');
  const capture = await captured(response.url()), events = frames(capture.body), result = events.at(-1).result;
  assert.equal(events[0].type, 'start'); assert.deepEqual(events[0].request, request);
  assert.equal(events.at(-1).type, 'result'); assert.equal(result.status, 'verified-found'); assert.equal(result.complete, true);
  assert.deepEqual(result.request, request); assert.equal(result.nearest.label, label);
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  assert.equal(result.search.algorithm, 'semantic-disk-page-index-v1'); assert.equal(result.search.completion, 'indexed');
  assert.equal(result.search.arithmetic, 'xyz-binary64-v1'); assert.equal(result.verification.verifier, 'semantic-disk-page-verifier-v1');
  assert.match(result.search.index.hash, /^[a-f0-9]{64}$/); assert.deepEqual(result.search.index, result.verification.index);
  assert.ok(result.search.index.points > 0 && result.search.index.points <= result.dataset.totalPoints);
  // Prepared actual-data stride is 55 bytes (fixture tests use 28). Cache records
  // are a separate 40-byte format, never charged as original-source witness I/O.
  for (const stats of [result.search, result.verification]) {
    assert.equal(stats.artifactRevision, request.expectedArtifactRevision); assert.equal(stats.requestHash, hash);
    for (const key of ['scannedPoints', 'matchingPoints', 'maxReadBytes', 'payloadBytes', 'resolutionPoints', 'resolutionPayloadBytes']) assert.ok(Number.isSafeInteger(stats[key]) && stats[key] >= 0);
    assert.ok(stats.maxReadBytes <= 4 * 1024 * 1024); assert.equal(stats.matchingPoints, result.search.index.points);
    assert.equal(stats.payloadBytes, 55); assert.equal(stats.resolutionPoints, 1); assert.equal(stats.resolutionPayloadBytes, 55);
    assert.equal(stats.hierarchyChunks, 0); assert.equal(stats.payloadNodes, 0); assert.equal(stats.hierarchyBytes, 0);
    const disk = stats.disk;
    assert.deepEqual(Object.keys(disk).sort(), ['totalPages', 'visitedPages', 'excludedPages', 'prunedPages', 'coveredPoints', 'cacheBytes', 'maxCacheReadBytes'].sort());
    assert.ok(Object.values(disk).every(n => Number.isSafeInteger(n) && n >= 0));
    assert.equal(disk.totalPages, Math.ceil(result.dataset.totalPoints / 4096));
    assert.equal(disk.visitedPages + disk.excludedPages + disk.prunedPages, disk.totalPages);
    assert.equal(disk.coveredPoints, result.dataset.totalPoints); assert.equal(disk.cacheBytes, stats.scannedPoints * 40);
    assert.ok(disk.visitedPages > 0 && stats.scannedPoints >= disk.visitedPages && stats.scannedPoints <= Math.min(result.dataset.totalPoints, disk.visitedPages * 4096));
    const full = disk.visitedPages * 4096, tail = (disk.visitedPages - 1) * 4096 + (result.dataset.totalPoints % 4096 || 4096);
    assert.ok((full <= result.dataset.totalPoints && stats.scannedPoints === full) || stats.scannedPoints === tail, 'All records of visited pages, with at most one partial tail page');
    assert.equal(disk.maxCacheReadBytes, disk.visitedPages === 1 ? stats.scannedPoints * 40 : 163840);
  }
  assert.equal(result.sourceReads.payloadBytes, 220, 'Two independent selected and two winning original-record reads');
  const [dx, dy, dz] = result.nearest.position.map((n, i) => n - result.queryPosition[i]);
  assert.equal(result.nearest.distanceSquared, (dx * dx + dy * dy) + dz * dz); assert.equal(result.nearest.distanceMeters, Math.sqrt(result.nearest.distanceSquared));
  await phase('verified-found'); await refreshCaptures(); const original = originalPosition(request.input.key, detail);
  assert.deepEqual(result.queryPosition, original, 'Server resolution equals original binary64 provenance, not GPU Float32');
  const selected = await page.getByTestId('pole-selection').locator('dd').allTextContents();
  assert.deepEqual(selected, [`${request.input.key.sourceFileId} / ${request.input.key.sourceRow}`, original.join(', '), request.expectedArtifactRevision]);
  const returned = await page.getByTestId('pole-result').locator('dd').allTextContents();
  assert.deepEqual(returned, [String(result.nearest.distanceMeters), `${result.nearest.key.sourceFileId} / ${result.nearest.key.sourceRow}`, result.nearest.position.join(', ')]);
  assert.equal(requests.filter(r => queryURL(r.url)).length, before + 1);
  assert.equal(await page.getByTestId('pole-error').count(), 0); assert.equal(await page.getByTestId('pole-gpu-error').count(), 0);
  await writeFile(join(directory, `${name}.ndjson`), capture.body);
  report.queries.push({ name, label, detail, milliseconds: performance.now() - started, request, result, original, differsFromGPU: original.some(n => n !== Math.fround(n)) });
  return result;
}
async function windowComplete() {
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-window-status"]')?.textContent === 'Ready — full resolution in frozen window', undefined, { timeout: QUERY_TIMEOUT });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-crop-points')) > 0, undefined, { timeout: TIMEOUT });
}
async function screenshot(name) { await page.screenshot({ path: join(directory, name), fullPage: true }); report.screenshots.push(name); }

try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  await start('backend', ['exec', 'tsx', '-e', 'import { createDemoServer } from "./apps/server/src/index.ts"; createDemoServer().listen(3002,"127.0.0.1",()=>console.log("Owned backend ready"));'], 'Owned backend ready');
  await start('preview', ['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', 'import { preview } from "vite"; const server=await preview({preview:{host:"127.0.0.1",port:4175,strictPort:true,proxy:Object.fromEntries(["/datasets/","/project","/chat/"].map(path=>[path,{target:"http://127.0.0.1:3002"}]))}}); server.printUrls();'], 'http://127.0.0.1:4175');
  const context = browser.contexts()[0]; assert.ok(context); page = await context.newPage(); page.setDefaultTimeout(TIMEOUT);
  // Preserve the original 1440px scene area plus the integrated 380px chat panel.
  // This keeps the provenance fixture/camera ray stable; the narrow-layout check remains below.
  await page.setViewportSize({ width: 1820, height: 1100 });
  page.on('console', message => report.messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) }));
  page.on('request', request => {
    if (!request.url().includes('/datasets/')) return;
    const value = { url: request.url(), milliseconds: performance.now() }; requests.push(value); report.network.push({ type: 'request', ...value });
  });
  page.on('response', response => { if (response.url().includes('/datasets/')) report.network.push({ type: 'response', url: response.url(), status: response.status(), milliseconds: performance.now() }); });
  page.on('requestfailed', request => report.network.push({ type: 'requestfailed', url: request.url(), error: request.failure() }));
  await page.addInitScript(() => {
    window.__task009Fetches = []; const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.url.includes('/datasets/toronto3d/')) {
        const entry = { id: window.__task009Fetches.length, url: response.url, status: response.status, done: false }; window.__task009Fetches.push(entry);
        response.clone().text().then(body => { entry.body = body; entry.done = true; }, error => { entry.error = String(error); entry.done = true; });
      }
      return response;
    };
  });
  await page.goto(`http://127.0.0.1:4175/?smoke=task009-${Date.now()}`);
  await page.getByRole('button', { name: 'Closest: label', exact: true }).click(); await ready();
  assert.equal(await page.getByTestId('closest-label').inputValue(), '6');
  assert.deepEqual(await page.getByTestId('closest-label').locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent])), [['0', 'Unclassified'], ['1', 'Ground'], ['2', 'Road markings'], ['3', 'Natural'], ['4', 'Building'], ['5', 'Utility line'], ['6', 'Pole'], ['7', 'Car'], ['8', 'Fence']]);
  await page.getByTestId('pole-depth').selectOption('0'); await ready();
  report.checks.push('All nine categories, Pole default; actual overview root LOD ready');
  const point = await target(), prior = requests.filter(r => queryURL(r.url)).length;
  await gesture(point, 'Meta', true); await gesture(point, 'Control', true); await delay(250);
  assert.equal(requests.filter(r => queryURL(r.url)).length, prior);
  await page.keyboard.down('Meta'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y + 20, { steps: 5 }); await page.mouse.move(point.x, point.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Meta');
  assert.equal(requests.filter(r => queryURL(r.url)).length, prior);
  const first = await query('pole-overview', 6, () => gesture(point));
  report.checks.push('Shift precedence; drag-return ignored; native Cmd overview query verifies Pole against whole dataset with exact source provenance');
  const fence = await query('fence-category-change', 8, () => page.getByTestId('closest-label').selectOption('8'));
  assert.deepEqual(fence.request.input, first.request.input); assert.deepEqual(fence.queryPosition, first.queryPosition);
  assert.match(await page.getByRole('heading', { level: 1 }).innerText(), /Closest: Fence/);
  report.checks.push('Native label change requeries same source as Fence; category-bound result/evidence/UI');

  // Task010: actually complete every label through native UI/category changes.
  // No route gates, modified payloads or cancellation-only evidence here.
  for (let label = 0; label <= 8; label++) {
    const completed = await query(`all-label-${label}`, label, () => page.getByTestId('closest-label').selectOption(String(label)));
    assert.deepEqual(completed.request.input, first.request.input);
    assert.deepEqual(completed.queryPosition, first.queryPosition);
    assert.equal(completed.search.index.hash, first.search.index.hash, 'Every category shares the same complete disk index');
    assert.match(await page.locator('.scene-source aside').innerText(), /Complete disk coverage: 78,320,210 source points/);
    assert.ok(!(await page.locator('body').innerText()).includes('larger categories use an exhaustive'), 'Current UI must describe the shared disk path');
    if (label === 1 || label === 4) await screenshot(`all-label-${label}-verified.png`);
  }
  report.checks.push('Task010 native all-nine-label completion, shared disk binding, exact source selection; Ground/Building rendered verified');

  // Ground now uses the same fast disk index. Hold only unmodified real responses
  // to make in-flight supersession/cancel deterministic; never latency evidence.
  for (const action of ['supersede', 'cancel']) {
    let release, entered, rejectEntered;
    const held = new Promise(resolve => { release = resolve; });
    const intercepted = new Promise((resolve, reject) => { entered = resolve; rejectEntered = reject; });
    gate = { release, done: false };
    await page.route('**/datasets/toronto3d/closest-label?*', async route => {
      if (JSON.parse(new URL(route.request().url()).searchParams.get('request')).filter.value !== 1) { await route.continue(); return; }
      try {
        const response = await route.fetch({ timeout: QUERY_TIMEOUT }); assert.equal(response.status(), 200);
        const body = await response.body(), result = frames(body.toString()).at(-1).result;
        assert.equal(result.status, 'verified-found'); assert.equal(result.search.algorithm, 'semantic-disk-page-index-v1');
        assert.equal(result.verification.verifier, 'semantic-disk-page-verifier-v1'); assert.equal(result.nearest.label, 1);
        await writeFile(join(directory, `ground-${action}-gated.ndjson`), body);
        entered(); await held; await route.fulfill({ response, body }).catch(() => {});
      } catch (error) { rejectEntered(error); await route.abort().catch(() => {}); }
      finally { gate.done = true; }
    });
    await page.getByTestId('closest-label').selectOption('1'); await intercepted;
    assert.ok(await page.getByTestId('pole-cancel').isEnabled());
    if (action === 'supersede') {
      const superseded = await query('pole-supersedes-ground', 6, () => page.getByTestId('closest-label').selectOption('6'));
      assert.deepEqual(superseded.nearest, first.nearest);
    } else {
      await page.getByTestId('pole-cancel').click(); await phase('cancelled-incomplete');
      await page.getByTestId('pole-clear').click(); await phase('idle');
    }
    release(); for (let i = 0; i < 100 && !gate.done; i++) await delay(20); assert.ok(gate.done);
    await page.unroute('**/datasets/toronto3d/closest-label?*'); await delay(300);
    await phase(action === 'supersede' ? 'verified-found' : 'idle');
  }
  await page.getByTestId('closest-label').selectOption('6'); await phase('idle');
  report.checks.push('Unmodified real Ground disk-result gates: in-flight supersession/cancel+clear suppress late results; gates excluded from latency evidence');
  await delay(300);
  await query('pole-reselected', 6, async () => gesture(await target(), 'Control'));
  await page.getByTestId('pole-frame').click(); await delay(700);
  let detailWindowPoint = await target();
  const queryCount = requests.filter(r => queryURL(r.url)).length;
  await gesture({ ...detailWindowPoint, x: detailWindowPoint.x - 6, y: detailWindowPoint.y - 6 }, 'Meta', true, [12, 12]);
  await windowComplete(); await refreshCaptures();
  assert.equal(requests.filter(r => queryURL(r.url)).length, queryCount, 'Shift+Cmd window load never issues semantic query');
  const cropRequest = requests.filter(r => cropURL(r.url)).at(-1), frozenText = await page.getByTestId('pole-window-selection').innerText();
  assert.ok(new URL(cropRequest.url).searchParams.get('planes'));
  const firstCrop = await captured(cropRequest.url); const firstCropFrames = frames(firstCrop.body), end = firstCropFrames.at(-1);
  assert.equal(end.type, 'end'); assert.equal(end.complete, true);
  for (const event of firstCropFrames.filter(e => e.type === 'batch')) { assert.ok(event.positions.length <= 8192 * 3); assert.equal(event.sourceIds.length, event.positions.length / 3 * 2); }
  report.window = { url: cropRequest.url, frozenText, stats: end.stats, sampleHash: end.sampleHash };
  await writeFile(join(directory, 'fullres-window.ndjson'), firstCrop.body);
  const detail = await query('pole-detail', 6, async () => gesture(await target(true)), true);
  assert.ok(report.queries.at(-1).differsFromGPU, 'Captured detail uses meaningful binary64 precision beyond GPU Float32');
  assert.equal(detail.request.domain.kind, 'whole-dataset');
  report.checks.push('Shift+Cmd frozen window loads full-resolution bounded batches with provenance; native Cmd detail pick server resolution equals original binary64; query remains whole dataset');
  await screenshot('detail-verified.png');
  // Orbit then clear/reload the frozen selection: new camera must not recalculate planes/bounds.
  const host = page.getByTestId('pole-viewer'); await host.scrollIntoViewIfNeeded(); const box = await host.boundingBox();
  const camera = await host.getAttribute('data-camera');
  await gesture({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, '', false, [35, 20]);
  await page.waitForFunction(camera => document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') !== camera, camera);
  assert.equal(await page.getByTestId('pole-window-selection').innerText(), frozenText);
  await page.getByTestId('pole-window-clear').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-crop-points') === '0');
  assert.equal(await page.getByTestId('pole-window-retry').isEnabled(), true);
  await page.getByTestId('pole-window-retry').click(); await windowComplete();
  assert.equal(requests.filter(r => cropURL(r.url)).at(-1).url, cropRequest.url);
  assert.equal(await page.getByTestId('pole-window-selection').innerText(), frozenText);
  assert.equal(requests.filter(r => queryURL(r.url)).length, queryCount + 1);
  report.checks.push('Orbit preserves frozen camera volume; clear disposes detail; same-window reload keeps exact request and never queries');

  // Gate only an unmodified real crop response to make cancel deterministic; do not use gated checks as latency evidence.
  let release, entered, rejectEntered;
  const held = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise((resolve, reject) => { entered = resolve; rejectEntered = reject; });
  gate = { release, done: false };
  await page.route('**/datasets/toronto3d/crop?*', async route => {
    try { const response = await route.fetch({ timeout: QUERY_TIMEOUT }); assert.equal(response.status(), 200); const body = await response.body(); frames(body.toString()); entered(); await held; await route.fulfill({ response, body }).catch(() => {}); }
    catch (error) { rejectEntered(error); await route.abort().catch(() => {}); }
    finally { gate.done = true; }
  });
  await page.getByTestId('pole-window-retry').click(); await intercepted;
  assert.equal(await page.getByTestId('pole-window-cancel').isEnabled(), true);
  await page.getByTestId('pole-window-cancel').click(); assert.match(await page.getByTestId('pole-window-status').innerText(), /Cancelled.*incomplete/);
  assert.equal(await page.getByTestId('pole-window-clear').isEnabled(), false, 'No detail was delivered by the gate, so nothing exists to clear'); release();
  for (let i = 0; i < 100 && !gate.done; i++) await delay(20); assert.ok(gate.done);
  await page.unroute('**/datasets/toronto3d/crop?*'); await delay(300);
  assert.equal(await host.getAttribute('data-crop-points'), '0');
  assert.match(await page.getByTestId('pole-window-status').innerText(), /Cancelled.*incomplete/);
  await page.getByTestId('pole-window-retry').click(); await windowComplete();
  report.checks.push('Real unchanged crop response gate: cancel suppresses late batches; empty detail cannot clear; reload succeeds; gate excluded from timing');
  await page.getByTestId('pole-depth').selectOption('3'); await ready(); await phase('verified-found');
  assert.equal(await page.getByTestId('pole-result').locator('dd').first().innerText(), String(detail.nearest.distanceMeters));
  report.checks.push('Display LOD change preserves query winner and full-resolution detail');
  await page.setViewportSize({ width: 700, height: 950 }); await screenshot('narrow-window.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  const oldHost = await host.elementHandle();
  await page.getByRole('button', { name: 'Toronto3D preview', exact: true }).click(); await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  assert.deepEqual(await oldHost.evaluate(host => ({ connected: host.isConnected, canvases: host.querySelectorAll('canvas').length })), { connected: false, canvases: 0 });
  const oldCamera = await oldHost.getAttribute('data-camera'); await delay(300); assert.equal(await oldHost.getAttribute('data-camera'), oldCamera);
  await page.getByRole('button', { name: 'Synthetic demo', exact: true }).click(); await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');
  await page.screenshot({ path: join(directory, 'demo-regression.png'), fullPage: true }); report.screenshots.push('demo-regression.png');
  await page.getByRole('button', { name: 'Closest: label', exact: true }).click(); await ready(); await phase('idle');
  assert.equal(await page.getByTestId('closest-label').inputValue(), '6'); assert.equal(await host.getAttribute('data-crop-points'), '0'); assert.equal(await page.getByTestId('pole-result').count(), 0);
  await oldHost.dispose(); report.checks.push('Responsive narrow layout; Toronto/demo regressions ready; tab disposal removes old canvas/animation; remount has default Pole/idle/no detail or query');
  assert.deepEqual(report.messages.filter(m => ['error', 'pageerror'].includes(m.type)), []);
  report.status = 'passed';
} catch (error) { report.error = error.stack ?? String(error); process.exitCode = 1; console.error(report.error); if (page && !page.isClosed()) await screenshot('failure.png').catch(() => {}); }
finally {
  gate?.release(); if (page && !page.isClosed()) await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
  if (page) await page.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  for (const { child, name } of children) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    await writeFile(join(directory, `${name}.log`), child.output?.() ?? '');
  }
  await save('console.json', report.messages); await save('network.json', report.network); await save('report.json', report);
  console.log(JSON.stringify({ status: report.status, directory, checks: report.checks.length, error: report.error }, null, 2));
}
