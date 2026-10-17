// Task033: existing Chrome only; ephemeral project/backend, fixture and owned tab.
// Build first: pnpm build
// node --import tsx scripts/browser-ai-ghost-proposals-smoke.mjs [CDP] [artifacts]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';

const directory = resolve(process.argv[3] ?? '/tmp/task033-browser');
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task033-isolated-'));
const report = { status: 'failed', checks: [], messages: [], replies: [], screenshots: [], snapshots: {}, ownership: 'Existing Chrome, one owned tab, ephemeral backend/project/fixture, intercepted built bundle. No Chrome launch, operator configuration changes or existing listener changes. Only model transport is synthetic.' };
let browser, page, server;
const bodies = [];
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
async function shot(name) {
  await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(directory, name + '.png') });
  report.screenshots.push(name + '.png');
}
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  // Tiny valid Toronto fixture permits the default page to load without touching operator data.
  const metadata = { version:'2.0', encoding:'UNCOMPRESSED', points:2, hierarchy:{firstChunkSize:22}, boundingBox:{min:[0,0,0],max:[3,3,3]}, scale:[.001,.001,.001], offset:[0,0,0], attributes:[{name:'position',type:'int32',size:12,min:[0,0,0],max:[3,3,3]},{name:'rgb',type:'uint16',size:6},{name:'point source id',type:'uint16',size:2},{name:'source_row',type:'uint32',size:4},{name:'scalar_Label',type:'float',size:4}] };
  const payload = Buffer.alloc(56);
  for (let i=0;i<2;i++) { payload.writeInt32LE((i+1)*1000,i*28); for(let a=0;a<3;a++)payload.writeUInt16LE(65535,i*28+12+a*2); payload.writeUInt16LE(1,i*28+18); payload.writeUInt32LE(i,i*28+20); payload.writeFloatLE(i===0?0:6,i*28+24); }
  const hierarchy = Buffer.alloc(22); hierarchy[0]=1; hierarchy.writeUInt32LE(2,2); hierarchy.writeBigUInt64LE(56n,14);
  const manifest = { units:'m',frame:'right-handed Z-up',local_origin_world:[627285,4841948,0],potree_scale_m:metadata.scale,semantic_attribute:'scalar_Label',semantic_classes:TORONTO_SEMANTIC_LABELS,sources:[1,2,3,4].map(file=>({source_file_id:file,file:`L00${file}.ply`,points:file===1?2:0})) };
  await mkdir(join(root,'octree')); await writeFile(join(root,'manifest.json'),JSON.stringify(manifest)); await writeFile(join(root,'octree/metadata.json'),JSON.stringify(metadata)); await writeFile(join(root,'octree/hierarchy.bin'),hierarchy); await writeFile(join(root,'octree/octree.bin'),payload);
  let round = 0;
  server = createDemoServer({ datasetRoot: root, projectPath: join(root,'project.json'), provider:{mode:'api-key',apiKey:'synthetic-test-only'}, modelTransport: async (url,init) => {
    if (String(url).endsWith('/models')) return Response.json({data:[{id:'fixture-model'}]});
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const turn = Math.floor(round / 2) + 1;
    const call = (name,args) => ({type:'function_call',namespace:'scene',name,call_id:`task033_${turn}_${name}`,arguments:JSON.stringify(args)});
    const output = round++ % 2 === 0 ? [
      call('propose_box_create',{entityId:`ai-created-${turn}`,center:[-1.8,0,1.5],dimensions:[1,1,2]}),
      call('propose_box_update',{entityId:'proposal-box',center:[1.6,0,1.6],dimensions:[1.2,1.2,2.4]}),
    ] : [{type:'message',role:'assistant',content:[{type:'output_text',text:'Two uncommitted box proposals are ready for individual human review.'}]}];
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const backend = `http://127.0.0.1:${server.address().port}`;
  const info = async () => (await (await fetch(backend+'/project/session')).json()).result;
  const snapshot = async name => (report.snapshots[name] = await info());
  const initial = await snapshot('initial');
  page = await browser.contexts()[0].newPage(); page.setDefaultTimeout(15000); await page.setViewportSize({width:1440,height:900});
  page.on('pageerror',error=>report.messages.push({type:'pageerror',text:String(error)}));
  page.on('console',message=>{if(message.type()==='error')report.messages.push({type:'error',text:message.text()});});
  page.on('dialog',dialog=>dialog.accept());
  await page.route('http://127.0.0.1:5173/**',async route=>{
    const url = new URL(route.request().url());
    if (url.pathname==='/' || url.pathname.startsWith('/assets/')) {
      await route.fulfill({status:200,body:await readFile(join(process.cwd(),'apps/web/dist',url.pathname==='/'?'index.html':url.pathname)),contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'}); return;
    }
    const response = await route.fetch({url:backend+url.pathname+url.search});
    if (url.pathname.startsWith('/project/') && route.request().method()==='POST') {
      report.replies.push({path:url.pathname,status:response.status(),request:route.request().postDataJSON(),body:await response.json()});
    }
    await route.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5173/?smoke=1');
  await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"]');
  await page.getByRole('button',{name:'Synthetic',exact:true}).click();
  await page.getByTestId('viewer').locator('canvas').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="model-select"]')?.value==='fixture-model');
  await shot('01-authoritative-before');
  const cards = page.getByTestId('model-box-proposal');
  async function send(text) {
    await page.getByTestId('local-draft').fill(text); await page.getByTestId('send-local-draft').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="model-box-proposal"]').length===2 && [...document.querySelectorAll('[data-testid="model-box-accept"]')].every(button=>!button.disabled));
  }
  const proposals = async () => Promise.all(await cards.evaluateAll(nodes=>nodes.map(node=>JSON.parse(node.querySelector('pre').textContent))));
  await send('Propose a new box and modify the existing box; do not commit anything.');
  const first = await proposals(); assert.deepEqual(first.map(p=>p.edit.kind),['create-box','update-box']);
  assert.deepEqual(await snapshot('twoGhosts'),initial,'automatic previews must not publish geometry');
  assert.match(await page.getByTestId('model-proposal-review').innerText(),/not CAD solids or collision verification/);
  await shot('02-two-automatic-ghosts');
  await page.getByTestId('model-attach-screenshot').click();
  await page.getByTestId('model-image-error').waitFor();
  assert.match(await page.getByTestId('model-image-error').innerText(),/uncommitted box ghosts/);
  assert.equal(await page.getByTestId('model-crop-preview').count(),0);
  await shot('03-ghost-screenshot-blocked');
  await page.getByTestId('model-crop-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  report.checks.push('Real model tool dispatch automatically renders two exact per-change previews; server geometry/history unchanged; screenshot grounding fails explicitly while ghosts are visible');
  await cards.filter({hasText:'Create ai-created-1'}).getByTestId('model-box-decline').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="model-box-proposal"]').length===1);
  assert.deepEqual(await snapshot('declinedOne'),initial);
  const declinedReply = report.replies.find(reply=>reply.path==='/project/decline');
  assert.equal(declinedReply.status,200); assert.deepEqual(declinedReply.body.result,{proposalId:first[0].proposalId,declined:true});
  assert.equal(declinedReply.request.digest,first[0].digest);
  await shot('04-declined-only-create');
  await cards.getByTestId('model-box-accept').click();
  await page.getByTestId('model-box-undo').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="model-box-proposal"]').length===0);
  const approved = await snapshot('acceptedUpdate');
  assert.equal(approved.snapshot.project.revision,1);
  assert.deepEqual(approved.snapshot.project.entities.find(e=>e.id==='proposal-box'),first[1].after);
  assert.equal(approved.snapshot.project.entities.some(e=>e.id==='ai-created-1'),false);
  assert.equal(approved.savedRevision,null,'Accept must not implicitly Save');
  await shot('05-accepted-update-only');
  await page.getByTestId('model-box-undo').click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="model-box-undo"]'));
  const undone = await snapshot('undone');
  assert.equal(undone.snapshot.project.revision,2);
  assert.deepEqual(undone.snapshot.project.entities,initial.snapshot.project.entities);
  assert.equal(undone.nextUndoTransactionId,null);
  await shot('06-undo-restores-original');
  report.checks.push('Decline invalidates just the exact retained create candidate without a revision; Accept publishes only the remaining update as revision 1, never saves; checked inverse Undo restores original entities as revision 2');
  await send('Again propose one new box and one existing-box change.');
  const second = await proposals(); assert.equal(second[0].projectRevision,2);
  await shot('07-revision-two-ghosts');
  await cards.filter({hasText:'Create ai-created-2'}).getByTestId('model-box-accept').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="model-box-proposal"]').length===0);
  const acceptedCreate = await snapshot('acceptedCreateInvalidatesPeer');
  assert.equal(acceptedCreate.snapshot.project.revision,3);
  assert.deepEqual(acceptedCreate.snapshot.project.entities.find(e=>e.id==='ai-created-2'),second[0].after);
  assert.deepEqual(acceptedCreate.snapshot.project.entities.find(e=>e.id==='proposal-box'),initial.snapshot.project.entities.find(e=>e.id==='proposal-box'));
  // Prove a cleared peer is also invalidated at authority, not merely hidden by UI.
  const peer = second[1], binding = acceptedCreate.snapshot;
  const staleAttempt = await fetch(backend+'/project/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:binding.sessionId,projectRevision:binding.project.revision,frameId:binding.frameId,units:'m',proposalId:peer.proposalId,digest:peer.digest,humanApproved:true})});
  assert.equal(staleAttempt.status,404); assert.equal((await staleAttempt.json()).error.code,'unknown-proposal');
  assert.deepEqual(await info(),acceptedCreate);
  await shot('08-create-accepted-peer-invalidated');
  await page.getByTestId('model-attach-screenshot').click(); await page.getByTestId('model-crop-preview').waitFor();
  await shot('09-screenshot-restored-without-ghosts');
  report.checks.push('Accepting one of two concurrent revision-2 candidates clears all other ghosts, publishes only that retained create as revision 3; fresh-binding replay of peer is rejected by server; screenshot capture works again without ghosts');
  assert.deepEqual(report.messages,[],'No browser page errors or console errors');
  assert.equal(bodies.length,4,'Two real two-round model loops');
  assert.equal(report.replies.filter(reply=>reply.path==='/project/approve').length,2);
  assert.equal(report.replies.filter(reply=>reply.path==='/project/undo').length,1);
  report.status='passed';
} catch (error) {
  report.error=String(error?.stack??error); if(page)try{await shot('failure');}catch{} process.exitCode=1;
} finally {
  await save('actual-provider-bodies.json',bodies); await save('report.json',report);
  await page?.close(); await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(root,{recursive:true,force:true});
  console.log(JSON.stringify({status:report.status,directory,checks:report.checks,error:report.error},null,2));
}
