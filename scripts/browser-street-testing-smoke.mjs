// Existing Chrome only; own tab + ephemeral backend/preview. Actual prepared cloud and offline preprocessing; failure states use labeled fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../apps/server/src/index.ts';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { preview } = await import(requireWeb.resolve('vite'));
const dir = resolve(process.argv[3] ?? '/tmp/street-testing-browser'); await mkdir(dir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'street-browser-'));
const report = { status: 'failed', checks: [], messages: [], cropRequests: [], actualPreprocessing: true, additionalFailureStateFixtures: true };
let browser, page, server, web;
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  server = createDemoServer({ projectPath: join(root, 'project.json') }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const backend = `http://127.0.0.1:${server.address().port}`;
  web = await preview({ configFile: false, root: resolve('apps/web'), preview: { host: '127.0.0.1', port: 4188, strictPort: true,
    proxy: Object.fromEntries(['/datasets/', '/project', '/chat/', '/auth/'].map(path => [path, { target: backend, changeOrigin: true }])) } });
  page = await browser.contexts()[0].newPage(); page.setDefaultTimeout(120000); await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) }));
  page.on('console', m => { if (m.type() === 'error') report.messages.push({ type: 'error', text: m.text() }); });
  page.on('request', r => { if (r.url().includes('/crop?')) report.cropRequests.push(r.url()); });
  await page.goto('http://127.0.0.1:4188/?smoke=1');
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box', { timeout: 120000 });
  const viewer = page.getByTestId('toronto-viewer');
  const pointCount = Number(await viewer.getAttribute('data-crop-points'));
  assert.ok(pointCount > 0 && pointCount < 78320210); assert.equal(report.cropRequests.length, 1);
  const request = new URL(report.cropRequests[0]);
  for (const axis of ['X', 'Y', 'Z']) assert.ok(Number(request.searchParams.get('max' + axis)) - Number(request.searchParams.get('min' + axis)) <= 40.001);
  const camera = await viewer.getAttribute('data-camera'), rect = await viewer.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 45, rect.y + rect.height / 2 + 15, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500);
  assert.notEqual(await viewer.getAttribute('data-camera'), camera); assert.equal(report.cropRequests.length, 1);
  report.checks.push(`Actual startup exact bounded crop: ${pointCount} points, 1 request, orbit moves camera without reloading`);
  await writeFile(join(dir, 'street.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(dir, 'street.png') });
  const bounds = { min: ['X','Y','Z'].map(a => Number(request.searchParams.get('min' + a))), max: ['X','Y','Z'].map(a => Number(request.searchParams.get('max' + a))) };
  const summaryResponse = await fetch(backend + '/datasets/toronto3d/preprocessing?bounds=' + encodeURIComponent(JSON.stringify(bounds)));
  assert.equal(summaryResponse.status, 200); const actual = await summaryResponse.json();
  assert.equal(actual.status, 'ready'); assert.ok(actual.overlays.length > 0); assert.ok(actual.overlays.some(o => o.fit?.status === 'fitted')); assert.ok(actual.ground.cells.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(actual)) <= 1024 * 1024);
  assert.equal((await fetch(backend + '/datasets/toronto3d/preprocessing?path=anything')).status, 400);
  assert.equal((await fetch(backend + '/datasets/toronto3d/preprocessing', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(backend + '/datasets/toronto3d/preprocessing', { headers: { Range: 'bytes=0-1' } })).status, 416);
  await page.getByTestId('toggle-preprocessing').click();
  await page.getByTestId('preprocessing-status').getByLabel('Layer representations').getByText(/Fits/).waitFor();
  const actualStatus = await page.getByTestId('preprocessing-status').textContent();
  for (const name of ['Clusters', 'Fits', 'Ground']) assert.ok(actualStatus.includes(name));
  assert.doesNotMatch(actualStatus, /derived instance bounds|heuristic quality|insufficient|degenerate|CAD validity|Original-source|Current box only|supported ground tiles/);
  assert.equal(await page.getByTestId('preprocessing-status').locator('details').count(), 0);
  report.actualSummary = { bytes: Buffer.byteLength(JSON.stringify(actual)), instances: actual.overlays.length, fitted: actual.overlays.filter(o => o.fit?.status === 'fitted').length, groundCells: actual.ground.cells.length, status: actualStatus };
  await writeFile(join(dir, 'actual-preprocessing.json'), JSON.stringify(actual, null, 2));
  await page.screenshot({ path: join(dir, 'actual-preprocessing.png') });
  await writeFile(join(dir, 'actual-preprocessing.ax.txt'), await page.locator('body').ariaSnapshot());
  await page.getByTestId('toggle-preprocessing').click();
  assert.equal(await page.getByTestId('preprocessing-status').count(), 0);
  report.checks.push('Actual preprocessing HTTP + eye: source-bound instance bounds, approximate primitives and supported observed ground; hide disposal; byte cap and HTTP origin/range/query restrictions');
  const observation = await (await fetch(backend + '/datasets/toronto3d/observation?purpose=harness&budget=256&depth=0')).json();
  const min = observation.positions.slice(0, 3), max = min.map((n, i) => n + (i === 2 ? 5 : 1));
  let mode = 'ready';
  await page.route('**/datasets/toronto3d/preprocessing?*', async route => {
    if (mode === 'failure') return route.fulfill({ status: 503, body: 'unavailable' });
    await route.fulfill({ json: { version: 'toronto-preprocessing-v1', datasetId: 'toronto3d', artifactRevision: observation.dataset.revision,
      frameId: 'toronto3d-local-v1', units: 'm', status: mode, message: 'Test fixture derived connectivity, not fitted geometry.', truncated: false,
      overlays: mode === 'ready' ? [{ id: 'fixture-pole', label: 6, name: 'Pole', points: 10, bounds: { min, max } }] : [] } });
  });
  await page.getByTestId('toggle-preprocessing').click();
  await page.getByTestId('preprocessing-status').getByLabel('Cluster classes').getByText('Pole', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('toggle-preprocessing').getAttribute('aria-pressed'), 'true');
  await page.getByTestId('toggle-preprocessing').click(); assert.equal(await page.getByTestId('preprocessing-status').count(), 0);
  for (const next of ['empty', 'unavailable', 'failure']) {
    mode = next; await page.getByTestId('toggle-preprocessing').click();
    await page.waitForFunction(expected => document.querySelector('[data-testid="preprocessing-status"]')?.textContent?.includes(expected), next === 'failure' ? 'Couldn’t load' : next === 'empty' ? 'No layers' : 'Layers unavailable');
    await page.getByTestId('toggle-preprocessing').click();
  }
  assert.equal(report.cropRequests.length, 1);
  report.checks.push('Additional fixture-only eye states: ready wire bounds, hidden, empty, unavailable and HTTP failure labels; crop channel unchanged');
  assert.deepEqual(report.messages.filter(m => m.type === 'pageerror'), []);
  report.status = 'passed';
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  await page?.close(); await browser?.close(); await web?.httpServer.close();
  if (server) await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
