import test from 'node:test';
import { withProductSkills, isWorkflowTool } from './helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, type ModelScene, type ModelChatEvent, type ModelTurnRequest } from '@spatial/contracts';
import { bindModelScene } from '../apps/server/src/model-scene';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { preparePoleIndex, dropPoleIndexMemoryCache } from '../apps/server/src/pole-index';
import { ProviderModel, ModelError, type BoundModelScene } from '../apps/server/src/provider-model';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { validateModelEvent } from '../apps/web/src/model-chat-client';

const signal = () => new AbortController().signal;
async function dataset(t: { after(fn: () => unknown): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-model-nearest-')));
  await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 3, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, 110], max: [10, 10, 130] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, 110], max: [10, 10, 130] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(84);
  [0, 1, 8].forEach((x, row) => {
    payload.writeInt32LE(x * 1000, row * 28); payload.writeUInt16LE(1, row * 28 + 18);
    payload.writeUInt32LE(row, row * 28 + 20); payload.writeFloatLE(row ? 6 : 1, row * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(3, 2); hierarchy.writeBigUInt64LE(84n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0],
    potree_scale_m: [.001, .001, .001], semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 3 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root); const revision = snapshot.dataset.revision; await snapshot.close();
  const prep = await preparePoleIndex(root);
  t.after(async () => { dropPoleIndexMemoryCache(); await rm(root, { recursive: true, force: true }); await rm(prep.directory, { recursive: true, force: true }); });
  const scene: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: revision,
    key: { sourceFileId: 1, sourceRow: 0 }, position: [9, 0, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  return { root, scene, bound: await bindModelScene(scene, root, signal()) };
}
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const tool = (args: unknown, name = 'nearest_label', call_id = 'nearest_call') => ({ type: 'function_call', name, namespace: 'scene', call_id, arguments: JSON.stringify(args) });
async function provider(t: { after(fn: () => unknown): void }, scene: ModelScene, bound: BoundModelScene, output: unknown[]) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'synthetic-only' });
  const bodies: Record<string, unknown>[] = []; const events: ModelChatEvent[] = []; let round = 0;
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test-model' }] });
    bodies.push(JSON.parse(String(init?.body)));
    return sse(round++ === 0 ? output : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Found original point.' }] }]);
  }, ['scene-inspection']));
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal());
  const call: ModelTurnRequest = { requestId: 'nearest-request', conversationId: null, generation: catalog.generation, model: 'test-model', text: 'Find nearest Pole to Point 1', scene };
  return { bodies, events, call, run: (abort = signal()) => model.turn(call, bound, async event => { events.push(validateModelEvent(event, call)); }, abort) };
}

test('live nearest-label returns full verified lineage, resolves original source instead of attachment position, and replays result', async t => {
  const f = await dataset(t); t.after(() => f.bound.close());
  const p = await provider(t, f.scene, f.bound, [tool({ pointName: 'Point 1', label: 6 })]); await p.run();
  const event = p.events.find(e => isWorkflowTool(e)); assert.ok(event?.kind === 'tool'); assert.equal(event.name, 'nearest_label');
  const context = event.context as Awaited<ReturnType<NonNullable<BoundModelScene['nearestLabel']>>>;
  assert.equal(context.searchGeometry, 'original-prepared-dataset'); assert.equal(context.pointName, 'Point 1');
  assert.deepEqual(context.request.input, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } });
  assert.equal(context.outcome.status, 'verified-found');
  if (context.outcome.status !== 'verified-found') assert.fail('Expected verified point');
  assert.deepEqual(context.outcome.queryPosition, [0, 0, 120]); assert.equal(context.outcome.nearest?.key.sourceRow, 1);
  assert.equal(context.outcome.search.algorithm, 'semantic-disk-page-index-v1');
  assert.equal(context.outcome.verification.verifier, 'semantic-disk-page-verifier-v1');
  assert.deepEqual(context.outcome.request, context.request); assert.ok(context.outcome.dataset.revision);
  const tools = p.bodies[0].tools as { tools: { name: string }[] }[];
  assert.deepEqual(tools[0].tools.map(tool => tool.name), ['list_skills', 'load_skill', 'get_scene_marks', 'set_scene_marks', 'query_points', 'ground_elevation', 'inspect_scene', 'nearest_label']);
  const replay = p.bodies[1].input as { type?: string; output?: string }[];
  assert.deepEqual(JSON.parse(replay.find(item => item.type === 'function_call_output' && !JSON.parse(item.output!).kind?.startsWith('runtime-skill'))!.output!), context);
  assert.equal(p.events.at(-1)?.kind, 'done');
});

test('verified-none and cancellation/stale artifact are preserved, not invented winners', async t => {
  const f = await dataset(t); t.after(() => f.bound.close());
  const empty = await f.bound.nearestLabel!({ pointName: 'Point 1', label: 8 }, signal());
  assert.equal(empty.outcome.status, 'verified-none');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.bound.nearestLabel!({ pointName: 'Point 1', label: 6 }, controller.signal));
  await assert.rejects(f.bound.nearestLabel!({ pointName: 'Point 99', label: 6 }, signal()));
  await writeFile(join(f.root, 'manifest.json'), '{}');
  await assert.rejects(f.bound.nearestLabel!({ pointName: 'Point 1', label: 6 }, signal()));
});

for (const args of [{ pointName: 'Point 99', label: 6 }, { pointName: 'Point 1', label: -1 }, { pointName: 'Point 1', label: 9 },
  { pointName: 'Point 1', label: 1.5 }, { pointName: 'Point 1', label: '6' }, { pointName: 'Point 1' },
  { pointName: 'Point 1', label: 6, sourceRow: 0 }]) test(`strict nearest-label arguments: ${JSON.stringify(args)}`, async t => {
  const scene: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 },
    position: [0, 0, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  let invoked = false;
  const bound: BoundModelScene = { context: {}, async check() {}, async close() {}, async nearestLabel() { invoked = true; throw new Error('Must not execute'); } };
  const p = await provider(t, scene, bound, [tool(args)]);
  await assert.rejects(p.run(), e => e instanceof ModelError && e.code === 'invalid-nearest-label'); assert.equal(invoked, false);
  assert.equal(p.events.some(e => isWorkflowTool(e)), false);
});

for (const mode of ['pole', 'toronto'] as const) test(`nearest-label is unavailable without active bound Toronto names: ${mode}`, async t => {
  const bound: BoundModelScene = { context: {}, async check() {}, async close() {}, async nearestLabel() { throw new Error('Must not execute'); } };
  const p = await provider(t, { mode, toronto: [] }, bound, [tool({ pointName: 'Point 1', label: 6 })]);
  await assert.rejects(p.run(), e => e instanceof ModelError && e.code === 'unsupported-tool');
  assert.equal(JSON.stringify(p.bodies[0].tools).includes('nearest_label'), false);
});

test('model cannot invoke mutation tools', async t => {
  const bound: BoundModelScene = { context: {}, async check() {}, async close() {} };
  const p = await provider(t, { mode: 'toronto', toronto: [] }, bound, [tool({}, 'move_point')]);
  await assert.rejects(p.run(), e => e instanceof ModelError && e.code === 'unsupported-tool');
});
