// Built prepared-cloud app, real source, fixture inference only. Own context/servers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { preview } from '../apps/web/node_modules/vite/dist/node/index.js';
import { createDemoServer } from '../apps/server/src/index.ts';

const directory = resolve(process.argv[3] ?? '/tmp/task089-cloud-marks-browser');
await mkdir(directory, { recursive: true });
const report = { status: 'failed', checks: [], errors: [], screenshots: [], results: [] };
let context, browser, front, page, positions, retained, action, actionSerial = 0;
const call = (name, args, id) => ({ type: 'function_call', namespace: 'scene', name, call_id: id, arguments: JSON.stringify(args) });
const mark = (position, id) => ({ ...(id ? { id } : {}), position, rationale: 'Investigate this feature.', uncertainty: 'Identity and surrounding surfaces need more evidence.' });
const server = createDemoServer({ provider: { mode: 'api-key', apiKey: 'cloud-marks-fixture-only' }, modelTransport: async (url, init) => {
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'cloud-marks-fixture' }] });
  const body = JSON.parse(String(init.body));
  let output;
  if (!String(body.instructions).includes('Runtime skill candidate-assessment:\n')) {
    output = [call('load_skill', { skillId: 'candidate-assessment' }, `skill_${++actionSerial}`)];
  } else if (!action.sent) {
    action.sent = true; if (action.hold) await action.hold;
    const args = action.kind === 'create' ? { expectedRevision: 0, marks: positions.map(p => mark(p)) } :
      action.kind === 'revise' || action.kind === 'fail' ? { expectedRevision: retained.annotationRevision,
        marks: [mark(positions[1], retained.marks[1]?.id ?? retained.marks[0].id)] } : {};
    output = [call(action.kind === 'read' ? 'get_scene_marks' : 'set_scene_marks', args, action.id)];
  } else {
    const item = body.input.findLast(i => i.type === 'function_call_output' && i.call_id === action.id);
    assert(item, 'fixture receives actual marks result'); const result = JSON.parse(item.output);
    report.results.push({ action: action.kind, result });
    assert.equal(result.kind, 'scene-marks');
    if (action.kind === 'fail') throw new Error('Fixture failure after streamed hypotheses');
    retained = result;
    output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${action.id} finished.` }] }];
  }
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
} });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = Object.fromEntries(['/datasets', '/chat', '/auth'].map(path => [path, { target, changeOrigin: true,
    configure(p) { p.on('proxyReq', req => req.setHeader('origin', target)); } }]));
  front = await preview({ configFile: false, root: resolve('apps/web'), build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, proxy } });
  browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9223');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  const base = `http://127.0.0.1:${front.httpServer.address().port}`;
  await page.goto(`${base}/?smoke=1`);
  const workspace = page.getByTestId('point-cloud-workspace'), host = workspace.locator('.viewport');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.adaptivePoints) > 0, null, { timeout: 90000 });
  await workspace.getByText('Display', { exact: true }).click(); await page.getByLabel('Display quality').selectOption('light'); await workspace.getByText('Display', { exact: true }).click();
  const info = await (await page.request.get(`${base}/datasets/prepared/stpls3d-1`)).json();
  positions = [.4, .6].map(f => info.bounds.min.map((n, axis) => n + (info.bounds.max[axis] - n) * (axis === 2 ? .3 : f)));
  const live = () => host.evaluate(el => JSON.parse(el.dataset.sceneMarks ?? '[]'));
  const camera = () => host.evaluate(el => ({ camera: el.dataset.camera, target: el.dataset.cameraTarget }));
  async function shot(name) { await page.screenshot({ path: `${directory}/${name}.png` }); report.screenshots.push(`${name}.png`); }
  async function start(kind, hold) {
    action = { kind, id: `marks_${++actionSerial}`, sent: false, hold };
    await page.getByTestId('local-draft').fill(`Fixture ${action.id}: ${kind} hypotheses.`); await page.getByTestId('send-local-draft').click();
  }
  async function run(kind) { await start(kind); await page.getByText(`${action.id} finished.`, { exact: true }).waitFor(); }
  assert.equal(await page.getByTestId('scene-mark-list').count(), 0); await shot('desktop-idle');
  const before = await camera(); let release;
  const held = new Promise(resolve => release = resolve); await start('create', held);
  await page.waitForFunction(() => document.querySelector('[data-testid="model-chat"]')?.dataset.state === 'streaming');
  await shot('desktop-inspecting'); release(); await page.getByText(`${action.id} finished.`, { exact: true }).waitFor();
  assert.equal((await live()).length, 2); assert.deepEqual(await camera(), before);
  const firstIds = (await live()).map(m => m.id); await shot('desktop-marked');
  await page.getByTestId('scene-mark-list').locator('summary').click();
  await page.getByTestId('scene-mark-2').click(); assert.notDeepEqual(await camera(), before);
  assert.equal(await page.getByTestId('scene-mark-2').getAttribute('aria-pressed'), 'true'); await shot('desktop-selected');
  await run('revise'); assert.deepEqual((await live()).map(m => m.id), [firstIds[1]]); const checkpoint = structuredClone(retained);
  await page.getByRole('button', { name: 'Semantic', exact: true }).click(); assert.equal((await live()).length, 1);
  await start('fail'); await page.waitForFunction(() => document.querySelector('[data-testid="model-chat"]')?.dataset.state === 'error');
  assert.deepEqual(await live(), []); await shot('desktop-failed');
  await run('read'); assert.deepEqual(retained, checkpoint); assert.equal((await live()).length, 1);
  report.checks.push('Real prepared binding; create/revise stable IDs; no automatic camera move; explicit focus; failed-turn cleanup and retained checkpoint rollback');
  await page.getByTestId('model-new-chat').click(); assert.deepEqual(await live(), []);
  assert.equal(await page.getByTestId('scene-mark-list').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await run('create'); assert.equal((await live()).length, 2); await shot('mobile-marked');
  const list = page.getByTestId('scene-mark-list');
  await page.getByRole('button', { name: 'Toggle chat' }).click(); await list.locator('summary').click();
  await page.getByTestId('scene-mark-1').click(); await shot('mobile-selected');
  assert.equal(await page.getByTestId('scene-mark-1').getAttribute('aria-pressed'), 'true');
  const box = await list.boundingBox(); assert(box.width <= 390 && box.x >= 0 && box.x + box.width <= 390);
  await page.getByLabel('STPLS3D scene').selectOption('stpls3d-2');
  await page.waitForFunction(() => document.querySelector('[data-testid="point-cloud-workspace"] .viewport')?.dataset.cloudId === 'stpls3d-2', null, { timeout: 90000 });
  assert.deepEqual(await live(), []); assert.equal(await list.count(), 0); await shot('mobile-source-replaced');
  report.checks.push('Desktop/mobile contextual accessible hypotheses; New chat clears; source replacement clears all source-bound marks');
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.error = String(error?.stack ?? error); throw error; }
finally {
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await context?.close(); await browser?.close(); await front?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve()));
}
