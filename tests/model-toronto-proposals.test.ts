import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, canonicalModelChatEvent, type ModelChatEvent, type ModelScene, type ModelTurnRequest, type PointMoveProposal, type PointOverrideSnapshot, type TorontoCadSnapshot, type ModelVisualObservation } from '@spatial/contracts';
import { bindModelScene } from '../apps/server/src/model-scene';
import { ProjectSession } from '../apps/server/src/project-session';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { ProviderModel, type BoundModelScene } from '../apps/server/src/provider-model';

const signal = () => new AbortController().signal;
const tool = (name: string, args: unknown) => ({ type: 'function_call', namespace: 'scene', name, call_id: `call_${name}`, arguments: JSON.stringify(args) });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const advertised = (body: Record<string, unknown>) => (body.tools as { tools: { name: string }[] }[])[0].tools.map(t => t.name);
const toolEvents = (events: ModelChatEvent[]) => events.filter((e): e is Extract<ModelChatEvent, { kind: 'tool' }> => e.kind === 'tool');
async function dataset(t: { after(fn: () => unknown): void }, multiple = false) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-model-toronto-'));
  const count = multiple ? 4 : 1;
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: count, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28 * count);
  for (let i = 0; i < count; i++) {
    payload.writeInt32LE((multiple ? [1000, 10000, 1, 12000][i] : 1000), i * 28);
    payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20);
    payload.writeFloatLE(multiple && i < 2 ? 0 : 6, i * 28 + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(count, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? count : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const points = new PointOverrideSession(root), cad = new TorontoCadSession(root), project = new ProjectSession(join(root, 'project.json'));
  t.after(async () => { await points.close(); await cad.close(); await rm(root, { recursive: true, force: true }); });
  const state = await points.execute('snapshot') as PointOverrideSnapshot;
  let scene: ModelScene = { mode: 'toronto', project: null, toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: state.artifactRevision,
    key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  if (multiple) scene = { ...scene, toronto: [...scene.toronto, { ...scene.toronto[0], name: 'Point 2', key: { sourceFileId: 1, sourceRow: 1 }, position: [10, 0, 0] }] };
  const bind = async (s = scene) => { const bound = await bindModelScene(s, project, root, signal(), undefined, { points, cad }); t.after(() => bound.close()); return bound; };
  return { root, points, cad, project, state, scene, bind };
}
async function provider(t: { after(fn: () => unknown): void }) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'synthetic-only' });
  const requests: Record<string, unknown>[] = [], outputs: unknown[][] = [];
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test-model' }] });
    requests.push(JSON.parse(String(init?.body))); return sse(outputs.shift() ?? []);
  });
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal());
  const run = async (scene: ModelScene, bound: BoundModelScene) => {
    const call: ModelTurnRequest = { requestId: 'request', conversationId: null, generation: catalog.generation, model: 'test-model', text: 'Propose a change', scene };
    const events: ModelChatEvent[] = []; await model.turn(call, bound, async event => { events.push(canonicalModelChatEvent(event)); }, signal()); return events;
  };
  return { requests, outputs, run };
}

test('Toronto box/cylinder tools work without attached points, return metadata only, and leave actual kernel candidates pending', async t => {
  const f = await dataset(t), p = await provider(t), scene = { ...f.scene, toronto: [] }, bound = await f.bind(scene);
  const syntheticBefore = f.project.snapshot();
  p.outputs.push([tool('propose_cad_box', { center: [3, 4, 5], dimensions: [2, 4, 6] }), tool('propose_cad_cylinder', { center: [7, 8, 9], radius: 2, height: 3 })], []);
  const events = toolEvents(await p.run(scene, bound));
  assert.deepEqual(advertised(p.requests[0]), ['inspect_scene', 'propose_cad_box', 'propose_cad_cylinder']);
  assert.deepEqual(events.map(e => e.name), ['propose_cad_box', 'propose_cad_cylinder']);
  for (const event of events) {
    const context = event.context as { status: string; proposal: { validation: { valid: boolean; volume: number }; mesh?: unknown; frameId: string } };
    assert.equal(context.status, 'pending'); assert.equal(context.proposal.mesh, undefined); assert.equal(context.proposal.frameId, 'toronto3d-local-v1');
    assert.equal(context.proposal.validation.valid, true); assert.ok(context.proposal.validation.volume > 0);
    assert.equal(JSON.stringify(context).includes('triangles'), false);
  }
  const snapshot = await f.cad.execute('snapshot') as TorontoCadSnapshot;
  assert.equal(snapshot.bodies.length, 0); assert.equal(snapshot.revision, 0); assert.equal(snapshot.proposals.length, 2);
  assert.ok(snapshot.proposals.every(proposal => proposal.mesh.triangles.length > 0));
  assert.deepEqual(f.project.snapshot(), syntheticBefore);
  const replay = p.requests[1].input as { type?: string; output?: string }[];
  assert.deepEqual(replay.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output!)), events.map(e => e.context));
  await bound.close();
  const proposal = snapshot.proposals[0];
  const accepted = await f.cad.execute('approve', { sessionId: snapshot.sessionId, revision: snapshot.revision, artifactRevision: snapshot.artifactRevision, proposalId: proposal.proposalId }) as TorontoCadSnapshot;
  assert.equal(accepted.bodies[0].bodyId, proposal.bodyId); assert.equal(accepted.revision, 1);
});

