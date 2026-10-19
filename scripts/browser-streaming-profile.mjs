// Actual-cloud streaming profile: isolated ephemeral servers, existing Chrome only; no model calls.
// Uses task053's camera sequence. Timings include CDP CPU profiling overhead and
// ~250ms polling; firstPlanCompleteMs is distinct from camera damping/settling.
// Run after pnpm build: node --import tsx scripts/browser-streaming-profile.mjs [CDP] [artifacts]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDemoServer } from '../apps/server/src/index.ts';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { preview } = await import(requireWeb.resolve('vite'));
const dir = resolve(process.argv[3] ?? '/tmp/task054-browser'); await mkdir(dir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task053-'));
const report = { status: 'failed', checks: [], states: {}, errors: [], timings: {}, network: [] }; let browser, page, server, web, profiler;
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  server = createDemoServer({ projectPath: join(root, 'project.json') }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const backend = `http://127.0.0.1:${server.address().port}`;
  web = await preview({ configFile: false, root: resolve('apps/web'), preview: { host: '127.0.0.1', port: 0,
    proxy: Object.fromEntries(['/datasets/', '/project', '/chat/', '/auth/'].map(path => [path, { target: backend, changeOrigin: true }])) } });
  page = await browser.contexts()[0].newPage(); await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('requestfinished', async request => {
    if (!request.url().includes('/display-')) return;
    const response = await request.response();
    report.network.push({ url: request.url(), timing: request.timing(), status: response?.status() });
  });
  profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
  await page.goto(`http://127.0.0.1:${web.httpServer.address().port}/?smoke=1`);
  const viewer = page.getByTestId('toronto-viewer');
  const state = () => viewer.evaluate(el => ({ ...el.dataset }));
  async function settled(name) {
    const start = performance.now(), samples = [], requestStart = report.network.length;
    let s, previous = '', stable = 0, firstChangeMs = null;
    const before = await state();
    for (let i = 0; i < 360; i++) {
      await page.waitForTimeout(250); s = await state(); assert.equal(s.adaptiveError, ''); assert.ok(Number(s.adaptivePoints) <= 3000000);
      const key = s.adaptiveNodes + JSON.stringify(JSON.parse(s.camera ?? '[]').map(n => Math.round(n * 1e5)));
      samples.push({ ms: performance.now() - start, points: Number(s.adaptivePoints), pending: Number(s.adaptivePending), chunks: JSON.parse(s.adaptiveNodes ?? '[]').length });
      if (firstChangeMs === null && s.adaptiveNodes !== before.adaptiveNodes) firstChangeMs = performance.now() - start;
      stable = s.adaptivePending === '0' && Number(s.adaptivePoints) > 0 && key === previous ? stable + 1 : 0; previous = key;
      if (stable >= 3) { report.states[name] = s; report.timings[name] = { settleMs: performance.now() - start, firstChangeMs, firstPlanCompleteMs: samples.find(sample => sample.pending === 0)?.ms ?? null, requests: report.network.length - requestStart, samples }; return s; }
    }
    throw new Error(`Did not settle: ${JSON.stringify(s)}`);
  }
  await settled('street-startup');
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  await page.getByText('Navigation help', { exact: true }).click();
  await page.getByRole('button', { name: 'Frame dataset', exact: true }).click();
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  const initial = await settled('initial'); const rect = await viewer.boundingBox();
  // Coarse root covers the actual dataset, letting us select a visible peripheral
  // point using read-only camera diagnostics rather than a test camera mutation API.
  const hierarchy = await (await fetch(backend + '/datasets/toronto3d/display-hierarchy')).json();
  const rootNode = await (await fetch(backend + '/datasets/toronto3d/display-node?' + new URLSearchParams({ revision: hierarchy.dataset.revision, name: 'r' }))).json();
  const camera = new PerspectiveCamera(45, rect.width / rect.height, .1, 10000); camera.up.set(0, 0, 1);
  camera.position.fromArray(JSON.parse(initial.camera)); camera.lookAt(new Vector3(...JSON.parse(initial.cameraTarget))); camera.updateMatrixWorld();
  const center = new Vector3(...JSON.parse(initial.cameraTarget)); let choice;
  for (let i = 0; i < rootNode.positions.length; i += 3) {
    const point = new Vector3(...rootNode.positions.slice(i, i + 3)), screen = point.clone().project(camera);
    if (Math.abs(screen.x) < .85 && Math.abs(screen.y) < .75 && Math.abs(screen.z) < 1 && (!choice || point.distanceTo(center) > choice.distance)) choice = { point: point.toArray(), screen: screen.toArray(), distance: point.distanceTo(center) };
  }
  assert.ok(choice && choice.distance > 100); report.edgeChoice = choice;
  await page.mouse.dblclick(rect.x + (choice.screen[0] + 1) * rect.width / 2, rect.y + (1 - choice.screen[1]) * rect.height / 2);
  const focused = await settled('edge-focused'); const target = new Vector3(...JSON.parse(focused.cameraTarget));
  assert.ok(target.distanceTo(center) > 100, 'double-click moves pivot away from scene center');
  assert.ok(new Vector3(...JSON.parse(focused.camera)).distanceTo(new Vector3(...JSON.parse(initial.camera))) < .01, 'retarget keeps eye stationary');
  report.checks.push('Double-click actual peripheral cloud changes orbit center without translating eye');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.wheel(0, -1300);
  const zoomed = await settled('edge-zoomed');
  assert.ok(new Vector3(...JSON.parse(zoomed.camera)).distanceTo(target) < new Vector3(...JSON.parse(focused.camera)).distanceTo(target) * .6);
  assert.ok(JSON.parse(zoomed.adaptiveNodes).some(name => name.length > Math.max(...JSON.parse(initial.adaptiveNodes).map(name => name.length))), 'closer edge view loads deeper native nodes');
  assert.notEqual(zoomed.adaptiveNodes, initial.adaptiveNodes);
  report.checks.push('Zoom into edge loads deeper native detail within 3M ceiling');
  const eye = new Vector3(...JSON.parse(zoomed.camera)), pivot = new Vector3(...JSON.parse(zoomed.cameraTarget));
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height * .54, { steps: 8 }); await page.mouse.up();
  const orbited = await settled('edge-orbited');
  assert.ok(new Vector3(...JSON.parse(orbited.cameraTarget)).distanceTo(pivot) < 1e-5);
  assert.ok(new Vector3(...JSON.parse(orbited.camera)).distanceTo(eye) > 1);
  report.checks.push('Drag orbits the new peripheral pivot');
  const beforeCursor = new Vector3(...JSON.parse(orbited.cameraTarget));
  await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height * .45); await page.mouse.wheel(0, -300);
  const cursor = await settled('cursor-zoomed');
  assert.ok(new Vector3(...JSON.parse(cursor.cameraTarget)).distanceTo(beforeCursor) > .1, 'off-center cursor zoom shifts target');
  report.checks.push('Off-center wheel zoom shifts target toward pointer');
  await writeFile(join(dir, 'desktop.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(dir, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await settled('mobile');
  await writeFile(join(dir, 'mobile.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(dir, 'mobile.png'), fullPage: true });
  report.checks.push('Mobile resize retains valid render and adaptive budget'); assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  if (profiler) {
    try { const { profile } = await profiler.send('Profiler.stop'); await writeFile(join(dir, 'cpu.json'), JSON.stringify(profile)); }
    catch (error) { report.status = 'failed'; report.profilerFailure = String(error); process.exitCode = 1; }
  }
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  await page?.close().catch(() => {}); await browser?.close().catch(() => {}); await web?.close(); if (server) await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, checks: report.checks, failure: report.failure, dir }, null, 2));
