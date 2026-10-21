// Task039: existing Chrome only; isolated 2-record source + real point authority. No live model calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index.ts';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/spatial/semantic-artifact.ts';
import { getSemanticDiskIndex } from '../apps/server/src/spatial/semantic-disk-index.ts';
import { createHash } from 'node:crypto';
const dir = resolve(process.argv[3] ?? '/tmp/task039-browser'); await mkdir(dir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'scene-hierarchy-'));
const report = { status: 'failed', checks: [], messages: [], screenshots: [], fixtureOnly: true };
let server, browser, page;
async function shot(name) { await page.screenshot({ path: join(dir, name + '.png'), fullPage: true }); await writeFile(join(dir, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); report.screenshots.push(name + '.png'); }
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0,0,0], max: [3,3,3] }, scale: [.001,.001,.001], offset: [0,0,0], attributes: [{ name: 'position', type: 'int32', size: 12, min: [0,0,0], max: [3,3,3] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(56);
  for (let i=0;i<2;i++) { payload.writeInt32LE((i+1)*1000,i*28); for(let axis=0;axis<3;axis++) payload.writeUInt16LE(65535,i*28+12+axis*2); payload.writeUInt16LE(1,i*28+18); payload.writeUInt32LE(i,i*28+20); payload.writeFloatLE(i===0?7:6,i*28+24); }
  const hierarchy = Buffer.alloc(22); hierarchy[0]=1; hierarchy.writeUInt32LE(2,2); hierarchy.writeBigUInt64LE(56n,14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285,4841948,0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1,2,3,4].map(file=>({ source_file_id:file,file:`L00${file}.ply`,points:file===1?2:0 })) };
  await mkdir(join(root,'octree')); await writeFile(join(root,'manifest.json'),JSON.stringify(manifest)); await writeFile(join(root,'octree/metadata.json'),JSON.stringify(metadata)); await writeFile(join(root,'octree/hierarchy.bin'),hierarchy); await writeFile(join(root,'octree/octree.bin'),payload);
  // Offline fixture preparation; the per-pick HTTP endpoint is forbidden to build.
  const artifact = await SemanticArtifact.open(root); try { await getSemanticDiskIndex(artifact); } finally { await artifact.close(); }
  server = createDemoServer({ datasetRoot: root, projectPath: join(root,'project.json') }); server.listen(0,'127.0.0.1'); await once(server,'listening'); const backend=`http://127.0.0.1:${server.address().port}`;
  const info=async()=> (await (await fetch(backend+'/datasets/toronto3d/overrides')).json()).result;
  page=await browser.contexts()[0].newPage(); page.setDefaultTimeout(15000); await page.setViewportSize({width:1440,height:900});
  page.on('pageerror',e=>report.messages.push({type:'pageerror',text:String(e)}));
  page.on('console',m=>{if(m.type()==='error')report.messages.push({type:'error',text:m.text()});});
  const typeRequests=[];
  await page.route('http://127.0.0.1:5173/**',async route=>{const url=new URL(route.request().url());
    if(url.pathname.endsWith('/point')) typeRequests.push(Object.fromEntries(url.searchParams));
    // Controlled sampled-channel fixture: Car row 0 exists only in native detail,
    // not in either overview publication. Exact source records and crop stay real.
    if(url.pathname.endsWith('/observation') && url.searchParams.get('purpose')==='display') {
      const observation=await (await fetch(backend+url.pathname+url.search)).json();
      observation.positions=observation.positions.slice(3); observation.colors=observation.colors.slice(3); observation.sourceIds=observation.sourceIds.slice(2); observation.labels=observation.labels.slice(1); observation.count=1;
      observation.sampleHash=createHash('sha256').update(JSON.stringify({positions:observation.positions,colors:observation.colors,sourceIds:observation.sourceIds,labels:observation.labels})).digest('hex');
      await route.fulfill({json:observation}); return;
    }
    if(url.pathname==='/' || url.pathname.startsWith('/assets/')) { await route.fulfill({status:200,body:await readFile(join(process.cwd(),'apps/web/dist',url.pathname==='/'?'index.html':url.pathname)),contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});return; }
    if(url.pathname.endsWith('/preprocessing')) { const snapshot=await info(); await route.fulfill({json:{version:'toronto-preprocessing-v1',datasetId:'toronto3d',artifactRevision:snapshot.artifactRevision,frameId:'toronto3d-local-v1',units:'m',status:'ready',message:'Fixture: derived bounds and approximate fits.',truncated:false,overlays:[6,7,8,4].map((label,i)=>({id:String(i),label,name:TORONTO_SEMANTIC_LABELS[label],points:3,bounds:{min:[i/4,0,0],max:[i/4+.2,.2,.5]},...(i===0?{fit:{kind:'vertical-cylinder',status:'fitted',center:[0,0,.25],dimensions:[.2,.2,.5],radius:.1,yawRadians:0,rmseMeters:.1,coverage:.8,qualityScore:.5,toleranceMeters:.2,evaluatedPoints:3,qualityMeaning:'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity'}}:{})})),ground:{cellMeters:2,origin:[0,0],minimumSupport:3,method:'observed-cell-minimum-v1',cells:[{x:0,y:0,elevation:0,maxElevation:.1,points:3}]}}});return; }
    await route.fulfill({response:await route.fetch({url:backend+url.pathname+url.search})});
  });
  await page.goto('http://127.0.0.1:5173/?smoke=1');
  await page.waitForFunction(()=>document.querySelector('[data-testid="toronto-viewer"]')?.getAttribute('data-crop-points')==='2');
  await page.waitForFunction(()=>document.querySelector('[data-testid="point-edits"]')?.hidden);
  assert.equal(await page.getByTestId('point-edit-refresh').isVisible(),false);
  assert.equal(await page.getByTestId('point-edit-undo').isVisible(),false);
  await shot('01-desktop-idle');
  const viewer=page.getByTestId('toronto-viewer');
  async function pick(attribute) { const rect=await viewer.boundingBox(), point=JSON.parse(await viewer.getAttribute(attribute)); await page.keyboard.down('Control');await page.mouse.click(rect.x+point[0],rect.y+point[1]);await page.keyboard.up('Control'); }
  await pick('data-detail-pick-point'); await page.waitForFunction(()=>document.querySelector('[data-testid="point-type-Point 1"]')?.textContent==='Car');
  assert.ok(typeRequests.some(request=>request.sourceFileId==='1' && request.sourceRow==='0'),'Detail-only source record resolved by exact metadata endpoint');
  const tools=page.getByTestId('toronto-technical'); await tools.locator(':scope > summary').click();
  const cropTools=tools.locator('details').filter({has:page.getByTestId('clear-crop')}); await cropTools.locator(':scope > summary').click();
  await page.getByTestId('clear-crop').click(); await tools.locator(':scope > summary').click();
  await pick('data-pick-point'); await page.getByTestId('point-type-Point 2').waitFor(); assert.equal(await page.getByTestId('point-type-Point 2').innerText(),'Pole');
  assert.equal(await page.getByText(/Removed numbers are never reused/).count(),0);
  assert.equal(await page.getByText(/Original coordinates, not GPU values/).count(),0);
  await page.getByTestId('toggle-preprocessing').click();
  const legend=page.getByTestId('preprocessing-status'); await legend.getByLabel('Cluster classes').waitFor();
  for(const name of ['Pole','Car','Fence','Building']) assert.ok((await legend.getByLabel('Cluster classes').innerText()).includes(name));
  for(const name of ['Clusters','Fits','Ground']) assert.ok((await legend.getByLabel('Layer representations').innerText()).includes(name));
  assert.equal(await legend.getByText(/Wire bounds group source/).isVisible(),false);
  await shot('02-desktop-selection-legend'); report.checks.push('Idle controls hidden; native detail-only Car (omitted from controlled overview) resolves exact source type; overview Pole remains exact; compact labeled legend, limitations disclosed only');
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300); await shot('03-mobile-selection-legend');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:900}); await page.getByTestId('toggle-preprocessing').click();
  await tools.locator(':scope > summary').click(); await tools.getByText('Manual point tools',{exact:true}).click();
  await page.getByTestId('point-edit-select-Point 1').check(); await page.getByTestId('point-edit-preview').click(); await page.getByTestId('point-edit-review').waitFor();
  await tools.locator(':scope > summary').click(); assert.equal(await page.getByTestId('point-edit-approve').isVisible(),true); assert.equal((await info()).revision,0);
  await shot('04-desktop-pending');
  await page.setViewportSize({width:390,height:844}); await shot('05-mobile-pending');
  assert.equal(await page.getByTestId('point-edit-approve').evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Mobile Confirm is not occluded by chat');
  await page.setViewportSize({width:1440,height:900});
  await page.getByTestId('point-edit-cancel').click(); await page.waitForFunction(()=>document.querySelector('[data-testid="point-edits"]')?.hidden); assert.equal((await info()).revision,0);
  await tools.locator(':scope > summary').click(); await page.getByTestId('point-edit-preview').click(); await page.getByTestId('point-edit-review').waitFor(); await tools.locator(':scope > summary').click();
  const pending=await (await fetch(backend+'/datasets/toronto3d/overrides/pending')).json(); const proposal=pending.result[0];
  await fetch(backend+'/datasets/toronto3d/overrides/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:proposal.sessionId,revision:proposal.revision,proposalId:proposal.proposalId})});
  await page.getByTestId('point-edit-approve').click(); await page.getByTestId('point-edit-recover').waitFor(); assert.match(await page.getByTestId('point-edits').innerText(),/stale-revision/); await shot('06-recovery');
  await page.getByTestId('point-edit-recover').click(); await page.waitForFunction(()=>document.querySelector('[data-testid="point-edits"]')?.hidden);
  await tools.locator(':scope > summary').click(); await page.getByTestId('point-edit-undo').click(); await page.waitForFunction(()=>/Undone/.test(document.querySelector('[data-testid="point-edit-status"]')?.textContent??'')); assert.deepEqual((await info()).entries,[]);
  report.checks.push('Per-change review stays visible with Scene tools closed, Reject does not mutate; real stale approval shows actionable recovery; explicit refresh and Undo preserve controller state');
  assert.deepEqual(report.messages.filter(m=>m.type==='pageerror'),[]); report.status='passed';
} catch(error) { report.error=String(error?.stack??error); if(page)try{await shot('failure');}catch{} process.exitCode=1; }
finally { await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)); await page?.close();await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true}); }
console.log(JSON.stringify(report,null,2));
