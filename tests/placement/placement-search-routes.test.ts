import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, type TorontoCadProposal, type TorontoCadSnapshot, type PointOverrideSnapshot, type PointMoveProposal } from '@spatial/contracts';
import { SemanticArtifact } from '../../apps/server/src/spatial/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../../apps/server/src/spatial/semantic-disk-index';
import { createDemoServer } from '../../apps/server/src/index';
import { PlacementSearchSession, type PlacementSearchResponse } from '../../apps/server/src/placement/placement-search-session';
import { TorontoCadSession } from '../../apps/server/src/cad/toronto-cad-session';
import { PointOverrideSession } from '../../apps/server/src/scene/point-overrides';

const ROOT = '/datasets/toronto3d/placement';
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'placement-http-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 200] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 200] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(-10000, 0); payload.writeInt32LE(-10000, 4); payload.writeUInt16LE(1, 18); payload.writeFloatLE(1, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 1 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root), { index } = await getSemanticDiskIndex(artifact);
  const terrainPath = join(root, 'terrain.json'), previous = process.env.SPATIAL_PREPROCESSING_PATH; process.env.SPATIAL_PREPROCESSING_PATH = terrainPath;
  const cells = Array.from({ length: 100 }, (_, i) => ({ x: i % 10 - 2, y: Math.floor(i / 10) - 2, points: 3, elevation: 0, maxElevation: 0 }));
  const terrain = { version: 'scene-preprocessing-v1', complete: true, binding: { datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: artifact.dataset.coordinates, indexHash: index.hash, sourceHash: index.sourceHash,
    instanceManifestHash: 'a'.repeat(64), membershipHash: 'b'.repeat(64) }, instances: [], ground: { cellMeters: 1, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3, points: cells.length * 3, cells } };
  const writeTerrain = () => writeFile(terrainPath, JSON.stringify(terrain)); await writeTerrain();
  const body = { area: { datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[0, 0, 100], [4, 0, 100], [4, 4, 100], [0, 4, 100]] },
    settings: { dimensions: [1, 1, 1.2], frontAccessDepth: .5, poleSeparation: 0, maxGroundSlopeDegrees: 1, maxGroundRelief: .1, spacingMeters: 1, allowedYawDegrees: [0] } };
  const server = createDemoServer({ datasetRoot: root });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, value: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() as { ok: boolean; result: any; error?: { code: string } } };
  };
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.SPATIAL_PREPROCESSING_PATH; else process.env.SPATIAL_PREPROCESSING_PATH = previous;
    dropSemanticDiskIndexMemoryCache(); await artifact.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  const search = async () => { const r = await post(ROOT + '/search', body); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result as PlacementSearchResponse; };
  return { root, body, post, search, terrain, writeTerrain, base };
}
const cadRequest = (p: TorontoCadProposal) => ({ sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision, proposalId: p.proposalId });

test('HTTP search → exact native ghost → explicit approval → Undo; resolved semantics and authority are disclosed', async t => {
  const f = await fixture(t), result = await f.search(); assert.equal(result.status, 'complete'); assert.ok(result.candidates.length > 0); assert.ok(result.candidates.length <= 5);
  const p = result.specification.parameters;
  assert.equal(p.frontAccessHeight, 1.2); assert.equal(p.containment, 'footprint-and-access'); assert.equal(p.poleDistance.from, 'box-boundary');
  assert.equal(p.maxBodyConflicts, 0); assert.equal(p.maxAccessConflicts, 0); assert.equal(p.binding.pointAuthority.revision, 0);
  assert.deepEqual(p.ranking.map(v => v.metric), ['ground-slope', 'ground-relief', 'pole-separation']);
  const proposed = await f.post(ROOT + '/propose', { searchId: result.searchId, candidateId: result.candidates[0].id }); assert.equal(proposed.status, 200);
  const proposal = proposed.body.result as TorontoCadProposal;
  assert.deepEqual(proposal.operation, result.candidates[0].operation); assert.ok(proposal.mesh.triangles.length);
  const pending = await (await fetch(f.base + '/datasets/toronto3d/cad')).json() as { result: TorontoCadSnapshot };
  assert.equal(pending.result.bodies.length, 0); assert.equal(pending.result.proposals.length, 1);
  const approved = await f.post('/datasets/toronto3d/cad/approve', cadRequest(proposal)); assert.equal(approved.status, 200);
  assert.equal(approved.body.result.bodies[0].bodyId, proposal.bodyId);
  assert.equal((await f.post(ROOT + '/propose', { searchId: result.searchId, candidateId: result.candidates[0].id })).status, 409);
  assert.equal((await f.post(ROOT + '/search', f.body)).status, 409);
  const s = approved.body.result as TorontoCadSnapshot;
  const undone = await f.post('/datasets/toronto3d/cad/undo', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, transactionId: s.nextUndoTransactionId });
  assert.equal(undone.status, 200); assert.equal(undone.body.result.bodies.length, 0);
  // Undo does not rebase a retained search even though effective geometry is empty again.
  assert.equal((await f.post(ROOT + '/propose', { searchId: result.searchId, candidateId: result.candidates[0].id })).status, 409);
});

