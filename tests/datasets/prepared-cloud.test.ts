import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPreparedCloudRegistry, parsePreparedCloudDescriptor, type PreparedCloudDescriptor } from '../../apps/server/src/datasets/prepared-cloud';
import { PotreeDataset, parseMetadata, decodePoint } from '../../apps/server/src/datasets/potree';

async function fixture(t: { after(fn: () => Promise<unknown>): void }, semantics = false, points = 4) {
  const root = await mkdtemp(join(tmpdir(), 'prepared-cloud-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  const split = Math.floor(points / 2);
  const descriptor: PreparedCloudDescriptor = { version: 1, format: 'potree2-uncompressed', id: 'quarry-west', frameId: 'quarry-local-v3',
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [123400, 432100, 80] },
    sources: [{ id: 42, name: 'survey-a.las', points: split }, { id: 99, name: 'survey-b.las', points: points - split }],
    ...(semantics ? { semantics: { attribute: 'classification', type: 'uint8' as const, classes: { '42': 'Rock face', '77': 'Equipment' } } } : {}) };
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points, scale: [0.01, 0.01, 0.01], offset: [10, 20, -5],
    hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [10, 20, -5], max: [14, 24, 0] }, attributes: [
      { name: 'position', type: 'int32', size: 12, min: [10, 20, -5], max: [13, 23, -2] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 },
      ...(semantics ? [{ name: 'classification', type: 'uint8', size: 1 }] : []),
    ] };
  const stride = semantics ? 25 : 24, payload = Buffer.alloc(stride * points);
  for (let i = 0; i < points; i++) {
    const at = stride * i;
    for (let axis = 0; axis < 3; axis++) payload.writeInt32LE((i % 4) * 100, at + axis * 4);
    payload.writeUInt16LE(65535, at + 12); payload.writeUInt16LE(32896, at + 14);
    payload.writeUInt16LE(i < split ? 42 : 99, at + 18); payload.writeUInt32LE(i < split ? i : i - split, at + 20);
    if (semantics) payload.writeUInt8(i < split ? 42 : 77, at + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await Promise.all([
    writeFile(join(root, 'cloud.json'), JSON.stringify(descriptor)), writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)),
    writeFile(join(root, 'octree/hierarchy.bin'), hierarchy), writeFile(join(root, 'octree/octree.bin'), payload),
    writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: descriptor.coordinates.localOrigin })),
  ]);
  const registry = createPreparedCloudRegistry({ 'quarry-west': root });
  return { root, descriptor, metadata, hierarchy, payload, registry, reader: registry.open('quarry-west') };
}

test('second cloud actually loads with a different origin, frame, IDs and no semantic labels', async t => {
  const f = await fixture(t), info = await f.reader.info();
  assert.equal(info.descriptor.id, 'quarry-west'); assert.equal(info.descriptor.frameId, 'quarry-local-v3');
  assert.deepEqual(info.descriptor.coordinates.localOrigin, [123400, 432100, 80]);
  assert.deepEqual(info.capabilities, { boundedSample: true, adaptiveDisplay: true, semanticLabels: false, instanceLabels: false, fullResolution: false, editing: false });
  assert.equal(info.totalPoints, 4);
  const sample = await f.reader.sample(info.revision, { budget: 4, depth: 0 });
  assert.deepEqual(sample.positions, [10, 20, -5, 11, 21, -4, 12, 22, -3, 13, 23, -2]);
  assert.deepEqual(sample.colors, Array.from({ length: 4 }, () => [255, 128, 0]).flat());
  assert.deepEqual(sample.sourceIds, [42, 0, 42, 1, 99, 0, 99, 1]); assert.equal(Object.hasOwn(sample, 'labels'), false);
  assert.equal(sample.bytesRead, 22 + 96); assert.deepEqual(sample.nodes, ['r']);
  assert.equal(sample.sampleHash, (await f.reader.sample(info.revision, { budget: 4, depth: 0 })).sampleHash);
  assert.equal((await f.reader.sample(info.revision, { budget: 2, depth: 0 })).count, 2);
  // Client-owned returned metadata cannot mutate the authority's next observation.
  (info.descriptor.coordinates.localOrigin as number[])[0] = 999;
  assert.deepEqual((await f.reader.info()).descriptor.coordinates.localOrigin, [123400, 432100, 80]);
});