test('named point move reuses shared authority, independently rejects forged original records, and safely resolves effective overrides', async t => {
  const f = await dataset(t), p = await provider(t), bound = await f.bind();
  p.outputs.push([tool('propose_point_move', { pointNames: ['Point 1'], translation: [0, 2, 0] })], []);
  const events = toolEvents(await p.run(f.scene, bound)); assert.equal(events[0].name, 'propose_point_move');
  const proposal = (events[0].context as { proposal: PointMoveProposal }).proposal;
  assert.deepEqual(proposal.moves[0].before, [1, 0, 0]); assert.deepEqual(proposal.moves[0].after, [1, 2, 0]);
  assert.equal((await f.points.execute('snapshot') as PointOverrideSnapshot).revision, 0);
  assert.equal((await f.points.execute('pending') as PointMoveProposal[])[0].proposalId, proposal.proposalId);
  await f.points.execute('approve', { sessionId: proposal.sessionId, revision: proposal.revision, proposalId: proposal.proposalId });
  await assert.rejects(bound.check(), { code: 'stale-scene' });
  const next = await f.bind();
  const moved = await next.proposePointMove!({ pointNames: ['Point 1'], translation: [0, 1, 0] }, signal());
  assert.deepEqual(moved.moves[0].originalPosition, [1, 0, 0]); assert.deepEqual(moved.moves[0].before, [1, 2, 0]); assert.deepEqual(moved.moves[0].after, [1, 3, 0]);
  const forged = await f.bind({ ...f.scene, toronto: [{ ...f.scene.toronto[0], position: [9, 0, 0] }] });
  await assert.rejects(forged.proposePointMove!({ pointNames: ['Point 1'], translation: [0, 1, 0] }, signal()), { code: 'invalid-point-proposal' });
  const fresh = new PointOverrideSession(f.root); t.after(() => fresh.close());
  const bad = await bindModelScene({ ...f.scene, toronto: [{ ...f.scene.toronto[0], position: [9, 0, 0] }] }, f.project, f.root, signal(), undefined, { points: fresh, cad: f.cad }); t.after(() => bad.close());
  await assert.rejects(bad.proposePointMove!({ pointNames: ['Point 1'], translation: [0, 1, 0] }, signal()), { code: 'position-mismatch' });
});

