import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { prepareSemanticInstances } from '../../apps/server/src/preprocessing/semantic-instances';
import { accumulatePoint, pointStatistics, initialPrimitiveFit, primitiveResidual, groundElevation,
  prepareScenePreprocessing } from '../../apps/server/src/preprocessing/scene-preprocessing';

test('stable sufficient stats and vertical-cylinder residuals distinguish surface from interior', () => {
  const s = pointStatistics();
  for (const z of [0, 1, 2]) for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) accumulatePoint(s, [x, y, z]);
  const f = initialPrimitiveFit(s, 6)!;
  assert.equal(f.status, 'fitted'); assert.ok(Math.abs(f.radius! - 1) < 1e-12);
  assert.ok(primitiveResidual(f, [1, 0, 1]) < 1e-12); assert.ok(Math.abs(primitiveResidual(f, [0, 0, 1]) - 1) < 1e-12);
  assert.ok(Math.abs(primitiveResidual(f, [2, 0, 3]) - Math.SQRT2) < 1e-12);
  assert.equal(initialPrimitiveFit(s, 8), undefined);
  assert.throws(() => accumulatePoint(s, [NaN, 0, 0]));
});

type Point = { xyz: number[]; label: number };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-preprocessing-test-')), source = join(root, 'source');
  await mkdir(join(source, 'octree'), { recursive: true });
  const points: Point[] = [];
  for (const z of [0, .2, .4, .6]) for (const [x, y] of [[.1, 0], [0, .1], [-.1, 0], [0, -.1]]) points.push({ xyz: [x, y, z], label: 6 });
  for (const x of [-.5, 0, .5]) for (const y of [-.25, .25]) for (const z of [0, .5]) {
    const a = Math.PI / 6; points.push({ xyz: [5 + x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z], label: 7 });
  }
  for (let i = 0; i < 4101; i++) points.push({ xyz: [10, 0, 0], label: 8 });
  points.push({ xyz: [15, 0, 0], label: 6 });
  points.push({ xyz: [2.1, 2.1, 3], label: 1 }, { xyz: [2.2, 2.2, 3.1], label: 2 }, { xyz: [2.3, 2.3, 3.2], label: 1 },
    { xyz: [2.2, 2.2, -10], label: 3 }, { xyz: [2.2, 2.2, -20], label: 4 }, { xyz: [-.1, -.1, 4], label: 1 });
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 100] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 } ] };
  const counts = [0, 0, 0, 0], payload = Buffer.alloc(points.length * 28);
  points.forEach((p, i) => {
    p.xyz.forEach((n, a) => payload.writeInt32LE(Math.round(n * 1000), i * 28 + a * 4));
    const file = i % 4; payload.writeUInt16LE(file + 1, i * 28 + 18); payload.writeUInt32LE(counts[file]++, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: counts.map((n, i) => ({ source_file_id: i + 1, file: `L00${i + 1}.ply`, points: n })) };
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(source, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(source, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(source, 'octree/octree.bin'), payload);
  const instances = join(root, 'instances'); await prepareSemanticInstances(source, instances, { classes: [{ label: 6, voxelMeters: 1 }, { label: 7, voxelMeters: 1 }, { label: 8, voxelMeters: 1 }] });
  return { root, source, instances, clean: () => rm(root, { recursive: true, force: true }) };
}

test('complete streaming ground and fits retain exact source bounds, actual coverage and deterministic binding', async () => {
  const f = await fixture();
  try {
    const a = await prepareScenePreprocessing(f.source, f.instances, join(f.root, 'a'));
    const b = await prepareScenePreprocessing(f.source, f.instances, join(f.root, 'b'));
    assert.deepEqual(a, b); assert.equal(a.binding.units, 'm'); assert.equal(a.statistics.memberships, 4130);
    assert.equal(a.ground.points, 4); assert.equal(a.ground.cells.length, 2);
    assert.equal(groundElevation(a.ground, 2.5, 2.5), 3); assert.equal(groundElevation(a.ground, -.1, -.1), undefined);
    assert.equal(groundElevation(a.ground, 8, 8), undefined);
    const pole = a.instances.find(i => i.points === 16)!;
    assert.deepEqual(pole.bounds, { min: [-.1, -.1, 0], max: [.1, .1, .6] });
    assert.equal(pole.fit!.coverage, 1); assert.equal(pole.fit!.evaluatedPoints, 16); assert.ok(pole.fit!.rmseMeters! < 1e-12);
    const car = a.instances.find(i => i.label === 7)!;
    assert.equal(car.fit!.status, 'fitted'); assert.equal(car.fit!.coverage, 1); assert.ok(Math.abs(car.fit!.yawRadians - Math.PI / 6) < .002);
    assert.equal(a.instances.find(i => i.label === 8)!.fit, undefined);
    assert.equal(a.instances.find(i => i.points === 1 && i.label === 6)!.fit!.status, 'insufficient');
    assert.deepEqual(JSON.parse(await readFile(join(f.root, 'a/manifest.json'), 'utf8')), a);
    await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'a')), /already exists/);
  } finally { await f.clean(); }
});

test('budgets, cancellation, changed source and corrupt memberships never publish a prefix', async () => {
  const f = await fixture();
  try {
    for (const limits of [{ maxGroundCells: 1 }, { maxInstances: 1 }, { maxOutputBytes: 1 }, { maxMilliseconds: 1 }]) {
      await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'bad'), { limits }));
    }
    const c = new AbortController(); c.abort(new Error('cancelled'));
    await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'bad'), { signal: c.signal }), /cancelled/);
    const path = join(f.instances, 'memberships.bin'), original = await readFile(path), bytes = Buffer.from(original);
    bytes.writeUInt32LE(0xffffffff, 0); await writeFile(path, bytes);
    await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'bad')), /Membership\/source mismatch/);
    await writeFile(path, original);
    const manifestPath = join(f.instances, 'manifest.json'), m = JSON.parse(await readFile(manifestPath, 'utf8'));
    m.membership.sha256 = '0'.repeat(64); await writeFile(manifestPath, JSON.stringify(m));
    await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'bad')), /checksum/);
    await writeFile(join(f.source, 'octree/octree.bin'), Buffer.alloc(28 * 36));
    await assert.rejects(prepareScenePreprocessing(f.source, f.instances, join(f.root, 'bad')));
    assert.deepEqual((await readdir(f.root)).sort(), ['instances', 'source']);
  } finally { await f.clean(); }
});