test('search enforces native dimensions, AOI XY and terrain-derived operation centers', async t => {
  const f = await fixture(t);
  for (const dimension of [.0005, 100.001]) {
    for (let axis = 0; axis < 3; axis++) {
      const dimensions = [1, 1, 1.2]; dimensions[axis] = dimension;
      const response = await f.post(ROOT + '/search', { ...f.body, settings: { ...f.body.settings, dimensions } });
      assert.equal(response.status, 413); assert.equal(response.body.error?.code, 'resource-limit');
    }
  }
  for (const shift of [-1001, 1001]) {
    const area = { ...f.body.area, corners: f.body.area.corners.map(([x, y, z]) => [x! + shift, y!, z!]) };
    const response = await f.post(ROOT + '/search', { ...f.body, area });
    assert.equal(response.status, 413); assert.equal(response.body.error?.code, 'resource-limit');
  }
  // Native limits are inclusive; the access depth is not a native dimension.
  const small = await f.post(ROOT + '/search', { ...f.body, settings: { ...f.body.settings, dimensions: [.001, 1, .001], frontAccessDepth: .0001 } });
  assert.equal(small.status, 200); assert.ok(small.body.result.candidates.length);
  const large = await f.post(ROOT + '/search', { ...f.body, settings: { ...f.body.settings, dimensions: [100, 100, 100] } });
  assert.equal(large.status, 200); assert.deepEqual(large.body.result.candidates, []);
  // AOI Z is only a display plane: actual CAD center comes from terrain.
  for (const cell of f.terrain.ground.cells) { cell.elevation = 1001; cell.maxElevation = 1001; }
  await f.writeTerrain();
  const high = await f.post(ROOT + '/search', f.body);
  assert.equal(high.status, 413); assert.equal(high.body.error?.code, 'resource-limit');
});

test('accepted point edit during final CAD snapshot rejects publication and retains no shortlist', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root), session = new PlacementSearchSession(f.root, points, cad);
  t.after(async () => { await session.close(); await points.close(); await cad.close(); });
  const original = cad.execute.bind(cad); let snapshots = 0;
  cad.execute = async (...args) => {
    if (args[0] === 'snapshot' && ++snapshots === 2) {
      const before = await points.execute('snapshot') as PointOverrideSnapshot;
      const move = await points.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
        points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [-10, -10, 0] }], translation: [0, 0, 1] }) as PointMoveProposal;
      await points.execute('approve', { sessionId: move.sessionId, revision: move.revision, proposalId: move.proposalId });
    }
    return original(...args);
  };
  await assert.rejects(session.search(f.body), { code: 'stale-revision' });
  assert.equal((await points.execute('snapshot') as PointOverrideSnapshot).revision, 1);
  await assert.rejects(session.propose({ searchId: 'not-retained', candidateId: 'none' }), { code: 'stale-revision' });
});

test('CAD approval during the final point snapshot rejects search and retains no shortlist', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root), session = new PlacementSearchSession(f.root, points, cad);
  t.after(async () => { await session.close(); await points.close(); await cad.close(); });
  const before = await cad.execute('snapshot') as TorontoCadSnapshot;
  const proposal = await cad.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    operation: { kind: 'box', center: [30, 30, 1], dimensions: [1, 1, 1] } }) as TorontoCadProposal;
  const original = points.execute.bind(points); let snapshots = 0;
  points.execute = async (...args) => {
    if (args[0] === 'snapshot' && ++snapshots === 3) await cad.execute('approve', cadRequest(proposal));
    return original(...args);
  };
  await assert.rejects(session.search(f.body), { code: 'stale-revision' });
  assert.equal((await cad.execute('snapshot') as TorontoCadSnapshot).revision, 1);
  await assert.rejects(session.propose({ searchId: 'not-retained', candidateId: 'none' }), { code: 'stale-revision' });
});