test('Toronto strict tools reject malformed arguments, model-selected keys, bindings, extra fields, and approval calls before dispatch', async t => {
  const f = await dataset(t), p = await provider(t), bound = await f.bind(); let attempts = 0;
  const guarded: BoundModelScene = { ...bound, async proposePointMove() { attempts++; throw new Error('must not dispatch'); }, async proposeCad() { attempts++; throw new Error('must not dispatch'); } };
  for (const [name, args] of [
    ['propose_point_move', { pointNames: ['Point 99'], translation: [1, 0, 0] }],
    ['propose_point_move', { pointNames: ['Point 1', 'Point 1'], translation: [1, 0, 0] }],
    ['propose_point_move', { pointNames: ['Point 1'], translation: [0, 0, 0] }],
    ['propose_point_move', { pointNames: ['Point 1'], translation: [1, 0] }],
    ['propose_point_move', { pointNames: ['Point 1'], translation: [1, 0, 0], key: { sourceRow: 0 } }],
    ['propose_cad_box', { center: [1, 2, 3], dimensions: [1, -1, 2] }],
    ['propose_cad_box', { center: [1, 2, 3], dimensions: [1, 1, 2], sessionId: 'forged' }],
    ['propose_cad_cylinder', { center: [1, 2], radius: 1, height: 2 }],
    ['propose_cad_cylinder', { center: [1, 2, 3], radius: 0, height: 2 }],
    ['propose_cad_cylinder', { center: [1001, 2, 3], radius: 1, height: 2 }],
    ['approve', {}], ['approve_point_move', {}], ['approve_cad', {}], ['decline', {}], ['undo', {}],
  ] as const) {
    p.outputs.push([tool(name, args)]); await assert.rejects(p.run(f.scene, guarded));
  }
  assert.equal(attempts, 0);
  assert.equal((await f.points.execute('pending') as PointMoveProposal[]).length, 0);
  assert.equal((await f.cad.execute('snapshot') as TorontoCadSnapshot).proposals.length, 0);
  for (const mode of ['demo', 'pole'] as const) {
    const scene: ModelScene = { mode, project: null, toronto: [] };
    p.outputs.push([tool('propose_cad_box', { center: [0, 0, 0], dimensions: [1, 1, 1] })]);
    await assert.rejects(p.run(scene, guarded), { code: 'unsupported-tool' });
    assert.deepEqual(advertised(p.requests.at(-1)!), ['inspect_scene']);
  }
});

test('image admission refuses pending point ghosts and accepted Toronto CAD bodies', async t => {
  const f = await dataset(t), bound = await f.bind();
  // Image decoding/hash/shape is validated separately before bindModelScene.
  const visual = { binding: { sourceRevision: f.state.artifactRevision } } as ModelVisualObservation;
  const proposal = await bound.proposePointMove!({ pointNames: ['Point 1'], translation: [0, 1, 0] }, signal());
  await assert.rejects(bindModelScene(f.scene, f.project, f.root, signal(), visual, { points: f.points, cad: f.cad }), { code: 'edited-scene-capture-unavailable' });
  await f.points.execute('decline', { sessionId: proposal.sessionId, revision: proposal.revision, proposalId: proposal.proposalId });
  const cadProposal = await bound.proposeCad!({ kind: 'box', center: [2, 2, 2], dimensions: [1, 1, 1] }, signal()) as { sessionId: string; revision: number; artifactRevision: string; proposalId: string };
  await assert.rejects(bindModelScene(f.scene, f.project, f.root, signal(), visual, { points: f.points, cad: f.cad }), { code: 'edited-scene-capture-unavailable' });
  await f.cad.execute('approve', { sessionId: cadProposal.sessionId, revision: cadProposal.revision, artifactRevision: cadProposal.artifactRevision, proposalId: cadProposal.proposalId });
  await assert.rejects(bindModelScene(f.scene, f.project, f.root, signal(), visual, { points: f.points, cad: f.cad }), { code: 'edited-scene-capture-unavailable' });
});

test('closed, cancelled, stale CAD revision and replaced artifacts fail closed before new proposal retention', async t => {
  const f = await dataset(t), bound = await f.bind(), operation = { kind: 'box' as const, center: [2, 2, 2] as const, dimensions: [1, 1, 1] as const };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(bound.proposeCad!(operation, controller.signal));
  const proposed = await bound.proposeCad!(operation, signal()) as { sessionId: string; revision: number; artifactRevision: string; proposalId: string };
  await f.cad.execute('approve', { sessionId: proposed.sessionId, revision: proposed.revision, artifactRevision: proposed.artifactRevision, proposalId: proposed.proposalId });
  await assert.rejects(bound.proposeCad!(operation, signal()), { code: 'stale-scene' });
  const next = await f.bind(); await next.close();
  await assert.rejects(next.proposeCad!(operation, signal()), { code: 'stale-scene' });
  const artifactBound = await f.bind(); await writeFile(join(f.root, 'manifest.json'), '{}');
  await assert.rejects(artifactBound.proposeCad!(operation, signal()));
});

