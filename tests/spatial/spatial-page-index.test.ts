import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact } from '../../apps/server/src/spatial/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache, pagePoints, type SemanticDiskPage } from '../../apps/server/src/spatial/semantic-disk-index';
import { buildPageKdTree, SpatialPageIndex, type SpatialPoint } from '../../apps/server/src/spatial/spatial-page-index';

type Point = { xyz: Vec3; label: number };
async function fixture(points: Point[]) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-page-test-'));
  await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 100] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 } ] };
  const counts = [0, 0, 0, 0], payload = Buffer.alloc(points.length * 28);
  const oracle = points.map((p, i) => {
    const file = 4 - i % 4, row = counts[file - 1]++;
    const xyz = p.xyz.map((n, a) => { const raw = Math.round(n * 1000); payload.writeInt32LE(raw, i * 28 + a * 4); return raw * .001; }) as unknown as Vec3;
    payload.writeUInt16LE(file, i * 28 + 18); payload.writeUInt32LE(row, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
    return { position: xyz, label: p.label, source: { sourceFileId: file, sourceRow: row, preparedRecordIndex: i } };
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: counts.map((count, i) => ({ source_file_id: i + 1, file: `L00${i + 1}.ply`, points: count })) };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root), { index } = await getSemanticDiskIndex(snapshot), spatial = await SpatialPageIndex.create(snapshot, index);
  return { root, snapshot, index, spatial, oracle,
    async clean() { dropSemanticDiskIndexMemoryCache(); await snapshot.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); } };
}
const id = (p: { source: SpatialPoint['source'] }) => p.source.preparedRecordIndex;

test('page KD-tree complete immutable all-label bounds, disjoint leaves and invalid coverage', () => {
  const make = (i: number, label: number, min: Vec3, max: Vec3): SemanticDiskPage => ({ start: i * pagePoints, count: pagePoints, hash: '',
    labels: Array.from({ length: 9 }, (_, n) => n === label ? { count: pagePoints, min, max } : null) });
  const pages = [make(0, 0, [-20, -8, -3], [-10, -4, -1]), make(1, 8, [10, 2, 1], [30, 9, 3]), make(2, 6, [-1, -1, -1], [1, 1, 1])];
  const tree = buildPageKdTree(pages, pagePoints * 3);
  assert.deepEqual(tree.root!.min, [-20, -8, -3]); assert.deepEqual(tree.root!.max, [30, 9, 3]);
  assert.ok(Object.isFrozen(tree.root)); assert.ok(Object.isFrozen(tree.root!.min));
  assert.equal(buildPageKdTree([], 0).root, undefined);
  assert.throws(() => buildPageKdTree(pages, pagePoints * 2));
  assert.throws(() => buildPageKdTree([{ ...pages[0], start: 1 }], pagePoints));
  assert.throws(() => buildPageKdTree([{ ...pages[0], labels: [] }], pagePoints));
});

test('nearest/radius equal exhaustive binary64 oracle across pages, labels, negative coordinates, boundaries and physical ties', async () => {
  const points: Point[] = Array.from({ length: pagePoints * 3 + 7 }, (_, i) => ({ xyz: [((i * 71) % 199 - 99) * .01, ((i * 23) % 173 - 86) * .02, ((i * 11) % 113 - 56) * .03], label: i % 9 }));
  points[0] = { xyz: [-1, 0, 0], label: 6 }; points[pagePoints + 2] = { xyz: [1, 0, 0], label: 6 };
  const f = await fixture(points);
  try {
    for (const q of [[0, 0, 0], [-2.123, -.2, .8], [10, 10, 10]] as Vec3[]) for (const label of [undefined, 0, 6, 8]) {
      const oracle = f.oracle.filter(p => label === undefined || p.label === label).map(p => ({ ...p, distance: Math.hypot(...p.position.map((n, a) => n - q[a])) }));
      oracle.sort((a, b) => a.distance - b.distance || id(a) - id(b));
      const nearest = await f.spatial.nearest(q, { label });
      assert.equal(id(nearest.point!), id(oracle[0])); assert.equal(nearest.point!.distanceMeters, oracle[0].distance);
      assert.deepEqual(nearest.point!.source, oracle[0].source); assert.deepEqual(nearest.point!.position, oracle[0].position);
      assert.equal(nearest.point!.artifactRevision, f.snapshot.dataset.revision); assert.equal(nearest.point!.units, 'm'); assert.equal(nearest.point!.frameId, 'toronto3d-local-v1');
      for (const radius of [0, oracle[0].distance, .7, 100]) {
        const expected = oracle.filter(p => p.distance <= radius).map(id).sort((a, b) => a - b);
        const result = await f.spatial.radius(q, radius, { label, maxResults: 10000 });
        assert.equal(result.totalCount, expected.length); assert.equal(result.truncated, expected.length > 10000);
        if (!result.truncated) assert.deepEqual(result.points.map(id), expected);
        assert.ok(result.points.length <= 10000);
      }
    }
    const big = await f.spatial.radius([0, 0, 0], Number.MAX_VALUE, { maxResults: 2 });
    assert.equal(big.totalCount, points.length); assert.equal(big.points.length, 2); assert.equal(big.truncated, true); assert.equal(big.statistics.checkedPages, f.index.pages.length);
    assert.deepEqual((await f.spatial.radius([0, 0, 0], 100, { maxResults: 0 })).points, []);
    const clearance = await f.spatial.clearance([0, 0, 0]); assert.equal(clearance.distanceMeters, clearance.point!.distanceMeters); assert.equal(clearance.domain, 'original-source-points');
    // A dedicated zero-radius coincident tie: source file 4 physically precedes source file 3.
    const tie = await fixture([{ xyz: [0, 0, 0], label: 6 }, { xyz: [0, 0, 0], label: 6 }]);
    try { assert.equal(id((await tie.spatial.nearest([0, 0, 0])).point!), 0); } finally { await tie.clean(); }
  } finally { await f.clean(); }
});

