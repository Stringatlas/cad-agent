import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { TORONTO_SEMANTIC_LABELS, canonicalPointMoveProposalRequest, canonicalPointMoveApprovalRequest, canonicalPointMoveUndoRequest,
  type PointOverrideSnapshot, type PointMoveProposal } from '@spatial/contracts';
import { PointOverrideSession, PointOverrideError } from '../apps/server/src/point-overrides';
import { createPointOverrideRoutes } from '../apps/server/src/point-override-routes';
import { SemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { queryIndexedClosestPole } from '../apps/server/src/pole-index';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-overrides-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(56);
  for (let i = 0; i < 2; i++) {
    payload.writeInt32LE((i + 1) * 1000, i * 28); payload.writeUInt16LE(1, i * 28 + 18);
    payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(6, i * 28 + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(2, 2); hierarchy.writeBigUInt64LE(56n, 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(file => ({ source_file_id: file, file: `L00${file}.ply`, points: file === 1 ? 2 : 0 })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy);
  await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, payload, clean: () => rm(root, { recursive: true, force: true }) };
}
const key = (sourceRow = 0) => ({ sourceFileId: 1, sourceRow });
const propose = (s: PointOverrideSnapshot, points = [{ key: key(), position: [1, 0, 0] }], translation = [0, 1, 0]) =>
  ({ sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, points, translation });
const approve = (s: PointOverrideSnapshot, p: PointMoveProposal) => ({ sessionId: s.sessionId, revision: s.revision, proposalId: p.proposalId });
const failure = (code: string) => (error: unknown) => error instanceof PointOverrideError && error.code === code;

test('point move contracts reject forged shapes, duplicates, nonfinite and oversized batches', () => {
  const valid = { sessionId: 's', revision: 0, artifactRevision: 'abc', points: [{ key: key(), position: [1, 0, 0] }], translation: [1, 0, 0] };
  const result = canonicalPointMoveProposalRequest(valid); valid.points[0].position[0] = 9; assert.equal(result.points[0].position[0], 1);
  for (const value of [{ ...valid, extra: true }, { ...valid, revision: -1 }, { ...valid, translation: [Infinity, 0, 0] },
    { ...valid, translation: [0, 0, 0] }, { ...valid, points: [] }, { ...valid, points: Array(33).fill(valid.points[0]) },
    { ...valid, points: [valid.points[0], valid.points[0]] }, { ...valid, points: [{ key: { sourceFileId: 5, sourceRow: 0 }, position: [1, 0, 0] }] }]) assert.throws(() => canonicalPointMoveProposalRequest(value));
  assert.throws(() => canonicalPointMoveApprovalRequest({ sessionId: 's', revision: 0, proposalId: 'p', moves: [] }));
  assert.throws(() => canonicalPointMoveUndoRequest({ sessionId: 's', revision: 0, transactionId: 't', artifactRevision: 'x' }));
});

test('atomic exact approvals, current-position moves, strict latest undo and source queries unchanged', async () => {
  const f = await fixture(), authority = new PointOverrideSession(f.root);
  try {
    const s = await authority.execute('snapshot') as PointOverrideSnapshot;
    assert.equal(s.units, 'm'); assert.equal(s.frameId, 'toronto3d-local-v1'); assert.deepEqual(s.entries, []);
    const p = await authority.execute('propose', propose(s, [{ key: key(), position: [1, 0, 0] }, { key: key(1), position: [2, 0, 0] }])) as PointMoveProposal;
    assert.deepEqual(p.moves[0], { key: key(), originalPosition: [1, 0, 0], before: [1, 0, 0], after: [1, 1, 0] });
    assert.deepEqual((await authority.execute('snapshot') as PointOverrideSnapshot).entries, []);
    // Returned proposal is detached; approval uses retained exact geometry only.
    (p.moves[0].after as number[])[0] = 999;
    const moved = await authority.execute('approve', approve(s, p)) as PointOverrideSnapshot;
    assert.equal(moved.revision, 1); assert.equal(moved.entries.length, 2); assert.deepEqual(moved.entries[0].position, [1, 1, 0]);
    assert.ok(moved.nextUndoTransactionId);
    await assert.rejects(authority.execute('approve', approve(s, p)), failure('stale-revision'));
    await assert.rejects(authority.execute('propose', propose(moved)), failure('position-mismatch'));
    const p2 = await authority.execute('propose', propose(moved, [{ key: key(), position: [1, 1, 0] }], [2, 0, 0])) as PointMoveProposal;
    const moved2 = await authority.execute('approve', approve(moved, p2)) as PointOverrideSnapshot;
    const nearest = await queryIndexedClosestPole(f.root, { requestId: 'test', datasetId: 'toronto3d', expectedArtifactRevision: s.artifactRevision,
      units: 'm', frameId: 'toronto3d-local-v1', input: { kind: 'point-ref', key: key() },
      filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } });
    assert.equal(nearest.status, 'verified-found'); if (nearest.status === 'verified-found') assert.deepEqual(nearest.queryPosition, [1, 0, 0]);
    await assert.rejects(authority.execute('undo', { sessionId: s.sessionId, revision: moved2.revision, transactionId: moved.nextUndoTransactionId }), failure('nothing-to-undo'));
    const undo2 = await authority.execute('undo', { sessionId: s.sessionId, revision: moved2.revision, transactionId: moved2.nextUndoTransactionId }) as PointOverrideSnapshot;
    assert.equal(undo2.revision, 3); assert.equal(undo2.nextUndoTransactionId, moved.nextUndoTransactionId);
    assert.deepEqual(undo2.entries, moved.entries);
    const undo1 = await authority.execute('undo', { sessionId: s.sessionId, revision: undo2.revision, transactionId: undo2.nextUndoTransactionId }) as PointOverrideSnapshot;
    assert.equal(undo1.revision, 4); assert.deepEqual(undo1.entries, []); assert.equal(undo1.nextUndoTransactionId, null);
    assert.deepEqual(await readFile(join(f.root, 'octree/octree.bin')), f.payload);
  } finally { await authority.close(); await f.clean(); }
});

test('stale session/artifact/revision, unknown records, atomic failure and session reset', async () => {
  const f = await fixture(), authority = new PointOverrideSession(f.root), other = new PointOverrideSession(f.root);
  try {
    const s = await authority.execute('snapshot') as PointOverrideSnapshot;
    const p = await authority.execute('propose', propose(s)) as PointMoveProposal;
    await assert.rejects(other.execute('approve', approve(s, p)), failure('stale-session'));
    await assert.rejects(authority.execute('propose', { ...propose(s), artifactRevision: 'other' }), failure('stale-artifact'));
    await assert.rejects(authority.execute('propose', propose(s, [{ key: key(), position: [1, 0, 0] }, { key: key(99), position: [2, 0, 0] }])), failure('unknown-point'));
    assert.deepEqual((await authority.execute('snapshot') as PointOverrideSnapshot).entries, []);
    // Lookup offset alone is NOT trusted: force the wrong valid physical record.
    const original = SemanticDiskIndex.prototype.resolvePhysical;
    SemanticDiskIndex.prototype.resolvePhysical = async () => 1;
    try { await assert.rejects(authority.execute('propose', propose(s)), failure('unknown-point')); }
    finally { SemanticDiskIndex.prototype.resolvePhysical = original; }
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    await assert.rejects(authority.execute('approve', approve(s, p)), failure('stale-artifact'));
  } finally { await authority.close(); await other.close(); await f.clean(); }
});

test('approval preserves only disjoint exact pending moves, decline is individual, Undo clears pending', async () => {
  const f = await fixture(), authority = new PointOverrideSession(f.root);
  try {
    const s = await authority.execute('snapshot') as PointOverrideSnapshot;
    const first = await authority.execute('propose', propose(s)) as PointMoveProposal;
    const conflict = await authority.execute('propose', propose(s, [{ key: key(), position: [1, 0, 0] }], [0, 2, 0])) as PointMoveProposal;
    const second = await authority.execute('propose', propose(s, [{ key: key(1), position: [2, 0, 0] }], [0, 3, 0])) as PointMoveProposal;
    const accepted = await authority.execute('approve', approve(s, first)) as PointOverrideSnapshot;
    const pending = await authority.execute('pending') as PointMoveProposal[];
    assert.deepEqual(pending, [{ ...second, revision: accepted.revision }]);
    await assert.rejects(authority.execute('approve', approve(accepted, conflict)), failure('unknown-proposal'));
    await authority.execute('decline', approve(accepted, pending[0]));
    assert.deepEqual(await authority.execute('pending'), []);
    assert.equal((await authority.execute('snapshot') as PointOverrideSnapshot).revision, accepted.revision);
    await authority.execute('propose', propose(accepted, [{ key: key(1), position: [2, 0, 0] }], [0, 4, 0]));
    await authority.execute('undo', { sessionId: accepted.sessionId, revision: accepted.revision, transactionId: accepted.nextUndoTransactionId });
    assert.deepEqual(await authority.execute('pending'), []);
  } finally { await authority.close(); await f.clean(); }
});

test('override HTTP local policy, body limits, envelopes and bounded admission', async () => {
  const f = await fixture(), routes = createPointOverrideRoutes(f.root);
  const server = createServer((request, response) => { void routes.handle(request, response).then(handled => { if (!handled) { response.statusCode = 404; response.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port, root = `http://127.0.0.1:${port}/datasets/toronto3d/overrides`;
  try {
    const get = await fetch(root); assert.equal(get.status, 200); const s = (await get.json()).result as PointOverrideSnapshot;
    const { request: httpRequest } = await import('node:http');
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(root, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(root, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(root + '?x=1')).status, 400);
    const post = (path: string, body: unknown) => fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await fetch(root + '/propose', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await post('/propose', { pad: 'x'.repeat(17000) })).status, 413);
    const proposalReply = await post('/propose', propose(s)); assert.equal(proposalReply.status, 200);
    const p = (await proposalReply.json()).result as PointMoveProposal;
    assert.equal((await post('/approve', { ...approve(s, p), moves: p.moves })).status, 400);
    const reply = await post('/approve', approve(s, p)); assert.equal(reply.status, 200);
    const moved = (await reply.json()).result as PointOverrideSnapshot;
    assert.equal(moved.revision, 1); assert.deepEqual(moved.entries[0].position, [1, 1, 0]);
    const undo = await post('/undo', { sessionId: moved.sessionId, revision: moved.revision, transactionId: moved.nextUndoTransactionId });
    assert.equal(undo.status, 200); assert.deepEqual((await undo.json()).result.entries, []);
    // Occupy admission with a chunked unfinished body, then reject a concurrent read.
    const { request } = await import('node:http');
    const slow = request(root + '/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    slow.on('error', () => {}); slow.write('{'); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await fetch(root)).status, 429); slow.destroy();
  } finally { await routes.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
});