for (const sequential of [false, true]) test(`two respective nearest-pole moves (${sequential ? 'sequential' : 'same-round'}) retain verified exact destinations and survive separate approvals`, async t => {
  const f = await dataset(t, true), p = await provider(t), bound = await f.bind();
  const calls = ['Point 1', 'Point 2'].map((pointName, i) => ({ ...tool('propose_point_move_to_nearest_label', { pointName, label: 6 }), call_id: `nearest_move_${i}` }));
  p.outputs.push(...(sequential ? calls.map(call => [call]) : [calls]), []);
  const events = toolEvents(await p.run(f.scene, bound));
  assert.deepEqual(events.map(e => e.name), ['propose_point_move_to_nearest_label', 'propose_point_move_to_nearest_label']);
  const proposals = events.map(e => (e.context as { proposal: PointMoveProposal }).proposal);
  assert.deepEqual(proposals.map(p => p.moves[0].before), [[1, 0, 0], [10, 0, 0]]);
  assert.deepEqual(proposals.map(p => p.moves[0].after), [[.001, 0, 0], [12, 0, 0]]);
  assert.notEqual(1 + (.001 - 1), .001, 'fixture exercises exact destination rather than rounded translation reconstruction');
  for (const event of events) {
    const context = event.context as { nearest: { outcome: { status: string; nearest: { position: number[] } } }; proposal: PointMoveProposal };
    assert.equal(context.nearest.outcome.status, 'verified-found');
    assert.deepEqual(context.proposal.moves[0].after, context.nearest.outcome.nearest.position);
  }
  assert.equal((await f.points.execute('snapshot') as PointOverrideSnapshot).revision, 0);
  const one = await f.points.execute('approve', { sessionId: f.state.sessionId, revision: 0, proposalId: proposals[0].proposalId }) as PointOverrideSnapshot;
  assert.equal(one.entries.length, 1);
  const remaining = await f.points.execute('pending') as PointMoveProposal[];
  assert.equal(remaining.length, 1); assert.equal(remaining[0].revision, 1);
  assert.equal(remaining[0].proposalId, proposals[1].proposalId); assert.deepEqual(remaining[0].moves, proposals[1].moves);
  // Old revision is still rejected, even though the disjoint exact proposal survives.
  await assert.rejects(f.points.execute('approve', { sessionId: one.sessionId, revision: 0, proposalId: remaining[0].proposalId }), { code: 'stale-revision' });
  const two = await f.points.execute('approve', { sessionId: one.sessionId, revision: one.revision, proposalId: remaining[0].proposalId }) as PointOverrideSnapshot;
  assert.equal(two.revision, 2); assert.deepEqual(two.entries.map(e => e.position), [[.001, 0, 0], [12, 0, 0]]);
  const undone = await f.points.execute('undo', { sessionId: two.sessionId, revision: two.revision, transactionId: two.nextUndoTransactionId }) as PointOverrideSnapshot;
  assert.deepEqual(undone.entries, one.entries);
  await assert.rejects(bound.check(), { code: 'stale-scene' });
});

test('nearest-move tool rejects model coordinates and unknown points before dispatch and fails closed on absent labels', async t => {
  const f = await dataset(t, true), p = await provider(t), bound = await f.bind(); let dispatched = 0;
  const guarded: BoundModelScene = { ...bound, async proposeNearestPointMove() { dispatched++; throw new Error('must not dispatch'); } };
  for (const args of [{ pointName: 'Point 1', label: 6, destination: [9, 0, 0] }, { pointName: 'Point 99', label: 6 }, { pointName: 'Point 1', label: 9 }]) {
    p.outputs.push([tool('propose_point_move_to_nearest_label', args)]);
    await assert.rejects(p.run(f.scene, guarded), { code: 'invalid-point-proposal' });
  }
  assert.equal(dispatched, 0);
  await assert.rejects(bound.proposeNearestPointMove!({ pointName: 'Point 1', label: 8 }, signal()), { code: 'nearest-destination-unavailable' });
  assert.deepEqual(await f.points.execute('pending'), []);
  // Attachment coordinates do not influence the original-source query or destination.
  const forgedScene = { ...f.scene, toronto: [{ ...f.scene.toronto[0], position: [19, 0, 0] as const }] };
  const forged = await f.bind(forgedScene);
  const exact = await forged.proposeNearestPointMove!({ pointName: 'Point 1', label: 6 }, signal());
  assert.equal(exact.status, 'pending');
  assert.ok(exact.proposal);
  assert.deepEqual(exact.proposal.moves[0].before, [1, 0, 0]); assert.deepEqual(exact.proposal.moves[0].after, [.001, 0, 0]);
});

