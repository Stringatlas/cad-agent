// Connects to an explicitly available Chrome CDP endpoint; never launches/downloads a browser.
import { chromium } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:9222';
const url = 'http://127.0.0.1:4173/?smoke=1';
const directory = process.argv[3] ? pathToFileURL(resolve(process.argv[3]) + '/') : new URL('../artifacts/browser/', import.meta.url);
await mkdir(directory, { recursive: true });
const projectPath = join(await mkdtemp(join(tmpdir(), 'spatial-smoke-project-')), 'project.json');
const report = { status: 'failed', consoleCaptured: false, messages: [], screenshots: [], checks: [] };
let browser, page, preview, backend;
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  const context = browser.contexts()[0];
  assert.ok(context, 'Existing Chrome must expose a browser context');
  // The integrated viewer requires /project. Own a backend; never reuse/stop :3001.
  backend = spawn('pnpm', ['exec', 'tsx', '-e', `import { createDemoServer } from "./apps/server/src/index.ts"; createDemoServer(${JSON.stringify({ projectPath })}).listen(3012,"127.0.0.1",()=>console.log("Owned demo backend ready"));`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let backendOutput = '', backendExited = false;
  backend.stdout.on('data', chunk => backendOutput += chunk);
  backend.stderr.on('data', chunk => backendOutput += chunk);
  backend.on('exit', () => backendExited = true);
  backend.on('error', error => { backendOutput += error; backendExited = true; });
  for (let i = 0; i < 100 && !backendOutput.includes('Owned demo backend ready'); i++) { assert.ok(!backendExited, backendOutput); await delay(100); }
  assert.ok(backendOutput.includes('Owned demo backend ready'), 'Backend startup unavailable: ' + backendOutput);
  // Strict port avoids accidentally checking another application.
  preview = spawn('pnpm', ['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', 'import { preview } from "vite"; const server=await preview({preview:{host:"127.0.0.1",port:4173,strictPort:true,proxy:Object.fromEntries(["/datasets/","/project","/chat/","^/auth/status$","^/auth/logout$"].map(path=>[path,{target:"http://127.0.0.1:3012",changeOrigin:path.startsWith("^/auth/")}]))}}); server.printUrls();'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  let exited = false;
  preview.stdout.on('data', chunk => { output += chunk; });
  preview.stderr.on('data', chunk => { output += chunk; });
  preview.on('exit', () => { exited = true; });
  preview.on('error', error => { output += String(error); exited = true; });
  for (let i = 0; i < 50 && !output.includes('http://127.0.0.1:4173'); i++) {
    assert.ok(!exited, 'Preview failed: ' + output);
    await delay(100);
  }
  assert.ok(output.includes('http://127.0.0.1:4173'), 'Preview startup timed out: ' + output);
  page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('console', message => report.messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) }));
  report.consoleCaptured = true;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Synthetic demo', exact: true }).click();
  const viewer = page.getByTestId('viewer');
  await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');
  await page.getByTestId('synthetic-scene-tools').locator(':scope > summary').click();
  await viewer.scrollIntoViewIfNeeded();
  await writeFile(new URL('initial.ax.txt', directory), await page.locator('body').ariaSnapshot());
  assert.equal(await page.getByRole('alert').count(), 0, 'Viewer error alert');
  assert.equal(await viewer.locator('canvas').count(), 1);
  assert.equal(Number(await viewer.getAttribute('data-points')), 441);
  assert.ok(Number(await viewer.getAttribute('data-triangles')) >= 12, 'Box mesh must render triangles');
  report.checks.push('canvas initialized; 441 points and box triangles submitted');
  await page.screenshot({ path: new URL('scene.png', directory).pathname, fullPage: true });
  report.screenshots.push('scene.png');
  assert.ok((await page.locator('.scene-source aside').textContent()).includes('Meters (m) · right-handed · Z-up'));
  assert.ok((await page.locator('.scene-source aside').textContent()).includes('1000, 2000, 10 m'));
  report.checks.push('explicit units and local-origin metadata');
  const selected = page.getByTestId('selected-id');
  assert.equal(await selected.textContent(), 'None');
  for (const id of ['proposal-box', 'synthetic-cloud']) {
    const targets = JSON.parse(await viewer.getAttribute('data-targets'));
    const target = targets.find(target => target.id === id);
    const bounds = await viewer.boundingBox();
    assert.ok(bounds && target, 'Projected target must exist');
    assert.ok(target.x >= 0 && target.x < bounds.width && target.y >= 0 && target.y < bounds.height, id + ' must be in view');
    await page.mouse.click(bounds.x + target.x, bounds.y + target.y);
    await page.waitForFunction(id => document.querySelector('[data-testid="selected-id"]')?.textContent === id, id);
    assert.equal(await page.getByRole('button', { name: new RegExp(id) }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: new URL(id + '.png', directory).pathname, fullPage: true });
    report.screenshots.push(id + '.png');
    report.checks.push('canvas picking selected authoritative ID: ' + id);
  }
  await page.getByRole('button', { name: 'Clear selection' }).click();
  assert.equal(await selected.textContent(), 'None');
  await page.getByRole('button', { name: /proposal-box/ }).click();
  assert.equal(await selected.textContent(), 'proposal-box');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  report.checks.push('entity-list selection resolves ID');
  await viewer.scrollIntoViewIfNeeded();
  const before = await viewer.getAttribute('data-targets');
  const bounds = await viewer.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(before => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-targets') !== before, before);
  assert.equal(await selected.textContent(), 'None', 'Orbit drag must not select an entity');
  report.checks.push('clear selection and orbit drag');
  const beforeZoom = await viewer.getAttribute('data-targets');
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(before => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-targets') !== before, beforeZoom);
  report.checks.push('wheel zoom changes projection');
  await page.setViewportSize({ width: 640, height: 850 });
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="viewer"]');
    const canvas = host?.querySelector('canvas');
    return canvas && Math.abs(canvas.getBoundingClientRect().width - host.getBoundingClientRect().width) < 1;
  });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.screenshot({ path: new URL('narrow.png', directory).pathname, fullPage: true });
  report.screenshots.push('narrow.png');
  report.checks.push('narrow viewport resizes canvas');
  assert.deepEqual(report.messages.filter(message => ['error', 'pageerror'].includes(message.type)), [], 'Browser console/runtime errors');
  report.status = 'passed';
  console.log('Browser smoke passed. Evidence: ' + directory.pathname);
} catch (error) {
  report.error = String(error);
  console.error('Browser smoke FAILED/UNAVAILABLE: ' + error);
  process.exitCode = 1;
} finally {
  if (page) await page.close().catch(() => {});
  // On a CDP connection this disconnects the client, not the user's Chrome.
  if (browser) await browser.close().catch(() => {});
  for (const child of [preview, backend]) if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await rm(dirname(projectPath), { recursive: true, force: true });
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n');
}
