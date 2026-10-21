import test from 'node:test';
import { withProductSkills } from '../helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, canonicalModelScene, canonicalModelChatEvent, type ModelScene, type ModelChatEvent, type ModelTurnRequest } from '@spatial/contracts';
import type { SceneObjectSnapshot, SceneObjectProposal, AuthoredObjectReference } from '../../packages/contracts/src/scene-objects';
import { SceneObjectSession } from '../../apps/server/src/scene/scene-object-session';
import { PointOverrideSession } from '../../apps/server/src/scene/point-overrides';
import { TorontoCadSession } from '../../apps/server/src/cad/toronto-cad-session';
import { bindModelScene } from '../../apps/server/src/agent/model-scene';
import { createModelAgentRuntime } from '../../apps/server/src/agent/model-agent-runtime';
import { ModelBrowserBroker } from '../../apps/server/src/agent/model-browser-broker';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';
import { ProviderModel } from '../../apps/server/src/agent/provider-model';
const signal = new AbortController().signal;
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'model-objects-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(1000); payload.writeUInt16LE(1, 18); payload.writeFloatLE(6, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 1 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/octree.bin'), payload); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy);
  const points = new PointOverrideSession(root), cad = new TorontoCadSession(root), objects = new SceneObjectSession(root, points);
  t.after(async () => { await objects.close(); await points.close(); await cad.close(); await rm(root, { recursive: true, force: true }); });
  const s = await objects.execute('snapshot') as SceneObjectSnapshot;
  const scene: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: s.artifactRevision, key: { sourceFileId: 1, sourceRow: 0 }, position: [19, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  const editing = { points, cad, objects };
  const bind = async (next = scene) => { const b = await bindModelScene(next, root, signal, undefined, editing); t.after(() => b.close()); return b; };
  return { root, points, cad, objects, editing, s, scene, bind };
}
const decision = (p: SceneObjectProposal) => ({ sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision, proposalId: p.proposalId });
const ref = (s: SceneObjectSnapshot): AuthoredObjectReference => ({ kind: 'authored-object', sessionId: s.sessionId, revision: s.revision, objectId: s.objects[0].id, objectRevision: 1, frameId: s.frameId, units: s.units });
test('model scene authored references are Toronto-only, canonical, bounded and exact', async t => {
  const f = await fixture(t), b = await f.bind();
  const p = await b.proposePointCreate!({ name: 'A', input: { kind: 'position', position: [2, 3, 4] } }, signal);
  const s = await f.objects.execute('approve', decision(p)) as SceneObjectSnapshot;
  const selected = { ...f.scene, objects: [ref(s)] };
  assert.deepEqual(canonicalModelScene(selected), selected);
  for (const invalid of [{ ...selected, mode: 'demo' }, { ...selected, objects: [{ ...ref(s), extra: true }] }, { ...selected, objects: [ref(s), ref(s)] }, { ...selected, objects: Array(33).fill(ref(s)) }]) assert.throws(() => canonicalModelScene(invalid));
  const selectedBound = await f.bind(selected); await selectedBound.check();
  await assert.rejects(f.bind({ ...selected, objects: [{ ...ref(s), revision: 0 }] }), { code: 'stale-scene' });
  await assert.rejects(f.bind({ ...selected, objects: [{ ...ref(s), objectId: 'absent' }] }), { code: 'stale-scene' });
  assert.equal(canonicalModelScene({ mode: 'pole', toronto: [] }).objects, undefined);
});
test('object tools retain checked independent datums, bounded inspection and no fabricated source record', async t => {
  const f = await fixture(t), b = await f.bind();
  const p = await b.proposePointCreate!({ name: 'Source copy', input: { kind: 'source', pointName: 'Point 1', offset: [0, 2, 0] } }, signal);
  assert.deepEqual(p.object.position, [1, 2, 0], 'server rereads original; forged attachment coordinates ignored');
  assert.equal((await f.objects.execute('snapshot') as SceneObjectSnapshot).objects.length, 0);
  await assert.rejects(b.getObject!(p.object.id, signal), { code: 'unknown-object' });
  await f.objects.execute('approve', decision(p)); await assert.rejects(b.check(), { code: 'stale-scene' });
  const next = await f.bind(), got = await next.getObject!(p.object.id, signal) as { reference: AuthoredObjectReference };
  assert.equal(got.reference.objectId, p.object.id);
  const copy = await next.proposePointCreate!({ name: 'Datum copy', input: { kind: 'object', objectId: p.object.id, offset: [1, 0, 0] } }, signal);
  assert.deepEqual(copy.object.position, [2, 2, 0]);
  assert.deepEqual(await next.listObjects!({ offset: 0, limit: 1 }, signal), { total: 1, offset: 0, objects: [p.object], nextOffset: null });
  await assert.rejects(next.listObjects!({ offset: 0, limit: 33 }, signal));
  assert.equal(JSON.stringify(copy).includes('sourceRow'), false);
  const move = await next.proposePointMove!({ pointNames: ['Point 1'], translation: [0, 1, 0] }, signal).catch(() => undefined);
  // Forged source attachment remains rejected by source-move tool, not promoted to authority.
  assert.equal(move, undefined);
});
test('runtime observes object receipts, rebinds selected refs, rejects unrelated owner changes', async t => {
  const f = await fixture(t), b = await f.bind();
  const first = await b.proposePointCreate!({ name: 'A', input: { kind: 'position', position: [1, 2, 3] } }, signal);
  const s = await f.objects.execute('approve', decision(first)) as SceneObjectSnapshot;
  const scene = { ...f.scene, objects: [ref(s)] }, current = await f.bind(scene);
  const call: ModelTurnRequest = { requestId: 'req', conversationId: null, generation: 'generation', model: 'test', text: 'create', scene };
  const browser = new ModelBrowserBroker('req', signal, async () => undefined);
  const runtime = createModelAgentRuntime(call, current, f.root, signal, browser, f.editing); t.after(() => runtime.close());
  const second = await runtime.proposePointCreate!({ name: 'B', input: { kind: 'object', objectId: first.object.id, offset: [1, 0, 0] } }, signal);
  await f.objects.execute('approve', decision(second));
  const result = await runtime.waitForApproval!('objects', second.proposalId);
  assert.equal(result.outcome, 'accepted'); assert.equal(result.scene.objects![0].revision, 2); await runtime.check();
  const third = await runtime.proposePointCreate!({ name: 'C', input: { kind: 'position', position: [0, 0, 0] } }, signal);
  await f.objects.execute('decline', decision(third));
  assert.equal((await runtime.waitForApproval!('objects', third.proposalId)).outcome, 'declined'); await runtime.check();
  const fourth = await runtime.proposePointCreate!({ name: 'D', input: { kind: 'position', position: [0, 0, 0] } }, signal);
  const cad = await runtime.proposeCad!({ kind: 'box', center: [2, 2, 2], dimensions: [1, 1, 1] }, signal) as { sessionId: string; revision: number; artifactRevision: string; proposalId: string };
  await f.cad.execute('approve', { sessionId: cad.sessionId, revision: cad.revision, artifactRevision: cad.artifactRevision, proposalId: cad.proposalId }); await f.objects.execute('approve', decision(fourth));
  await assert.rejects(runtime.waitForApproval!('objects', fourth.proposalId), { code: 'stale-scene' });
});
test('provider rejects malformed object inputs and approval tools before dispatch', async t => {
  const f = await fixture(t), bound = await f.bind(), auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture' });
  let output: unknown[] = [], attempts = 0;
  const model = new ProviderModel(auth, withProductSkills(async url => String(url).endsWith('/models') ? Response.json({ data: [{ id: 'test' }] }) : new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }), ['scene-objects']));
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal);
  const guarded = { ...bound, async proposePointCreate(): Promise<SceneObjectProposal> { attempts++; throw new Error('not dispatched'); }, async listObjects() { attempts++; return {}; }, async getObject() { attempts++; return {}; } };
  for (const [name, args] of [
    ['propose_point_create', { name: 'A', input: { kind: 'position', position: [1, 2] } }],
    ['propose_point_create', { name: 'A', input: { kind: 'position', position: [1, 2, 3], sourceRow: 0 } }],
    ['propose_point_create', { name: 'A', input: { kind: 'object', objectId: 'a', offset: [1, 2, 3] }, revision: 0 }],
    ['propose_point_create', { name: 'A', input: { kind: 'source', pointName: 'Point 1', offset: [1, 2] } }],
    ['list_objects', { offset: 0, limit: 33 }], ['get_object', { objectId: 'a', sessionId: 'forged' }], ['approve', {}], ['undo', {}],
  ] as const) {
    output = [{ type: 'function_call', namespace: 'scene', name, call_id: 'bad', arguments: JSON.stringify(args) }];
    await assert.rejects(model.turn({ requestId: 'req', conversationId: null, generation: catalog.generation, model: 'test', text: 'create', scene: f.scene }, guarded, async () => undefined, signal));
  }
  assert.equal(attempts, 0); assert.equal((await f.objects.execute('snapshot') as SceneObjectSnapshot).proposals.length, 0);
});
test('provider advertises strict object tools, emits exact candidate and observes human approval without approval tool', async t => {
  const f = await fixture(t), bound = await f.bind();
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture' });
  const requests: Record<string, unknown>[] = [];
  const calls = [
    [{ type: 'function_call', namespace: 'scene', name: 'propose_point_create', call_id: 'create', arguments: JSON.stringify({ name: 'A', input: { kind: 'position', position: [2, 3, 4] } }) }],
    [{ type: 'function_call', namespace: 'scene', name: 'list_objects', call_id: 'list', arguments: JSON.stringify({ offset: 0, limit: 32 }) }], [],
  ];
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test' }] });
    requests.push(JSON.parse(String(init?.body)));
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: calls.shift() ?? [] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['scene-objects']));
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal), call: ModelTurnRequest = { requestId: 'req', conversationId: null, generation: catalog.generation, model: 'test', text: 'create A', scene: f.scene };
  const runtime = createModelAgentRuntime(call, bound, f.root, signal, new ModelBrowserBroker('req', signal, async () => undefined), f.editing);
  t.after(() => runtime.close());
  const events: ModelChatEvent[] = [];
  await model.turn(call, runtime, async event => {
    events.push(canonicalModelChatEvent(event));
    if (event.kind === 'tool' && event.name === 'propose_point_create') await f.objects.execute('approve', decision((event.context as { proposal: SceneObjectProposal }).proposal));
  }, signal);
  const tools = (requests[0].tools as { tools: { name: string; strict: boolean }[] }[])[0].tools;
  assert.ok(['list_objects', 'get_object', 'propose_point_create'].every(name => tools.some(tool => tool.name === name && tool.strict)));
  assert.ok(!tools.some(tool => /approve|decline|undo/.test(tool.name)));
  assert.ok(events.some(event => event.kind === 'approval-result' && event.authority === 'objects' && event.outcome === 'accepted'));
  assert.equal((await f.objects.execute('snapshot') as SceneObjectSnapshot).objects.length, 1);
  assert.ok(JSON.stringify(requests[1]).includes('humanDecision'));
});
