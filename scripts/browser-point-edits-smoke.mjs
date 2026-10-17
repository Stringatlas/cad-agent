// Task031 only: existing Chrome, built viewer, real isolated authority + tiny prepared dataset.
// No existing listeners, operator auth/config/project or source records are modified.
// Run: node --import tsx scripts/browser-point-edits-smoke.mjs [CDP] [artifact-directory]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'spatial-point-edits-browser-'));
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'spatial-point-edit-fixture-'));
const report = { status: 'failed', directory, checks: [], messages: [], replies: [], screenshots: [], ownership: 'One new existing-Chrome tab; isolated ephemeral-port server and fixture/project. Built files intercepted at allowed origin localhost:5173; existing :3001/:5173 listeners untouched. No operator auth/config/persistence.' };
let server, browser, page;
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
async function screenshot(name) { await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(directory, name), fullPage: true }); report.screenshots.push(name); }
try {
  // No browser launched: attach only to the operator's already-running CDP instance.
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0,0,0], max: [3,3,3] }, scale: [.001,.001,.001], offset: [0,0,0], attributes: [{ name: 'position', type: 'int32', size: 12, min: [0,0,0], max: [3,3,3] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(56);
  for (let i=0;i<2;i++) { payload.writeInt32LE((i+1)*1000,i*28); for(let axis=0;axis<3;axis++) payload.writeUInt16LE(65535,i*28+12+axis*2); payload.writeUInt16LE(1,i*28+18); payload.writeUInt32LE(i,i*28+20); payload.writeFloatLE(i===0?0:6,i*28+24); }
  const hierarchy = Buffer.alloc(22); hierarchy[0]=1; hierarchy.writeUInt32LE(2,2); hierarchy.writeBigUInt64LE(56n,14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285,4841948,0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1,2,3,4].map(file=>({ source_file_id:file,file:`L00${file}.ply`,points:file===1?2:0 })) };
  await mkdir(join(root,'octree')); await writeFile(join(root,'manifest.json'),JSON.stringify(manifest)); await writeFile(join(root,'octree/metadata.json'),JSON.stringify(metadata)); await writeFile(join(root,'octree/hierarchy.bin'),hierarchy); await writeFile(join(root,'octree/octree.bin'),payload);
  let modelRound = 0; const modelBodies = [];
  server = createDemoServer({ datasetRoot: root, projectPath: join(root,'isolated-project.json'), provider: { mode: 'api-key', apiKey: 'synthetic-test-only' }, modelTransport: async (url, init) => {
    if(String(url).endsWith('/models')) return Response.json({ data: [{id:'fixture-model'}] });
    modelBodies.push(JSON.parse(String(init?.body)));
    const output = modelRound++ === 0 ? [{ type:'function_call', name:'nearest_label', namespace:'scene', call_id:'fixture_nearest', arguments:JSON.stringify({pointName:'Point 1',label:6}) }] : [{type:'message',role:'assistant',content:[{type:'output_text',text:'Verified original-source nearest Pole found.'}]}];
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  } }); server.listen(0,'127.0.0.1'); await once(server,'listening'); const backend = `http://127.0.0.1:${server.address().port}`;
  page = await browser.contexts()[0].newPage(); await page.setViewportSize({width:1600,height:1100});
  await page.addInitScript(() => { window.__pointUploads=[]; for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]) { const original=prototype.bufferSubData; prototype.bufferSubData=function(...args) { if(args[2] instanceof Float32Array && args[2].length===6) window.__pointUploads.push(Array.from(args[2])); return original.apply(this,args); }; } });
  page.on('pageerror',e=>report.messages.push({type:'pageerror',text:String(e)}));
  page.on('console',m=>{if(m.type()==='error')report.messages.push({type:'error',text:m.text()});});
  await page.route('http://127.0.0.1:5173/**',async route=>{ const request=route.request(), url=new URL(request.url());
    if(url.pathname==='/' || url.pathname.startsWith('/assets/')) { const file=join(process.cwd(),'apps/web/dist',url.pathname==='/'?'index.html':url.pathname); const contentType=url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'; await route.fulfill({status:200,body:await readFile(file),contentType}); return; }
    const response=await route.fetch({url:backend+url.pathname+url.search});
    if(url.pathname.includes('/overrides')) { try{report.replies.push({path:url.pathname,status:response.status(),body:await response.json()});}catch{} }
    await route.fulfill({response});
  });
  const base='http://127.0.0.1:5173'; await page.goto(base+'/?smoke=1');
  await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  // Open real disclosures, do not bypass controls.
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  await page.getByTestId('toronto-technical').getByText('Manual point tools', { exact: true }).click();
  await page.getByTestId('point-edits').waitFor({ state: 'hidden' });
  await page.waitForFunction(()=>document.querySelector('[data-testid="toronto-viewer"]')?.hasAttribute('data-pick-point'));
  const viewer=page.getByTestId('toronto-viewer'); await viewer.scrollIntoViewIfNeeded(); const rect=await viewer.boundingBox(), pick=JSON.parse(await viewer.getAttribute('data-pick-point'));
  await page.keyboard.down('Control'); await page.mouse.click(rect.x+pick[0],rect.y+pick[1]); await page.keyboard.up('Control');
  await page.getByTestId('point-edit-select-Point 1').waitFor();
  await page.getByTestId('point-query').click(); await page.getByTestId('point-query-select').waitFor();
  await page.getByTestId('point-query-select').click(); await page.getByTestId('point-edit-select-Point 2').waitFor();
  report.checks.push('Native Ctrl-pick P1 → real indexed original-source Pole query → verified winner explicitly selected as P2');
  const info=async()=>{const r=await fetch(backend+'/datasets/toronto3d/overrides');return(await r.json()).result;};
  const original=await info(); assert.equal(original.revision,0); assert.deepEqual(original.entries,[]);
  await page.getByTestId('point-edit-refresh').click(); await page.waitForFunction(()=>/Authoritative volatile point state refreshed/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  await page.getByTestId('point-edit-select-Point 2').check(); await page.getByTestId('point-edit-preview').click(); await page.getByTestId('point-edit-review').waitFor();
  assert.deepEqual((await info()).entries,[]); await screenshot('01-uncommitted-preview.png');
  const retained=report.replies.find(r=>r.path.endsWith('/propose')).body.result; assert.deepEqual(retained.moves[0].before,[2,0,0]); assert.deepEqual(retained.moves[0].after,[2,0,1]);
  await page.evaluate(()=>window.__pointUploads=[]); await page.getByTestId('point-edit-approve').click(); await page.waitForFunction(()=>/Approved.*revision 1/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  const moved=await info(); assert.equal(moved.revision,1); assert.deepEqual(moved.entries[0].position,[2,0,1]);
  await page.waitForFunction(()=>window.__pointUploads.some(p=>p.join(',')==='1,0,0,2,0,1')); await save('loaded-record-gpu-upload.json',await page.evaluate(()=>window.__pointUploads));
  await screenshot('02-approved-loaded-record.png');
  report.checks.push('Preview is uncommitted; exact approval advances revision; actual loaded 2-point position GPU buffer changed to [1,0,0,2,0,1] (not merely a pin/fallback)');
  await page.getByTestId('point-edit-preview').click(); await page.getByTestId('point-edit-review').waitFor();
  const p2=report.replies.filter(r=>r.path.endsWith('/propose')).at(-1).body.result; assert.deepEqual(p2.moves[0].before,[2,0,1]); assert.deepEqual(p2.moves[0].after,[2,0,2]);
  await page.getByTestId('point-edit-approve').click(); await page.waitForFunction(()=>/Approved.*revision 2/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  assert.deepEqual((await info()).entries[0].position,[2,0,2]);
  const stale=await fetch(backend+'/datasets/toronto3d/overrides/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:original.sessionId,revision:0,proposalId:retained.proposalId})}); assert.equal(stale.status,409); assert.equal((await stale.json()).error.code,'stale-revision');
  await page.getByTestId('point-query').click(); await page.getByTestId('point-query-select').waitFor(); assert.match(await page.getByTestId('point-query-status').innerText(),/original source position/);
  report.checks.push('Repeated translation uses current effective position; replayed original proposal rejected stale-revision; query remains explicit original-source after edits');
  await page.getByTestId('point-edit-undo').click(); await page.waitForFunction(()=>/Undone.*revision 3/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??'')); assert.deepEqual((await info()).entries[0].position,[2,0,1]);
  await page.evaluate(()=>window.__pointUploads=[]); await page.getByTestId('point-edit-undo').click(); await page.waitForFunction(()=>/Undone.*revision 4/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??'')); assert.deepEqual((await info()).entries,[]);
  await page.waitForFunction(()=>window.__pointUploads.some(p=>p.join(',')==='1,0,0,2,0,0')); assert.deepEqual(await readFile(join(root,'octree/octree.bin')),payload);
  await screenshot('03-undo-restores-loaded-record.png'); report.checks.push('Both latest-first Undo operations succeed, GPU buffer returns to exact original loaded geometry; original prepared payload byte-for-byte unchanged');
  // Synthetic provider transport only; actual product HTTP/SSE/model tool binder/UI, no live credentials or external model requests.
  await page.getByTestId('local-draft').fill('Find nearest Pole to Point 1'); await page.getByTestId('send-local-draft').click();
  await page.getByTestId('model-select-nearest').waitFor(); await page.getByTestId('model-select-nearest').click(); await page.getByTestId('point-edit-select-Point 3').waitFor();
  assert.deepEqual((await info()).entries,[]); assert.equal((await info()).revision,4);
  assert.ok(JSON.stringify(modelBodies[0].tools).includes('nearest_label')); const replay=modelBodies[1].input.find(item=>item.type==='function_call_output'); const evidence=JSON.parse(replay.output); assert.equal(evidence.outcome.status,'verified-found'); assert.deepEqual(evidence.outcome.nearest.position,[2,0,0]); await save('model-tool-evidence.json',evidence);
  await screenshot('04-model-verified-result-selection.png'); report.checks.push('Synthetic provider round → real server nearest_label tool → full verified lineage replay → explicit Select verified result adds Point 3 without any mutation (no live-provider inference claim)');
  // Simulate another local client committing the retained proposal while this tab still reviews revision 4.
  await page.getByTestId('point-edit-preview').click(); await page.getByTestId('point-edit-review').waitFor();
  const staleProposal=report.replies.filter(r=>r.path.endsWith('/propose')).at(-1).body.result;
  const external=await fetch(backend+'/datasets/toronto3d/overrides/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:staleProposal.sessionId,revision:staleProposal.revision,proposalId:staleProposal.proposalId})}); assert.equal(external.status,200);
  await page.getByTestId('point-edit-approve').click(); await page.waitForFunction(()=>/stale-revision.*Refresh required/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  assert.equal(await page.getByTestId('point-edit-preview').isDisabled(),true); assert.equal((await info()).revision,5);
  await page.getByTestId('point-edit-refresh').click(); await page.waitForFunction(()=>/Authoritative volatile point state refreshed/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  await page.getByTestId('point-edit-undo').click(); await page.waitForFunction(()=>/Undone.*revision 6/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??'')); assert.deepEqual((await info()).entries,[]);
  await page.getByRole('button',{name:'Remove Point 1',exact:true}).click(); assert.equal(await page.getByTestId('model-select-nearest').count(),0);
  report.checks.push('Real stale UI approval fails closed without retry; explicit Refresh recovers current undo, Undo restores geometry; removing bound query reference hides retained model winner selection');
  assert.deepEqual(report.messages,[{type:'error',text:'Failed to load resource: the server responded with a status of 409 (Conflict)'}]); // Expected intentional stale-approval response only.
  report.status='passed';
} catch(error) { report.error=String(error?.stack??error); if(page) { try{await screenshot('failure.png');}catch{} } process.exitCode=1; }
finally { await save('report.json',report); await page?.close(); await browser?.close(); if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} await rm(root,{recursive:true,force:true}); console.log(JSON.stringify({status:report.status,directory,error:report.error,checks:report.checks},null,2)); }
