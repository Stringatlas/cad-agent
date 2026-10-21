// Task032: attach to existing Chrome only; isolate backend, project, fixture and owned tab.
// node --import tsx scripts/browser-scene-workspace-smoke.mjs [CDP] [artifacts]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
const directory = resolve(process.argv[3] ?? '/tmp/task032-browser');
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task032-isolated-'));
const report = { status: 'failed', checks: [], messages: [], replies: [], screenshots: [], layouts: {}, ownership: 'Existing Chrome, one owned tab, ephemeral backend, temporary fixture/project, intercepted built bundle. No existing listeners or operator configuration changed.' };
let browser, page, server;
const save = (name, data) => writeFile(join(directory, name), JSON.stringify(data, null, 2) + '\n');
async function shot(name) { await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(directory, name + '.png') }); report.screenshots.push(name + '.png'); }
async function layout(name, viewerId) {
  const state = await page.evaluate(id => {
    const bounds = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
    const v = document.querySelector(`[data-testid="${id}"]`), canvas = v.querySelector('canvas');
    return { width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight,workspace:bounds(document.querySelector('[data-testid="shared-workspace"]')),viewer:bounds(v),canvas:bounds(canvas) };
  }, viewerId);
  report.layouts[name] = state;
  assert.ok(state.scrollWidth <= state.width && state.bodyWidth <= state.width, `${name}: horizontal document overflow`);
  assert.ok(state.scrollHeight <= state.height && state.bodyHeight <= state.height, `${name}: vertical document overflow`);
  assert.ok(Math.abs(state.viewer.height - state.workspace.height) <= 2, `${name}: viewport must fill workspace height`);
  assert.ok(Math.abs(state.canvas.height - state.viewer.height) <= 2, `${name}: canvas must fill viewport`);
  report.checks.push(`${name}: full-height viewport/canvas, no document overflow`);
}
async function toggleDetails(locator, open) { if (await locator.evaluate(n => n.open) !== open) await locator.locator(':scope > summary').click(); }
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const metadata = { version:'2.0',encoding:'UNCOMPRESSED',points:2,hierarchy:{firstChunkSize:22},boundingBox:{min:[0,0,0],max:[3,3,3]},scale:[.001,.001,.001],offset:[0,0,0],attributes:[{name:'position',type:'int32',size:12,min:[0,0,0],max:[3,3,3]},{name:'rgb',type:'uint16',size:6},{name:'point source id',type:'uint16',size:2},{name:'source_row',type:'uint32',size:4},{name:'scalar_Label',type:'float',size:4}] };
  const payload = Buffer.alloc(56);
  for(let i=0;i<2;i++){payload.writeInt32LE((i+1)*1000,i*28);for(let a=0;a<3;a++)payload.writeUInt16LE(65535,i*28+12+a*2);payload.writeUInt16LE(1,i*28+18);payload.writeUInt32LE(i,i*28+20);payload.writeFloatLE(i===0?0:6,i*28+24);}
  const hierarchy=Buffer.alloc(22);hierarchy[0]=1;hierarchy.writeUInt32LE(2,2);hierarchy.writeBigUInt64LE(56n,14);
  const manifest={units:'m',frame:'right-handed Z-up',local_origin_world:[627285,4841948,0],potree_scale_m:metadata.scale,semantic_attribute:'scalar_Label',semantic_classes:TORONTO_SEMANTIC_LABELS,sources:[1,2,3,4].map(file=>({source_file_id:file,file:`L00${file}.ply`,points:file===1?2:0}))};
  await mkdir(join(root,'octree'));await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));await writeFile(join(root,'octree/metadata.json'),JSON.stringify(metadata));await writeFile(join(root,'octree/hierarchy.bin'),hierarchy);await writeFile(join(root,'octree/octree.bin'),payload);
  const modelBodies=[];let round=0;
  server=createDemoServer({datasetRoot:root,projectPath:join(root,'project.json'),provider:{mode:'api-key',apiKey:'synthetic-test-only'},modelTransport:async(url,init)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture-model'}]});
    modelBodies.push(JSON.parse(String(init?.body)));
    const output=round++===0?[{type:'function_call',name:'nearest_label',namespace:'scene',call_id:'task032_nearest',arguments:JSON.stringify({pointName:'Point 1',label:6})}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Verified original-source nearest Pole found.'}]}];
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  }});server.listen(0,'127.0.0.1');await once(server,'listening');const backend=`http://127.0.0.1:${server.address().port}`;
  page=await browser.contexts()[0].newPage();page.setDefaultTimeout(12000);await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{window.__pointUploads=[];for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){const original=prototype.bufferSubData;prototype.bufferSubData=function(...args){if(args[2] instanceof Float32Array&&args[2].length===6)window.__pointUploads.push(Array.from(args[2]));return original.apply(this,args);};}});
  page.on('pageerror',e=>report.messages.push({type:'pageerror',text:String(e)}));page.on('console',m=>{if(m.type()==='error')report.messages.push({type:'error',text:m.text()});});
  await page.route('http://127.0.0.1:5173/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/'||url.pathname.startsWith('/assets/')){await route.fulfill({status:200,body:await readFile(join(process.cwd(),'apps/web/dist',url.pathname==='/'?'index.html':url.pathname)),contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});return;}const response=await route.fetch({url:backend+url.pathname+url.search});if(url.pathname.includes('/overrides')){try{report.replies.push({path:url.pathname,status:response.status(),body:await response.json()});}catch{}}await route.fulfill({response});});
  const base='http://127.0.0.1:5173/?smoke=1';await page.goto(base);await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  await layout('desktop-toronto','toronto-viewer');await shot('01-desktop-toronto');
  await page.getByRole('button',{name:'Find nearest',exact:true}).click();await page.getByTestId('pole-viewer').locator('canvas').waitFor();await page.waitForTimeout(250);await layout('desktop-closest','pole-viewer');await shot('03-desktop-closest');
  await page.getByRole('button',{name:'Toronto3D',exact:true}).click();await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"][data-pick-point]');
  const viewer=page.getByTestId('toronto-viewer'),rect=await viewer.boundingBox(),pick=JSON.parse(await viewer.getAttribute('data-pick-point'));
  await page.keyboard.down('Control');await page.mouse.click(rect.x+pick[0],rect.y+pick[1]);await page.keyboard.up('Control');
  await toggleDetails(page.getByTestId('draft-attachments'),true);await page.getByTestId('draft-point-Point 1').waitFor();await shot('04-scene-reference');await toggleDetails(page.getByTestId('draft-attachments'),false);
  const tools=page.getByTestId('chat').locator('details.secondary');await toggleDetails(tools,true);
  await page.getByTestId('point-query').click();await page.getByTestId('point-query-select').click();await page.getByTestId('point-edit-select-Point 2').waitFor();
  report.checks.push('Desktop native Ctrl-pick → references disclosure → real nearest-label indexed query → explicit Point 2 selection');
  const info=async()=>(await(await fetch(backend+'/datasets/toronto3d/overrides')).json()).result;
  assert.deepEqual((await info()).entries,[]);await page.getByTestId('point-edit-refresh').click();await page.waitForFunction(()=>/Authoritative volatile point state refreshed/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  await page.getByTestId('point-edit-select-Point 2').check();await page.getByTestId('point-edit-preview').click();await page.getByTestId('point-edit-review').waitFor();assert.deepEqual((await info()).entries,[]);
  const proposal=report.replies.find(r=>r.path.endsWith('/propose')).body.result;assert.deepEqual(proposal.moves[0].before,[2,0,0]);assert.deepEqual(proposal.moves[0].after,[2,0,1]);await shot('05-exact-preview');
  await page.evaluate(()=>window.__pointUploads=[]);await page.getByTestId('point-edit-approve').click();await page.waitForFunction(()=>/Approved.*revision 1/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));assert.deepEqual((await info()).entries[0].position,[2,0,1]);await page.waitForFunction(()=>window.__pointUploads.some(p=>p.join(',')==='1,0,0,2,0,1'));await save('approved-gpu-upload.json',await page.evaluate(()=>window.__pointUploads));await shot('06-approved');
  await page.evaluate(()=>window.__pointUploads=[]);await page.getByTestId('point-edit-undo').click();await page.waitForFunction(()=>/Undone.*revision 2/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));assert.deepEqual((await info()).entries,[]);await page.waitForFunction(()=>window.__pointUploads.some(p=>p.join(',')==='1,0,0,2,0,0'));assert.deepEqual(await readFile(join(root,'octree/octree.bin')),payload);await shot('07-undone');
  report.checks.push('Uncommitted exact preview → deliberate approval revision 1 → actual loaded-point GPU upload → Undo revision 2 restores exact GPU/source bytes');await toggleDetails(tools,false);
  await page.getByTestId('local-draft').fill('Find nearest Pole to Point 1');await page.getByTestId('send-local-draft').click();await page.getByTestId('model-select-nearest').waitFor();
  const inspector=page.getByTestId('model-request-inspector').first();await toggleDetails(inspector,true);const requestRound=inspector.getByTestId('model-request-round').first();await toggleDetails(requestRound,true);
  const displayed=JSON.parse(await requestRound.getByTestId('model-request-body').innerText());
  const expected=structuredClone(modelBodies[0]);
  // Existing security projection omits the nearest_label schema, explicitly disclosed in UI.
  for (const tool of expected.tools ?? []) for (const fn of tool.tools ?? []) if(fn.name==='nearest_label') fn.parameters={omitted:'unrecognized-schema'};
  assert.deepEqual(displayed,expected);assert.match(await requestRound.getByTestId('model-request-omissions').innerText(),/unrecognized-fields/);
  report.inspectionLimitation='Existing request projection explicitly omits nearest_label parameters as unrecognized-schema; all remaining actual-body fields matched. Raw fixture body is retained separately.';
  await save('actual-provider-bodies.json',modelBodies);await shot('08-actual-request-inspector');await toggleDetails(inspector,false);
  const evidence=JSON.parse(modelBodies[1].input.find(x=>x.type==='function_call_output').output);assert.equal(evidence.outcome.status,'verified-found');await page.getByTestId('model-select-nearest').click();assert.equal((await info()).revision,2);assert.deepEqual((await info()).entries,[]);
  report.checks.push('Synthetic provider transport only: real nearest_label roundtrip, verified selection, request inspector matches actual provider body except explicitly disclosed schema omission; no authority mutation');
  await page.getByTestId('model-attach-screenshot').click();await page.getByTestId('model-crop-preview').waitFor();await shot('09-screenshot-crop-modal');await page.getByTestId('model-crop-attach').click();await page.getByTestId('model-image-preview').waitFor();await page.getByTestId('model-remove-screenshot').click();report.checks.push('Composer camera opens native crop modal, attaches JPEG and removes without sending');
  await page.setViewportSize({width:390,height:844});await page.goto(base);await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');await layout('mobile-default','toronto-viewer');assert.equal(await page.getByTestId('chat').isVisible(),false);await shot('10-mobile-default');
  await page.getByRole('button',{name:'Toggle chat',exact:true}).click();await page.getByTestId('local-draft').waitFor({state:'visible'});const drawer=await page.getByTestId('chat').boundingBox(),composer=await page.getByTestId('local-draft-form').boundingBox();assert.ok(drawer.x>=0&&drawer.y>=96&&drawer.x+drawer.width<=390&&drawer.y+drawer.height<=844);assert.ok(composer.y>=drawer.y&&composer.y+composer.height<=drawer.y+drawer.height+1);await layout('mobile-chat-open','toronto-viewer');await shot('11-mobile-chat-open');report.checks.push('Fresh mobile navigation hides chat by default; explicit toggle opens bounded drawer with visible composer and no document scroll');
  assert.deepEqual(report.messages,[]);report.status='passed';
}catch(error){report.error=String(error?.stack??error);if(page)try{await shot('failure');}catch{}process.exitCode=1;}
finally{await save('report.json',report);await page?.close();await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true});console.log(JSON.stringify({status:report.status,directory,checks:report.checks,error:report.error},null,2));}