test('nearest move of an original Pole to itself returns verified no-change without a pending proposal', async t => {
  const f = await dataset(t), p = await provider(t);
  // The attachment is not trusted as the original/effective position, even on no-op.
  const scene = { ...f.scene, toronto: [{ ...f.scene.toronto[0], position: [19, 0, 0] as const }] };
  const bound = await f.bind(scene);
  p.outputs.push([tool('propose_point_move_to_nearest_label', { pointName: 'Point 1', label: 6 })], []);
  const all = await p.run(scene, bound), events = toolEvents(all);
  assert.equal(all.at(-1)?.kind, 'done');
  assert.equal(events.length, 1);
  const context = events[0].context as { kind: string; status: string; proposal?: unknown; nearest: { outcome: { status: string; queryPosition: number[]; nearest: { position: number[] } } } };
  assert.equal(context.kind, 'toronto-point-move-proposal'); assert.equal(context.status, 'no-change');
  assert.equal(Object.hasOwn(context, 'proposal'), false);
  assert.equal(context.nearest.outcome.status, 'verified-found');
  assert.deepEqual(context.nearest.outcome.queryPosition, [1, 0, 0]);
  assert.deepEqual(context.nearest.outcome.nearest.position, [1, 0, 0]);
  assert.deepEqual(await f.points.execute('pending'), []);
  assert.deepEqual(await f.points.execute('snapshot'), f.state);
  const replay = p.requests[1].input as { type?: string; output?: string }[];
  assert.deepEqual(replay.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output!)), [context]);
});

for (const sequential of [false, true]) test(`already approved nearest move is no-change and allows another actual move (${sequential ? 'sequential' : 'same-round'})`, async t => {
  const f = await dataset(t, true), initial = await f.bind();
  const first = await initial.proposeNearestPointMove!({ pointName: 'Point 1', label: 6 }, signal());
  assert.ok(first.proposal);
  const approved = await f.points.execute('approve', { sessionId: first.proposal.sessionId, revision: first.proposal.revision,
    proposalId: first.proposal.proposalId }) as PointOverrideSnapshot;
  const p = await provider(t), bound = await f.bind();
  const calls = ['Point 1', 'Point 2'].map((pointName, i) => ({ ...tool('propose_point_move_to_nearest_label', { pointName, label: 6 }), call_id: `repeat_${i}` }));
  p.outputs.push(...(sequential ? calls.map(call => [call]) : [calls]), []);
  const all = await p.run(f.scene, bound), events = toolEvents(all);
  assert.equal(all.at(-1)?.kind, 'done');
  assert.equal(events.length, 2);
  const noChange = events[0].context as { status: string; proposal?: unknown; nearest: { outcome: { status: string; queryPosition: number[]; nearest: { position: number[] } } } };
  assert.equal(noChange.status, 'no-change'); assert.equal(Object.hasOwn(noChange, 'proposal'), false);
  assert.equal(noChange.nearest.outcome.status, 'verified-found');
  assert.deepEqual(noChange.nearest.outcome.queryPosition, [1, 0, 0], 'search still independently uses original source, not the approved override');
  assert.deepEqual(noChange.nearest.outcome.nearest.position, [.001, 0, 0]);
  const changed = events[1].context as { status: string; proposal: PointMoveProposal };
  assert.equal(changed.status, 'pending');
  assert.deepEqual(changed.proposal.moves[0].before, [10, 0, 0]);
  assert.deepEqual(changed.proposal.moves[0].after, [12, 0, 0]);
  assert.deepEqual(await f.points.execute('pending'), [changed.proposal]);
  assert.deepEqual(await f.points.execute('snapshot'), approved, 'neither call publishes a mutation');
  const replay = p.requests.at(-1)!.input as { type?: string; output?: string }[];
  assert.deepEqual(replay.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output!)), events.map(e => e.context));
});
