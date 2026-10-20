import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, canonicalResolvedPlacementSpecification, type ResolvedPlacementSpecification, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact, digest } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../apps/server/src/semantic-disk-index';
import { searchPlacement } from '../apps/server/src/placement-search';

const options = () => ({ signal: new AbortController().signal, spacingMeters: 1, maxPoses: 1000, limit: 100, diversityMeters: 0 });
type Point = { xyz: Vec3; label: number };
async function fixture(t: { after(fn: () => unknown): void }, raw: Point[] = [{ xyz: [-10, -10, 0], label: 1 }]) {
  const root = await mkdtemp(join(tmpdir(), 'placement-search-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: raw.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 200] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 200] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(raw.length * 28);
  const oracle = raw.map((p, i) => {
    const xyz = p.xyz.map((n, a) => { const value = Math.round(n * 1000); payload.writeInt32LE(value, i * 28 + a * 4); return value * .001; }) as unknown as Vec3;
    payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24); return { xyz, label: p.label };
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(raw.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? raw.length : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root), { index } = await getSemanticDiskIndex(snapshot);
  const terrainPath = join(root, 'terrain.json'), previous = process.env.SPATIAL_PREPROCESSING_PATH; process.env.SPATIAL_PREPROCESSING_PATH = terrainPath;
  const cells = Array.from({ length: 144 }, (_, i) => ({ x: i % 12 - 3, y: Math.floor(i / 12) - 3, points: 3, elevation: 0, maxElevation: 0 }));
  const terrain = { version: 'scene-preprocessing-v1', complete: true, binding: { datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: snapshot.dataset.coordinates, indexHash: index.hash, sourceHash: index.sourceHash,
    instanceManifestHash: 'a'.repeat(64), membershipHash: 'b'.repeat(64) }, instances: [], ground: { cellMeters: 1, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3, points: cells.length * 3, cells } };
  const writeTerrain = () => writeFile(terrainPath, JSON.stringify(terrain)); await writeTerrain();
  const spec = (): ResolvedPlacementSpecification => canonicalResolvedPlacementSpecification({ schemaVersion: 1, parameters: {
    binding: { datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision, terrainRevision: digest(JSON.stringify(terrain)), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0],
      pointAuthority: { sessionId: 'points-fixture', revision: 0 }, cadAuthority: { sessionId: 'cad-fixture', revision: 0 } },
    area: { corners: [[0, 0, 100], [4, 0, 100], [4, 4, 100], [0, 4, 100]] }, dimensions: [1, 1, 1.2], frontAccessDepth: 0, frontAccessHeight: 1.8,
    poleSeparation: 0, poleDistance: { from: 'box-boundary', metric: 'horizontal', to: 'observed-pole-points' }, maxGroundSlopeDegrees: 1, maxGroundRelief: .1,
    groundMeasurement: 'sampled-plane-slope-and-height-range', allowedYawDegrees: [0], containment: 'footprint-and-access', maxBodyConflicts: 0, maxAccessConflicts: 0, ranking: [] } });
  t.after(async () => { if (previous === undefined) delete process.env.SPATIAL_PREPROCESSING_PATH; else process.env.SPATIAL_PREPROCESSING_PATH = previous;
    dropSemanticDiskIndexMemoryCache(); await snapshot.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  return { snapshot, index, terrain, terrainPath, writeTerrain, spec, oracle };
}
function change(spec: ResolvedPlacementSpecification, patch: Partial<ResolvedPlacementSpecification['parameters']>) {
  return canonicalResolvedPlacementSpecification({ ...spec, parameters: { ...spec.parameters, ...patch } });
}

test('lattice is not a source-point sample; inclusive AOI edges, stable ties, IDs, ranks and diversity', async t => {
  const f = await fixture(t), o = { ...options(), spacingMeters: .5 };
  const a = await searchPlacement(f.snapshot, f.spec(), o), b = await searchPlacement(f.snapshot, f.spec(), o);
  assert.equal(a.status, 'complete'); assert.equal(a.generated, 81); assert.equal(a.evaluated, 49); assert.equal(a.candidates.length, 49);
  assert.deepEqual(a.candidates.map(c => [c.id, c.rank, c.operation]), b.candidates.map(c => [c.id, c.rank, c.operation]));
  assert.deepEqual(a.candidates[0].operation.center, [.5, .5, .6]); assert.equal(a.candidates[0].poleSeparationMeters, null);
  assert.deepEqual(a.candidates.at(-1)!.operation.center, [3.5, 3.5, .6]);
  const diverse = await searchPlacement(f.snapshot, f.spec(), { ...o, diversityMeters: 1.1, limit: 5 });
  assert.equal(diverse.candidates.length, 5);
  diverse.candidates.forEach((c, i) => diverse.candidates.slice(0, i).forEach(other => assert.ok(Math.hypot(c.operation.center[0] - other.operation.center[0], c.operation.center[1] - other.operation.center[1]) >= 1.1)));
});

test('cardinal orientations swap native dimensions and rotate front access; all volume counts match independent inclusive oracle', async t => {
  const points = Array.from({ length: 145 }, (_, i) => ({ xyz: [((i * 7) % 51) / 10, ((i * 13) % 51) / 10, i % 3 === 0 ? 0 : .8] as Vec3, label: i % 9 }));
  points.push({ xyz: [1, 1, 1.2], label: 8 });
  const f = await fixture(t, points);
  const spec = change(f.spec(), { dimensions: [1, 2, 1.2], frontAccessDepth: .5, allowedYawDegrees: [0, 90, 180, 270], maxBodyConflicts: 1000, maxAccessConflicts: 1000 });
  const result = await searchPlacement(f.snapshot, spec, options()); assert.equal(result.status, 'complete'); assert.ok(result.candidates.length > 0);
  assert.deepEqual([...new Set(result.candidates.map(c => c.yawDegrees))].sort((a,b) => a-b), [0,90,180,270]);
  for (const c of result.candidates) {
    assert.deepEqual(c.operation.dimensions, c.yawDegrees % 180 === 0 ? [1, 2, 1.2] : [2, 1, 1.2]);
    for (const volume of [c.body, c.access!]) {
      const expected = f.oracle.filter(p => p.xyz.every((v, a) => v >= volume.bounds.min[a] && v <= volume.bounds.max[a]));
      assert.equal(volume.totalCount, expected.length);
      assert.equal(volume.obstructionCount, expected.filter(p => !([1,2].includes(p.label) && p.xyz[2] <= .1)).length);
      assert.ok(volume.bounds.min[0] >= 0 && volume.bounds.max[0] <= 4 && volume.bounds.min[1] >= 0 && volume.bounds.max[1] <= 4);
    }
    const access = c.access!.bounds, body = c.body.bounds;
    if (c.yawDegrees === 0) assert.equal(access.min[1], body.max[1]);
    if (c.yawDegrees === 180) assert.equal(access.max[1], body.min[1]);
    if (c.yawDegrees === 90) assert.equal(access.max[0], body.min[0]);
    if (c.yawDegrees === 270) assert.equal(access.min[0], body.max[0]);
    assert.equal(access.max[2], 1.8);
  }
});

test('rotated AOI requires full footprint containment, not just center or AABB containment', async t => {
  const f = await fixture(t), spec = change(f.spec(), { area: { corners: [[2,0,0],[4,2,0],[2,4,0],[0,2,0]] } });
  const result = await searchPlacement(f.snapshot, spec, { ...options(), spacingMeters: Math.SQRT2 });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 1);
  const [x,y] = result.candidates[0].operation.center; assert.ok(Math.abs(x-2) < 1e-12 && Math.abs(y-2) < 1e-12);
});

test('LS plane slope and sampled relief use independent analytic plane; threshold and missing support are hard failures', async t => {
  const f = await fixture(t);
  for (const c of f.terrain.ground.cells) c.elevation = c.maxElevation = .1 * (c.x + .5) + .2 * (c.y + .5);
  await f.writeTerrain(); const spec = change(f.spec(), { maxGroundSlopeDegrees: 20, maxGroundRelief: 1 });
  const result = await searchPlacement(f.snapshot, spec, options()); assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 9);
  for (const c of result.candidates) {
    assert.ok(Math.abs(c.groundSlopeDegrees - Math.atan(Math.hypot(.1,.2))*180/Math.PI) < 1e-12);
    assert.ok(Math.abs(c.groundRelief-.3) < 1e-12);
    assert.ok(Math.abs(c.operation.center[2] - (.1*c.operation.center[0]+.2*c.operation.center[1]+.15+.6)) < 1e-12);
  }
  assert.equal((await searchPlacement(f.snapshot, change(spec, { maxGroundSlopeDegrees: 10 }), options())).candidates.length, 0);
  assert.equal((await searchPlacement(f.snapshot, change(spec, { maxGroundRelief: .2 }), options())).candidates.length, 0);
  f.terrain.ground.cells = []; f.terrain.ground.points = 0; await f.writeTerrain();
  const missing = await searchPlacement(f.snapshot, f.spec(), options()); assert.equal(missing.status, 'complete'); assert.deepEqual(missing.candidates, []);
});

test('exact horizontal pole separation includes high-elevation points and inclusive threshold; declared ranking and center metric', async t => {
  const f = await fixture(t, [{ xyz: [5.5,2,100], label: 6 }, { xyz: [5.5,2,-50], label: 6 }]);
  const spec = change(f.spec(), { poleSeparation: 2, ranking: [{ metric: 'pole-separation', direction: 'maximize' }] });
  const result = await searchPlacement(f.snapshot, spec, options()); assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 9);
  for (const c of result.candidates) {
    const [x,y] = c.operation.center;
    const expected = Math.hypot(Math.max(5.5-x-.5, 0), Math.max(Math.abs(2-y)-.5, 0));
    assert.equal(c.poleSeparationMeters, expected);
  }
  assert.equal(result.candidates[0].operation.center[0], 1);
  assert.ok(result.candidates.some(c => c.poleSeparationMeters === 2));
  const tighter = await searchPlacement(f.snapshot, change(spec, { poleSeparation: 2.0001 }), options());
  assert.ok(!tighter.candidates.some(c => c.poleSeparationMeters === 2));
  const center = await searchPlacement(f.snapshot, change(spec, { poleDistance: { ...spec.parameters.poleDistance, from: 'box-center' } }), options());
  for (const c of center.candidates) assert.equal(c.poleSeparationMeters, Math.hypot(5.5-c.operation.center[0], 2-c.operation.center[1]));
});

test('observed conflict hard limits reject a pose, not capped witnesses; support-band and no-access semantics', async t => {
  const points: Point[] = Array.from({ length: 40 }, (_, i) => ({ xyz: [1,1,.2+i*.01], label: 8 }));
  points.push({ xyz: [1,1,.1], label: 1 }, { xyz: [1,1,0], label: 2 });
  const f = await fixture(t, points), permissive = change(f.spec(), { maxBodyConflicts: 40 });
  const a = await searchPlacement(f.snapshot, permissive, options()), c = a.candidates.find(c => c.operation.center[0] === 1 && c.operation.center[1] === 1)!;
  assert.equal(c.body.totalCount, 42); assert.equal(c.body.obstructionCount, 40); assert.equal(c.body.points.length, 12); assert.equal(c.body.truncated, true); assert.equal(c.access, null);
  const b = await searchPlacement(f.snapshot, change(permissive, { maxBodyConflicts: 39 }), options());
  assert.ok(!b.candidates.some(c => c.operation.center[0] === 1 && c.operation.center[1] === 1));
});

test('pole reduction traverses complete pages beyond capped witness domains', async t => {
  const raw: Point[] = Array.from({ length: 4200 }, () => ({ xyz: [50, 50, 100], label: 6 }));
  raw.push({ xyz: [4.5, 2, 100], label: 6 });
  const f = await fixture(t, raw), result = await searchPlacement(f.snapshot, f.spec(), options());
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 9);
  const c = result.candidates.find(c => c.operation.center[0] === 3 && c.operation.center[1] === 2)!;
  assert.equal(c.poleSeparationMeters, 1);
});

