// Built UI, actual prepared backend, existing CDP Chrome only. No launch/data generation.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const directory = new URL('../artifacts/closest-pole-ui/browser/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { status: 'failed', consoleCaptured: false, messages: [], checks: [], screenshots: [] };
const processes = []; let browser, page;
async function start(args, ready) {
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); processes.push(child);
  let output = '', exited = false;
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes); child.on('exit', () => exited = true); child.on('error', error => { exited = true; output += error; });
  for (let i = 0; i < 100 && !output.includes(ready); i++) { assert.ok(!exited, output); await delay(100); }
  assert.ok(output.includes(ready), 'Startup unavailable: ' + output);
}
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const context = browser.contexts()[0]; assert.ok(context);
  // Owned ports only; never change the user's server on :3001.
  await start(['exec', 'tsx', '-e', 'import { createDemoServer } from "./apps/server/src/index.ts"; createDemoServer().listen(3002, "127.0.0.1", () => console.log("Owned backend ready"));'], 'Owned backend ready');
  await start(['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', 'import { preview } from "vite"; const server = await preview({ preview: { host: "127.0.0.1", port: 4175, strictPort: true, proxy: { "/datasets/": { target: "http://127.0.0.1:3002" } } } }); server.printUrls();'], 'http://127.0.0.1:4175');
  page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 1100 });
  page.on('console', message => report.messages.push({ type: message.type(), text: message.text() })); page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) })); report.consoleCaptured = true;
  const requests = [];
  page.on('request', request => { if (request.url().includes('/closest-label?')) requests.push(JSON.parse(new URL(request.url()).searchParams.get('request'))); });
  await page.goto('http://127.0.0.1:4175/?smoke=1'); await page.getByRole('button', { name: 'Closest: label', exact: true }).click();
  const viewer = page.getByTestId('pole-viewer'), status = page.getByTestId('pole-status');
  await page.waitForFunction(() => document.querySelector('[data-testid="pole-display-status"]')?.textContent?.startsWith('Ready'));
  const target = async () => { const box = await viewer.boundingBox(), p = JSON.parse(await viewer.getAttribute('data-pick-point')); assert.ok(box && p); return { x: box.x + p[0], y: box.y + p[1] }; };
  let p = await target();
  await page.keyboard.down('Shift'); await page.keyboard.down('Meta'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta'); await page.keyboard.up('Shift'); assert.equal(requests.length, 0);
  await page.keyboard.down('Meta'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30, p.y + 20, { steps: 5 }); await page.mouse.move(p.x, p.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Meta'); assert.equal(requests.length, 0, 'Returned drag is not a click');
  await page.keyboard.down('Meta'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta'); await page.waitForFunction(() => document.querySelector('[data-testid="pole-status"]')?.textContent === 'resolving'); assert.equal(requests.length, 1); assert.equal(requests[0].input.kind, 'point-ref'); assert.equal(requests[0].domain.kind, 'whole-dataset');
  await page.getByTestId('pole-cancel').click(); assert.equal(await status.textContent(), 'cancelled-incomplete'); await page.getByTestId('pole-clear').click(); assert.equal(await status.textContent(), 'idle');
  report.checks.push('Shift precedence, Cmd drag-return ignored, one Cmd query, cancel/clear');
  // Ensure prior server cancellation can finish bounded work before occupying another slot.
  await page.getByRole('button', { name: 'Reload display', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="pole-display-status"]')?.textContent?.startsWith('Ready'));
  p = await target(); await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
  await page.waitForFunction(() => ['verified-found', 'verified-none', 'error', 'error-stale'].includes(document.querySelector('[data-testid="pole-status"]')?.textContent), undefined, { timeout: 0 });
  assert.equal(await status.textContent(), 'verified-found'); assert.equal(requests.length, 2); assert.equal(await viewer.getAttribute('data-query-winner'), 'true');
  const before = await viewer.getAttribute('data-camera'); await page.getByTestId('pole-frame').click(); await page.waitForFunction(before => document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') !== before, before);
  await page.screenshot({ path: new URL('verified-result.png', directory).pathname, fullPage: true }); report.screenshots.push('verified-result.png');
  await page.getByTestId('pole-depth').selectOption('0'); await page.waitForFunction(() => document.querySelector('[data-testid="pole-display-status"]')?.textContent?.startsWith('Ready')); assert.equal(await status.textContent(), 'verified-found'); assert.equal(requests.length, 2);
  const box = await viewer.boundingBox(), camera = await viewer.getAttribute('data-camera');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 }); await page.mouse.up(); await page.waitForFunction(camera => document.querySelector('[data-testid="pole-viewer"]')?.getAttribute('data-camera') !== camera, camera);
  await page.mouse.wheel(0, -200); assert.equal(requests.length, 2); report.checks.push('Ctrl query verified, markers/Frame result, display LOD independence, ordinary orbit/zoom');
  await page.setViewportSize({ width: 700, height: 950 }); await page.screenshot({ path: new URL('narrow.png', directory).pathname, fullPage: true }); report.screenshots.push('narrow.png');
  await page.getByRole('button', { name: 'Toronto3D preview', exact: true }).click(); await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  await page.getByRole('button', { name: 'Synthetic demo', exact: true }).click(); await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');
  report.checks.push('resize and tab disposal'); assert.deepEqual(report.messages.filter(m => ['error', 'pageerror'].includes(m.type)), []); report.status = 'passed';
} catch (error) { report.error = String(error); console.error('Closest pole browser FAILED/UNAVAILABLE: ' + error); process.exitCode = 1; }
finally {
  if (page) await page.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  for (const child of processes) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n');
}
