// Existing Chrome only. Does not launch/install a browser or modify prepared data.
import { chromium } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.argv[3] ? pathToFileURL(resolve(process.argv[3]) + '/') : new URL('../artifacts/projected-full-resolution/browser/', import.meta.url);
await mkdir(directory, { recursive: true });
const projectPath = join(await mkdtemp(join(tmpdir(), 'spatial-toronto-smoke-project-')), 'project.json');
const report = { status: 'failed', consoleCaptured: false, messages: [], checks: [], screenshots: [] };
let browser, page;
const processes = [];
async function start(args, ready) {
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  processes.push(child);
  let output = '', exited = false;
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  child.on('exit', () => exited = true); child.on('error', error => { output += error; exited = true; });
  for (let i = 0; i < 100 && !output.includes(ready); i++) { assert.ok(!exited, output); await delay(100); }
  assert.ok(output.includes(ready), 'Startup timed out: ' + output);
}
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const context = browser.contexts()[0]; assert.ok(context);
  // Owned ports only: never reuse or stop operator :3001/:5173.
  await start(['exec', 'tsx', '-e', `import { createDemoServer } from './apps/server/src/index.ts'; createDemoServer(${JSON.stringify({ projectPath })}).listen(3015,'127.0.0.1',()=>console.log('Owned Toronto backend ready'));`], 'Owned Toronto backend ready');
  await start(['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', 'import { preview } from "vite"; const server=await preview({preview:{host:"127.0.0.1",port:4174,strictPort:true,proxy:Object.fromEntries(["/datasets/","/project","/chat/","^/auth/status$","^/auth/logout$"].map(path=>[path,{target:"http://127.0.0.1:3015",changeOrigin:path.startsWith("^/auth/")}]))}}); server.printUrls();'], 'http://127.0.0.1:4174');
  page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 1100 });
  page.on('console', message => report.messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => report.messages.push({ type: 'pageerror', text: String(error) }));
  report.consoleCaptured = true;
  await page.goto('http://127.0.0.1:4174/?smoke=1');
  await page.getByRole('button', { name: 'Toronto3D preview', exact: true }).click();
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  await page.getByText('Harness observation & export', { exact: true }).click();
  const displayStatus = page.getByTestId('display-status'), harnessStatus = page.getByTestId('harness-status');
  const ready = async () => { await page.waitForFunction(() => ['display-status', 'harness-status'].every(id => document.querySelector(`[data-testid="${id}"]`)?.textContent === 'Ready')); };
  await ready();
  const viewer = page.getByTestId('toronto-viewer');
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-points') === '50000');
  assert.equal(await viewer.locator('canvas').count(), 1);
  assert.ok((await page.locator('main').textContent()).includes('[627285, 4841948, 0]'));
  report.checks.push('actual Toronto: 50k points submitted, local frame and origin explicit');
  await writeFile(new URL('initial.ax.txt', directory), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: new URL('initial.png', directory).pathname, fullPage: true }); report.screenshots.push('initial.png');
  const hash = await page.getByTestId('harness-hash').textContent();
  const overviewCount = await page.getByTestId('display-count').textContent();
  assert.equal(await viewer.getAttribute('data-box-visible'), 'true');
  const setCenter = async center => { for (const [i, axis] of ['x', 'y', 'z'].entries()) await page.getByTestId('box-center-' + axis).fill(String(center[i])); };
  // View-based placement: use the projected first overview point, not guessed screen coordinates.
  await setCenter([0, 0, 125]);
  await viewer.scrollIntoViewIfNeeded();
  const rect = await viewer.boundingBox(); assert.ok(rect);
  const pick = JSON.parse(await viewer.getAttribute('data-pick-point'));
  assert.ok(pick[0] >= 0 && pick[0] <= rect.width && pick[1] >= 0 && pick[1] <= rect.height);
  await page.keyboard.down('Shift'); await page.mouse.click(rect.x + pick[0], rect.y + pick[1]); await page.keyboard.up('Shift');
  assert.notEqual(await page.getByTestId('box-center-x').inputValue(), '0');
  // Known populated local location exercises hierarchy proxies and visible dense detail.
  await setCenter([278.715, 505.852, 139.662]);
  await page.getByTestId('load-crop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box');
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points') === '10914');
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  assert.equal(await page.getByTestId('display-count').textContent(), overviewCount);
  assert.match(await page.getByTestId('selection-info').textContent(), /Axis-aligned box.*inclusive local bounds/);
  assert.match(await page.getByTestId('crop-count').textContent(), /complete, no downsampling/);
  assert.equal(await page.getByTestId('cancel-crop').isDisabled(), true);
  assert.equal(await page.getByTestId('crop-progress').count(), 0);
  await page.getByTestId('frame-box').click();
  await page.screenshot({ path: new URL('full-resolution-box.png', directory).pathname, fullPage: true }); report.screenshots.push('full-resolution-box.png');
  // Changing harness settings must not clear, replace or sample the dense crop.
  await page.getByTestId('harness-budget').selectOption('256'); await ready();
  assert.equal(await viewer.getAttribute('data-crop-points'), '10914');
  await page.getByTestId('harness-budget').selectOption('1024'); await ready();
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  await page.getByTestId('box-size-x').fill('2');
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points') === '0');
  // Whole-cloud selection progresses beyond the historical cap, then THIS CLIENT cancels.
  await setCenter([238, 538, 144]);
  for (const axis of ['x', 'y', 'z']) await page.getByTestId('box-size-' + axis).fill('2200');
  await page.getByTestId('load-crop').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points')) > 100000);
  assert.ok((await page.getByTestId('crop-count').textContent()).includes('partial'));
  assert.match(await page.getByTestId('crop-progress').textContent(), /Selected total unknown until completion/);
  assert.equal(await page.getByTestId('cancel-crop').isEnabled(), true);
  await page.getByTestId('cancel-crop').click();
  assert.ok((await page.getByTestId('crop-status').textContent()).includes('Cancelled'));
  await delay(100); // Let the last pre-cancel GPU publication reach the frame's diagnostic count.
  const partial = await viewer.getAttribute('data-crop-points'); await delay(500);
  assert.equal(await viewer.getAttribute('data-crop-points'), partial);
  await page.getByTestId('clear-crop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points') === '0');
  // Actual Shift-drag: visible overlay, frozen camera/no orbit, automatic progressive volume query.
  await page.getByRole('button', { name: 'Frame dataset' }).click(); await delay(700);
  await viewer.scrollIntoViewIfNeeded();
  const windowRect = await viewer.boundingBox(); assert.ok(windowRect);
  await page.keyboard.down('Shift');
  await page.mouse.move(windowRect.x + windowRect.width * 0.25, windowRect.y + windowRect.height * 0.25);
  await page.mouse.down();
  // Pointer capture freezes controls; wait for that physical state to reach the smoke diagnostic.
  // A pre-pointerdown sample can differ by binary64 normalization during idle controls.update().
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frozenCamera = await viewer.getAttribute('data-camera');
  await page.mouse.move(windowRect.x + windowRect.width * 0.75, windowRect.y + windowRect.height * 0.75, { steps: 8 });
  assert.equal(await page.getByTestId('selection-window').isVisible(), true);
  await writeFile(new URL('shift-drag-overlay.ax.txt', directory), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: new URL('shift-drag-overlay.png', directory).pathname, fullPage: true }); report.screenshots.push('shift-drag-overlay.png');
  assert.equal(await viewer.getAttribute('data-camera'), frozenCamera);
  await page.mouse.up(); await page.keyboard.up('Shift');
  await page.waitForSelector('[data-testid="projected-selection"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points')) > 0);
  assert.ok((await page.getByTestId('crop-count').textContent()).includes('partial'));
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  assert.equal(await viewer.getAttribute('data-camera'), frozenCamera);
  assert.match(await page.getByTestId('selection-info').textContent(), /Projected window.*dataset clipping extent, not the frustum's shape/);
  const frozenSelectionInfo = await page.getByTestId('selection-info').textContent();
  await page.getByTestId('cancel-crop').click();
  assert.equal(await page.getByTestId('cancel-crop').isDisabled(), true);
  assert.equal(await page.getByTestId('retry-crop').isEnabled(), true);
  await page.screenshot({ path: new URL('projected-progress-cancel.png', directory).pathname, fullPage: true }); report.screenshots.push('projected-progress-cancel.png');
  // Retry repeats this frozen query, not the dormant numeric box or current camera.
  await page.getByTestId('retry-crop').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points')) > 0);
  assert.equal(await page.getByTestId('selection-info').textContent(), frozenSelectionInfo);
  await page.getByTestId('cancel-crop').click();
  await page.getByTestId('clear-crop').click();
  assert.equal(await page.getByTestId('clear-crop').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points') === '0');
  await setCenter([278.715, 505.852, 139.662]);
  for (const axis of ['x', 'y', 'z']) await page.getByTestId('box-size-' + axis).fill('5');
  await page.getByTestId('load-crop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box');
  await page.getByTestId('clear-crop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points') === '0');
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  await page.getByRole('button', { name: 'Frame dataset' }).click();
  report.checks.push('visible editable box/10914 complete points; uncapped >100k progressive AABB then client cancellation; actual Shift-drag overlay/projected progressive query without orbit; explicit selection/progress feedback and phase-aware cancel/clear/retry of frozen selection; clear/dispose and harness independence');
  await page.getByTestId('display-budget').selectOption('100000'); await ready();
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  assert.equal(await page.getByTestId('harness-budget').inputValue(), '1024');
  await page.getByTestId('display-depth').selectOption('1'); await ready();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-points') === '9245');
  assert.equal(await page.getByTestId('harness-hash').textContent(), hash);
  report.checks.push('display budget and depth change rendering without changing harness settings/sample');
  const displayCount = await page.getByTestId('display-count').textContent();
  await page.getByTestId('harness-budget').selectOption('4096'); await ready();
  assert.notEqual(await page.getByTestId('harness-hash').textContent(), hash);
  await page.getByTestId('harness-depth').selectOption('3'); await ready();
  assert.equal(await page.getByTestId('display-count').textContent(), displayCount);
  assert.equal(await page.getByTestId('display-budget').inputValue(), '100000');
  assert.equal(await page.getByTestId('display-depth').inputValue(), '1');
  report.checks.push('harness budget/depth alter concrete sample without changing display');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download harness observation JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = new URL('observation.json', directory).pathname; await download.saveAs(downloadPath);
  const observation = JSON.parse(await readFile(downloadPath, 'utf8'));
  assert.equal(observation.count, 4096); assert.equal(observation.positions.length, 12288); assert.equal(observation.lod.depth, 3);
  assert.equal(observation.sampleHash, await page.getByTestId('harness-hash').textContent());
  report.checks.push('download contains actual bounded XYZ/RGB/provenance/labels and reproducibility metadata');
  await viewer.scrollIntoViewIfNeeded();
  const bounds = await viewer.boundingBox(); assert.ok(bounds);
  const camera = await viewer.getAttribute('data-camera');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 25, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(before => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-camera') !== before, camera);
  await delay(500); const beforeZoom = await viewer.getAttribute('data-camera'); await page.mouse.wheel(0, -200);
  await page.waitForFunction(before => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-camera') !== before, beforeZoom);
  assert.equal(await page.getByTestId('harness-hash').textContent(), observation.sampleHash);
  await page.getByRole('button', { name: 'Frame dataset' }).click();
  report.checks.push('orbit, zoom and frame dataset work without resampling harness');
  await page.setViewportSize({ width: 680, height: 1000 });
  await page.waitForFunction(() => { const host = document.querySelector('[data-testid="toronto-viewer"]'); return host && Math.abs(host.clientWidth - host.querySelector('canvas').getBoundingClientRect().width) < 1; });
  await page.screenshot({ path: new URL('narrow.png', directory).pathname, fullPage: true }); report.screenshots.push('narrow.png');
  report.checks.push('Toronto viewport resizes correctly on narrow screens');
  assert.deepEqual(report.messages.filter(message => ['error', 'pageerror'].includes(message.type)), []);
  report.status = 'passed';
  console.log('Toronto browser smoke passed: ' + directory.pathname);
} catch (error) { report.error = String(error); process.exitCode = 1; console.error('Toronto browser FAILED/UNAVAILABLE: ' + error); }
finally {
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  for (const child of processes) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await rm(dirname(projectPath), { recursive: true, force: true });
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n');
}