test('empty/filter domains, page/time budgets, pre/mid cancellation and malformed inputs fail closed', async () => {
  const f = await fixture(Array.from({ length: pagePoints + 1 }, () => ({ xyz: [-1, 0, 0] as Vec3, label: 6 })));
  try {
    assert.equal((await f.spatial.nearest([0, 0, 0], { label: 1, maxPages: 0 })).point, null);
    assert.equal((await f.spatial.radius([0, 0, 0], 2, { label: 1 })).totalCount, 0);
    await assert.rejects(f.spatial.nearest([0, 0, 0], { maxPages: 0 }), /page budget/);
    await assert.rejects(f.spatial.nearest([0, 0, 0], { maxPages: 1 }), /page budget/);
    await assert.rejects(f.spatial.radius([0, 0, 0], 2, { maxPages: 1 }), /page budget/);
    const original = f.index.readPage.bind(f.index);
    f.index.readPage = async (...args) => { await new Promise(resolve => setTimeout(resolve, 10)); return await original(...args); };
    await assert.rejects(f.spatial.nearest([0, 0, 0], { maxMilliseconds: 5 }), /time budget/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.spatial.nearest([0, 0, 0], { signal: controller.signal }));
    const mid = new AbortController(); f.index.readPage = async (...args) => { const bytes = await original(...args); mid.abort(); return bytes; };
    await assert.rejects(f.spatial.radius([0, 0, 0], 2, { signal: mid.signal }));
    for (const label of [-1, 9, .1, NaN]) await assert.rejects(f.spatial.nearest([0, 0, 0], { label }), RangeError);
    await assert.rejects(f.spatial.nearest([NaN, 0, 0]), RangeError);
    await assert.rejects(f.spatial.radius([0, 0, 0], -1), RangeError);
    await assert.rejects(f.spatial.radius([0, 0, 0], 1, { maxResults: 10001 }), RangeError);
  } finally { await f.clean(); }
  // SemanticArtifact rejects zero-point prepared metadata; pure empty trees are checked above.
  const empty = await fixture([{ xyz: [0, 0, 0], label: 6 }]);
  try { assert.equal((await empty.spatial.clearance([0, 0, 0], { label: 1 })).distanceMeters, null); }
  finally { await empty.clean(); }
});

test('disjoint page bounds prune exact queries while cross-page equal-distance ties remain deterministic', async () => {
  const points: Point[] = Array.from({ length: pagePoints * 3 }, (_, i) => ({ xyz: [i < pagePoints ? -20 : i < pagePoints * 2 ? 0 : 20, 0, 0], label: 6 }));
  const f = await fixture(points);
  try {
    const near = await f.spatial.nearest([0, 0, 0]);
    assert.equal(id(near.point!), pagePoints); assert.equal(near.statistics.checkedPages, 1);
    const radius = await f.spatial.radius([0, 0, 0], 0, { maxResults: 1 });
    assert.equal(radius.totalCount, pagePoints); assert.equal(radius.statistics.checkedPages, 1); assert.equal(radius.truncated, true);
    const tie = await f.spatial.nearest([-10, 0, 0]);
    assert.equal(id(tie.point!), 0); assert.equal(tie.point!.distanceMeters, 10); assert.equal(tie.statistics.checkedPages, 2);
  } finally { await f.clean(); }
});

test('canonical snapshot binding and mutations before/after reads reject, never partial success', async () => {
  for (const mode of ['source', 'index', 'during']) {
    const f = await fixture([{ xyz: [0, 0, 0], label: 6 }]);
    try {
      const mutate = async () => { const file = await open(join(mode === 'source' ? f.root : f.index.directory, mode === 'source' ? 'octree/octree.bin' : 'records.bin'), 'r+');
        try { await file.write(Buffer.from([1]), 0, 1, 0); } finally { await file.close(); } };
      if (mode === 'during') { const read = f.index.readPage.bind(f.index); f.index.readPage = async (...args) => { const bytes = await read(...args); await mutate(); return bytes; }; }
      else await mutate();
      await assert.rejects(f.spatial.nearest([0, 0, 0]));
    } finally { await f.clean(); }
  }
  const a = await fixture([{ xyz: [0, 0, 0], label: 6 }]), b = await fixture([{ xyz: [1, 0, 0], label: 6 }]);
  try { await assert.rejects(SpatialPageIndex.create(a.snapshot, b.index)); } finally { await a.clean(); await b.clean(); }
});
