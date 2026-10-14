// Task012: built UI, real prepared dispatcher, existing CDP Chrome only. Never launches Chrome.
// Usage: node scripts/browser-shared-chat-smoke.mjs [CDP endpoint] [OS-temp evidence directory]
// Owns only process groups on :3013/:4176 and one new tab; does not touch the user's :3001 server.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'spatial-task012-browser-'));
await mkdir(directory, { recursive: true });
const report = { status: 'failed', task: '012', directory, checks: [], messages: [], screenshots: [], responses: [],
  ownership: 'Only new tab and owned 3013/4176 process groups; no browser launch, dataset mutation or server3001 changes.',
  faultScope: 'Cancellation/reload deliberately gate a real completed HTTP response using a fetch wrapper that ignores abort. Server failure stops the owned backend; dataset failure restarts it with a nonexistent fixed operator root.' };
const children = [];
let browser, page, backend, phase = 'native';
async function save(name, value) { await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n'); }
async function start(name, args, ready) {
  const child = spawn('pnpm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push({ name, child });
  let output = '', exited = false;
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
  child.on('exit', () => exited = true); child.on('error', error => { output += error; exited = true; });
  child.output = () => output;
  for (let i = 0; i < 100 && !output.includes(ready); i++) { assert.ok(!exited, `${name}: ${output}`); await delay(100); }
  assert.ok(output.includes(ready), `${name} startup unavailable: ${output}`); return child;
}
async function startBackend(unavailable = false) {
  return start(unavailable ? 'missing-dataset-backend' : 'backend', ['exec', 'tsx', '-e',
    `import { createDemoServer } from "./apps/server/src/index.ts"; const server=createDemoServer(${unavailable ? JSON.stringify({ datasetRoot: join(directory, 'nonexistent-dataset') }) : ''}); server.listen(3013,"127.0.0.1",()=>console.log("Owned chat backend ready"));`], 'Owned chat backend ready');
}
async function state(expected) {
  await page.waitForFunction(expected => document.querySelector('[data-testid="chat-result"]')?.getAttribute('data-state') === expected, expected, { timeout: 30_000 });
}
async function send(command, expected = 'completed') {
  await page.getByTestId('chat-command').fill(command);
  await page.getByRole('button', { name: 'Send inspection', exact: true }).click(); await state(expected);
}
async function screenshot(name) { await page.screenshot({ path: join(directory, name), fullPage: true }); report.screenshots.push(name); }
async function gate() {
  await page.evaluate(() => {
    const original = window.fetch;
    window.__task012Gate = { received: false, released: false, release: null, restore: () => window.fetch = original };
    window.fetch = async (input, init) => {
      if (typeof input !== 'string' || input !== '/chat/inspect') return original(input, init);
      // Keep the actual dispatcher request/reply, but force a late noncooperative return.
      const response = await original(input, { ...init, signal: undefined });
      window.__task012Gate.received = true;
      await new Promise(resolve => window.__task012Gate.release = resolve);
      window.__task012Gate.released = true; return response;
    };
  });
  await page.getByTestId('chat-command').fill('metadata');
  await page.getByRole('button', { name: 'Send inspection', exact: true }).click(); await state('pending');
  await page.waitForFunction(() => window.__task012Gate.received && window.__task012Gate.release, undefined, { timeout: 30_000 });
}
async function release() {
  await page.evaluate(() => { window.__task012Gate.restore(); window.__task012Gate.release(); });
  await page.waitForFunction(() => window.__task012Gate.released); await delay(250);
}
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const context = browser.contexts()[0]; assert.ok(context, 'Existing Chrome context required');
  backend = await startBackend();
  await start('preview', ['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e',
    'import { preview } from "vite"; const server=await preview({preview:{host:"127.0.0.1",port:4176,strictPort:true,proxy:Object.fromEntries(["/datasets/","/project","/chat/"].map(path=>[path,{target:"http://127.0.0.1:3013"}]))}}); server.printUrls();'], 'http://127.0.0.1:4176');
  page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 1000 });
  page.on('console', m => report.messages.push({ phase, type: m.type(), text: m.text() }));
  page.on('pageerror', e => report.messages.push({ phase, type: 'pageerror', text: String(e) }));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/chat/inspect') return;
    try { report.responses.push({ status: response.status(), request: response.request().postDataJSON(), response: await response.json() }); } catch {}
  });
  await page.goto('http://127.0.0.1:4176/?smoke=1');
  const viewer = page.getByTestId('viewer'), chat = page.getByTestId('chat');
  await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');
  const projectResponse = await page.request.get('http://127.0.0.1:4176/project');
  assert.ok(projectResponse.ok()); const project = await projectResponse.json();
  const sessionId = projectResponse.headers()['x-spatial-session'], frame = projectResponse.headers()['x-spatial-frame'];
  const binding = await page.getByTestId('chat-project-binding').innerText();
  assert.match(await page.getByTestId('viewer-project-binding').innerText(), new RegExp(sessionId));
  for (const text of [sessionId, frame, `${project.revision} / ${project.coordinates.units}`, project.coordinates.localOrigin.join(', '), ...project.entities.map(e => e.id)]) assert.ok(binding.includes(text), `Shared binding: ${text}`);
  const left = await viewer.boundingBox(), right = await chat.boundingBox(); assert.ok(left && right && left.x + left.width <= right.x, 'Scene is left of chat');
  assert.equal(await viewer.getAttribute('data-points'), '441'); assert.ok(Number(await viewer.getAttribute('data-triangles')) >= 12);
  await screenshot('desktop.png'); report.checks.push('Desktop left-scene/right-chat layout; both use authoritative /project session/IDs/revision/units/frame/origin');

  for (const id of ['proposal-box', 'synthetic-cloud']) {
    const target = JSON.parse(await viewer.getAttribute('data-targets')).find(t => t.id === id), box = await viewer.boundingBox(); assert.ok(target && box);
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await page.waitForFunction(id => document.querySelector('[data-testid="selected-id"]')?.textContent === id, id);
    assert.equal(await page.getByRole('button', { name: new RegExp(id) }).getAttribute('aria-pressed'), 'true');
  }
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const targets = await viewer.getAttribute('data-targets'), box = await viewer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(before => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-targets') !== before, targets);
  assert.equal(await page.getByTestId('selected-id').innerText(), 'None');
  report.checks.push('Demo authoritative-ID picking and orbit regression');

  await send('metadata');
  const canonical = JSON.parse(await page.getByTestId('chat-request').textContent());
  const outcome = JSON.parse(await page.getByTestId('chat-tool-result').textContent());
  assert.equal(canonical.tool, 'dataset.metadata'); assert.deepEqual(canonical.args, {});
  assert.equal(canonical.binding.frameId, 'toronto3d-local-v1'); assert.equal(outcome.status, 'observed'); assert.equal(outcome.coverage, 'metadata-only');
  assert.equal(outcome.data.revision, canonical.binding.artifactRevision); assert.deepEqual(outcome.data.coordinates.localOrigin, [627285, 4841948, 0]);
  const evidence = await page.getByTestId('chat-evidence').innerText(); assert.ok(evidence.includes(canonical.runId) && evidence.includes(canonical.requestId));
  const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  assert.ok(evidence.includes(createHash('sha256').update(JSON.stringify(stable(outcome))).digest('hex')), 'Displayed metadata semantic hash matches real dispatcher outcome');
  await save('metadata.json', { canonical, outcome, evidence });
  await send('observe 32 0');
  const sampleCall = JSON.parse(await page.getByTestId('chat-request').textContent()), sample = JSON.parse(await page.getByTestId('chat-tool-result').textContent());
  assert.equal(sampleCall.tool, 'dataset.observe'); assert.deepEqual(sampleCall.args, { lod: { budget: 32, depth: 0 } });
  assert.equal(sample.status, 'observed'); assert.equal(sample.coverage, 'bounded-first-chunk-sample');
  assert.ok(sample.data.count > 0 && sample.data.count <= 32); assert.equal(sample.data.positions.length, sample.data.count * 3);
  assert.equal(sampleCall.binding.artifactRevision, canonical.binding.artifactRevision); await save('observe.json', { canonical: sampleCall, outcome: sample });
  await screenshot('dispatcher-result.png'); report.checks.push('Native metadata + observe commands use real prepared task011 dispatcher and display canonical binding/evidence; Toronto frame remains separate');
  await send('move box', 'rejected'); assert.match(await page.getByTestId('chat-result').innerText(), /unsupported-command/);
  assert.equal(await page.getByTestId('chat-request').count(), 0); report.checks.push('Unsupported text explicitly rejected without a fake model answer');
  const stale = { sessionId, projectRevision: project.revision, generation: 1, requestId: 'browser-stale', command: 'metadata' };
  for (const changed of [{ ...stale, sessionId: 'old-session' }, { ...stale, projectRevision: project.revision + 1 }]) {
    const response = await page.request.post('http://127.0.0.1:4176/chat/inspect', { data: changed }); const value = await response.json();
    assert.equal(value.state, 'rejected'); assert.equal(value.code, 'stale-project');
  }
  report.checks.push('Real transport rejects stale server session and geometry revision');

  await gate(); await page.getByRole('button', { name: 'Cancel inspection', exact: true }).click(); await state('cancelled'); await release(); await state('cancelled');
  assert.equal(await page.getByTestId('chat-evidence').count(), 0); report.checks.push('Pending → cancelled; late actual reply cannot publish, even when loader ignores abort');
  await gate(); await page.getByRole('button', { name: 'Reload shared project', exact: true }).click();
  await page.waitForSelector('[data-testid="viewer"][data-ready="true"]'); await release();
  assert.equal(await page.getByTestId('chat-result').count(), 0); await send('metadata');
  report.checks.push('Project reload disposes chat/controller/viewer; late reply suppressed; fresh generation works');
  assert.deepEqual(await (await page.request.get('http://127.0.0.1:4176/project')).json(), project, 'Inspection/picking/camera never mutate authoritative geometry');
  await page.setViewportSize({ width: 700, height: 950 });
  await page.waitForFunction(() => { const h = document.querySelector('[data-testid="viewer"]'), c = h?.querySelector('canvas'); return c && Math.abs(c.getBoundingClientRect().width - h.getBoundingClientRect().width) < 1; });
  const narrowScene = await page.locator('.scene-source').boundingBox(), narrowChat = await chat.boundingBox(); assert.ok(narrowScene && narrowChat && narrowChat.y >= narrowScene.y + narrowScene.height - 1);
  await screenshot('narrow.png'); report.checks.push('Narrow viewport stacks chat and resizes scene canvas');
  assert.deepEqual(report.messages.filter(m => ['error', 'pageerror'].includes(m.type)), [], 'No native browser console/runtime errors');

  phase = 'intentional-server-failure'; process.kill(-backend.pid, 'SIGTERM');
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:3013/health'); await delay(100); } catch { break; } }
  await send('metadata', 'error'); assert.match(await page.getByTestId('chat-result').innerText(), /server-unavailable-or-invalid-response/);
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await page.getByTestId('project-error').waitFor();
  assert.equal(await page.getByTestId('viewer').count(), 0); assert.equal(await page.getByTestId('chat').count(), 0);
  await screenshot('server-unavailable.png'); report.checks.push('Actual owned-server shutdown gives chat error and project unavailable; no independent seed/fallback');
  phase = 'intentional-dataset-failure'; backend = await startBackend(true);
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');
  await send('metadata', 'error'); assert.match(await page.getByTestId('chat-result').innerText(), /dataset-unavailable/);
  assert.equal(await page.getByTestId('chat-evidence').count(), 0); report.checks.push('Actual nonexistent fixed server dataset root yields explicit dataset-unavailable (no paths exposed)');
  assert.deepEqual(report.messages.filter(m => m.type === 'pageerror'), [], 'No runtime exceptions, including failure handling');
  report.status = 'passed'; console.log(`Shared chat browser passed. Evidence: ${directory}`);
} catch (error) { report.error = String(error); console.error(`Shared chat browser FAILED/UNAVAILABLE: ${error}\nEvidence: ${directory}`); process.exitCode = 1; }
finally {
  if (page) await page.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  for (const { child, name } of children) { if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } await writeFile(join(directory, name + '.log'), child.output?.() ?? ''); }
  await save('report.json', report);
}
