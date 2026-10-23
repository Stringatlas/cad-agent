// Task086: isolated backend and browser context; never mutate the operator's scene.
// node --import tsx scripts/browser-workspace-ui-smoke.mjs [CDP endpoint] [artifact directory]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';
const directory = resolve(process.argv[3] ?? '/tmp/task086-browser');
await mkdir(directory, { recursive: true });
const report = { status: 'failed', checks: [], screenshots: [], errors: [] };
let browser, context, front, page;
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'synthetic-ui-test-only' }, modelTransport: async url => {
  assert(String(url).endsWith('/models'), 'This UI check must never send an inference request');
  return Response.json({ data: [{ id: 'ui-fixture' }] });
} });
async function shot(name) {
  await writeFile(`${directory}/${name}.ax.txt`, await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: `${directory}/${name}.png` });
  report.screenshots.push(`${name}.png`);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), `${name}: document overflow`);
}
async function disclosure(testId) { await page.getByTestId(testId).locator(':scope > summary').click(); }
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true, configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${front.httpServer.address().port}/?smoke=1`);
  await page.getByLabel('Scene source').waitFor();
  assert.equal(await page.title(), 'Workspace');
  assert.equal(await page.locator('.brand, .conversation-empty').count(), 0);
  await shot('desktop-cloud');
  await page.getByLabel('Scene source').selectOption('toronto');
  await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="create-point-tool"]')?.disabled && !document.querySelector('[data-testid="point-edits"]:not([hidden])'));
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="toronto-viewer"]'); return Number(v?.getAttribute('data-adaptive-points')) > 100000 && v?.getAttribute('data-adaptive-pending') === '0'; });
  const toolbar = await page.getByRole('group', { name: 'Scene controls', exact: true }).boundingBox();
  const viewport = await page.getByTestId('toronto-viewer').boundingBox();
  assert(toolbar.y + toolbar.height <= viewport.y + 1, 'Toolbar must sit outside canvas');
  await shot('desktop-toronto-idle');
  await disclosure('display-quality');
  await page.getByLabel('Point colors').selectOption('type');
  await disclosure('point-type-key');
  await page.getByRole('list', { name: 'Point type color key' }).waitFor();
  await shot('desktop-display-key');
  await page.getByLabel('Point colors').selectOption('rgb');
  await disclosure('display-quality');
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByTestId('create-point-tool').click();
  await page.getByTestId('datum-z').fill('125');
  await page.getByTestId('datum-preview').click();
  await page.getByTestId('approval-review').waitFor();
  await shot('desktop-pending');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await shot('mobile-pending');
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  const approval = await page.getByTestId('approval-review').boundingBox();
  const chat = await page.getByTestId('chat').boundingBox();
  assert(chat.y + chat.height <= approval.y + 1, 'Mobile chat must not cover approval');
  await shot('mobile-pending-chat');
  await page.getByRole('button', { name: 'Toggle chat' }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByTestId('approval-review').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByTestId('datum-row').click();
  await page.getByTestId('selected-datum').waitFor();
  await shot('mobile-selected');
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot('desktop-selected');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('mobile-idle');
  await page.waitForSelector('[data-testid="toronto-viewer"][data-detail-pick-point]');
  const host = page.getByTestId('toronto-viewer'), bounds = await host.boundingBox();
  const pick = JSON.parse(await host.getAttribute('data-detail-pick-point'));
  await page.keyboard.down('Control'); await page.mouse.click(bounds.x + pick[0], bounds.y + pick[1]); await page.keyboard.up('Control');
  await page.getByTestId('selected-source').waitFor();
  assert.match(await page.getByTestId('selected-source').innerText(), /Point 1 ·/);
  await shot('mobile-selected-source');
  await page.setViewportSize({ width: 1440, height: 900 }); await shot('desktop-selected-source');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await disclosure('display-quality'); await shot('mobile-display'); await disclosure('display-quality');
  await page.route('**/datasets/toronto3d/objects', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture unavailable' }) }));
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByTestId('scene-hierarchy').getByText('Details', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh objects', exact: true }).click();
  await page.getByTestId('scene-hierarchy').getByRole('alert').waitFor();
  await shot('mobile-error');
  await page.setViewportSize({ width: 1440, height: 900 }); await shot('desktop-error');
  await page.unroute('**/datasets/toronto3d/objects');
  await page.getByTestId('scene-hierarchy').getByRole('alert').getByRole('button', { name: 'Refresh objects' }).click();
  await page.getByTestId('scene-hierarchy').getByRole('alert').waitFor({ state: 'hidden' });
  report.checks.push('Unbranded header and no chat tagline; toolbar outside canvas; display/type key accessible; datum preview and individual approval; selected identity; mobile chat/approval separation; error and recovery on desktop/mobile');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.error = String(error.stack ?? error); if (page) await shot('failure').catch(() => {}); process.exitCode = 1; }
finally {
  await context?.close(); await browser?.close(); await front?.httpServer.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, directory, error: report.error }));
}
