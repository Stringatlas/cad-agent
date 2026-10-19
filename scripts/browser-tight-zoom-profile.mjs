// Isolated actual-cloud tight-zoom diagnostic. Existing Chrome only, no provider calls.
// Run after building: node --import tsx scripts/browser-tight-zoom-profile.mjs [CDP] [artifact-dir] [street|point|edge]
// Default street preserves its initial pivot; point retargets to an actual center-screen source sample.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PerspectiveCamera, Vector3, Frustum, Matrix4, Box3 } from 'three';
import { createDemoServer } from '../apps/server/src/index.ts';
import { decodeAdaptiveBinary } from '../packages/contracts/src/adaptive-binary.ts';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { preview } = await import(requireWeb.resolve('vite'));
const dir = resolve(process.argv[3] ?? '/tmp/task055-tight-before'); await mkdir(dir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task055-'));
const report = { status: 'failed', states: {}, timings: {}, density: {}, errors: [], network: [] };
let browser, page, server, web;
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
    const response = await request.response(); report.network.push({ url: request.url(), timing: request.timing(), status: response?.status() });
  });
  // Observe actual renderer submissions, without exposing or mutating scene/camera state.
  await page.addInitScript(() => {
    window.__tightDraw = { frames: 0, calls: 0, vertices: 0, previous: null };
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!C) continue;
      const clear = C.prototype.clear, draw = C.prototype.drawArrays;
      C.prototype.clear = function (...args) {
        const d = window.__tightDraw;
        if (d.calls) { d.previous = { calls: d.calls, vertices: d.vertices }; d.frames++; d.calls = 0; d.vertices = 0; }
        return clear.apply(this, args);
      };
      C.prototype.drawArrays = function (mode, first, count) {
        if (mode === this.POINTS) { window.__tightDraw.calls++; window.__tightDraw.vertices += count; }
        return draw.call(this, mode, first, count);
      };
    }
  });
  await page.goto(`http://127.0.0.1:${web.httpServer.address().port}/?smoke=1`);
  const viewer = page.getByTestId('toronto-viewer');
  const state = () => viewer.evaluate(el => ({ ...el.dataset }));
  async function settled(name) {
    const start = performance.now(), samples = [], requestStart = report.network.length;
    let s, previous = '', stable = 0;
    for (let i = 0; i < 360; i++) {
      await page.waitForTimeout(250); s = await state(); assert.equal(s.adaptiveError, ''); assert.ok(Number(s.adaptivePoints) <= 3000000);
      const key = s.adaptiveNodes + JSON.stringify([s.camera, s.cameraTarget].map(v => JSON.parse(v ?? '[]').map(n => Math.round(n * 1e5))));
      samples.push({ ms: performance.now() - start, points: Number(s.adaptivePoints), pending: Number(s.adaptivePending), chunks: JSON.parse(s.adaptiveNodes ?? '[]').length });
      stable = s.adaptivePending === '0' && Number(s.adaptivePoints) > 0 && key === previous ? stable + 1 : 0; previous = key;
      if (stable >= 3) {
        report.states[name] = s;
        report.timings[name] = { settleMs: performance.now() - start, firstPlanCompleteMs: samples.find(v => v.pending === 0)?.ms ?? null, requests: report.network.length - requestStart, samples };
        console.log(name, s.adaptivePoints, 'points', 'distance', new Vector3(...JSON.parse(s.camera)).distanceTo(new Vector3(...JSON.parse(s.cameraTarget))));
        return s;
      }
    }
    throw new Error(`Did not settle: ${JSON.stringify(s)}`);
  }
  await settled('street-bootstrap');
  await page.bringToFront();
  await page.getByTestId('focus-street').click();
  await settled('street-startup');
  if (process.argv[4] === 'edge') {
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  await page.getByText('Navigation & points', { exact: true }).click();
  await page.getByRole('button', { name: 'Frame dataset', exact: true }).click();
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  }
  const initial = await settled('initial'); const rect = await viewer.boundingBox();
  const hierarchy = await (await fetch(backend + '/datasets/toronto3d/display-hierarchy')).json();
  await writeFile(join(dir, 'hierarchy.json'), JSON.stringify(hierarchy));
  const rootNode = await (await fetch(backend + '/datasets/toronto3d/display-node?' + new URLSearchParams({ revision: hierarchy.dataset.revision, name: 'r' }))).json();
  function cameraFor(s) {
    const camera = new PerspectiveCamera(45, rect.width / rect.height, .1, 10000); camera.up.set(0, 0, 1);
    camera.position.fromArray(JSON.parse(s.camera)); camera.lookAt(new Vector3(...JSON.parse(s.cameraTarget))); camera.updateMatrixWorld(); return camera;
  }
  if (process.argv[4] === 'edge' || process.argv[4] === 'point') {
  const camera = cameraFor(initial), center = new Vector3(...JSON.parse(initial.cameraTarget)); let choice;
  for (let i = 0; i < rootNode.positions.length; i += 3) {
    const point = new Vector3(...rootNode.positions.slice(i, i + 3)), screen = point.clone().project(camera);
    const score = process.argv[4] === 'point' ? -Math.hypot(screen.x, screen.y) : point.distanceTo(center);
    if (Math.abs(screen.x) < .85 && Math.abs(screen.y) < .75 && Math.abs(screen.z) < 1 && (!choice || score > choice.score)) choice = { point: point.toArray(), screen: screen.toArray(), distance: point.distanceTo(center), score };
  }
  assert.ok(choice); report.choice = choice;
  await page.mouse.dblclick(rect.x + (choice.screen[0] + 1) * rect.width / 2, rect.y + (1 - choice.screen[1]) * rect.height / 2);
  await settled('edge-focused');
  }
  async function metrics(name, s) {
    const camera = cameraFor(s), target = new Vector3(...JSON.parse(s.cameraTarget));
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const selected = new Set(JSON.parse(s.adaptiveNodes)), point = new Vector3(), projected = new Vector3();
    const distanceTo = (node, p) => Math.hypot(...p.toArray().map((v, i) => Math.max(node.bounds.min[i] - v, 0, v - node.bounds.max[i])));
    const near = hierarchy.nodes.filter(n => distanceTo(n, target) <= 3);
    const visible = hierarchy.nodes.filter(n => frustum.intersectsBox(new Box3(new Vector3(...n.bounds.min), new Vector3(...n.bounds.max))));
    const rows = hierarchy.nodes.filter(n => selected.has(n.name)).map(n => ({ name: n.name, count: n.count, depth: n.name.length - 1, focusDistance: distanceTo(n, target), eyeDistance: distanceTo(n, camera.position), visible: visible.includes(n) }));
    const result = { camera: s.camera, target: s.cameraTarget, distance: camera.position.distanceTo(target), viewport: rect, loadedPoints: Number(s.adaptivePoints), selectedNodes: rows,
      gpuDraw: await page.evaluate(() => window.__tightDraw),
      visibleAvailable: visible.map(n => ({ name: n.name, count: n.count, selected: selected.has(n.name) })),
      focus3mAvailable: near.map(n => ({ name: n.name, count: n.count, selected: selected.has(n.name) })),
      selectedPointMetrics: { total: 0, inFrustum: 0, centerHalf: 0, within1m: 0, within3m: 0, within10m: 0 },
      missingFocus3mPointMetrics: { total: 0, inFrustum: 0, centerHalf: 0, within1m: 0, within3m: 0, within10m: 0 } };
    await page.screenshot({ path: join(dir, name + '.png'), fullPage: true });
    await viewer.screenshot({ path: join(dir, name + '-viewer.png') });
    // Pixel occupancy uses an image copy, not WebGL readback. It is not a source completeness metric.
    const png = await viewer.screenshot();
    result.pixels = await page.evaluate(async b64 => {
      const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let occupied = 0, centerOccupied = 0, centerTotal = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const on = Math.hypot(data[i] - 16, data[i + 1] - 25, data[i + 2] - 39) > 25;
        occupied += +on;
        if (x >= c.width / 4 && x < c.width * .75 && y >= c.height / 4 && y < c.height * .75) { centerTotal++; centerOccupied += +on; }
      }
      return { width: c.width, height: c.height, occupied, occupancy: occupied / (c.width * c.height), centerOccupied, centerOccupancy: centerOccupied / centerTotal };
    }, png.toString('base64'));
    // Sequential bounded native payloads: selected resident set plus missing nodes
    // intersecting the 3m inspection sphere. The browser's adaptive lane is settled.
    for (const node of hierarchy.nodes.filter(n => selected.has(n.name) || near.includes(n))) {
      const response = await fetch(backend + '/datasets/toronto3d/display-node?' + new URLSearchParams({ revision: hierarchy.dataset.revision, name: node.name, format: 'binary' }));
      assert.equal(response.status, 200);
      const payload = decodeAdaptiveBinary(new Uint8Array(await response.arrayBuffer()), { dataset: hierarchy.dataset, name: node.name, count: node.count });
      const stats = selected.has(node.name) ? result.selectedPointMetrics : result.missingFocus3mPointMetrics;
      for (let i = 0; i < payload.positions.length; i += 3) {
        point.fromArray(payload.positions, i); stats.total++;
        const d = point.distanceTo(target); if (d <= 1) stats.within1m++; if (d <= 3) stats.within3m++; if (d <= 10) stats.within10m++;
        projected.copy(point).project(camera);
        if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1) { stats.inFrustum++; if (Math.abs(projected.x) <= .5 && Math.abs(projected.y) <= .5) stats.centerHalf++; }
      }
    }
    report.density[name] = result;
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(name, JSON.stringify({ pixels: result.pixels, selected: result.selectedPointMetrics, missing: result.missingFocus3mPointMetrics, draw: result.gpuDraw }));
  }
  for (const [name, goal] of [['tight-8m', 8], ['tight-3m', 3]]) {
    const motionStart = performance.now(), requestStart = report.network.length;
    for (let i = 0; i < 15; i++) {
      const s = await state(), distance = new Vector3(...JSON.parse(s.camera)).distanceTo(new Vector3(...JSON.parse(s.cameraTarget)));
      if (distance <= goal * 1.15) break;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.wheel(0, -Math.min(2000, Math.max(5, Math.log(distance / goal) * 1000)));
      await page.waitForTimeout(1800);
    }
    const s = await settled(name); const actualDistance = new Vector3(...JSON.parse(s.camera)).distanceTo(new Vector3(...JSON.parse(s.cameraTarget)));
    assert.ok(actualDistance >= goal * .75 && actualDistance <= goal * 1.2, `Expected approximately ${goal}m, got ${actualDistance}`);
    report.timings[name].actionThroughSettleMs = performance.now() - motionStart;
    report.timings[name].actionThroughSettleRequests = report.network.length - requestStart;
    await metrics(name, s);
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  await page?.close().catch(() => {}); await browser?.close().catch(() => {}); await web?.close();
  if (server) await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, failure: report.failure, dir }, null, 2));
