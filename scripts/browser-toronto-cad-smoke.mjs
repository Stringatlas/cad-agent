// Task034: one isolated tab in EXISTING Chrome only; real fixture authority + actual native CAD worker.
// node --import tsx scripts/browser-toronto-cad-smoke.mjs [CDP] [artifact-directory]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'spatial-toronto-cad-browser-'));
await mkdir(directory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'spatial-toronto-cad-fixture-'));
const report = { status: 'failed', directory, checks: [], errors: [], replies: [], screenshots: [], ownership: 'One new tab in existing Chrome9222; ephemeral server and fixture. Built assets intercepted at allowed localhost:5173. Existing listeners, operator auth/config/persistence untouched. Synthetic provider transport, actual native OpenCascade kernel.' };
let server, browser, page;
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
async function screenshot(name) { await writeFile(join(directory, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(directory, name), fullPage: true }); report.screenshots.push(name); }
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0,0,0], max: [3,3,3] }, scale: [.001,.001,.001], offset: [0,0,0], attributes: [{ name: 'position', type: 'int32', size: 12, min: [0,0,0], max: [3,3,3] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(56);
  for (let i=0;i<2;i++) { payload.writeInt32LE((i+1)*1000,i*28); for(let axis=0;axis<3;axis++) payload.writeUInt16LE(65535,i*28+12+axis*2); payload.writeUInt16LE(1,i*28+18); payload.writeUInt32LE(i,i*28+20); payload.writeFloatLE(i===0?0:6,i*28+24); }
  const hierarchy = Buffer.alloc(22); hierarchy[0]=1; hierarchy.writeUInt32LE(2,2); hierarchy.writeBigUInt64LE(56n,14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285,4841948,0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1,2,3,4].map(file=>({ source_file_id:file,file:`L00${file}.ply`,points:file===1?2:0 })) };
  await mkdir(join(root,'octree')); await writeFile(join(root,'manifest.json'),JSON.stringify(manifest)); await writeFile(join(root,'octree/metadata.json'),JSON.stringify(metadata)); await writeFile(join(root,'octree/hierarchy.bin'),hierarchy); await writeFile(join(root,'octree/octree.bin'),payload);
  let round = 0; const modelBodies = [];
  const fn = (name, args, id) => ({ type:'function_call', name, namespace:'scene', call_id:id, arguments:JSON.stringify(args) });
  server = createDemoServer({ datasetRoot: root, projectPath: join(root,'isolated-project.json'), provider: { mode:'api-key', apiKey:'synthetic-test-only' }, modelTransport: async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data:[{id:'fixture-model'}] });
    modelBodies.push(JSON.parse(String(init?.body)));
    const currentRound = round++;
    const output = currentRound === 0 ? [fn('propose_point_move',{pointNames:['Point 1'],translation:[0,0,1]},'point_call'),fn('propose_cad_box',{center:[1,0,1],dimensions:[1,1,1]},'box_call')] : currentRound === 2 ? [fn('propose_cad_cylinder',{center:[2,0,1],radius:.5,height:2},'cylinder_call')] : [{type:'message',role:'assistant',content:[{type:'output_text',text:'Pending changes require individual human acceptance.'}]}];
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  } }); server.listen(0,'127.0.0.1'); await once(server,'listening'); const backend = `http://127.0.0.1:${server.address().port}`;
  const authority = async path => { const response = await fetch(backend+'/datasets/toronto3d/'+path); const reply = await response.json(); assert.equal(reply.ok,true); return reply.result; };
  page = await browser.contexts()[0].newPage(); await page.setViewportSize({width:1600,height:1100});
  page.on('pageerror', e => report.errors.push(String(e))); page.on('console', m => { if(m.type()==='error')report.errors.push(m.text()); });
  let dropApproval = false;
  await page.route('http://127.0.0.1:5173/**', async route => { const url = new URL(route.request().url());
    if(url.pathname==='/' || url.pathname.startsWith('/assets/')) { const file=join(process.cwd(),'apps/web/dist',url.pathname==='/'?'index.html':url.pathname); await route.fulfill({status:200,body:await readFile(file),contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'}); return; }
    const response = await route.fetch({url:backend+url.pathname+url.search});
    if(url.pathname.includes('/cad') || url.pathname.includes('/overrides')) { try { report.replies.push({path:url.pathname,status:response.status(),body:await response.json()}); } catch {} }
    if (dropApproval && url.pathname.endsWith('/cad/approve')) { dropApproval = false; await route.abort('connectionfailed'); return; }
    await route.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5173/?smoke=1');
  const viewer = page.getByTestId('toronto-viewer'); await page.waitForSelector('[data-testid="toronto-viewer"][data-ready="true"][data-pick-point]');
  const rect = await viewer.boundingBox(), pick = JSON.parse(await viewer.getAttribute('data-pick-point'));
  await page.keyboard.down('Control'); await page.mouse.click(rect.x+pick[0],rect.y+pick[1]); await page.keyboard.up('Control');
  await page.getByTestId('draft-point-Point 1').waitFor({state:'attached'});
  await page.getByTestId('local-draft').fill('Move Point 1 up one meter and propose a box and cylinder at the explicit local coordinates.'); await page.getByTestId('send-local-draft').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-ghosts') === '1');
  await page.getByTestId('point-edit-review').waitFor();
  await page.getByTestId('local-draft').fill('Now also propose the cylinder.'); await page.getByTestId('send-local-draft').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-ghosts') === '2');
  const initialCad = await authority('cad'), initialPoints = await authority('overrides'); assert.equal(initialCad.bodies.length,0); assert.equal(initialCad.proposals.length,2); assert.equal(initialPoints.entries.length,0); assert.equal((await authority('overrides/pending')).length,1);
  const replay = modelBodies[1].input.filter(x=>x.type==='function_call_output').map(x=>JSON.parse(x.output)); assert.equal(replay.length,2); assert.equal(JSON.stringify(replay).includes('triangles'),false); await save('model-metadata-only.json',replay);
  await screenshot('01-ai-pending-native-ghosts.png'); report.checks.push('AI tools through actual provider loop retain source-point move and two real kernel solids; authority unmutated; metadata-only model replay; scene has two orange tessellations');
  await page.getByTestId('toronto-cad-proposal').filter({hasText:'Pending cylinder'}).getByTestId('toronto-cad-decline').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-ghosts') === '1');
  await page.getByTestId('toronto-cad-accept').click(); await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-bodies') === '1');
  const committed = await authority('cad'); assert.equal(committed.revision,1); assert.equal(committed.bodies[0].bodyId,initialCad.proposals.find(p=>p.operation.kind==='box').bodyId); assert.equal(committed.proposals.length,0);
  await page.getByTestId('point-edit-approve').click(); await page.waitForFunction(() => /Approved.*revision 1/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??'')); assert.deepEqual((await authority('overrides')).entries[0].position,[1,0,1]);
  await screenshot('02-human-accepted-native-solid-and-point.png'); report.checks.push('Individual cylinder Decline preserves box; human exact box Accept retains same native body; explicit point Accept commits actual source override');
  // Locate the chat camera by its accessible name (not internal renderer hooks).
  await page.getByRole('button',{name:'Attach scene screenshot',exact:true}).click();
  await page.waitForFunction(() => /capture unavailable|capture is unavailable/.test(document.body.innerText)); report.checks.push('Scene screenshot attachment fails closed for CAD/edited imagery');
  assert.equal(await page.getByTestId('model-crop-attach').isDisabled(),true); await page.getByTestId('model-crop-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  const technical = page.getByTestId('toronto-technical'); if(!await technical.evaluate(n=>n.open)) await technical.locator(':scope > summary').click();
  await page.getByTestId('point-edit-undo').click(); await page.waitForFunction(() => /Undone.*revision 2/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??''));
  await page.getByTestId('toronto-cad-undo').click(); await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-bodies') === '0'); assert.equal((await authority('cad')).revision,2); assert.equal((await authority('overrides')).entries.length,0);
  report.checks.push('Independent latest-first point and CAD Undo restore both authorities and release committed mesh');
  // Manual deterministic primitive goes through the very same native proposal/approval seam.
  const manual = page.getByTestId('toronto-cad-review').locator('details'); await manual.locator('summary').click();
  for(const [axis,value] of [['x','1'],['y','0'],['z','1']]) await page.getByTestId('cad-center-'+axis).fill(value);
  await page.getByTestId('toronto-cad-propose').click(); await page.getByTestId('toronto-cad-accept').waitFor(); dropApproval = true; await page.getByTestId('toronto-cad-accept').click();
  await page.waitForFunction(() => /Refresh required/.test(document.querySelector('[data-testid="toronto-cad-status"]')?.textContent??'')); assert.equal(await page.getByTestId('toronto-cad-propose').isDisabled(),true); assert.equal((await authority('cad')).bodies.length,1);
  await page.getByTestId('toronto-cad-refresh').click(); await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-bodies') === '1'); await screenshot('03-ambiguous-write-explicit-refresh.png');
  await page.getByTestId('toronto-cad-undo').click(); await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-cad-bodies') === '0'); assert.deepEqual(await readFile(join(root,'octree/octree.bin')),payload);
  report.checks.push('Committed-but-dropped approval response blocks writes, hides uncertified cache, no retry; explicit Refresh discovers exact native committed body; Undo restores; prepared bytes unchanged');
  assert.ok(report.errors.every(e=>e.includes('net::ERR_CONNECTION_FAILED')),JSON.stringify(report.errors)); report.status='passed';
} catch(error) { report.error=String(error?.stack??error); if(page)try{await screenshot('failure.png');}catch{} process.exitCode=1; }
finally { await save('report.json',report); await page?.close(); await browser?.close(); if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} await rm(root,{recursive:true,force:true}); console.log(JSON.stringify({status:report.status,directory,error:report.error,checks:report.checks},null,2)); }
