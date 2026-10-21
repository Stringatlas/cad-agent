import assert from 'node:assert/strict';
import test from 'node:test';
import { withProductSkills } from './helpers/product-skill-transport';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, canonicalModelChatEvent, type ModelScene, type ModelTurnRequest, type Vec3, type PointOverrideSnapshot, type PointMoveProposal, type TorontoCadSnapshot, type TorontoCadProposal } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache, pagePoints } from '../apps/server/src/semantic-disk-index';
import { SpatialPageIndex } from '../apps/server/src/spatial-page-index';
import { assessUtilityBox, type UtilityBoxAssessment } from '../apps/server/src/utility-box-placement';
import { bindModelScene } from '../apps/server/src/model-scene';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession, TorontoCadError } from '../apps/server/src/toronto-cad-session';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { ProviderModel } from '../apps/server/src/provider-model';
import { validateModelEvent } from '../apps/web/src/model-chat-client';

const signal = () => new AbortController().signal;
const args = { pointName: 'Point 1', dimensions: [1.2, .6, 1.5] as Vec3, frontAccessMeters: 1 };
async function fixture(t: { after(fn: () => unknown): void }, points: { xyz: Vec3; label: number }[] = [{ xyz: [1, 1, 0], label: 1 }]) {
  const root = await mkdtemp(join(tmpdir(), 'utility-placement-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 100] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 } ] };
  const payload = Buffer.alloc(points.length * 28);
  const oracle = points.map((p, i) => { const xyz = p.xyz.map((n, a) => { const raw = Math.round(n * 1000); payload.writeInt32LE(raw, i * 28 + a * 4); return raw * .001; }) as unknown as Vec3;
    payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24); return { xyz, label: p.label, row: i }; });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? points.length : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root), { index } = await getSemanticDiskIndex(snapshot), spatial = await SpatialPageIndex.create(snapshot, index);
  const terrainPath = join(root, 'terrain.json'), previous = process.env.SPATIAL_PREPROCESSING_PATH; process.env.SPATIAL_PREPROCESSING_PATH = terrainPath;
  const cells = Array.from({ length: 36 }, (_, i) => ({ x: i % 6 - 1, y: Math.floor(i / 6) - 1, points: 3, elevation: 0, maxElevation: 0 }));
  const terrain = { version: 'scene-preprocessing-v1', complete: true, binding: { datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: snapshot.dataset.coordinates, indexHash: index.hash, sourceHash: index.sourceHash,
    instanceManifestHash: 'a'.repeat(64), membershipHash: 'b'.repeat(64) }, instances: [], ground: { cellMeters: 1, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3, points: 108, cells } };
  const writeTerrain = () => writeFile(terrainPath, JSON.stringify(terrain)); await writeTerrain();
  const reference = { name: 'Point 1' as const, artifactRevision: snapshot.dataset.revision, key: { sourceFileId: 1, sourceRow: 0 }, position: oracle[0].xyz };
  const scene: ModelScene = { mode: 'toronto', toronto: [{ ...reference, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', ...snapshot.dataset.coordinates, localOrigin: [627285, 4841948, 0] }] };
  const pointsAuthority = new PointOverrideSession(root), cad = new TorontoCadSession(root);
  const bind = () => bindModelScene(scene, root, signal(), undefined, { points: pointsAuthority, cad });
  t.after(async () => { if (previous === undefined) delete process.env.SPATIAL_PREPROCESSING_PATH; else process.env.SPATIAL_PREPROCESSING_PATH = previous;
    await pointsAuthority.close(); await cad.close(); dropSemanticDiskIndexMemoryCache(); await snapshot.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  return { root, snapshot, index, spatial, oracle, terrain, writeTerrain, terrainPath, reference, scene, points: pointsAuthority, cad, bind };
}
test('exact inclusive box occupancy matches independent full oracle across pages, all labels, caps and boundaries', async t => {
  const raw = Array.from({ length: pagePoints * 3 + 7 }, (_, i) => ({ xyz: [((i * 71) % 199 - 99) * .01, ((i * 23) % 173 - 86) * .02, ((i * 11) % 113 - 56) * .03] as Vec3, label: i % 9 }));
  raw[0] = { xyz: [-.5, -.5, 0], label: 1 }; raw[1] = { xyz: [.5, .5, 1.5], label: 1 }; raw[2] = { xyz: [0, 0, .101], label: 2 };
  const f = await fixture(t, raw), bounds = { min: [-.5, -.5, 0] as Vec3, max: [.5, .5, 1.5] as Vec3 };
  const expected = f.oracle.filter(p => p.xyz.every((n, a) => n >= bounds.min[a] && n <= bounds.max[a]));
  const support = expected.filter(p => (p.label === 1 || p.label === 2) && p.xyz[2] <= .1);
  for (const cap of [0, 1, 12, 100]) {
    const result = await f.spatial.box(bounds, { maxResults: cap, supportMaxZ: .1 });
    assert.equal(result.totalCount, expected.length); assert.equal(result.supportingGroundCount, support.length); assert.equal(result.obstructionCount, expected.length - support.length);
    assert.deepEqual(result.countsByLabel, Array.from({ length: 9 }, (_, l) => expected.filter(p => p.label === l).length));
    assert.equal(result.truncated, result.obstructionCount > cap); assert.equal(result.points.length, Math.min(result.obstructionCount, cap));
    assert.ok(result.points.every(p => expected.some(e => e.row === p.source.sourceRow && !support.includes(e))));
    assert.equal(result.binding.indexHash, f.index.hash); assert.equal(result.binding.sourceHash, f.index.sourceHash);
  }
  await assert.rejects(f.spatial.box(bounds, { maxPages: 0 }), /page budget/);
  const stopped = new AbortController(); stopped.abort(); await assert.rejects(f.spatial.box(bounds, { signal: stopped.signal }));
  const original = f.index.readPage.bind(f.index); f.index.readPage = async (...a) => { await new Promise(r => setTimeout(r, 10)); return original(...a); };
  await assert.rejects(f.spatial.box(bounds, { maxMilliseconds: 1 }), /time budget/);
});
test('grounded assessment separates support, body and +Y access conflicts and never calls empty scan volume clear', async t => {
  const f = await fixture(t, [{ xyz: [1, 1, 0], label: 1 }, { xyz: [1, 1, .1], label: 2 }, { xyz: [1, 1, .101], label: 1 },
    { xyz: [1, 1, 1], label: 6 }, { xyz: [1, 2, .8], label: 7 }, { xyz: [1.61, 1, 1], label: 8 }]);
  const a = await assessUtilityBox(f.snapshot, f.reference, args, signal()); assert.equal(a.status, 'assessed'); if (a.status !== 'assessed') return;
  assert.deepEqual(a.operation.center, [1, 1, .75]); assert.equal(a.body.totalCount, 4); assert.equal(a.body.supportingGroundCount, 2); assert.equal(a.body.obstructionCount, 2);
  assert.equal(a.access!.obstructionCount, 1); assert.equal(a.finding, 'observed-conflicts'); assert.equal(a.binding.artifactRevision, f.snapshot.dataset.revision);
  const noAccess = await assessUtilityBox(f.snapshot, f.reference, { ...args, frontAccessMeters: 0 }, signal()); assert.equal(noAccess.status === 'assessed' && noAccess.access, null);
  await assert.rejects(assessUtilityBox(f.snapshot, { ...f.reference, position: [2, 1, 0] }, args, signal()), /mismatch/);
  await assert.rejects(assessUtilityBox(f.snapshot, f.reference, { ...args, dimensions: [0, 1, 1] }, signal()));
});
test('missing, sparse and unsupported terrain fail closed; sampled slope flags base preparation', async t => {
  const f = await fixture(t);
  const empty = await assessUtilityBox(f.snapshot, f.reference, args, signal()); assert.equal(empty.status === 'assessed' && empty.finding, 'no-observed-conflicts');
  for (const cell of f.terrain.ground.cells) cell.points = 2;
  f.terrain.ground.points = 72; await f.writeTerrain();
  const unsupported = await assessUtilityBox(f.snapshot, f.reference, args, signal());
  assert.equal(unsupported.status, 'unavailable'); assert.ok(unsupported.ground.some(g => g.result.status === 'unavailable' && g.result.reason === 'insufficient-support'));
  for (const cell of f.terrain.ground.cells) cell.points = 3;
  f.terrain.ground.points = 108;
  const hash = f.terrain.binding.indexHash; f.terrain.binding.indexHash = '0'.repeat(64); await f.writeTerrain();
  await assert.rejects(assessUtilityBox(f.snapshot, f.reference, args, signal()), /binding mismatch/);
  f.terrain.binding.indexHash = hash;
  for (const cell of f.terrain.ground.cells) { cell.elevation = cell.x * .25; cell.maxElevation = cell.elevation; }
  await f.writeTerrain(); const slope = await assessUtilityBox(f.snapshot, f.reference, args, signal()); assert.equal(slope.status === 'assessed' && slope.needsBasePreparation, true);
  f.terrain.ground.cells = []; f.terrain.ground.points = 0; await f.writeTerrain();
  assert.equal((await assessUtilityBox(f.snapshot, f.reference, args, signal())).status, 'unavailable');
  await rm(f.terrainPath); const bound = await f.bind(); t.after(() => bound.close());
  assert.equal((await bound.assessUtilityBox!(args, signal()) as { complete: boolean }).complete, false);
  await assert.rejects(bound.proposeUtilityBox!('a'.repeat(36), signal()), { code: 'placement-assessment-unavailable' });
});
test('model assessment → exact native ghost → human approval, no model acceptance; client dispatch and source binding', async t => {
  const f = await fixture(t), bound = await f.bind(); t.after(() => bound.close());
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' }); let round = 0;
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test-model' }] });
    const body = JSON.parse(String(init?.body)); const names = body.tools[0].tools.map((v: { name: string }) => v.name);
    assert.ok(names.includes('assess_utility_box')); assert.ok(names.includes('propose_utility_box')); assert.ok(!names.some((n: string) => n.includes('approve')));
    let output: unknown[] = [];
    if (round === 0) output = [{ type: 'function_call', namespace: 'scene', name: 'assess_utility_box', call_id: 'assess', arguments: JSON.stringify(args) }];
    if (round === 1) {
      const results = body.input.filter((i: { type?: string }) => i.type === 'function_call_output'); const assessment = JSON.parse(results.at(-1).output);
      assert.equal(assessment.status, 'assessed'); assert.equal(assessment.source.key.sourceRow, 0);
      output = [{ type: 'function_call', namespace: 'scene', name: 'propose_utility_box', call_id: 'propose', arguments: JSON.stringify({ assessmentId: assessment.assessmentId }) }];
    }
    round++; return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['utility-box-placement'])); t.after(() => { model.close(); auth.close(); }); const catalog = await model.models(signal());
  const call: ModelTurnRequest = { requestId: 'utility', conversationId: null, generation: catalog.generation, model: 'test-model', text: 'What would need to change to put a utility box at Point 1? Show a hypothetical box.', scene: f.scene };
  const events: unknown[] = []; await model.turn(call, bound, async e => { const event = canonicalModelChatEvent(e); validateModelEvent(event, call); events.push(event); }, signal());
  const pending = await f.cad.execute('snapshot') as TorontoCadSnapshot; assert.equal(pending.bodies.length, 0); assert.equal(pending.proposals.length, 1); assert.ok(pending.proposals[0].mesh.triangles.length);
  assert.deepEqual(pending.proposals[0].operation, { kind: 'box', center: [1, 1, .75], dimensions: args.dimensions });
  assert.equal(JSON.stringify(events).includes('triangles'), false);
  await bound.close(); // Retained approval check must survive the model turn.
  const accepted = await f.cad.execute('approve', { sessionId: pending.sessionId, revision: pending.revision, artifactRevision: pending.artifactRevision, proposalId: pending.proposals[0].proposalId }) as TorontoCadSnapshot;
  assert.equal(accepted.bodies[0].bodyId, pending.proposals[0].bodyId);
  const edited = await f.bind(); t.after(() => edited.close()); assert.equal((await edited.assessUtilityBox!(args, signal()) as { reason: string }).reason, 'edited-state-unsupported');
  await assert.rejects(edited.proposeUtilityBox!('a'.repeat(36), signal()), { code: 'placement-unavailable' });
});
test('point edits invalidate assessment/proposal and retained human approval preconditions; stale terrain cannot publish', async t => {
  const f = await fixture(t), bound = await f.bind(); t.after(() => bound.close());
  const assessment = await bound.assessUtilityBox!(args, signal()) as UtilityBoxAssessment & { assessmentId: string }; assert.equal(assessment.complete, true);
  const proposal = await bound.proposeUtilityBox!(assessment.assessmentId, signal()) as TorontoCadProposal;
  const before = await f.points.execute('snapshot') as PointOverrideSnapshot;
  const move = await f.points.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    points: [{ key: f.reference.key, position: f.reference.position }], translation: [0, 0, 1] }) as PointMoveProposal;
  await f.points.execute('approve', { sessionId: move.sessionId, revision: move.revision, proposalId: move.proposalId });
  await assert.rejects(bound.assessUtilityBox!(args, signal()), { code: 'stale-scene' });
  await assert.rejects(f.cad.execute('approve', { sessionId: proposal.sessionId, revision: proposal.revision, artifactRevision: proposal.artifactRevision, proposalId: proposal.proposalId }), { code: 'stale-revision' });
  assert.equal((await f.cad.execute('snapshot') as TorontoCadSnapshot).bodies.length, 0);
  const next = await f.bind(); t.after(() => next.close()); assert.equal((await next.assessUtilityBox!(args, signal()) as { reason: string }).reason, 'edited-state-unsupported');
});
test('terrain replacement after assessment blocks proposal, and after retention blocks human acceptance', async t => {
  const f = await fixture(t), bound = await f.bind(); t.after(() => bound.close());
  const a = await bound.assessUtilityBox!(args, signal()) as { assessmentId: string };
  f.terrain.ground.cells[0].maxElevation = .01; await f.writeTerrain(); await assert.rejects(bound.proposeUtilityBox!(a.assessmentId, signal()));
  const b = await bound.assessUtilityBox!(args, signal()) as { assessmentId: string }; const p = await bound.proposeUtilityBox!(b.assessmentId, signal()) as TorontoCadProposal;
  f.terrain.ground.cells[0].maxElevation = .02; await f.writeTerrain(); await bound.close();
  await assert.rejects(f.cad.execute('approve', { sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision, proposalId: p.proposalId }), { code: 'stale-artifact' });
  assert.equal((await f.cad.execute('snapshot') as TorontoCadSnapshot).bodies.length, 0);
});
test('late approval precondition failure keeps pending native registry consistent after discarding competing candidates', async t => {
  const f = await fixture(t), s = await f.cad.execute('snapshot') as TorontoCadSnapshot; let checks = 0;
  const p = await f.cad.execute('propose', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision,
    operation: { kind: 'box', center: [1, 1, .75], dimensions: [1.2, .6, 1.5] } }, signal(), async () => { if (++checks === 2) throw new TorontoCadError('stale-revision'); }) as TorontoCadProposal;
  await f.cad.execute('propose', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision,
    operation: { kind: 'box', center: [3, 3, 1], dimensions: [1, 1, 1] } });
  await assert.rejects(f.cad.execute('approve', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, proposalId: p.proposalId }), { code: 'stale-revision' });
  const live = await f.cad.execute('snapshot') as TorontoCadSnapshot;
  assert.equal(checks, 2); assert.equal(live.bodies.length, 0); assert.deepEqual(live.proposals.map(p => p.proposalId), [p.proposalId]);
  const declined = await f.cad.execute('decline', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, proposalId: p.proposalId }) as TorontoCadSnapshot;
  assert.equal(declined.proposals.length, 0);
});