for (const finalSnapshot of [4, 5]) test(`CAD approval during proposal snapshot ${finalSnapshot} rejects stale ghost publication`, async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root), session = new PlacementSearchSession(f.root, points, cad);
  t.after(async () => { await session.close(); await points.close(); await cad.close(); });
  const result = await session.search(f.body), before = await cad.execute('snapshot') as TorontoCadSnapshot;
  const other = await cad.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    operation: { kind: 'box', center: [30, 30, 1], dimensions: [1, 1, 1] } }) as TorontoCadProposal;
  const original = points.execute.bind(points); let snapshots = 0;
  points.execute = async (...args) => {
    if (args[0] === 'snapshot' && ++snapshots === finalSnapshot) await cad.execute('approve', cadRequest(other));
    return original(...args);
  };
  await assert.rejects(session.propose({ searchId: result.searchId, candidateId: result.candidates[0].id }), { code: 'stale-revision' });
  const current = await cad.execute('snapshot') as TorontoCadSnapshot;
  assert.equal(current.bodies.length, 1); assert.equal(current.proposals.length, 0);
});

test('point edit after the final approval snapshot is captured blocks native acceptance', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root), session = new PlacementSearchSession(f.root, points, cad);
  t.after(async () => { await session.close(); await points.close(); await cad.close(); });
  const result = await session.search(f.body), proposal = await session.propose({ searchId: result.searchId, candidateId: result.candidates[0].id });
  const before = await points.execute('snapshot') as PointOverrideSnapshot;
  const move = await points.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [-10, -10, 0] }], translation: [0, 0, 1] }) as PointMoveProposal;
  const original = points.execute.bind(points); let snapshots = 0;
  points.execute = async (...args) => {
    const snapshot = await original(...args);
    if (args[0] === 'snapshot' && ++snapshots === 2) await original('approve', { sessionId: move.sessionId, revision: move.revision, proposalId: move.proposalId });
    return snapshot;
  };
  await assert.rejects(cad.execute('approve', cadRequest(proposal)), { code: 'stale-revision' });
  assert.equal((await cad.execute('snapshot') as TorontoCadSnapshot).bodies.length, 0);
  assert.equal((await points.execute('snapshot') as PointOverrideSnapshot).revision, 1);
});

test('composition guards fail closed for uninitialized, busy, mismatched, edited and closed authorities', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root);
  t.after(async () => { await points.close(); await cad.close(); });
  const unknown = { sessionId: 'unknown', revision: 0, artifactRevision: f.body.area.artifactRevision };
  for (const authority of [points, cad]) assert.throws(() => authority.assertOriginalBinding(unknown), { code: 'unavailable' });
  const p = await points.execute('snapshot') as PointOverrideSnapshot, c = await cad.execute('snapshot') as TorontoCadSnapshot;
  for (const [authority, binding] of [[points, p], [cad, c]] as const) {
    assert.equal(authority.assertOriginalBinding(binding), undefined);
    assert.throws(() => authority.assertOriginalBinding({ ...binding, sessionId: 'other' }), { code: 'stale-session' });
    assert.throws(() => authority.assertOriginalBinding({ ...binding, revision: 1 }), { code: 'stale-revision' });
    assert.throws(() => authority.assertOriginalBinding({ ...binding, artifactRevision: 'other' }), { code: 'stale-artifact' });
    const active = authority.execute('snapshot');
    assert.throws(() => authority.assertOriginalBinding(binding), { code: 'busy' });
    await active;
  }
  const move = await points.execute('propose', { sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision,
    points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [-10, -10, 0] }], translation: [0, 0, 1] }) as PointMoveProposal;
  const ghost = await cad.execute('propose', { sessionId: c.sessionId, revision: c.revision, artifactRevision: c.artifactRevision,
    operation: { kind: 'box', center: [30, 30, 1], dimensions: [1, 1, 1] } }) as TorontoCadProposal;
  // Pending ghosts are not accepted edits and must not invalidate original-source search.
  points.assertOriginalBinding(p); cad.assertOriginalBinding(c);
  const moved = await points.execute('approve', { sessionId: move.sessionId, revision: move.revision, proposalId: move.proposalId }) as PointOverrideSnapshot;
  const accepted = await cad.execute('approve', cadRequest(ghost)) as TorontoCadSnapshot;
  assert.throws(() => points.assertOriginalBinding(moved), { code: 'stale-revision' });
  assert.throws(() => cad.assertOriginalBinding(accepted), { code: 'stale-revision' });
  const undonePoints = await points.execute('undo', { sessionId: moved.sessionId, revision: moved.revision, transactionId: moved.nextUndoTransactionId }) as PointOverrideSnapshot;
  const undoneCad = await cad.execute('undo', { sessionId: accepted.sessionId, revision: accepted.revision, artifactRevision: accepted.artifactRevision, transactionId: accepted.nextUndoTransactionId }) as TorontoCadSnapshot;
  points.assertOriginalBinding(undonePoints); cad.assertOriginalBinding(undoneCad);
  assert.throws(() => points.assertOriginalBinding(p), { code: 'stale-revision' });
  assert.throws(() => cad.assertOriginalBinding(c), { code: 'stale-revision' });
  // A detected source failure invalidates CAD even though its in-memory binding is unchanged.
  await writeFile(join(f.root, 'manifest.json'), '{}');
  await assert.rejects(cad.execute('snapshot'));
  assert.throws(() => cad.assertOriginalBinding(undoneCad), { code: 'unavailable' });
  await points.close(); await cad.close();
  assert.throws(() => points.assertOriginalBinding(undonePoints), { code: 'unavailable' });
  assert.throws(() => cad.assertOriginalBinding(undoneCad), { code: 'unavailable' });
});

