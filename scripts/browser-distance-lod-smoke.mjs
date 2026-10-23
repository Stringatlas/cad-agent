// Built viewer and real native data; read-only fixture provider, no inference.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
const directory = resolve(process.argv[3] ?? '/tmp/distance-lod-browser');
await mkdir(directory, { recursive: true });
const report = { status: 'failed', checks: [], screenshots: [], states: [], errors: [] };
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'display-fixture-only' }, modelTransport: async url => {
  assert(String(url).endsWith('/models'), 'No inference is authorized by this UI check'); return Response.json({ data: [{ id: 'display-fixture' }] });
} });
let browser, context, front, page;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  const base = `http://127.0.0.1:${front.httpServer.address().port}`;
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9223');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(e.message));
  const host = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  async function settled(budget) {
    await page.waitForFunction(budget => { const el = document.querySelector('[data-testid="point-cloud-workspace"] .viewport'); return Number(el?.dataset.pointBudget) === budget && Number(el?.dataset.adaptivePoints) > 0 && el?.dataset.adaptivePending === '0' && !el?.dataset.adaptiveError; }, budget, { timeout: 90000 });
    const state = await host.evaluate(el => ({ points: Number(el.dataset.adaptivePoints), capacity: Number(el.dataset.adaptiveCapacity), budget: Number(el.dataset.pointBudget), camera: el.dataset.camera, target: el.dataset.cameraTarget, nodes: JSON.parse(el.dataset.adaptiveNodes) }));
    assert(state.points <= budget && state.capacity <= budget); report.states.push(state); return state;
  }
  const disclosure = () => page.getByTestId('point-cloud-workspace').getByText('Display', { exact: true }).click();
  async function setBudget(value) { const input = page.getByRole('spinbutton', { name: 'Point budget', exact: true }); await input.fill(value); await input.press('Tab'); }
  async function shot(name) { await page.screenshot({ path: `${directory}/${name}.png` }); report.screenshots.push(`${name}.png`); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.goto(`${base}/?smoke=1`); await settled(3000000);
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-ra');
  const initial = await settled(3000000); await shot('ra-overview-default');
  const canvas = host.locator('canvas'); await canvas.evaluate(el => { el.dataset.identity = 'retained'; });
  const bounds = await canvas.boundingBox(); let selected = '';
  for (const [x, y] of [[.5, .65], [.45, .7], [.6, .7], [.5, .75]]) {
    await canvas.click({ position: { x: bounds.width * x, y: bounds.height * y } });
    if (await page.locator('.inspection .selection').count()) { selected = await page.locator('.inspection .selection').innerText(); break; }
  }
  assert(selected, 'native source selection should be available before changing the cap');
  await shot('selected-source-point');
  await page.getByRole('button', { name: 'Semantic', exact: true }).click();
  await disclosure(); await setBudget('4500000');
  const larger = await settled(4500000);
  assert.equal(larger.camera, initial.camera); assert.equal(larger.target, initial.target);
  assert.equal(await canvas.getAttribute('data-identity'), 'retained');
  assert.equal(await page.locator('.inspection .selection').innerText(), selected, 'budget changes retain the selected source identity/type');
  assert.equal(await page.getByRole('button', { name: 'Semantic', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Display quality').inputValue(), 'custom');
  assert.equal(await page.evaluate(() => localStorage.getItem('spatial.display.pointBudget.cloud.v1')), '4500000');
  await shot('desktop-custom-budget'); await disclosure();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.wheel(0, -1000);
  const closer = await settled(4500000); assert.notEqual(closer.camera, initial.camera);
  assert(closer.nodes.some(n => !initial.nodes.includes(n)), 'closer camera changes native demand');
  await page.getByRole('button', { name: 'RGB', exact: true }).click();
  await shot('ra-close-distance-detail');
  await disclosure(); await setBudget('3000000'); await settled(3000000); await disclosure();
  await shot('ra-close-default-budget');
  // Save an exact custom number and preserve the close camera while lowering admission.
  await disclosure(); await setBudget('1234567');
  const smaller = await settled(1234567); assert.equal(smaller.camera, closer.camera); assert.equal(smaller.target, closer.target);
  await setBudget('50000001'); await page.getByRole('alert').filter({ hasText: 'whole number' }).waitFor();
  assert.equal(await host.getAttribute('data-point-budget'), '1234567');
  assert.equal(await page.evaluate(() => localStorage.getItem('spatial.display.pointBudget.cloud.v1')), '1234567');
  await shot('invalid-budget'); await setBudget('1234567'); await disclosure();
  await page.reload(); await settled(1234567); await disclosure();
  assert.equal(await page.getByRole('spinbutton', { name: 'Point budget', exact: true }).inputValue(), '1234567'); await disclosure();
  report.checks.push('3M default; custom 4.5M changes admission without remount/navigation/color reset; close camera loads different native chunks; exact custom 1,234,567 survives reload; invalid input preserves active/saved cap');
  // Derived layers also retain their camera and visibility through in-place cap changes.
  await page.getByLabel('Surface layer').selectOption('dtm');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.surfaceLayer === 'dtm');
  const surfaceCamera = await host.getAttribute('data-camera');
  await disclosure(); await setBudget('2000000'); await settled(2000000);
  assert.equal(await host.getAttribute('data-surface-layer'), 'dtm'); assert.equal(await host.getAttribute('data-camera'), surfaceCamera);
  await shot('surface-budget-preserved'); await disclosure(); await page.getByLabel('Surface layer').selectOption('points');
  report.checks.push('Selected semantic source identity/type and DTM layer/camera remain unchanged through budget edits');
  // Trigger an actionable node failure when increasing from a smaller cap.
  await disclosure(); await setBudget('500000'); await settled(500000);
  let failed = false;
  await page.route('**/datasets/prepared/*/display-node?**', route => { if (!failed) { failed = true; return route.fulfill({ status: 503, body: '{}' }); } return route.continue(); });
  await setBudget('4500000'); await page.getByRole('button', { name: 'Retry detail', exact: true }).waitFor();
  assert(Number(await host.getAttribute('data-adaptive-points')) > 0); await shot('native-loading-error');
  await page.getByRole('button', { name: 'Retry detail', exact: true }).click(); await settled(4500000); await page.unroute('**/datasets/prepared/*/display-node?**');
  await disclosure();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click();
  await disclosure(); await setBudget('2000000'); await settled(2000000); await shot('mobile-custom-budget'); await disclosure();
  report.checks.push('Loading errors retain visible geometry and recover via Retry; custom control works on mobile without overflow');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Scene source').selectOption('toronto');
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid="toronto-viewer"]'); return Number(el?.dataset.adaptivePoints) > 0 && el?.dataset.adaptivePending === '0'; }, undefined, { timeout: 90000 });
  await page.getByTestId('display-quality').locator(':scope > summary').click(); await page.getByText('Detail settings', { exact: true }).click();
  assert.equal(await page.getByTestId('display-budget').inputValue(), '3000000', 'per-viewer defaults/persistence remain separate');
  const toronto = page.getByTestId('toronto-viewer'), before = await toronto.getAttribute('data-camera');
  await page.getByTestId('display-budget').fill('4500000'); await page.getByTestId('display-budget').press('Tab');
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid="toronto-viewer"]'); return Number(el?.dataset.adaptivePoints) > 3000000 && el?.dataset.adaptivePending === '0'; }, undefined, { timeout: 90000 });
  assert.equal(await toronto.getAttribute('data-camera'), before);
  assert.equal(await page.evaluate(() => localStorage.getItem('spatial.display.pointBudget.toronto.v1')), '4500000');
  await shot('toronto-custom-budget');
  await page.getByLabel('Scene source').selectOption('cloud'); await settled(2000000);
  await page.getByLabel('Scene source').selectOption('toronto');
  await page.getByTestId('display-quality').locator(':scope > summary').click(); await page.getByText('Detail settings', { exact: true }).click();
  assert.equal(await page.getByTestId('display-budget').inputValue(), '4500000');
  report.checks.push('Toronto custom 4.5M loads beyond former maximum, preserves camera, and persists separately across viewer remounts');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} finally {
  if (page && !page.isClosed()) { report.finalText = await page.locator('body').innerText(); await page.screenshot({ path: `${directory}/final.png` }); }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close(); await new Promise(r => server.close(r));
}
console.log(JSON.stringify({ status: report.status, directory, checks: report.checks }));