test('ranking is lexicographic in declared order, not a weighted score', async t => {
  const f = await fixture(t, [{ xyz: [1,1,.5], label: 8 }, { xyz: [5.5,3,100], label: 6 }]);
  const spec = change(f.spec(), { maxBodyConflicts: 1, ranking: [{ metric: 'body-conflicts', direction: 'minimize' }, { metric: 'pole-separation', direction: 'maximize' }] });
  const result = await searchPlacement(f.snapshot, spec, options()); assert.equal(result.status, 'complete');
  assert.deepEqual(result.candidates[0].operation.center, [1,2,.6]); assert.equal(result.candidates.at(-1)!.body.obstructionCount, 1);
  const reversed = await searchPlacement(f.snapshot, change(spec, { ranking: [...spec.parameters.ranking].reverse() }), options());
  assert.deepEqual(reversed.candidates[0].operation.center, [1,1,.6]);
});

test('failure or cancellation after feasible poses discards all partial results', async t => {
  const f = await fixture(t, [{ xyz: [0,0,0], label: 1 }, { xyz: [4,4,0], label: 1 }]), read = f.index.readPage.bind(f.index); let calls = 0;
  f.index.readPage = async (...args) => { if (++calls === 4) throw new Error('injected late page failure'); return read(...args); };
  const failed = await searchPlacement(f.snapshot, f.spec(), options());
  assert.equal(failed.status, 'incomplete'); assert.ok(failed.evaluated >= 4); assert.deepEqual(failed.candidates, []); assert.match(failed.reason!, /injected late/);
  const abort = new AbortController(); calls = 0;
  f.index.readPage = async (...args) => { if (++calls === 4) abort.abort(); return read(...args); };
  const stopped = await searchPlacement(f.snapshot, f.spec(), { ...options(), signal: abort.signal });
  assert.equal(stopped.reason, 'cancelled'); assert.ok(stopped.evaluated >= 4); assert.deepEqual(stopped.candidates, []);
  f.index.readPage = read;
});