test('in-flight caller LOD mutation cannot bypass the budget limit or change reported sampling parameters', async t => {
  const f = await fixture(t, false, 4097), info = await f.reader.info();
  const lod = { budget: 4096, depth: 0 };
  const pending = f.reader.sample(info.revision, lod);
  // sample has synchronously validated the request and is awaiting filesystem IO.
  lod.budget = 4097;
  lod.depth = 8;
  const sample = await pending;
  assert.equal(sample.candidatePoints, 4097);
  assert.equal(sample.count, 4096);
  assert.equal(sample.positions.length, 4096 * 3);
  assert.deepEqual(sample.lod, { budget: 4096, depth: 0 });
});

test('different taxonomy is explicit and never interpreted as Toronto labels', async t => {
  const f = await fixture(t, true), info = await f.reader.info();
  const sample = await f.reader.sample(info.revision, { budget: 4, depth: 0 });
  assert.equal(info.capabilities.semanticLabels, true);
  assert.deepEqual(sample.labels, [42, 42, 77, 77]);
  assert.equal(info.descriptor.semantics?.classes['42'], 'Rock face');
  assert.throws(() => parseMetadata(f.metadata), /Missing attributes/);
  await assert.rejects(new PotreeDataset(f.root).info(), /Unsupported Toronto coordinate/);
});

