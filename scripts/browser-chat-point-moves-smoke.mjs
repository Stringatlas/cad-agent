// Task035 isolated acceptance: existing Chrome only, ephemeral fixture/authority/provider.
// node --import tsx scripts/browser-chat-point-moves-smoke.mjs [CDP] [artifact-directory]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import * as THREE from 'three';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
const directory = resolve(process.argv[3] ?? '/tmp/task035-browser');
await mkdir(directory, {recursive:true});
const root = await mkdtemp(join(tmpdir(),'spatial-chat-points-'));
const report = {status:'failed', error:undefined, checks:[], errors:[], replies:[], screenshots:[], browser:'Existing Chrome9222, isolated new tab. Browser tools/setup unavailable and daemon socket absent; direct CDP fallback. No existing servers, configuration or persistence touched.'};
let browser, page, server;
const save = (name,value) => writeFile(join(directory,name), JSON.stringify(value,null,2)+'\n');
async function screenshot(name) { await writeFile(join(directory,name+'.ax.txt'),await page.locator('body').ariaSnapshot()); await page.screenshot({path:join(directory,name+'.png'),fullPage:true}); report.screenshots.push(name); }
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222',{timeout:5000});
  const coords = [[1,0,0],[8,0,0],[2,0,0],[9,0,0]];
  const metadata = {version:'2.0',encoding:'UNCOMPRESSED',points:4,hierarchy:{firstChunkSize:22},boundingBox:{min:[0,-1,-1],max:[10,1,1]},scale:[.001,.001,.001],offset:[0,0,0],attributes:[{name:'position',type:'int32',size:12,min:[0,-1,-1],max:[10,1,1]},{name:'rgb',type:'uint16',size:6},{name:'point source id',type:'uint16',size:2},{name:'source_row',type:'uint32',size:4},{name:'scalar_Label',type:'float',size:4}]};
  const payload = Buffer.alloc(112);
  coords.forEach((p,i)=>{p.forEach((v,a)=>payload.writeInt32LE(v*1000,i*28+a*4)); for(let a=0;a<3;a++)payload.writeUInt16LE(65535,i*28+12+a*2);payload.writeUInt16LE(1,i*28+18);payload.writeUInt32LE(i,i*28+20);payload.writeFloatLE(i<2?0:6,i*28+24);});
  const hierarchy=Buffer.alloc(22);hierarchy[0]=1;hierarchy.writeUInt32LE(4,2);hierarchy.writeBigUInt64LE(112n,14);
  const manifest={units:'m',frame:'right-handed Z-up',local_origin_world:[627285,4841948,0],potree_scale_m:metadata.scale,semantic_attribute:'scalar_Label',semantic_classes:TORONTO_SEMANTIC_LABELS,sources:[1,2,3,4].map(file=>({source_file_id:file,file:`L00${file}.ply`,points:file===1?4:0}))};
  await mkdir(join(root,'octree'));for(const [path,body] of [['manifest.json',JSON.stringify(manifest)],['octree/metadata.json',JSON.stringify(metadata)],['octree/hierarchy.bin',hierarchy],['octree/octree.bin',payload]])await writeFile(join(root,path),body);
  let round=0;const modelBodies=[];
  server=createDemoServer({datasetRoot:root,projectPath:join(root,'isolated-project.json'),provider:{mode:'api-key',apiKey:'synthetic-test-only'},modelTransport:async(url,init)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture-model'}]});
    modelBodies.push(JSON.parse(String(init?.body)));const r=round++;
    const output=r%2===0?['Point 1','Point 2'].map((pointName,i)=>({type:'function_call',name:'propose_point_move_to_nearest_label',namespace:'scene',call_id:`move_${r}_${i}`,arguments:JSON.stringify({pointName,label:6})})):[{type:'message',role:'assistant',content:[{type:'output_text',text:'## Proposed moves\n\n- **Point 1** → closest pole\n- **Point 2** → its own closest pole\n\n`Confirm` each change separately.\n\n<img src=x onerror="window.task035Unsafe=true">'}]}];
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  }});server.listen(0,'127.0.0.1');await once(server,'listening');const backend=`http://127.0.0.1:${server.address().port}`;
  const authority=async(path)=>{const r=await fetch(backend+'/datasets/toronto3d/'+path);const reply=await r.json();assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result;};
  page=await browser.contexts()[0].newPage();await page.setViewportSize({width:1600,height:1100});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('http://127.0.0.1:5173/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/'||u.pathname.startsWith('/assets/')){await route.fulfill({status:200,body:await readFile(join(process.cwd(),'apps/web/dist',u.pathname==='/'?'index.html':u.pathname)),contentType:u.pathname.endsWith('.js')?'application/javascript':u.pathname.endsWith('.css')?'text/css':'text/html'});return;}const response=await route.fetch({url:backend+u.pathname+u.search});if(u.pathname.includes('/overrides')){try{report.replies.push({path:u.pathname,status:response.status(),body:await response.json()});}catch{}}await route.fulfill({response});});
  await page.goto('http://127.0.0.1:5173/?smoke=1');await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"][data-pick-point]');
  const viewer=page.getByTestId('toronto-viewer');
  // Real Control-click selections, projecting known fixture originals from smoke camera telemetry.
  for(let i=0;i<2;i++){
    const rect=await viewer.boundingBox();const camera=new THREE.PerspectiveCamera(45,rect.width/rect.height,.1,10000);camera.up.set(0,0,1);camera.position.fromArray(JSON.parse(await viewer.getAttribute('data-camera')));camera.lookAt(5,0,0);camera.updateMatrixWorld();const p=new THREE.Vector3(...coords[i]).project(camera);
    await page.keyboard.down('Control');await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);await page.keyboard.up('Control');await page.getByTestId(`draft-point-Point ${i+1}`).waitFor({state:'attached'});
  }
  const cards=page.getByTestId('point-edit-review');
  async function send(){const composer=page.getByTestId('local-draft');await composer.fill('Move Point 1 and Point 2 to their closest poles respectively.');await composer.press('End');await composer.press('Shift+Enter');assert.ok((await composer.inputValue()).endsWith('\n'));assert.notEqual(await page.getByTestId('model-chat').getAttribute('data-state'),'streaming');await composer.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-testid="point-edit-review"]').length===2);await page.waitForFunction(()=>document.querySelector('[data-testid="model-chat"]')?.getAttribute('data-state')!=='streaming');}
  await send();const initial=await authority('overrides'),pending=await authority('overrides/pending');assert.equal(initial.entries.length,0);assert.equal(pending.length,2);assert.deepEqual(pending.map(p=>p.moves[0].after).sort((a,b)=>a[0]-b[0]),[[2,0,0],[9,0,0]]);
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="toronto-viewer"]').dataset.draftMarkers).length===4);
  const markers=JSON.parse(await viewer.getAttribute('data-draft-markers'));assert.deepEqual(markers.map(m=>m.position).sort((a,b)=>a[0]-b[0]),[[1,0,0],[2,0,0],[8,0,0],[9,0,0]]);
  const assistant=page.locator('article[data-role="assistant"]').last();await assistant.locator('h2').waitFor();assert.equal(await assistant.locator('strong').filter({hasText:'Point 1'}).count(),1);assert.equal(await assistant.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.task035Unsafe),undefined);assert.equal(await page.getByTestId('model-request-inspector').evaluateAll(nodes=>nodes.every(n=>!n.open)),true);
  const bubbleStyles=await page.locator('article[data-role]').evaluateAll(nodes=>nodes.map(n=>({role:n.dataset.role,align:getComputedStyle(n).alignSelf,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));await save('bubble-styles.json',bubbleStyles);assert.equal(bubbleStyles[0].align,'flex-end');assert.equal(bubbleStyles[1].align,'flex-start');
  const overlay=await page.getByTestId('scene-point-confirmation').boundingBox(),rect=await viewer.boundingBox();assert.ok(overlay.x>rect.x+rect.width/2);assert.ok(overlay.y+overlay.height<=rect.y+rect.height+2);assert.equal(await cards.getByRole('button',{name:'Confirm',exact:true}).count(),2);assert.equal(await cards.getByRole('button',{name:'Reject',exact:true}).count(),2);
  await screenshot('01-two-originals-two-ghosts-desktop');report.checks.push('Actual clicks select two sources; real provider pipeline independently resolves distinct poles [2,0,0]/[9,0,0]; zero authoritative entries and two exact pending changes; four original/proposed marker positions, bottom-right per-change Confirm/Reject; safe Markdown/HTML inert; assistant left/user right, inspectors collapsed.');
  const first=pending[0],second=pending[1];
  await page.locator(`[data-proposal-id="${first.proposalId}"]`).getByTestId('point-edit-approve').click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="point-edit-review"]').length===1);
  const afterFirst=await authority('overrides'),survivor=(await authority('overrides/pending'))[0];assert.equal(afterFirst.entries.length,1);assert.equal(survivor.proposalId,second.proposalId);assert.deepEqual(survivor.moves,second.moves);assert.equal(survivor.revision,afterFirst.revision);await screenshot('02-first-confirm-preserves-second');
  await cards.getByTestId('point-edit-approve').click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="point-edit-review"]').length===0);assert.equal((await authority('overrides')).entries.length,2);await screenshot('03-both-confirmed');report.checks.push('Sequential confirmations: first advances authority and rebinds unchanged second exact proposal; second confirms separately, two authoritative entries.');
  await page.getByTestId('point-edit-undo').click();await page.waitForFunction(()=>/Undone/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));assert.equal((await authority('overrides')).entries.length,1);
  await page.getByTestId('point-edit-undo').click();await page.waitForFunction(()=>/revision 4/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));assert.equal((await authority('overrides')).entries.length,0);report.checks.push('Latest-first two Undo operations restore both originals.');
  await send();const next=await authority('overrides/pending');await page.locator(`[data-proposal-id="${next[0].proposalId}"]`).getByTestId('point-edit-cancel').click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="point-edit-review"]').length===1);assert.equal((await authority('overrides/pending'))[0].proposalId,next[1].proposalId);assert.equal((await authority('overrides')).entries.length,0);await screenshot('04-reject-preserves-other');report.checks.push('Reject one of a fresh pair preserves the other pending proposal and zero authoritative entries.');
  await page.setViewportSize({width:390,height:844});await screenshot('05-mobile-pending');await page.getByRole('button',{name:'Toggle chat',exact:true}).click();await screenshot('06-mobile-scene-chat-closed');await page.getByRole('button',{name:'Toggle chat',exact:true}).click();await page.setViewportSize({width:1600,height:1100});
  await page.getByRole('button',{name:'Synthetic',exact:true}).click();assert.equal(await page.getByTestId('scene-point-confirmation').count(),0);assert.equal(await viewer.count(),0);await page.getByRole('button',{name:'Toronto3D',exact:true}).click();await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');await page.waitForFunction(()=>document.querySelectorAll('[data-testid="point-edit-review"]').length===1 && !document.querySelector('[data-testid="point-edit-refresh"]')?.disabled);assert.equal((await authority('overrides/pending')).length,1);report.checks.push('Source switching disposes Toronto scene/review; authority remains isolated and pending survives explicit Toronto remount.');
  assert.deepEqual(await readFile(join(root,'octree/octree.bin')),payload);assert.deepEqual(report.errors,[]);await save('model-bodies.json',modelBodies);report.status='passed';
}catch(error){report.error=String(error?.stack??error);if(page)try{await screenshot('failure');}catch{}process.exitCode=1;}
finally{await save('report.json',report);await page?.close();await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true});console.log(JSON.stringify({status:report.status,directory,error:report.error,checks:report.checks},null,2));}