test('unsupported yaw and pole modes reject explicitly; request inputs are detached across awaits', async t => {
  const f = await fixture(t);
  await assert.rejects(searchPlacement(f.snapshot, change(f.spec(), { allowedYawDegrees: [45] }), options()), /Unsupported placement yaw/);
  await assert.rejects(searchPlacement(f.snapshot, change(f.spec(), { poleDistance: { ...f.spec().parameters.poleDistance, metric: '3d' } }), options()), /Unsupported pole metric/);
  const spec = structuredClone(f.spec()), pending = searchPlacement(f.snapshot, spec, options());
  (spec.parameters.dimensions as unknown as number[])[0] = 100;
  assert.equal((await pending).candidates.length, 9);
});

test('monotonic time budget terminates with no partial shortlist', async t => {
  const f = await fixture(t); let now = 0;
  t.mock.method(performance, 'now', () => { now += 1000; return now; });
  const result = await searchPlacement(f.snapshot, f.spec(), options());
  assert.equal(result.status, 'incomplete'); assert.deepEqual(result.candidates, []); assert.match(result.reason!, /time budget|time-budget/);
});

test('pose budget, abort and query failure never expose partial usable candidates; exact binding invalidation', async t => {
  const f = await fixture(t), spec = f.spec();
  const budget = await searchPlacement(f.snapshot, spec, { ...options(), maxPoses: 15 });
  assert.equal(budget.status, 'incomplete'); assert.equal(budget.generated, 15); assert.ok(budget.evaluated > 0); assert.deepEqual(budget.candidates, []); assert.match(budget.reason!, /pose-budget/);
  const abort = new AbortController(); abort.abort();
  const stopped = await searchPlacement(f.snapshot, spec, { ...options(), signal: abort.signal }); assert.equal(stopped.reason, 'cancelled'); assert.deepEqual(stopped.candidates, []);
  f.terrain.ground.cells[0].maxElevation = .01; await f.writeTerrain();
  const stale = await searchPlacement(f.snapshot, spec, options()); assert.equal(stale.status, 'incomplete'); assert.match(stale.reason!, /terrain\/index binding mismatch/); assert.deepEqual(stale.candidates, []);
  await rm(f.terrainPath);
  const failed = await searchPlacement(f.snapshot, spec, options()); assert.equal(failed.status, 'incomplete'); assert.deepEqual(failed.candidates, []);
});
