// Task017 isolated existing-Chrome acceptance. Owns only :3071/:4271, temporary persistence and one new tab.
// Never launches Chrome or loads operator credentials. Only same-owned-base GET /auth/status
// without query/body is permitted; its real reply must be 200 with disabled, signed-out account state.
// All auth writes/start/callback/other auth routes and model/CAD endpoints remain forbidden.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(process.argv[3] ?? '/tmp/spatial-task017/browser');
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:4271';
const report = { status: 'failed', ownership: 'Only owned3071/4271 process groups, one new Chrome tab, temp isolated persistence. Operator3001/5173/auth untouched.', checks: [], failures: [], findings: [], messages: [], requests: [], accountResponses: [], screenshots: [], provenance: [] };
const pendingAccountResponses = new Set();
const children = []; let browser, page, cdp, phase = 'setup'; const observations = [], cropBatches = [];
const save = (name, value) => writeFile(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
async function start(name, args, marker) {
  const child = spawn('pnpm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  child.on('exit', () => exited = true); child.on('error', e => { output += String(e); exited = true; }); children.push({ name, child, output: () => output });
  for (let i = 0; i < 150 && !output.includes(marker); i++) { assert.ok(!exited, `${name}: ${output}`); await delay(100); }
  assert.ok(output.includes(marker), `${name} startup: ${output}`);
}
const t = id => page.getByTestId(id);
async function ready() { await page.waitForFunction(() => document.querySelector('[data-testid="display-status"]')?.textContent === 'Ready' && document.querySelector('[data-testid="toronto-viewer"]')?.dataset.ready === 'true'); }
async function open(id) { const d = t(id); if (!(await d.getAttribute('open'))) { if (!await d.evaluate(el => el.open)) await d.locator(':scope > summary').click(); } }
async function snapshot(name) { const tree = await cdp.send('Accessibility.getFullAXTree'); await save(name + '.ax.json', tree); const text = await page.locator('body').ariaSnapshot(); await save(name + '.ax.txt', text); return text; }
async function screenshot(name, fullPage = true) { await snapshot(name.replace('.png', '')); await page.screenshot({ path: join(directory, name), fullPage }); report.screenshots.push(name); }
async function releaseInput() { await page.mouse.up(); for (const key of ['Shift','Control','Meta']) await page.keyboard.up(key); }
async function check(name, fn) { phase = name; console.log('CHECK ' + name); try { await fn(); report.checks.push(name); } catch (e) { await releaseInput().catch(() => {}); report.failures.push({ name, error: String(e), stack: e.stack }); console.error('FAIL ' + name + ': ' + e); await screenshot('failure-' + report.failures.length + '.png').catch(() => {}); } finally { await releaseInput().catch(() => {}); } await save('report.json', report); }
function sameCamera(a, b) { assert.ok(JSON.parse(a).every((n,i)=>Math.abs(n-JSON.parse(b)[i])<1e-7), `camera moved: ${a} → ${b}`); }
async function info() { const r = await fetch(base + '/project/session'); assert.ok(r.ok); return (await r.json()).result; }
async function point(name) { return JSON.parse(await t('draft-point-json-' + name).textContent()); }
async function marker(name, visible) { await page.waitForFunction(({ name, visible }) => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-draft-marker-' + name.toLowerCase()) === String(visible), { name, visible }); }
async function pick(name, layer = 'overview', key = 'Control') {
  await t('toronto-pin-name').selectOption(name); await t('toronto-viewer').scrollIntoViewIfNeeded(); await delay(100);
  const v = t('toronto-viewer'), rect = await v.boundingBox(); const p = JSON.parse(await v.getAttribute(layer === 'detail' ? 'data-detail-pick-point' : 'data-pick-point'));
  assert.ok(rect && p[0] >= 0 && p[0] <= rect.width && p[1] >= 0 && p[1] <= rect.height, 'rendered target in viewport');
  await page.keyboard.down(key); await page.mouse.click(rect.x + p[0], rect.y + p[1]); await page.keyboard.up(key);
  await t('draft-point-' + name).waitFor(); await delay(200); await marker(name, true); return point(name);
}
function validatePoint(p, sources, label) {
  assert.equal(p.datasetId, 'toronto3d'); assert.match(p.artifactRevision, /^[a-f0-9]{64}$/); assert.equal(p.frameId, 'toronto3d-local-v1'); assert.equal(p.units, 'm'); assert.equal(p.upAxis, 'Z'); assert.equal(p.handedness, 'right'); assert.deepEqual(p.localOrigin, [627285, 4841948, 0]);
  let original;
  for (const s of sources) for (let i = 0; i < s.sourceIds.length; i += 2) if (s.sourceIds[i] === p.key.sourceFileId && s.sourceIds[i + 1] === p.key.sourceRow) original = s.positions.slice(i / 2 * 3, i / 2 * 3 + 3);
  assert.ok(original, label + ' key belongs to actual source payload'); assert.deepEqual(p.position, original); assert.ok(p.position.some(n => Math.fround(n) !== n), 'original binary64 differs from GPU float32'); report.provenance.push({ label, point: p, original });
}
async function center(value, size = 5) { await open('toronto-technical'); for (const [i, axis] of ['x','y','z'].entries()) { await t('box-center-' + axis).fill(String(value[i])); await t('box-size-' + axis).fill(String(size)); } }
async function clearPins() { if (await t('clear-toronto-pins').isEnabled()) await t('clear-toronto-pins').click(); await marker('A', false); await marker('B', false); }
async function command(value) { await open('inspection-tools'); await t('chat-command').fill(value); await page.getByRole('button', { name: 'Send inspection', exact: true }).click(); }
async function projectStatus(regex) { await page.waitForFunction(regex => new RegExp(regex).test(document.querySelector('[data-testid="project-status"]')?.textContent ?? ''), regex); }
async function preview() { await open('inspection-tools'); await open('approved-box-tools'); await t('box-center').fill('1, 0, 1'); await t('box-dimensions').fill('2, 1, 2'); await t('box-preview').click(); await t('box-proposal').waitFor(); }
async function noOverflow(label) { const layout = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).slice(0, 12).map(el => ({ tag: el.tagName, testid: el.getAttribute('data-testid'), right: el.getBoundingClientRect().right })) })); await save(label + '-layout.json', layout); assert.ok(layout.scroll <= layout.viewport + 1 && layout.body <= layout.viewport + 1, JSON.stringify(layout)); }
try {
  // Factory explicitly isolates persistence; imported server factory defaults to disabled auth.
  await start('server', ['exec', 'tsx', '-e', "import { createIsolatedDemoServer } from './scripts/isolated-demo-server.ts'; const server=createIsolatedDemoServer(); process.once('SIGTERM',()=>server.close()); server.listen(3071,'127.0.0.1',()=>console.log('Owned task017 server ready'));"], 'Owned task017 server ready');
  await start('preview', ['--dir', 'apps/web', 'exec', 'node', '--input-type=module', '-e', "import { preview } from 'vite'; const server=await preview({preview:{host:'127.0.0.1',port:4271,strictPort:true,proxy:Object.fromEntries(['/datasets/','/project','/chat/','^/auth/status$','^/auth/logout$'].map(path=>[path,{target:'http://127.0.0.1:3071',changeOrigin:path.startsWith('^/auth/')}]))}}); server.printUrls();"], 'http://127.0.0.1:4271');
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 }); const context = browser.contexts()[0]; assert.ok(context);
  page = await context.newPage(); await page.bringToFront(); await page.setViewportSize({ width: 1440, height: 1000 }); page.setDefaultTimeout(12000);
  cdp = await context.newCDPSession(page); await cdp.send('Accessibility.enable');
  page.on('console', m => report.messages.push({ phase, type: m.type(), text: m.text() })); page.on('pageerror', e => report.messages.push({ phase, type: 'pageerror', text: String(e) })); page.on('dialog', d => d.accept());
  page.on('request', r => report.requests.push({ phase, method: r.method(), url: r.url(), body: r.postData() }));
  page.on('response', r => {
    const url = new URL(r.url()); if (url.pathname !== '/auth/status') return;
    const capture = (async () => {
      const entry = { phase, url: r.url(), path: url.pathname, method: r.request().method(), requestBody: r.request().postData(), status: r.status() };
      try { report.accountResponses.push({ ...entry, body: await r.json() }); }
      catch { report.accountResponses.push({ ...entry, bodyError: 'Invalid account response body' }); }
    })();
    pendingAccountResponses.add(capture); capture.finally(() => pendingAccountResponses.delete(capture));
  });
  page.on('response', async r => { const url = new URL(r.url()); try { if (url.pathname.endsWith('/observation')) observations.push(await r.json()); if (url.pathname.endsWith('/crop') && !url.searchParams.has('planes')) { const lines = (await r.text()).trim().split('\n').map(JSON.parse); cropBatches.push(...lines.filter(e => e.type === 'batch')); await save('real-crop-stream-summary.json', lines.map(e => ({ ...e, positions: e.positions?.slice(0, 6), colors: e.colors?.slice(0, 6), sourceIds: e.sourceIds?.slice(0, 4) }))); } } catch {} });
  await page.goto(base + '/?smoke=1'); await ready(); await snapshot('initial-desktop');
  console.log('INITIAL AX READY: ' + join(directory, 'initial-desktop.ax.txt') + ' — inspect then create allow-screenshots');
  for (let i = 0; i < 1200; i++) { try { await access(join(directory, 'allow-screenshots')); break; } catch {} if (i === 1199) throw new Error('AX acknowledgement timed out'); await delay(100); }
  await check('Toronto-first desktop layout and labeled collapsed technical controls', async () => {
    assert.equal(await page.getByRole('button', { name: 'Toronto3D preview', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await t('toronto-viewer').getAttribute('data-points'), '50000'); assert.equal(await t('display-budget').isVisible(), false); assert.equal(await t('chat-command').isVisible(), false);
    const scene = await t('toronto-viewer').boundingBox(), chat = await t('chat').boundingBox(); assert.ok(scene.x + scene.width <= chat.x && scene.y > chat.y && scene.y < chat.y + chat.height); await noOverflow('desktop'); await screenshot('desktop-initial.png');
  });
  await check('Actual overview Control/Meta picks attach original binary64 A/B with markers', async () => {
    const a = await pick('A'), b = await pick('B', 'overview', 'Meta'); validatePoint(a, observations, 'overview A'); validatePoint(b, observations, 'overview B'); assert.equal(await t('draft-point-A').count(), 1); assert.equal(await t('draft-point-B').count(), 1); await screenshot('desktop-overview-pins.png');
  });
  await check('Local natural-language Send emits zero requests, retains text/context and authority', async () => {
    const before = await info(), a = await point('A'), b = await point('B'); await t('local-draft').fill('Build a channel from point A to point B, keeping Toronto references explicit.'); await delay(500); const n = report.requests.length;
    await t('send-local-draft').click(); await t('local-draft-status').waitFor(); await delay(500); assert.match(await t('local-draft-status').textContent(), /Not connected.*no AI\/model or edit request was sent/); assert.equal(report.requests.length, n); assert.match(await t('local-draft').inputValue(), /Build a channel/); assert.deepEqual(await point('A'), a); assert.deepEqual(await point('B'), b); assert.deepEqual(await info(), before);
    await save('local-send-evidence.json', { requestsBefore: n, requestsAfter: report.requests.length, status: await t('local-draft-status').textContent(), a, b, unchangedAuthority: true });
  });
  await check('Remove/clear plus plain orbit, Ctrl-drag, pointercancel and real LOD-race cannot attach', async () => {
    await t('local-draft').fill((await t('local-draft').inputValue()) + ' Keep the draft local.'); await t('local-draft-status').waitFor({state:'hidden'}); await t('send-local-draft').click(); await t('local-draft-status').waitFor();
    await t('remove-draft-point-A').click(); await marker('A', false); await marker('B', true); await t('local-draft-status').waitFor({state:'hidden'}); await t('send-local-draft').click(); await t('local-draft-status').waitFor(); assert.match(await t('local-draft-status').textContent(), /1 Toronto3D attachment/);
    await clearPins(); await t('local-draft-status').waitFor({state:'hidden'}); await save('draft-feedback-invalidation.json',{currentAttachments:await t('draft-attachments').textContent(),feedbackCleared:true,draftPreserved:await t('local-draft').inputValue()}); await t('toronto-viewer').scrollIntoViewIfNeeded(); await delay(500);
    let r = await t('toronto-viewer').boundingBox(); const before = await t('toronto-viewer').getAttribute('data-camera'); await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5); await page.mouse.down(); await page.mouse.move(r.x+r.width*.5+70,r.y+r.height*.5+30,{steps:10}); await page.mouse.up(); await delay(500); assert.notEqual(await t('toronto-viewer').getAttribute('data-camera'), before); assert.equal(await t('draft-point-A').count(),0);
    await page.getByRole('button',{name:'Frame dataset',exact:true}).click(); await delay(500); r=await t('toronto-viewer').boundingBox(); let p=JSON.parse(await t('toronto-viewer').getAttribute('data-pick-point')); const x=r.x+p[0],y=r.y+p[1];
    await page.keyboard.down('Control'); await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+30,y+20,{steps:5}); await page.mouse.move(x,y,{steps:5}); await page.mouse.up(); await page.keyboard.up('Control'); assert.equal(await t('draft-point-A').count(),0); assert.equal(await t('draft-point-B').count(),0);
    await page.keyboard.down('Control'); await page.mouse.move(x,y); await page.mouse.down(); await t('toronto-viewer').locator('canvas').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true}); await page.mouse.up(); await page.keyboard.up('Control'); assert.equal(await t('draft-point-B').count(),0);
    await page.keyboard.down('Control'); await page.mouse.move(x,y); await page.mouse.down(); await t('display-depth').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}); await ready(); await delay(250); await page.mouse.up(); await page.keyboard.up('Control'); assert.equal(await t('draft-point-B').count(),0);
    await open('toronto-technical'); await t('display-depth').selectOption('3'); await ready(); await clearPins();
  });
  await check('Real complete full-resolution detail provenance replaces A and supports B/removal', async () => {
    const prior=await pick('A'); await center([278.715,505.852,139.662]); await t('load-crop').click(); await page.waitForFunction(()=>document.querySelector('[data-testid="crop-status"]')?.textContent==='Ready — full resolution inside box'); await page.waitForFunction(()=>document.querySelector('[data-testid="toronto-viewer"]')?.dataset.cropPoints==='10914');
    // Independently reread the same bounded actual prepared volume for source-record agreement.
    const cropUrl=report.requests.filter(r=>new URL(r.url).pathname.endsWith('/crop')).at(-1).url; const realLines=(await (await fetch(cropUrl)).text()).trim().split('\n').map(JSON.parse); assert.equal(realLines.at(-1).type,'end');await save('actual-small-crop.ndjson',realLines.map(e=>JSON.stringify(e)).join('\n')+'\n');cropBatches.push(...realLines.filter(e=>e.type==='batch'));
    await t('frame-box').click(); await delay(700); const a=await pick('A','detail'),b=await pick('B','detail'); validatePoint(a,cropBatches,'detail A');validatePoint(b,cropBatches,'detail B');assert.notDeepEqual(a.key,prior.key);assert.equal(await t('draft-point-A').count(),1);const rect=await t('toronto-viewer').boundingBox(),target=JSON.parse(await t('toronto-viewer').getAttribute('data-detail-pick-point'));let replacement=b;for(const dx of [8,16,24,-8,-16]){await page.keyboard.down('Control');await page.mouse.click(rect.x+target[0]+dx,rect.y+target[1]);await page.keyboard.up('Control');await delay(120);replacement=await point('B');if(JSON.stringify(replacement.key)!==JSON.stringify(b.key))break;}assert.notDeepEqual(replacement.key,b.key);validatePoint(replacement,cropBatches,'detail B replacement');await screenshot('desktop-detail-pins.png'); await t('remove-draft-point-B').click();await marker('B',false);await marker('A',true);
  });
  await check('Real Shift window freezes orbit and progressive detail cancels/retries/clears', async () => {
    await t('clear-crop').click();
    // Isolate the frozen-window assertion from residual OrbitControls damping of the earlier orbit test.
    await page.getByRole('button',{name:'Synthetic demo',exact:true}).click();await page.getByRole('button',{name:'Toronto3D preview',exact:true}).click();await ready();await open('toronto-technical');await pick('A');await page.getByRole('button',{name:'Frame dataset',exact:true}).click();await t('toronto-viewer').scrollIntoViewIfNeeded();await delay(700); const r=await t('toronto-viewer').boundingBox();await snapshot('shift-before-gesture');await page.evaluate(()=>{window.__shiftEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.querySelector('[data-testid="toronto-viewer"] canvas').addEventListener(type,e=>window.__shiftEvents.push({type:e.type,id:e.pointerId,x:e.clientX,y:e.clientY}),true);});
    await page.keyboard.down('Shift');await page.mouse.move(r.x+r.width*.3,r.y+r.height*.3);await page.mouse.down();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const camera=await t('toronto-viewer').getAttribute('data-camera');await page.mouse.move(r.x+r.width*.7,r.y+r.height*.7,{steps:8});assert.equal(await t('selection-window').isVisible(),true);sameCamera(await t('toronto-viewer').getAttribute('data-camera'),camera);const overlayCapture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'desktop-shift-window.png'),Buffer.from(overlayCapture.data,'base64'));report.screenshots.push('desktop-shift-window.png');await page.mouse.up();await page.keyboard.up('Shift');await save('shift-pointer-events.json',await page.evaluate(()=>window.__shiftEvents));await t('projected-selection').waitFor();await page.waitForFunction(()=>Number(document.querySelector('[data-testid="toronto-viewer"]')?.dataset.cropPoints)>0);await t('quick-cancel-crop').click();assert.match(await t('crop-summary').textContent(),/Cancelled/);await delay(250);const partial=await t('toronto-viewer').getAttribute('data-crop-points');await delay(500);assert.equal(await t('toronto-viewer').getAttribute('data-crop-points'),partial);assert.equal(await t('retry-crop').isEnabled(),true);await save('actual-window-cancellation.json',{partialPoints:Number(partial),status:await t('crop-summary').textContent(),selection:await t('selection-info').textContent()});await screenshot('desktop-window-cancelled.png');const selection=await t('selection-info').textContent();await t('retry-crop').click();await page.waitForFunction(()=>Number(document.querySelector('[data-testid="toronto-viewer"]')?.dataset.cropPoints)>0);assert.equal(await t('selection-info').textContent(),selection);await t('quick-cancel-crop').click();await t('clear-crop').click();await page.waitForFunction(()=>document.querySelector('[data-testid="toronto-viewer"]')?.dataset.cropPoints==='0');sameCamera(await t('toronto-viewer').getAttribute('data-camera'),camera);
  });
  await check('Toronto pins excluded from actual project/context and exact proposal; reload clears', async () => {
    await command('context');await t('chat-context').waitFor();const value=JSON.parse(await t('chat-context').textContent());assert.deepEqual(value.points,[]);assert.equal(value.source,'synthetic-project');assert.equal(value.frameId,'demo-local-v1');assert.ok(!JSON.stringify(value).includes('627285'));await save('synthetic-context-while-toronto-pinned.json',value);
    await preview();const parameters=JSON.parse(await t('proposal-parameters').textContent());assert.equal(parameters.binding.frameId,'demo-local-v1');assert.ok(!JSON.stringify(parameters).includes('toronto'));await save('proposal-while-toronto-pinned.json',parameters);await open('project-controls');await page.getByRole('button',{name:'Reload shared project',exact:true}).click();await projectStatus('Refreshed server authority');await marker('A',false);assert.equal(await t('draft-point-A').count(),0);assert.match(await t('local-draft').inputValue(),/Build a channel/);
  });
  await check('Source switches dispose Toronto canvas and clear references; synthetic entity/A-B context works', async () => {
    await pick('A');await page.getByRole('button',{name:'Closest: label',exact:true}).click();assert.equal(await t('draft-point-A').count(),0);await page.getByRole('button',{name:'Toronto3D preview',exact:true}).click();await ready();assert.equal(await t('draft-point-A').count(),0);await pick('A');await page.getByRole('button',{name:'Synthetic demo',exact:true}).click();await page.waitForSelector('[data-testid="viewer"][data-ready="true"]');assert.equal(await t('toronto-viewer').count(),0);assert.equal(await t('draft-point-A').count(),0);await open('synthetic-scene-tools');await page.getByRole('button',{name:/proposal-box.*Proposed box/}).click();
    for(const [name,index]of[['A',0],['B',7]]){await t('pin-name').selectOption(name);await t('viewer').scrollIntoViewIfNeeded();const v=t('viewer'),r=await v.boundingBox(),targets=JSON.parse(await v.getAttribute('data-point-targets'));await page.keyboard.down('Control');await page.mouse.click(r.x+targets[index].x,r.y+targets[index].y);await page.keyboard.up('Control');await t('point-'+name).waitFor();}
    await command('context');await t('chat-context').waitFor();const value=JSON.parse(await t('chat-context').textContent()),authority=await info();assert.deepEqual(value.entityIds,['proposal-box']);assert.equal(value.points.length,2);for(const p of value.points){const cloud=authority.snapshot.project.entities.find(e=>e.id===p.entityId);assert.deepEqual(p.position,cloud.points[p.pointIndex]);}assert.ok(!JSON.stringify(value).includes('toronto'));await save('actual-synthetic-pinned-context.json',value);await screenshot('desktop-synthetic-context.png');
  });
  await check('Actual deterministic metadata/observation tools remain accessible without a model', async () => {
    await command('metadata');await page.waitForFunction(()=>document.querySelector('[data-testid="chat-result"]')?.dataset.state==='completed',{},{timeout:90000});await t('chat-evidence').waitFor();await save('metadata-result.json',JSON.parse(await t('chat-tool-result').textContent()));
    await command('observe 256 0');await page.waitForFunction(()=>document.querySelector('[data-testid="chat-result"]')?.dataset.state==='completed',{},{timeout:30000});await t('chat-evidence').waitFor();await save('observation-result.json',JSON.parse(await t('chat-tool-result').textContent()));
  });
  await check('Exact preview/approval/Undo/Save/Load preserve authoritative safety through panels', async () => {
    const original=await info();await preview();assert.deepEqual(await info(),original);const p=JSON.parse(await t('proposal-parameters').textContent());assert.deepEqual(p.edit.center,[1,0,1]);assert.match(await t('proposal-digest').textContent(),/^[a-f0-9]{64}$/);await screenshot('desktop-exact-approval.png');await t('box-center').fill('2, 0, 1');assert.equal(await t('box-proposal').count(),0);await preview();await t('box-approve').click();await projectStatus('Committed update-box');let current=await info();assert.equal(current.snapshot.project.revision,original.snapshot.project.revision+1);assert.deepEqual(current.snapshot.project.entities.find(e=>e.id==='proposal-box').center,[1,0,1]);await open('approved-box-tools');assert.equal(await t('project-undo').isEnabled(),true);await t('project-undo').click();await projectStatus('Committed undo');current=await info();assert.deepEqual(current.snapshot.project.entities,original.snapshot.project.entities);assert.equal(current.snapshot.project.revision,original.snapshot.project.revision+2);
    await open('project-controls');await t('project-save').click();await projectStatus('Saved revision');const saved=await info();assert.equal(saved.dirty,false);await preview();await t('box-approve').click();await projectStatus('Committed update-box');await t('project-load').click();await projectStatus('Loaded saved geometry');const loaded=await info();assert.deepEqual(loaded.snapshot.project,saved.snapshot.project);assert.notEqual(loaded.snapshot.sessionId,saved.snapshot.sessionId);assert.equal(loaded.nextUndoTransactionId,null);assert.equal(loaded.dirty,false);await save('save-load-evidence.json',{saved,loaded});
  });
  await check('Deterministic stale-artifact fixture invalidates attachments (no prepared-file edits)', async () => {
    await page.getByRole('button',{name:'Toronto3D preview',exact:true}).click();await ready();await pick('A');const replacementRevision='f'.repeat(64);await page.route('**/datasets/toronto3d/observation?**',async route=>{const r=await route.fetch(),data=await r.json();if(data.purpose==='display')data.dataset.revision=replacementRevision;await route.fulfill({response:r,json:data});});await open('toronto-technical');await page.getByRole('button',{name:'Reload display',exact:true}).click();await ready();await marker('A',false);assert.equal(await t('draft-point-A').count(),0);const fresh=await pick('A');assert.equal(fresh.artifactRevision,replacementRevision);await page.unroute('**/datasets/toronto3d/observation?**');await page.getByRole('button',{name:'Reload display',exact:true}).click();await ready();await marker('A',false);await pick('A');await open('project-controls');await t('project-load').click();await projectStatus('Loaded saved geometry');await marker('A',false);assert.equal(await t('draft-point-A').count(),0);
  });
  await check('Deterministic crop-error fixture exposes honest incomplete/Retry/Clear controls', async () => {
    const source=(await readFile(join(directory,'actual-small-crop.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);const incomplete=source.filter(e=>e.type!=='end').map(e=>JSON.stringify(e)).join('\n')+'\n'+JSON.stringify({type:'error'})+'\n';
    await page.route('**/datasets/toronto3d/crop?**',route=>route.fulfill({status:200,contentType:'application/x-ndjson',body:incomplete}));await center([278.715,505.852,139.662]);await t('load-crop').click();await page.waitForFunction(()=>document.querySelector('[data-testid="crop-status"]')?.textContent?.startsWith('Error — incomplete'));assert.equal(await t('retry-crop').isEnabled(),true);assert.equal(await t('clear-crop').isEnabled(),true);assert.equal(await t('cancel-crop').isDisabled(),true);await screenshot('crop-error-fixture.png');await page.unroute('**/datasets/toronto3d/crop?**');await t('clear-crop').click();
  });
  await check('Mobile375 stacked layout, expandable tools, labels and visible keyboard focus', async () => {
    // Return to clean default panels without losing local draft.
    for(const id of ['toronto-technical','inspection-tools','project-controls'])await t(id).evaluate(el=>el.open=false);await page.setViewportSize({width:375,height:900});await page.evaluate(()=>scrollTo(0,0));await delay(400);await snapshot('mobile-initial');await noOverflow('mobile-default');const scene=await t('toronto-viewer').boundingBox(),chat=await t('chat').boundingBox();assert.ok(chat.y>scene.y+scene.height);await screenshot('mobile-initial.png');await pick('A');await t('draft-point-A').locator('details > summary').click();await noOverflow('mobile-pinned');await screenshot('mobile-pinned.png');
    await t('local-draft').focus();await page.keyboard.press('Tab');const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.getAttribute('data-testid'),outline:getComputedStyle(document.activeElement).outline,visible:document.activeElement.matches(':focus-visible')}));assert.equal(focus.id,'send-local-draft');assert.equal(focus.visible,true);assert.match(focus.outline,/2px/);await save('mobile-focus.json',focus);await screenshot('mobile-keyboard-focus.png');await t('toronto-technical').locator(':scope > summary').focus();await page.keyboard.press('Space');assert.equal(await t('toronto-technical').evaluate(el=>el.open),true);await open('inspection-tools');await open('approved-box-tools');await open('project-controls');await noOverflow('mobile-expanded');assert.equal(await t('project-save').isVisible(),true);assert.equal(await t('box-preview').isVisible(),true);await screenshot('mobile-expanded.png');
  });
  await check('No browser errors; only verified disabled account reads, no auth writes/model/CAD traffic', async () => {
    assert.deepEqual(report.messages.filter(m=>['error','pageerror'].includes(m.type)),[]);
    const accountReads = report.requests.filter(r => { const url = new URL(r.url); return url.origin === base && url.pathname === '/auth/status' && url.search === '' && r.method === 'GET' && r.body === null; });
    assert.ok(accountReads.length >= 1, 'workspace must read the owned disabled account status');
    assert.deepEqual(report.requests.filter(r=>/\/(?:auth|cad|v1|responses|completions)(?:\/|\?|$)/.test(new URL(r.url).pathname) && !accountReads.includes(r)),[]);
    assert.ok(report.requests.every(r=>new URL(r.url).origin===base));
    await Promise.all([...pendingAccountResponses]);
    assert.equal(report.accountResponses.length, accountReads.length, 'each real account read has a recorded response');
    for (const response of report.accountResponses) {
      assert.equal(response.url, base + '/auth/status'); assert.equal(response.path, '/auth/status'); assert.equal(response.method, 'GET'); assert.equal(response.requestBody, null); assert.equal(response.status, 200);
      assert.deepEqual(response.body, { ok: true, result: { mode: 'disabled', authenticated: false, ready: false, planUsageEnabled: false, selectedAccount: null, accounts: [] } });
    }
  });
  report.status=report.failures.length?'failed':'passed';console.log('Task017 browser '+report.status+': '+directory);if(report.failures.length)process.exitCode=1;
} catch(e){report.failures.push({name:phase,error:String(e),stack:e.stack});console.error(e);process.exitCode=1;}
finally{
  await save('report.json',report);if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  for(const {child,name,output}of children){if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}await save(name+'.log',output());}
}