test('terrain changes block proposal and independently block later human acceptance', async t => {
  const f = await fixture(t), a = await f.search();
  f.terrain.ground.cells[0].maxElevation = .01; await f.writeTerrain();
  assert.equal((await f.post(ROOT + '/propose', { searchId: a.searchId, candidateId: a.candidates[0].id })).status, 409);
  const b = await f.search(), r = await f.post(ROOT + '/propose', { searchId: b.searchId, candidateId: b.candidates[0].id }); assert.equal(r.status, 200);
  f.terrain.ground.cells[0].maxElevation = .02; await f.writeTerrain();
  assert.equal((await f.post('/datasets/toronto3d/cad/approve', cadRequest(r.body.result))).status, 409);
});

test('strict shapes, AOI bindings, empty feasible result and localhost/origin policy', async t => {
  const f = await fixture(t);
  for (const bad of [{ ...f.body, extra: true }, { ...f.body, settings: { ...f.body.settings, approve: true } }, { ...f.body, settings: { ...f.body.settings, allowedYawDegrees: [45] } },
    { ...f.body, area: { ...f.body.area, localOrigin: [0, 0, 0] } }, { ...f.body, area: { ...f.body.area, frameId: 'wrong' } }]) assert.equal((await f.post(ROOT + '/search', bad)).status, 400);
  assert.equal((await f.post(ROOT + '/search', { ...f.body, area: { ...f.body.area, artifactRevision: 'a'.repeat(64) } })).status, 409);
  assert.equal((await f.post(ROOT + '/search', f.body, { origin: 'https://evil.example' })).status, 403);
  const foreignHost = await new Promise<number>(resolve => {
    const r = httpRequest(f.base + ROOT + '/search', { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode!); });
    r.end(JSON.stringify(f.body));
  });
  assert.equal(foreignHost, 403);
  assert.equal((await f.post(ROOT + '/search?x=1', f.body)).status, 400);
  assert.equal((await f.post(ROOT + '/propose', { searchId: 'none', candidateId: 'none', operation: {} })).status, 400);
  const empty = await f.post(ROOT + '/search', { ...f.body, settings: { ...f.body.settings, dimensions: [20, 20, 1] } });
  assert.equal(empty.status, 200); assert.equal(empty.body.result.status, 'complete'); assert.deepEqual(empty.body.result.candidates, []);
  assert.equal((await f.post(ROOT + '/propose', { searchId: empty.body.result.searchId, candidateId: 'none' })).status, 400);
  const malformed = await fetch(f.base + ROOT + '/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(malformed.status, 400);
  const text = await malformed.text(); assert.ok(!text.includes(f.root));
  const oversized = await fetch(f.base + ROOT + '/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(9000) });
  assert.equal(oversized.status, 413);
});

test('single retained search and independent approval check survive session close but reject accepted point edits', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root), session = new PlacementSearchSession(f.root, points, cad);
  t.after(async () => { await session.close(); await points.close(); await cad.close(); });
  const a = await session.search(f.body), b = await session.search(f.body);
  await assert.rejects(session.propose({ searchId: a.searchId, candidateId: a.candidates[0].id }), { code: 'stale-revision' });
  const proposal = await session.propose({ searchId: b.searchId, candidateId: b.candidates[0].id }); await session.close();
  const before = await points.execute('snapshot') as PointOverrideSnapshot;
  const move = await points.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [-10, -10, 0] }], translation: [0, 0, 1] }) as PointMoveProposal;
  await points.execute('approve', { sessionId: move.sessionId, revision: move.revision, proposalId: move.proposalId });
  await assert.rejects(cad.execute('approve', cadRequest(proposal)), { code: 'stale-revision' });
  assert.equal((await cad.execute('snapshot') as TorontoCadSnapshot).bodies.length, 0);
});
