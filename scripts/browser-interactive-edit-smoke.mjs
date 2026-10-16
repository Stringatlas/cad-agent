// Tasks014/015: built UI + actual authority + existing Chrome CDP. Never launches Chrome.
// Owns only :3014/:4177 process groups, an isolated operator projectPath and one new tab.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'spatial-interactive-browser-'));
await mkdir(directory, { recursive: true });
const projectPath = join(await mkdtemp(join(tmpdir(), 'spatial-interactive-project-')), 'project.json'), base = 'http://127.0.0.1:4177';
const report = { status: 'failed', directory, projectPath, checks: [], messages: [], screenshots: [], replies: [],
  ownership: 'Owned3014/4177 processes and one new tab. Existing user Chrome CDP only; trusted isolated temp projectPath. No user server termination.' };
const children = []; let browser, page, backend, phase = 'native';
async function save(name, value) { await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n'); }
async function start(name, args, ready) {
  const child = spawn('pnpm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push({ name, child });
  let output = '', exited = false; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  child.on('exit', () => exited = true); child.on('error', e => { output += String(e); exited = true; }); child.output = () => output;
  for (let i = 0; i < 100 && !output.includes(ready); i++) { assert.ok(!exited, `${name}: ${output}`); await delay(100); }
  assert.ok(output.includes(ready), `${name}: ${output}`); return child;
}
async function startBackend(name) {
  return start(name, ['exec', 'tsx', '-e', `import { createDemoServer } from './apps/server/src/index.ts'; createDemoServer(${JSON.stringify({ projectPath })}).listen(3014,'127.0.0.1',()=>console.log('Owned authority ready'));`], 'Owned authority ready');
}
async function info() { const response = await page.request.get(base + '/project/session'); assert.ok(response.ok()); return (await response.json()).result; }
const binding = s => ({ sessionId: s.snapshot.sessionId, projectRevision: s.snapshot.project.revision, frameId: s.snapshot.frameId, units: 'm' });
async function openTools() {
  // Snapshot-keyed scene/approval panels remount collapsed after every authority
  // replacement. Navigate their real labeled summaries; never bypass UI gates.
  for (const id of ['project-controls', 'inspection-tools', 'synthetic-scene-tools', 'approved-box-tools']) {
    const panel = page.getByTestId(id);
    if (!await panel.evaluate(node => node.open)) await panel.locator(':scope > summary').click();
  }
}
async function ready() { await page.waitForSelector('[data-testid="viewer"][data-ready="true"]'); await openTools(); }
async function status(pattern) { await page.waitForFunction(pattern => new RegExp(pattern).test(document.querySelector('[data-testid="project-status"]')?.textContent ?? ''), pattern); }
async function revision(n) { await page.waitForFunction(n => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-revision') === String(n), n); await openTools(); }
async function screenshot(name) { await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(directory, name), fullPage: true }); report.screenshots.push(name); }
async function preview(center = '1, 0, 1', dimensions = '2, 1, 2') {
  await page.getByTestId('box-center').fill(center); await page.getByTestId('box-dimensions').fill(dimensions);
  await page.getByTestId('box-preview').click(); await page.getByTestId('box-proposal').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-preview') === 'true');
}
async function gate(endpoint) {
  await page.evaluate(endpoint => {
    const original = window.fetch;
    window.__projectGate = { received: false, release: null, restore: () => window.fetch = original };
    window.fetch = async (input, init) => {
      if (input !== endpoint) return original(input, init);
      const response = await original(input, { ...init, signal: undefined });
      window.__projectGate.received = true; await new Promise(resolve => window.__projectGate.release = resolve); return response;
    };
  }, endpoint);
}
async function received() { await page.waitForFunction(() => window.__projectGate.received && window.__projectGate.release); }
async function release() { await page.evaluate(() => { window.__projectGate.restore(); window.__projectGate.release(); }); await delay(250); }
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const context = browser.contexts()[0]; assert.ok(context, 'Existing Chrome required');
  backend = await startBackend('backend-first');
  await start('preview', ['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', `import { preview } from 'vite'; const server=await preview({preview:{host:'127.0.0.1',port:4177,strictPort:true,proxy:Object.fromEntries(['/datasets/','/project','/chat/','^/auth/status$','^/auth/logout$'].map(path=>[path,{target:'http://127.0.0.1:3014',changeOrigin:path.startsWith('^/auth/')}]))}}); server.printUrls();`], 'http://127.0.0.1:4177');
  page = await context.newPage(); await page.setViewportSize({ width: 1600, height: 1100 });
  page.on('console', m => report.messages.push({ phase, type: m.type(), text: m.text() })); page.on('pageerror', e => report.messages.push({ phase, type: 'pageerror', text: String(e) }));
  page.on('dialog', dialog => dialog.accept());
  page.on('response', async response => { if (!new URL(response.url()).pathname.startsWith('/project')) return; try { report.replies.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.json() }); } catch {} });
  await page.goto(base + '/?smoke=1');
  await page.getByRole('button', { name: 'Synthetic demo', exact: true }).click();
  await ready(); const original = await info(); assert.equal(original.snapshot.project.revision, 0);
  assert.match(await page.getByTestId('project-persistence').innerText(), /Unsaved geometry/);
  assert.ok((await page.getByTestId('chat-project-binding').innerText()).includes(original.snapshot.sessionId));
  assert.ok((await page.getByTestId('viewer-project-binding').innerText()).includes(original.snapshot.sessionId));
  report.checks.push('GET/session shared authority, server dirty label and retained undo pointer displayed');

  await page.getByRole('button', { name: /proposal-box.*Proposed box/ }).click();
  for (const [name, offset] of [['A', 0], ['B', 7]]) {
    await page.getByTestId('pin-name').selectOption(name);
    const viewer = page.getByTestId('viewer'); await viewer.scrollIntoViewIfNeeded();
    const rect = await viewer.boundingBox(), targets = JSON.parse(await viewer.getAttribute('data-point-targets'));
    const target = targets[offset]; assert.ok(target && rect);
    await page.keyboard.down('Control'); await page.mouse.click(rect.x + target.x, rect.y + target.y); await page.keyboard.up('Control');
    await page.getByTestId('point-' + name).waitFor();
  }
  await page.getByTestId('chat-command').fill('context'); await page.getByRole('button', { name: 'Send inspection', exact: true }).click();
  await page.getByTestId('chat-context').waitFor(); const bound = JSON.parse(await page.getByTestId('chat-context').textContent());
  assert.deepEqual(bound.entityIds, ['proposal-box']); assert.equal(bound.points.length, 2); assert.equal(bound.projectRevision, 0);
  assert.equal(bound.source, 'synthetic-project'); assert.equal(bound.frameId, 'demo-local-v1');
  for (const point of bound.points) { const cloud = original.snapshot.project.entities.find(e => e.id === point.entityId); assert.equal(cloud.kind, 'point-cloud'); assert.deepEqual(point.position, cloud.points[point.pointIndex]); }
  assert.deepEqual((await info()).snapshot, original.snapshot); await save('bound-context.json', bound); await screenshot('context-pins.png');
  report.checks.push('Native Cmd/Ctrl A/B picks resolve original ordered point index + binary64 coordinates; entity selection reaches actual bound context without changing revision');

  await preview(); assert.deepEqual((await info()).snapshot, original.snapshot);
  const parameters = JSON.parse(await page.getByTestId('proposal-parameters').textContent()); assert.deepEqual(parameters.edit.center, [1, 0, 1]);
  assert.match(await page.getByTestId('proposal-digest').innerText(), /^[a-f0-9]{64}$/); await screenshot('preview-wireframe.png');
  report.checks.push('Exact before/after/binding/parameters/digest and disposable wireframe preview; no authority publication');
  await page.getByTestId('box-center').fill('2, 0, 1'); assert.equal(await page.getByTestId('box-proposal').count(), 0);
  await page.waitForFunction(() => document.querySelector('[data-testid="viewer"]')?.getAttribute('data-preview') === 'false');
  await preview(); await page.getByTestId('box-approve').click(); await status('Committed update-box'); await revision(1);
  const committed = await info(); assert.deepEqual(committed.snapshot.project.entities.find(e => e.id === 'proposal-box').center, [1, 0, 1]);
  assert.equal(await page.getByTestId('chat-context').count(), 0); assert.equal(await page.getByTestId('point-A').count(), 0);
  assert.equal(await page.getByTestId('box-proposal').count(), 0); assert.match(await page.getByTestId('project-persistence').innerText(), /Unsaved/);
  assert.match(await page.getByTestId('chat-project-binding').innerText(), /1 \/ m/);
  await page.getByRole('button', { name: /proposal-box.*Proposed box/ }).click();
  assert.match(await page.locator('.scene-source aside').innerText(), /1, 0, 1 m/); await screenshot('committed-render.png');
  report.checks.push('Parameter change clears digest/preview; separate deliberate approval commits exactly once, scene + chat revision/geometry update, stale pins/context/proposals cleared');

  for (const request of [
    { path: '/project/proposals', body: { ...binding(committed), edit: { kind: 'update-box', entityId: 'proposal-box', center: [0,0,0], dimensions: [0,1,1] } } },
    { path: '/project/proposals', body: { ...binding(original), edit: { kind: 'update-box', entityId: 'proposal-box', center: [0,0,0], dimensions: [1,1,1] } } },
    { path: '/project/approve', body: { ...binding(committed), proposalId: 'unknown-proposal', digest: '0'.repeat(64), humanApproved: true } },
  ]) { const response = await page.request.post(base + request.path, { data: request.body }); assert.ok(!response.ok()); assert.equal((await response.json()).ok, false); }
  assert.deepEqual((await info()).snapshot, committed.snapshot); report.checks.push('Actual HTTP invalid dimensions/stale revision/unknown approval reject with unchanged geometry');

  // Hold only the first Refresh response; the second read must retain this page's inverse.
  phase = 'overlapping-refresh';
  await gate('/project/session'); await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await received();
  await page.evaluate(() => window.__projectGate.restore());
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await revision(1);
  assert.equal(await page.getByTestId('project-undo').isEnabled(), true);
  await release(); assert.equal(await page.getByTestId('project-undo').isEnabled(), true);
  assert.deepEqual(await info(), committed);
  report.checks.push('Overlapping same-session Refresh retains held inverse receipt/Undo and suppresses the late first response');

  phase = 'failed-refresh';
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (input !== '/project/session') return original(input, init);
      window.fetch = original;
      // Well-formed HTTP response, invalid authority envelope: no local fallback.
      return new Response(JSON.stringify({ ok: true, result: { malformed: true } }), { headers: { 'Content-Type': 'application/json' } });
    };
  });
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click();
  await page.getByTestId('project-error').waitFor(); assert.equal(await page.getByTestId('viewer').count(), 0);
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await revision(1);
  assert.equal(await page.getByTestId('project-undo').isEnabled(), true);
  assert.deepEqual(await info(), committed); phase = 'native';
  report.checks.push('Failed in-page Refresh then same-session recovery retains exact inverse receipt; authority unchanged and Undo remains enabled');
  await page.getByTestId('project-undo').click(); await status('Committed undo'); await revision(2);
  assert.deepEqual((await info()).snapshot.project.entities, original.snapshot.project.entities); assert.equal(await page.getByTestId('project-undo').isEnabled(), false);
  report.checks.push('Confirmed revision-checked undo renders exact inverse and advances revision, never rolls back');

  await page.selectOption('#box-kind', 'create-box'); await page.getByTestId('box-id').fill('browser-new-box'); await preview('2, 2, 1', '1, 1, 1');
  await page.getByTestId('box-approve').click(); await status('Committed create-box'); await revision(3);
  assert.equal((await info()).snapshot.project.entities.length, original.snapshot.project.entities.length + 1);
  await page.getByTestId('project-undo').click(); await status('Committed undo'); await revision(4);
  assert.deepEqual((await info()).snapshot.project.entities, original.snapshot.project.entities); report.checks.push('Create exact new ID/parameters approved, added to authority/scene and inverse removal undo checked');

  await gate('/project/context'); await page.getByTestId('chat-command').fill('context'); await page.getByRole('button', { name: 'Send inspection', exact: true }).click(); await received();
  await page.getByTestId('project-cancel').click(); await status('Cancelled'); await release(); assert.equal(await page.getByTestId('chat-context').count(), 0);
  await gate('/project/proposals'); await page.getByTestId('box-preview').click(); await received();
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await release(); assert.equal(await page.getByTestId('box-proposal').count(), 0);
  report.checks.push('Actual noncooperative late context cancellation and pending-proposal refresh/rebind suppress stale publication');

  await preview(); await gate('/project/approve'); await page.getByTestId('box-approve').click(); await received();
  await page.getByTestId('project-cancel').click(); await status('Mutation outcome unknown');
  assert.equal(await page.getByTestId('box-preview').isEnabled(), false); assert.equal(await page.getByTestId('project-save').isEnabled(), false);
  await release(); await status('Mutation outcome unknown'); await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await revision(5);
  report.checks.push('Ambiguous real committed approval cancellation blocks further writes/no retries until explicit authority refresh');

  await page.getByTestId('project-save').click(); await status('Saved revision 5'); const saved = await info(); assert.equal(saved.dirty, false);
  process.kill(-backend.pid, 'SIGTERM');
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:3014/health'); await delay(100); } catch { break; } }
  backend = await startBackend('backend-restarted'); await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready();
  const restarted = await info(); assert.deepEqual(restarted.snapshot.project, saved.snapshot.project); assert.notEqual(restarted.snapshot.sessionId, saved.snapshot.sessionId);
  assert.equal(restarted.nextUndoTransactionId, null); assert.equal(restarted.dirty, false);
  await preview('3, 0, 1'); await page.getByTestId('box-approve').click(); await status('Committed update-box'); await revision(6);
  await page.getByTestId('project-load').click(); await status('Loaded saved geometry'); await revision(5);
  const loaded = await info(); assert.deepEqual(loaded.snapshot.project, saved.snapshot.project); assert.notEqual(loaded.snapshot.sessionId, restarted.snapshot.sessionId);
  assert.equal(loaded.nextUndoTransactionId, null); assert.equal(loaded.dirty, false); await screenshot('saved-restarted-loaded.png');
  report.checks.push('Explicit atomic Save; owned backend restart preserves exact IDs/geometry/revision and fresh session; confirmed Load discards unsaved edit/rotates session/clears history');
  assert.deepEqual(report.messages.filter(m => ['error', 'pageerror'].includes(m.type)), []);
  await preview('4, 0, 1'); phase = 'intentional-render-failure';
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.__restoreCanvasContext = () => HTMLCanvasElement.prototype.getContext = original;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return String(kind).startsWith('webgl') ? null : original.call(this, kind, ...args); };
  });
  await page.getByTestId('box-approve').click(); await status('Committed update-box');
  await page.getByRole('alert').filter({ hasText: 'Render unavailable' }).waitFor();
  await openTools();
  const failedRenderAuthority = await info(); assert.equal(failedRenderAuthority.snapshot.project.revision, 6);
  assert.deepEqual(failedRenderAuthority.snapshot.project.entities.find(e => e.id === 'proposal-box').center, [4, 0, 1]);
  assert.ok((await page.getByTestId('chat-project-binding').innerText()).includes('6 / m'));
  await screenshot('committed-render-unavailable.png');
  await page.evaluate(() => window.__restoreCanvasContext());
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await revision(6);
  assert.deepEqual(report.messages.filter(m => m.type === 'pageerror'), []);
  report.checks.push('Intentional WebGL creation failure reports render unavailable separately while authoritative commit/parameters/revision remain correct; explicit refresh recovers rendering');

  phase = 'runtime-context-loss';
  await preview('1, 0, 1'); await page.getByTestId('box-approve').click(); await status('Committed update-box'); await revision(7);
  const beforeContextLoss = await info(), statusBeforeContextLoss = await page.getByTestId('project-status').innerText();
  await save('authority-before-context-loss.json', beforeContextLoss);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="viewer"] canvas');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context unavailable');
    window.__runtimeWebgl = { canvas, extension }; extension.loseContext();
  });
  await page.getByRole('alert').filter({ hasText: 'WebGL context lost' }).waitFor();
  assert.equal(await page.getByTestId('viewer').getAttribute('data-ready'), 'false');
  assert.match(await page.getByTestId('viewer').getAttribute('data-render-error'), /WebGL context lost/);
  const duringContextLoss = await info(); assert.deepEqual(duringContextLoss, beforeContextLoss);
  assert.equal(await page.getByTestId('project-status').innerText(), statusBeforeContextLoss);
  await save('authority-during-context-loss.json', duringContextLoss); await screenshot('runtime-context-lost.png');
  // Restore the actual context, without an authority refresh/remount.
  await delay(300); await page.evaluate(() => window.__runtimeWebgl.extension.restoreContext());
  await ready(); await revision(7);
  await page.waitForFunction(() => !document.querySelector('[data-testid="viewer"]')?.hasAttribute('data-render-error'));
  assert.equal(await page.getByRole('alert').filter({ hasText: 'Render unavailable' }).count(), 0);
  assert.ok(Number(await page.getByTestId('viewer').getAttribute('data-draw-calls')) > 0);
  assert.ok(Number(await page.getByTestId('viewer').getAttribute('data-points')) > 0);
  assert.ok(Number(await page.getByTestId('viewer').getAttribute('data-triangles')) > 0);
  assert.equal(await page.evaluate(() => window.__runtimeWebgl.canvas === document.querySelector('[data-testid="viewer"] canvas')), true);
  const afterContextRestoration = await info(); assert.deepEqual(afterContextRestoration, beforeContextLoss);
  assert.equal(await page.getByTestId('project-status').innerText(), statusBeforeContextLoss);
  await save('authority-after-context-restoration.json', afterContextRestoration); await screenshot('runtime-context-restored.png');
  report.checks.push('Actual Chrome WEBGL_lose_context runtime loss marks render unavailable/ready=false; same-canvas restoration clears alert and resumes visible draw calls; full authority/session/undo/persistence and commit status unchanged');

  phase = 'disposed-viewer-listeners';
  await page.getByRole('button', { name: 'Reload shared project', exact: true }).click(); await ready(); await revision(7);
  const retired = await page.evaluate(() => {
    const canvas = window.__runtimeWebgl.canvas;
    return { connected: canvas.isConnected,
      unhandledLoss: canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
      unhandledRestoration: canvas.dispatchEvent(new Event('webglcontextrestored')) };
  });
  assert.deepEqual(retired, { connected: false, unhandledLoss: true, unhandledRestoration: true });
  await delay(250); assert.equal(await page.getByRole('alert').filter({ hasText: 'Render unavailable' }).count(), 0);
  assert.equal(await page.getByTestId('viewer').getAttribute('data-ready'), 'true');
  assert.deepEqual(await info(), beforeContextLoss);
  assert.deepEqual(report.messages.filter(m => m.type === 'pageerror'), []);
  assert.deepEqual(report.messages.filter(m => m.phase !== 'intentional-render-failure' && m.type === 'error'), []);
  report.checks.push('Disposed old canvas removes context listeners: loss/restoration events are unhandled and cannot alter the remounted viewer or authority');
  report.status = 'passed'; console.log(`Interactive edit browser passed. Evidence: ${directory}`);
} catch (error) { report.error = String(error); console.error(`Interactive edit browser FAILED/UNAVAILABLE: ${error}\nEvidence: ${directory}`); process.exitCode = 1; }
finally {
  if (page) await page.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  for (const { child, name } of children) { if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } await writeFile(join(directory, name + '.log'), child.output?.() ?? ''); }
  await rm(dirname(projectPath), { recursive: true, force: true });
  await save('report.json', report);
}
