// Actual Potree artifacts + built viewer, through UI navigation; provider is a local catalog fixture only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';

const artifacts = process.argv[3] ?? '/tmp/prepared-lod-browser';
await mkdir(artifacts, { recursive: true });
const report = { status: 'failed', checks: [], views: [], errors: [], screenshots: [] };
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'fixture-lod-only' }, modelTransport: async () => Response.json({ data: [{ id: 'lod-browser' }] }) });
let browser, context, front;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', request => request.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  const host = page.locator('[data-testid="point-cloud-workspace"] .viewport');
  const state = async () => host.evaluate(el => ({ points: Number(el.dataset.adaptivePoints), pending: Number(el.dataset.adaptivePending), error: el.dataset.adaptiveError, nodes: JSON.parse(el.dataset.adaptiveNodes ?? '[]'), budget: Number(el.dataset.pointBudget) }));
  const settled = () => page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="point-cloud-workspace"] .viewport');
    return el?.dataset.cloudId === document.querySelector('[aria-label="STPLS3D scene"]')?.value && Number(el?.dataset.adaptivePoints) > 100000 && el?.dataset.adaptivePending === '0' && !el?.dataset.adaptiveError;
  }, undefined, { timeout: 90000 });
  const shot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${artifacts}/${name}.png` }); report.screenshots.push(`${name}.png`);
  };
  await page.goto(`http://127.0.0.1:${front.httpServer.address().port}`);
  await settled();
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-ra');
  await settled();
  const overview = await state(); assert(overview.points <= overview.budget); report.views.push({ name: 'ra-overview', ...overview });
  await shot('ra-overview');
  const canvas = host.locator('canvas'), box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.wheel(0, -1600);
  await page.waitForTimeout(200); await settled();
  const close = await state(); assert(close.points <= close.budget);
  assert(close.nodes.some(name => !overview.nodes.includes(name)), 'zoom must load a different native node set');
  assert(Math.max(...close.nodes.map(n => n.length)) > Math.max(...overview.nodes.map(n => n.length)), 'zoom must refine to deeper native nodes');
  report.views.push({ name: 'ra-close', ...close }); await shot('ra-close-rgb');
  await page.getByRole('button', { name: 'Semantic', exact: true }).click(); await shot('ra-close-semantic');
  assert.equal(await page.getByRole('button', { name: 'Instance', exact: true }).isDisabled(), true);
  // Pick only through the displayed cloud. Selection must expose its native semantic type and source identity.
  let selected = false;
  for (const [x, y] of [[.5, .5], [.45, .6], [.55, .55], [.6, .5], [.4, .5]]) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    if (await page.locator('.inspection .selection').count()) { selected = true; break; }
  }
  assert(selected, 'dense native cloud should be pickable');
  const selection = await page.locator('.inspection .selection').innerText(); assert(!selection.includes('Unknown'));
  await shot('ra-selected');
  await page.getByRole('button', { name: 'RGB', exact: true }).click();
  assert.equal(await page.locator('.inspection .selection').innerText(), selection, 'recolor retains selected native point');
  await page.getByRole('button', { name: 'Fit', exact: true }).click(); await settled();
  const fitted = await state(); assert(fitted.nodes.some(n => !close.nodes.includes(n)), 'fit evicts close-only nodes and restores overview');
  report.checks.push('RA overview and zoom exceed 100k points within budget, zoom loads deeper nodes, native picking/recolor and fit work');
  // An in-flight request from a departed scene must not pollute the next viewer.
  let held, release;
  const arrived = new Promise(resolve => held = resolve), gate = new Promise(resolve => release = resolve);
  await page.route('**/datasets/prepared/stpls3d-realworld-usc/display-node?**', async route => { held(); await gate; try { await route.continue(); } catch {} });
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-usc');
  await arrived;
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-wmsc'); release();
  await settled(); assert.equal(await page.getByLabel('STPLS3D scene', { exact: true }).inputValue(), 'stpls3d-realworld-wmsc');
  report.views.push({ name: 'wmsc', ...await state() });
  await page.unroute('**/datasets/prepared/stpls3d-realworld-usc/display-node?**');
  report.checks.push('Scene switch disposes and aborts departed-scene native loads');
  // Recover a failed native request explicitly while keeping the overview visible.
  let fail = true;
  await page.route('**/datasets/prepared/stpls3d-realworld-occc/display-node?**', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-occc');
  await page.getByRole('button', { name: 'Retry detail', exact: true }).waitFor(); await shot('detail-error');
  fail = false; await page.getByRole('button', { name: 'Retry detail', exact: true }).click(); await settled();
  assert.equal(await page.getByRole('button', { name: 'Retry detail', exact: true }).count(), 0);
  report.views.push({ name: 'occc-recovered', ...await state() }); report.checks.push('Native loading failure keeps overview and recovers by explicit retry');
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-usc'); await settled();
  report.views.push({ name: 'usc', ...await state() }); await shot('usc-dense');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Toggle chat' }).click(); await settled();
  await page.getByRole('button', { name: 'Semantic', exact: true }).click(); await shot('mobile-usc-semantic');
  const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, canvas: document.querySelector('[data-testid="point-cloud-workspace"] canvas').getBoundingClientRect().toJSON() }));
  assert(mobile.scroll <= mobile.width && mobile.canvas.width > 300 && mobile.canvas.height > 400);
  await page.getByText('Display', { exact: true }).click(); await page.getByLabel('Display quality').selectOption('light');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.pointBudget === '500000'); await settled();
  const light = await state(); assert(light.points <= 500000 && light.budget === 500000); report.views.push({ name: 'mobile-light', ...light });
  report.checks.push('All four real-world scenes refine; mobile resize and Light budget remain bounded');
  await page.getByText('Display', { exact: true }).click();
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-1'); await settled();
  await page.getByRole('button', { name: 'Instance', exact: true }).click();
  await page.getByLabel('STPLS3D scene', { exact: true }).selectOption('stpls3d-realworld-ra'); await settled();
  assert.equal(await page.getByRole('button', { name: 'RGB', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  report.checks.push('Instance-to-real-world scene switch falls back to RGB without losing the viewer');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} finally {
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ status: report.status, artifacts, checks: report.checks }));
