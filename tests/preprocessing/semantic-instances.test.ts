import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact, digest } from '../../apps/server/src/spatial/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../../apps/server/src/spatial/semantic-disk-index';
import { clusterSemanticInstances, type InstanceOptions } from '../../apps/server/src/preprocessing/semantic-instances';
import { parseInstanceArguments } from '../../scripts/cluster-semantic-instances';
import { checkSemanticInstances } from '../../scripts/check-semantic-instances';

type Point = { xyz: number[]; label: number };
async function fixture(points: Point[]) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-instances-test-')), source = join(root, 'source');
  await mkdir(join(source, 'octree'), { recursive: true });
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 100] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 } ] };
  const counts = [0, 0, 0, 0], keys: { file: number; row: number }[] = [], payload = Buffer.alloc(points.length * 28);
  points.forEach((p, i) => { const file = i % 4 + 1, row = counts[file - 1]++; keys.push({ file, row });
    p.xyz.forEach((n, axis) => payload.writeInt32LE(Math.round(n * 1000), i * 28 + axis * 4));
    payload.writeUInt16LE(file, i * 28 + 18); payload.writeUInt32LE(row, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24); });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: counts.map((count, i) => ({ source_file_id: i + 1, file: `L00${i + 1}.ply`, points: count })) };
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(source, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(source, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(source, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(source), { index } = await getSemanticDiskIndex(snapshot);
  return { root, source, snapshot, index, keys,
    async run(name: string, options: InstanceOptions = {}) { return await clusterSemanticInstances(snapshot, index, join(root, name), options); },
    async clean() { dropSemanticDiskIndexMemoryCache(); await snapshot.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); } };
}
const classes = [{ label: 6 as const, voxelMeters: 1 }, { label: 7 as const, voxelMeters: 1 }, { label: 8 as const, voxelMeters: 1 }];

test('class-specific transitive 26-neighbor components preserve every exact original membership across pages', async () => {
  const points: Point[] = [
    { xyz: [-.001, 0, 0], label: 6 }, { xyz: [0, 0, 0], label: 6 }, { xyz: [1, 1, 1], label: 6 },
    { xyz: [5, 0, 0], label: 6 }, { xyz: [0, 0, 0], label: 7 }, { xyz: [0, 0, 0], label: 8 },
    { xyz: [0, 0, 0], label: 4 }, { xyz: [0, 0, 0], label: 1 },
    ...Array.from({ length: 4100 }, () => ({ xyz: [0, 0, 0], label: 6 })),
  ];
  const f = await fixture(points);
  try {
    const m = await f.run('a', { classes }), repeated = await f.run('b', { classes: [...classes].reverse() });
    assert.deepEqual(m, repeated); assert.equal(m.instances.length, 4); assert.equal(m.statistics.cells, 6);
    assert.deepEqual(m.instances.map(c => [c.label, c.points]), [[6, 4103], [6, 1], [7, 1], [8, 1]]);
    assert.deepEqual(m.instances[0].anchor, { sourceFileId: 1, sourceRow: 0 });
    assert.equal(m.binding.units, 'm'); assert.equal(m.binding.frameId, 'toronto3d-local-v1'); assert.equal(m.binding.indexHash, f.index.hash);
    const bytes = await readFile(join(f.root, 'a/memberships.bin')); assert.equal(digest(bytes), m.membership.sha256);
    let at = 0; points.forEach((p, physical) => {
      if (![6, 7, 8].includes(p.label)) return;
      const ordinal = physical === 3 ? 1 : p.label === 7 ? 2 : p.label === 8 ? 3 : 0;
      assert.deepEqual([0, 4, 8, 12].map(n => bytes.readUInt32LE(at + n)), [ordinal, f.keys[physical].file, f.keys[physical].row, physical]); at += 16;
    }); assert.equal(at, bytes.length); assert.equal(at, m.membership.bytes);
    assert.equal((await checkSemanticInstances(f.source, join(f.root, 'a'))).exactMemberships, m.membership.points);
    const corrupted = Buffer.from(bytes); corrupted.writeUInt32LE(999, 4);
    await writeFile(join(f.root, 'b/memberships.bin'), corrupted);
    await assert.rejects(checkSemanticInstances(f.source, join(f.root, 'b')));
    const changed = await f.run('changed', { classes: [{ label: 6, voxelMeters: .5 }] });
    assert.notEqual(changed.instances[0].id, m.instances[0].id);
    await assert.rejects(f.run('a', { classes }), /already exists/);
  } finally { await f.clean(); }
});

test('optional Building and empty selected classes produce complete truthful artifacts', async () => {
  const f = await fixture([{ xyz: [0, 0, 0], label: 4 }]);
  try {
    const empty = await f.run('empty'); assert.equal(empty.membership.points, 0); assert.deepEqual(empty.instances, []);
    assert.equal((await readFile(join(f.root, 'empty/memberships.bin'))).length, 0);
    assert.equal((await f.run('building', { classes: [{ label: 4, voxelMeters: 1 }] })).instances[0].points, 1);
  } finally { await f.clean(); }
});

test('explicit cell/output/manifest/time budgets and invalid configuration never publish partial directories', async () => {
  const f = await fixture([{ xyz: [0, 0, 0], label: 6 }, { xyz: [5, 0, 0], label: 6 }]);
  try {
    const cases: InstanceOptions[] = [{ limits: { maxCells: 1 } }, { limits: { maxMembershipBytes: 1 } },
      { limits: { maxManifestBytes: 1 } }, { limits: { maxMilliseconds: 1 } }, { limits: { maxCells: 0 } },
      { classes: [] }, { classes: [{ label: 6, voxelMeters: NaN }] }, { classes: [classes[0], classes[0]] }];
    for (let i = 0; i < cases.length; i++) { await assert.rejects(f.run(`bad-${i}`, cases[i])); }
    assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.clean(); }
});

test('pre-cancelled and stale source snapshots fail closed without output', async () => {
  const f = await fixture([{ xyz: [0, 0, 0], label: 6 }]);
  try {
    const c = new AbortController(); c.abort(new Error('cancelled')); await assert.rejects(f.run('cancelled', { signal: c.signal }), /cancelled/);
    await writeFile(join(f.source, 'octree/octree.bin'), Buffer.alloc(28));
    await assert.rejects(f.run('stale'), /Artifact changed/); assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.clean(); }
});

test('disk page corruption is never converted into a complete segmentation', async () => {
  const f = await fixture([{ xyz: [0, 0, 0], label: 6 }]);
  try {
    const handle = await open(join(f.index.directory, 'records.bin'), 'r+');
    try { await handle.write(Buffer.from([1]), 0, 1, 0); } finally { await handle.close(); }
    await assert.rejects(f.run('corrupt'), /cache changed/i); assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.clean(); }
});

test('cancellation during membership pass removes staging artifacts instead of publishing a prefix', async () => {
  const f = await fixture([{ xyz: [0, 0, 0], label: 6 }]);
  try {
    const c = new AbortController(), original = f.index.readPage.bind(f.index); let reads = 0;
    f.index.readPage = async (page, signal) => { if (++reads === 2) c.abort(new Error('cancel second pass')); return await original(page, signal); };
    await assert.rejects(f.run('cancel-second', { signal: c.signal }), /cancel second pass/);
    assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.clean(); }
});

test('CLI admits explicit settings and rejects unknown, duplicate or malformed options', () => {
  const parsed = parseInstanceArguments(['source', 'output', '--classes', '6:.25,7:0.5', '--max-cells', '100']);
  assert.deepEqual(parsed.options.classes, [{ label: 6, voxelMeters: .25 }, { label: 7, voxelMeters: .5 }]);
  assert.equal(parsed.options.limits.maxCells, 100);
  for (const args of [[], ['a', 'b', '--oops', '1'], ['a', 'b', '--classes', '6'], ['a', 'b', '--max-cells', 'NaN'],
    ['a', 'b', '--max-cells', '1', '--max-cells', '2']]) assert.throws(() => parseInstanceArguments(args));
});
