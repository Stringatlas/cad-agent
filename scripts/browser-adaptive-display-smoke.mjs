// Existing Chrome only. Actual native cloud data; only one explicitly labeled HTTP failure is injected.
// Run after pnpm build: pnpm exec tsx scripts/browser-adaptive-display-smoke.mjs [CDP] [artifact-dir]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../apps/server/src/index.ts';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { preview } = await import(requireWeb.resolve('vite'));
const dir = resolve(process.argv[3] ?? '/tmp/task040-browser'); await mkdir(dir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'task040-browser-'));
const report = { status: 'failed', checks: [], states: {}, requests: [], messages: [], ownership: 'One new tab, ephemeral backend and Vite preview; existing Chrome only. No provider calls, index preparation or operator process changes.' };
let browser, page, server, web;
const deadline = setTimeout(() => { console.error('Five-minute smoke deadline exceeded'); process.exit(2); }, 295000);
try {
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222', { timeout: 5000 });
  server = createDemoServer({ projectPath: join(root, 'project.json') }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const backend = `http://127.0.0.1:${server.address().port}`;
  web = await preview({ configFile: false, root: resolve('apps/web'), preview: { host: '127.0.0.1', port: 0,
    proxy: Object.fromEntries(['/datasets/', '/project', '/chat/', '/auth/'].map(path => [path, { target: backend, changeOrigin: true }])) } });
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  page = await browser.contexts()[0].newPage(); page.setDefaultTimeout(20000); await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', e => report.messages.push({ type: 'pageerror', text: String(e) }));
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) report.messages.push({ type: m.type(), text: m.text() }); });
  page.on('request', r => { if (r.url().includes('/datasets/')) report.requests.push({ url: r.url(), time: Date.now() }); });
  const viewer = page.getByTestId('toronto-viewer');
  const state = () => viewer.evaluate(el => ({ ...el.dataset }));
  const nodes = s => JSON.parse(s.adaptiveNodes);
  async function settled(name, budget = 3000000) {
    let previous = '', stable = 0, s;
    for (let i = 0; i < 360; i++) {
      await page.waitForTimeout(250); s = await state();
      assert.equal(s.adaptiveError, '', `Native streaming failed: ${s.adaptiveError}`);
      assert.ok(Number(s.adaptivePoints) <= budget);
      // Orbit damping retains sub-micrometer tail noise; use a tighter pose tolerance than the planner's 10cm grid.
      const key = JSON.stringify(JSON.parse(s.camera ?? '[]').map(n => Math.round(n * 1e6))) + s.adaptiveNodes;
      stable = s.adaptivePending === '0' && Number(s.adaptivePoints) > 0 && key === previous ? stable + 1 : 0;
      previous = key; if (stable >= 3) break;
    }
    assert.ok(stable >= 3, 'camera and resident plan settle without pending requests');
    assert.ok(Number(s.adaptiveChunks) > 0); assert.equal(s.ready, 'true');
    assert.equal(Number(s.nativeBatches), Math.ceil(Number(s.adaptivePoints) / 131072), 'native GPU batches pack resident points, not logical nodes');
    assert.ok(Number(s.gpuGeometries) >= Number(s.nativeBatches));
    assert.ok(Number(s.drawCalls) <= 24, `bounded draw calls: ${s.drawCalls}`);
    report.states[name] = s; return s;
  }
  async function capture(name) { await writeFile(join(dir, name + '.ax.txt'), await page.locator('body').ariaSnapshot()); await page.screenshot({ path: join(dir, name + '.png'), fullPage: true }); }
  async function section(name) { const summary = page.getByText(name, { exact: true }); if (!await summary.evaluate(el => el.parentElement.open)) await summary.click(); }
  async function quality() { if (!await page.getByTestId('toronto-technical').evaluate(el => el.open)) await page.getByTestId('toronto-technical').locator(':scope > summary').click(); await section('Display quality'); }
  async function orbit() { await viewer.scrollIntoViewIfNeeded(); const r = await viewer.boundingBox(); await page.mouse.move(r.x + r.width * .5, r.y + r.height * .5); await page.mouse.down(); await page.mouse.move(r.x + r.width * .65, r.y + r.height * .55, { steps: 8 }); await page.mouse.up(); }
  const nativeCount = () => report.requests.filter(r => /display-(node|hierarchy)/.test(r.url)).length;
  const cropCount = () => report.requests.filter(r => r.url.includes('/crop?')).length;
  await page.goto(base + '/?smoke=1');
  const startup = await settled('startup'); assert.equal(startup.cropPoints, '0'); assert.equal(cropCount(), 0);
  assert.ok(Number(startup.adaptiveChunks) > Number(startup.nativeBatches), 'logical native nodes are packed into fewer GPU geometries');
  assert.ok(report.requests.filter(r => r.url.includes('/display-node?')).every(r => new URL(r.url).searchParams.get('format') === 'binary'));
  assert.equal(await page.getByTestId('toronto-technical').evaluate(el => el.open), false);
  await capture('desktop-default');
  await quality(); assert.equal(await page.getByTestId('adaptive-display-toggle').isChecked(), true);
  assert.equal(await page.getByTestId('display-budget').inputValue(), '3000000');
  assert.deepEqual(await page.getByTestId('display-budget').locator('option').evaluateAll(options => options.map(option => Number(option.value))), [500000, 1000000, 2000000, 3000000]);
  assert.equal(await page.getByTestId('display-depth').count(), 0);
  assert.equal(await page.getByTestId('display-point-size').inputValue(), '4');
  const beforeSize = await state(), sizeRequests = nativeCount();
  for (const size of ['2', '6', '4']) {
    const frames = Number((await state()).renderedFrames);
    await page.getByTestId('display-point-size').selectOption(size);
    assert.equal(await page.getByTestId('display-point-size').inputValue(), size);
    await page.waitForFunction(previous => Number(document.querySelector('[data-testid="toronto-viewer"]')?.dataset.renderedFrames) > previous, frames);
  }
  assert.deepEqual(nodes(await state()), nodes(beforeSize)); assert.equal(nativeCount(), sizeRequests);
  await page.getByTestId('toronto-technical').locator(':scope > summary').click();
  report.checks.push('Default adaptive binary streaming uses 3M budget/hard maximum, bounded GPU batches/draw calls, no automatic crop; point size redraws without refetching nodes; tools stay collapsed');
  await capture('desktop-idle');
  await page.waitForTimeout(1000); const idle = nativeCount(), idleFrames = (await state()).renderedFrames;
  await page.waitForTimeout(1800); assert.equal(nativeCount(), idle); assert.equal((await state()).renderedFrames, idleFrames);
  report.checks.push('No repeated native requests or rendered frames during settled idle');
  await orbit(); const orbited = await settled('orbited'); assert.notEqual(orbited.camera, startup.camera); assert.notDeepEqual(nodes(orbited), nodes(startup));
  const r = await viewer.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.wheel(0, -550); await page.waitForTimeout(800); const zoomed = await settled('zoomed'); assert.notEqual(zoomed.camera, orbited.camera);
  report.checks.push('Orbit and zoom update camera/native request plan');
  await quality(); await page.getByTestId('display-budget').selectOption('500000'); const small = await settled('budget500k', 500000);
  assert.ok(Number(small.adaptivePoints) < Number(zoomed.adaptivePoints)); assert.ok(Number(small.gpuGeometries) < Number(zoomed.gpuGeometries));
  assert.ok(Number(small.nativeBatches) < Number(zoomed.nativeBatches));
  report.checks.push('Budget shrink evicts logical nodes and reduces packed GPU batches/geometry count');
  await page.getByTestId('display-near-radius').scrollIntoViewIfNeeded(); await capture('desktop-quality');
  await section('Toronto visual observation · fixed-view capture'); await page.getByTestId('capture-visual').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="visual-status"]')?.textContent?.startsWith('Captured view'));
  const metadata = JSON.parse(await page.getByTestId('visual-metadata').textContent());
  assert.ok(metadata.coverage.adaptive.chunks > 0); assert.equal(metadata.coverage.complete, false);
  report.captureCoverage = metadata.coverage;
  await page.getByTestId('display-near-radius').fill('0'); await page.getByTestId('display-near-radius').press('Tab'); await page.getByTestId('display-threshold').selectOption('160'); const coarse = await settled('coarse', 500000);
  await page.getByTestId('display-threshold').selectOption('20'); await page.getByTestId('display-near-radius').fill('200'); await page.getByTestId('display-near-radius').press('Tab'); const fine = await settled('fine', 500000);
  report.tuningChangedNodes = JSON.stringify(nodes(coarse)) !== JSON.stringify(nodes(fine)); assert.ok(report.tuningChangedNodes, 'near/distant tuning changes plan');
  report.checks.push('Near radius/distant threshold changes request plan');
  await page.waitForFunction(() => document.querySelector('[data-testid="visual-status"]')?.textContent === 'Captured image retained; pixel grounding unavailable.');
  assert.equal(JSON.parse(await page.getByTestId('visual-resolution').textContent()).status, 'stale');
  assert.equal(await page.getByRole('button', { name: 'Resolve pixel in captured image' }).isDisabled(), true);
  report.checks.push('Source screenshot records adaptive native coverage and invalidates after quality/chunk changes');
  await section('Navigation & points'); await page.getByRole('button', { name: 'Frame dataset', exact: true }).click(); const framed = await settled('framed', 500000); assert.notEqual(framed.camera, fine.camera);
  await page.waitForFunction(() => document.querySelector('[data-testid="toronto-viewer"]')?.dataset.detailPickPoint);
  await viewer.scrollIntoViewIfNeeded(); const pick = JSON.parse((await state()).detailPickPoint), rect = await viewer.boundingBox();
  await page.keyboard.down('Control'); await page.mouse.click(rect.x + pick[0], rect.y + pick[1]); await page.keyboard.up('Control');
  await page.waitForTimeout(1800); await capture('desktop-selected');
  report.selectedAX = await page.locator('body').ariaSnapshot();
  const selected = JSON.parse(await page.getByTestId('draft-point-json-Point 1').textContent());
  // Verify against exact native source payloads without requiring/building a semantic disk index.
  let original;
  for (const name of nodes(await state())) {
    const query = new URLSearchParams({ revision: selected.artifactRevision, name });
    const response = await fetch(backend + '/datasets/toronto3d/display-node?' + query); assert.equal(response.status, 200);
    const payload = await response.json();
    const index = Array.from({ length: payload.count }, (_, i) => i).find(i => payload.sourceIds[i * 2] === selected.key.sourceFileId && payload.sourceIds[i * 2 + 1] === selected.key.sourceRow);
    if (index !== undefined) { original = { position: payload.positions.slice(index * 3, index * 3 + 3), label: payload.labels[index] }; break; }
  }
  assert.ok(original, 'selected provenance exists in a displayed native source node');
  assert.deepEqual(selected.position, original.position); assert.equal(selected.semanticLabel, original.label);
  report.selectedPoint = { key: selected.key, position: selected.position, label: selected.semanticLabel };
  report.checks.push('Cmd/Ctrl-click native detail preserves exact source binary64 coordinates/key and semantic label (independently checked against native source payloads, no semantic index preparation)');
  const hierarchyResponse = await fetch(backend + '/datasets/toronto3d/display-hierarchy'); assert.equal(hierarchyResponse.status, 200); const hierarchy = await hierarchyResponse.json();
  report.hierarchy = { nodes: hierarchy.nodes.length, points: hierarchy.nodes.reduce((a,n) => a+n.count,0), total: hierarchy.dataset.totalPoints }; assert.equal(report.hierarchy.points, report.hierarchy.total);
  const first = new URL(report.requests.find(r => r.url.includes('/display-node?')).url);
  first.searchParams.delete('format'); // Browser streaming is binary; independent provenance checks intentionally read JSON.
  const payload = await (await fetch(backend + first.pathname + first.search)).json();
  assert.equal(payload.positions.length, payload.count * 3); assert.equal(payload.sourceIds.length, payload.count * 2); assert.equal(payload.labels.length, payload.count);
  for (const [path, options, expected] of [['/display-hierarchy?path=x', {},400], ['/display-node?name=r',{},400], ['/display-hierarchy',{headers:{Origin:'https://example.com'}},403], ['/display-hierarchy',{headers:{Range:'bytes=0-1'}},416]]) assert.equal((await fetch(backend+'/datasets/toronto3d'+path,options)).status,expected);
  report.checks.push('Native API complete hierarchy/count, exact payload identity/labels, query/origin/range guards');
  await section('Full-resolution selection & crop');
  for (const [i,a] of ['x','y','z'].entries()) { await page.getByTestId('box-center-'+a).fill(String(payload.positions[i])); await page.getByTestId('box-size-'+a).fill('0.5'); }
  const beforeCropNodes = nodes(await state()), beforeCropCount = cropCount(); await page.getByTestId('load-crop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box', undefined, {timeout:45000});
  const cropped = await state(); assert.ok(Number(cropped.cropPoints) > 0); assert.deepEqual(nodes(cropped), beforeCropNodes); assert.equal(cropCount(), beforeCropCount + 1);
  report.checks.push('Independent explicit 0.5m manual crop loads actual exact points without replacing native chunks');
  await page.getByTestId('clear-crop').click();
  await quality(); let failures = 0; await page.route('**/datasets/toronto3d/display-node?*', route => { if (!failures++) return route.fulfill({status:503,body:'Explicit task040 one-node failure fixture'}); return route.continue(); });
  await page.getByTestId('display-budget').selectOption('1000000'); await page.waitForFunction(() => !!document.querySelector('[data-testid="toronto-viewer"]')?.dataset.adaptiveError);
  const failedCount = nativeCount(); await orbit(); await page.waitForTimeout(2000); assert.equal(nativeCount(), failedCount); assert.ok((await state()).adaptiveError);
  await quality(); await capture('desktop-error'); await page.getByTestId('retry-display').click(); await settled('retried',1000000); await page.unroute('**/datasets/toronto3d/display-node?*');
  report.checks.push('One explicitly injected node HTTP503 latches through camera movement, no retry loop; explicit Retry restores real chunks');
  await page.getByTestId('toronto-technical').locator(':scope > summary').click(); await page.setViewportSize({width:390,height:844}); await settled('mobile',1000000); await capture('mobile-idle');
  await page.getByRole('button', { name: 'Toggle chat' }).click(); await settled('mobileScene', 1000000); await capture('mobile-scene');
  await quality(); await page.getByTestId('display-near-radius').scrollIntoViewIfNeeded(); await capture('mobile-quality');
  assert.ok(await page.getByTestId('display-near-radius').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
  report.checks.push('Desktop/mobile quality controls visible and mobile input hit-tested; no horizontal overflow');
  report.mobileOverflow = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})); assert.ok(report.mobileOverflow.scrollWidth <= 391);
  await page.getByTestId('adaptive-display-toggle').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box', undefined, { timeout: 90000 });
  const stopped = await state(), stopCalls = nativeCount(); assert.equal(stopped.adaptivePoints, '0'); assert.equal(stopped.adaptiveChunks, '0'); assert.equal(stopped.adaptivePending, '0');
  assert.ok(Number(stopped.cropPoints) > 0); assert.equal(await page.getByTestId('display-near-radius').count(), 0);
  await page.waitForTimeout(1000); assert.equal(nativeCount(), stopCalls);
  assert.equal(await page.getByTestId('display-depth').inputValue(), '3');
  await orbit(); await page.waitForTimeout(1000); assert.equal(nativeCount(), stopCalls);
  await quality(); await page.getByTestId('display-budget').selectOption('10000'); await page.getByTestId('display-depth').selectOption('0');
  await page.waitForFunction(() => document.querySelector('[data-testid="display-status"]')?.textContent === 'Ready');
  assert.ok(report.requests.some(r => r.url.includes('budget=10000') && r.url.includes('depth=0')));
  report.checks.push('Explicit off restores exact street crop and sampled overview, no native requests on legacy orbit; legacy budget/depth controls work');
  await page.route('**/datasets/toronto3d/display-node?*', async route => { await new Promise(r => setTimeout(r, 350)); await route.continue().catch(() => {}); });
  await page.getByTestId('adaptive-display-toggle').check();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="toronto-viewer"]')?.dataset.adaptivePending) > 0);
  await page.getByTestId('adaptive-display-toggle').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid="crop-status"]')?.textContent === 'Ready — full resolution inside box', undefined, { timeout: 90000 });
  await page.waitForTimeout(600); const rapid = await state(); assert.equal(rapid.adaptivePoints, '0'); assert.equal(rapid.adaptiveChunks, '0'); assert.equal(rapid.adaptiveError, '');
  await page.unroute('**/datasets/toronto3d/display-node?*');
  await page.getByTestId('toronto-technical').locator(':scope > summary').click(); await capture('mobile-default-restored');
  report.checks.push('Disable releases native chunks and returns to exact old street rendering; rapid on/off suppresses late publication and leaves controls tucked away (legacy fallback, not the new default)');
  assert.deepEqual(report.messages.filter(m => m.type === 'pageerror'), []); report.status='passed';
} catch (e) { report.error = String(e); report.stack=e.stack; process.exitCode=1; if(page) { try { report.failureState = await page.getByTestId('toronto-viewer').evaluate(el=>({...el.dataset})); await page.screenshot({path:join(dir,'failure.png'),fullPage:true}); await writeFile(join(dir,'failure.ax.txt'),await page.locator('body').ariaSnapshot()); } catch {} } }
finally { clearTimeout(deadline); await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)); await page?.close(); await browser?.close(); await web?.close(); if(server) {server.closeAllConnections(); await new Promise(r=>server.close(r));} await rm(root,{recursive:true,force:true}); }
console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,dir},null,2));