test('Toronto metadata and decoder remain strict for generic provenance and labels', async t => {
  const f = await fixture(t);
  assert.throws(() => parseMetadata(f.metadata), /Missing attributes/);
  const metadata = { ...f.metadata, attributes: [...f.metadata.attributes, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const layout = parseMetadata(metadata), point = Buffer.alloc(28);
  // Position matches generic bounds; unsupported source ID and class must each fail.
  point.writeUInt16LE(42, 18); point.writeFloatLE(1, 24);
  assert.throws(() => decodePoint(point, 0, layout), /Invalid provenance or label/);
  point.writeUInt16LE(1, 18); point.writeFloatLE(42, 24);
  assert.throws(() => decodePoint(point, 0, layout), /Invalid provenance or label/);
});

test('registry admits IDs only, has no path traversal or Toronto fallback', async t => {
  const f = await fixture(t);
  for (const id of ['toronto3d', '../quarry-west', f.root, '', '__proto__']) assert.throws(() => f.registry.open(id), /Unknown prepared cloud/);
  const wrong = createPreparedCloudRegistry({ another: f.root }).open('another');
  await assert.rejects(wrong.info(), /Cloud identity mismatch/);
});

test('unsupported descriptors fail closed instead of supplying default frames or semantics', async t => {
  const { descriptor } = await fixture(t);
  for (const change of [{ version: 2 }, { format: 'las' }, { coordinates: undefined }, { frameId: undefined },
    { coordinates: { ...descriptor.coordinates, units: 'ft' } }, { sources: [{ id: 42, name: 'a', points: 2 }, { id: 42, name: 'b', points: 2 }] },
    { semantics: { attribute: 'classification', type: 'uint8', classes: { '999': 'Impossible' } } },
    { semantics: { attribute: 'position', type: 'float', classes: { '1': 'Bad' } } }]) {
    assert.throws(() => parsePreparedCloudDescriptor({ ...descriptor, ...change }));
  }
});

test('revisions bind descriptor, metadata and payload identity; stale reads and cancellation reject', async t => {
  const f = await fixture(t), old = await f.reader.info();
  await writeFile(join(f.root, 'cloud.json'), JSON.stringify({ ...f.descriptor, frameId: 'quarry-local-v4' }));
  assert.notEqual((await f.reader.info()).revision, old.revision);
  await assert.rejects(f.reader.sample(old.revision, { budget: 4, depth: 0 }), /Stale cloud revision/);
  const info = await f.reader.info(), changed = Buffer.from(f.payload); changed.writeUInt16LE(12345, 12);
  await writeFile(join(f.root, 'octree/octree.bin'), changed);
  await assert.rejects(f.reader.sample(info.revision, { budget: 4, depth: 0 }), /Stale cloud revision/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.reader.info(abort.signal), { name: 'AbortError' });
  await assert.rejects(f.reader.sample((await f.reader.info()).revision, { budget: 4, depth: 0 }, abort.signal), { name: 'AbortError' });
  await assert.rejects(f.reader.sample('invalid', { budget: 4, depth: 0 }), /Invalid cloud revision/);
});

test('malformed samples fail on source keys and unmapped labels rather than fabricate metadata', async t => {
  const f = await fixture(t, true);
  for (const mutate of [(b: Buffer) => b.writeUInt16LE(88, 18), (b: Buffer) => b.writeUInt32LE(2, 20), (b: Buffer) => b.writeUInt8(9, 24)]) {
    const bytes = Buffer.from(f.payload); mutate(bytes); await writeFile(join(f.root, 'octree/octree.bin'), bytes);
    await assert.rejects(f.reader.sample((await f.reader.info()).revision, { budget: 4, depth: 0 }), /Invalid cloud source key|Unmapped semantic label/);
  }
});

test('in-flight payload replacement and cancellation cannot publish a sample', async t => {
  const f = await fixture(t), info = await f.reader.info();
  const original = Buffer.prototype.readInt32LE;
  let changed = false;
  const mock = t.mock.method(Buffer.prototype, 'readInt32LE', function (this: Buffer, offset?: number) {
    if (!changed) { changed = true; writeFileSync(join(f.root, 'octree/octree.bin'), f.payload); }
    return original.call(this, offset);
  });
  try { await assert.rejects(f.reader.sample(info.revision, { budget: 4, depth: 0 }), /Cloud artifact changed during read/); }
  finally { mock.mock.restore(); }
  const current = await f.reader.info(), controller = new AbortController();
  const abortMock = t.mock.method(Buffer.prototype, 'readInt32LE', function (this: Buffer, offset?: number) {
    controller.abort(); return original.call(this, offset);
  });
  try { await assert.rejects(f.reader.sample(current.revision, { budget: 4, depth: 0 }, controller.signal), { name: 'AbortError' }); }
  finally { abortMock.mock.restore(); }
});

test('format, hierarchy, size and symlink safeguards apply to generic artifacts', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify({ ...f.metadata, encoding: 'BROTLI' }));
  await assert.rejects(f.reader.info(), /Unsupported Potree encoding/);
  await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify(f.metadata));
  const bad = Buffer.from(f.hierarchy); bad.writeBigUInt64LE(999n, 14);
  await writeFile(join(f.root, 'octree/hierarchy.bin'), bad);
  await assert.rejects(f.reader.sample((await f.reader.info()).revision, { budget: 4, depth: 0 }), /Invalid payload range/);
  await writeFile(join(f.root, 'octree/hierarchy.bin'), f.hierarchy);
  const descriptorBytes = await readFile(join(f.root, 'cloud.json'));
  await writeFile(join(f.root, 'cloud.json'), Buffer.alloc(65537));
  await assert.rejects(f.reader.info(), /Read range exceeds limits/);
  await writeFile(join(f.root, 'cloud.json'), descriptorBytes);
  await writeFile(join(f.root, 'outside.bin'), f.payload);
  await rm(join(f.root, 'octree/octree.bin'));
  await symlink(join(f.root, 'outside.bin'), join(f.root, 'octree/octree.bin'));
  await assert.rejects(f.reader.info(), /symlinks/);
});
