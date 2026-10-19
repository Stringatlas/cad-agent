import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, type PointOverrideSnapshot, type PointMoveProposal } from '@spatial/contracts';
import { SCENE_OBJECT_LIMITS, canonicalSceneObjectSnapshot, canonicalSceneObjectProposalRequest, canonicalSceneObjectReference, canonicalSceneObjectProposal, type SceneObjectSnapshot, type SceneObjectProposal, type SourceRecordReference } from '../packages/contracts/src/scene-objects';
import { SceneObjectSession, SceneObjectError } from '../apps/server/src/scene-object-session';
import { PointOverrideSession } from '../apps/server/src/point-overrides';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-datums-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 0], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(1000, 0); payload.writeUInt16LE(1, 18); payload.writeFloatLE(6, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(file => ({ source_file_id: file, file: `L00${file}.ply`, points: file === 1 ? 1 : 0 })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const points = new PointOverrideSession(root), objects = new SceneObjectSession(root, points);
  return { root, payload, points, objects, async clean() { await objects.close(); await points.close(); await rm(root, { recursive: true, force: true }); } };
}
const request = (s: SceneObjectSnapshot, position = [2, 3, 4]) => ({ sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, frameId: s.frameId, units: s.units, name: 'Point A', input: { kind: 'position', position } });
const decision = (s: SceneObjectSnapshot, p: SceneObjectProposal) => ({ sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, proposalId: p.proposalId });
const failure = (code: string) => (error: unknown) => error instanceof SceneObjectError && error.code === code;
const sourceRef = (p: PointOverrideSnapshot): SourceRecordReference => ({ kind: 'source-record', datasetId: p.datasetId, artifactRevision: p.artifactRevision, frameId: p.frameId, units: p.units, key: { sourceFileId: 1, sourceRow: 0 }, domain: 'effective', overrideSessionId: p.sessionId, overrideRevision: p.revision });

test('strict versioned scene object contracts reject forged, unknown and nonfinite values', () => {
  const s: SceneObjectSnapshot = { schemaVersion: 1, sessionId: 's', revision: 0, artifactRevision: 'a', datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', objects: [], proposals: [], nextUndoTransactionId: null };
  const r = request(s); const canonical = canonicalSceneObjectProposalRequest(r); r.input.position[0] = 999; assert.deepEqual(canonical.input, { kind: 'position', position: [2, 3, 4] });
  for (const invalid of [{ ...r, extra: true }, { ...r, name: ' ' }, { ...r, name: 'x'.repeat(81) }, { ...r, name: 'a\nb' }, { ...r, revision: -1 }, { ...r, frameId: 'demo' }, { ...r, units: 'ft' }, { ...r, input: { kind: 'position', position: [Infinity, 0, 0] } }, { ...r, input: { kind: 'position', position: [0, 0, 0], objectId: 'forged' } }]) assert.throws(() => canonicalSceneObjectProposalRequest(invalid));
  assert.throws(() => canonicalSceneObjectSnapshot({ ...s, schemaVersion: 2 }));
  assert.throws(() => canonicalSceneObjectReference({ kind: 'derived-entity' }));
  assert.deepEqual(canonicalSceneObjectSnapshot(s), s);
});

test('reserved exact candidates publish once, decline is not a revision, Undo removes only datum', async () => {
  const f = await fixture();
  try {
    const s = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    const p = await f.objects.execute('propose', request(s)) as SceneObjectProposal;
    const canonical = canonicalSceneObjectProposal(p);
    (p.object.position as unknown as number[])[0] = 999;
    assert.deepEqual((await f.objects.execute('snapshot') as SceneObjectSnapshot).objects, []);
    assert.equal(f.objects.proposalDecision(p.proposalId), undefined);
    const q = await f.objects.execute('propose', request(s)) as SceneObjectProposal;
    const declined = await f.objects.execute('decline', decision(s, q)) as SceneObjectSnapshot;
    assert.equal(declined.revision, 0); assert.equal(f.objects.proposalDecision(q.proposalId), 'declined');
    const accepted = await f.objects.execute('approve', decision(s, p)) as SceneObjectSnapshot;
    assert.deepEqual(accepted.objects, [canonical.object]); assert.equal(accepted.revision, 1); assert.equal(f.objects.proposalDecision(p.proposalId), 'accepted');
    await assert.rejects(f.objects.execute('approve', decision(s, p)), failure('stale-revision'));
    await assert.rejects(f.objects.execute('approve', decision(accepted, p)), failure('unknown-proposal'));
    const undone = await f.objects.execute('undo', { sessionId: accepted.sessionId, revision: accepted.revision, artifactRevision: accepted.artifactRevision, transactionId: accepted.nextUndoTransactionId }) as SceneObjectSnapshot;
    assert.deepEqual(undone.objects, []); assert.equal(undone.revision, 2); assert.equal(undone.nextUndoTransactionId, null);
    assert.deepEqual((await f.points.execute('snapshot') as PointOverrideSnapshot).entries, []);
    assert.deepEqual(await readFile(join(f.root, 'octree/octree.bin')), f.payload);
  } finally { await f.clean(); }
});

test('authored references reject pending IDs and stale bindings, normalize independent copies', async () => {
  const f = await fixture();
  try {
    let s = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    const p = await f.objects.execute('propose', request(s)) as SceneObjectProposal;
    const reference = { kind: 'authored-object', sessionId: s.sessionId, revision: s.revision, objectId: p.object.id, objectRevision: 1, frameId: s.frameId, units: s.units };
    await assert.rejects(f.objects.execute('propose', { ...request(s), input: { kind: 'reference', reference, offset: [1, 2, 3] } }), failure('unknown-object'));
    s = await f.objects.execute('approve', decision(s, p)) as SceneObjectSnapshot;
    await assert.rejects(f.objects.execute('propose', { ...request(s), input: { kind: 'reference', reference, offset: [1, 2, 3] } }), failure('stale-reference'));
    const q = await f.objects.execute('propose', { ...request(s), input: { kind: 'reference', reference: { ...reference, revision: s.revision }, offset: [1, 2, 3] } }) as SceneObjectProposal;
    assert.deepEqual(q.object.position, [3, 5, 7]);
    s = await f.objects.execute('approve', decision(s, q)) as SceneObjectSnapshot;
    assert.equal(s.objects.length, 2);
  } finally { await f.clean(); }
});

test('source rereads and override binding recheck on accept; committed datums are independent', async () => {
  const f = await fixture();
  try {
    let s = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    let ps = await f.points.execute('snapshot') as PointOverrideSnapshot;
    const input = { kind: 'reference', reference: sourceRef(ps), offset: [0, 2, 0] };
    const p = await f.objects.execute('propose', { ...request(s), input }) as SceneObjectProposal;
    assert.deepEqual(p.object.position, [1, 2, 0]);
    const move = await f.points.execute('propose', { sessionId: ps.sessionId, revision: ps.revision, artifactRevision: ps.artifactRevision, points: [{ key: input.reference.key, position: [1, 0, 0] }], translation: [5, 0, 0] }) as PointMoveProposal;
    ps = await f.points.execute('approve', { sessionId: ps.sessionId, revision: ps.revision, proposalId: move.proposalId }) as PointOverrideSnapshot;
    await assert.rejects(f.objects.execute('approve', decision(s, p)), failure('stale-reference'));
    assert.equal(f.objects.proposalDecision(p.proposalId), undefined);
    const invalidated = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    assert.deepEqual(invalidated.objects, []); assert.deepEqual(invalidated.proposals, []);
    const q = await f.objects.execute('propose', { ...request(s), input: { ...input, reference: sourceRef(ps) } }) as SceneObjectProposal;
    assert.deepEqual(q.object.position, [6, 2, 0]);
    s = await f.objects.execute('approve', decision(s, q)) as SceneObjectSnapshot;
    await f.points.execute('undo', { sessionId: ps.sessionId, revision: ps.revision, transactionId: ps.nextUndoTransactionId });
    assert.deepEqual((await f.objects.execute('snapshot') as SceneObjectSnapshot).objects, s.objects);
    const original = await f.objects.execute('propose', { ...request(s), input: { ...input, reference: { ...sourceRef(await f.points.execute('snapshot') as PointOverrideSnapshot), domain: 'original' } } }) as SceneObjectProposal;
    assert.deepEqual(original.object.position, [1, 2, 0]);
  } finally { await f.clean(); }
});

test('stale bindings, unknown sources, overflow, proposal budgets and artifact replacement fail closed', async () => {
  const f = await fixture();
  try {
    const s = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    await assert.rejects(f.objects.execute('propose', { ...request(s), sessionId: 'wrong' }), failure('stale-session'));
    await assert.rejects(f.objects.execute('propose', { ...request(s), artifactRevision: 'wrong' }), failure('stale-artifact'));
    const ps = await f.points.execute('snapshot') as PointOverrideSnapshot;
    await assert.rejects(f.objects.execute('propose', { ...request(s), input: { kind: 'reference', reference: { ...sourceRef(ps), key: { sourceFileId: 1, sourceRow: 99 } }, offset: [0, 0, 0] } }), failure('unknown-point'));
    for (let i = 0; i < SCENE_OBJECT_LIMITS.proposals; i++) await f.objects.execute('propose', request(s));
    await assert.rejects(f.objects.execute('propose', request(s)), failure('resource-limit'));
    const before = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    await assert.rejects(f.objects.execute('approve', decision(s, before.proposals[0]!)), failure('stale-artifact'));
    assert.equal(f.objects.proposalDecision(before.proposals[0]!.proposalId), undefined);
    await assert.rejects(f.objects.execute('snapshot'), failure('unavailable'));
  } finally { await f.clean(); }
});

test('object/history limits, checked Undo, arithmetic overflow and cancellation preserve publication', async () => {
  const f = await fixture();
  try {
    let s = await f.objects.execute('snapshot') as SceneObjectSnapshot;
    const huge = await f.objects.execute('propose', request(s, [Number.MAX_VALUE, 0, 0])) as SceneObjectProposal;
    s = await f.objects.execute('approve', decision(s, huge)) as SceneObjectSnapshot;
    const reference = { kind: 'authored-object', sessionId: s.sessionId, revision: s.revision, objectId: huge.object.id, objectRevision: 1, frameId: s.frameId, units: s.units };
    await assert.rejects(f.objects.execute('propose', { ...request(s), input: { kind: 'reference', reference, offset: [Number.MAX_VALUE, 0, 0] } }), failure('invalid-request'));
    await assert.rejects(f.objects.execute('undo', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, transactionId: 'wrong' }), failure('nothing-to-undo'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.objects.execute('propose', request(s), controller.signal));
    assert.equal((await f.objects.execute('snapshot') as SceneObjectSnapshot).objects.length, 1);
    const inFlight = f.objects.execute('snapshot'); await assert.rejects(f.objects.execute('snapshot'), failure('busy')); await inFlight;
    for (let i = 1; i < SCENE_OBJECT_LIMITS.objects; i++) {
      const p = await f.objects.execute('propose', request(s)) as SceneObjectProposal;
      s = await f.objects.execute('approve', decision(s, p)) as SceneObjectSnapshot;
    }
    assert.equal(s.objects.length, SCENE_OBJECT_LIMITS.objects);
    await assert.rejects(f.objects.execute('propose', request(s)), failure('resource-limit'));
    const undone = await f.objects.execute('undo', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, transactionId: s.nextUndoTransactionId }) as SceneObjectSnapshot;
    assert.equal(undone.objects.length, SCENE_OBJECT_LIMITS.objects - 1);
    assert.deepEqual(undone.objects[0], huge.object);
  } finally { await f.clean(); }
});
