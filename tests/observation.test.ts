import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { get } from 'node:http';
import { PotreeDataset, parseMetadata, parseHierarchy, decodePoint, READ_LIMITS } from '../apps/server/src/potree';
import { createIsolatedDemoServer as createDemoServer } from '../scripts/isolated-demo-server';
import { assertPointLod, sampleIndices } from '../packages/agent-harness/src/observation';
import { createObservationChannel, fetchObservation, type ObservationLoader } from '../apps/web/src/observation-client';
import type { PointObservation } from '@spatial/contracts';

function fixture() {
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 8, hierarchy: { firstChunkSize: 44 }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 120], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [0, 0, 120], max: [10, 10, 130] },
    { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
    { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
  ] };
  const payload = Buffer.alloc(8 * 28);
  for (let i = 0; i < 8; i++) {
    for (let axis = 0; axis < 3; axis++) payload.writeInt32LE(i * 1000, i * 28 + axis * 4);
    payload.writeUInt16LE(65535, i * 28 + 12); payload.writeUInt16LE(128 * 257, i * 28 + 14);
    payload.writeUInt16LE(i < 4 ? 1 : 2, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(i, i * 28 + 24);
  }
  const hierarchy = Buffer.alloc(44);
  for (let i = 0; i < 2; i++) {
    hierarchy[i * 22] = i; hierarchy[i * 22 + 1] = i === 0 ? 1 : 0;
    hierarchy.writeUInt32LE(4, i * 22 + 2); hierarchy.writeBigUInt64LE(BigInt(i * 112), i * 22 + 6); hierarchy.writeBigUInt64LE(112n, i * 22 + 14);
  }
  return { metadata, payload, hierarchy };
}
async function temporaryDataset() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-potree-test-'));
  const f = fixture();
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0] }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(f.metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), f.hierarchy);
  await writeFile(join(root, 'octree/octree.bin'), f.payload);
  return { root, ...f };
}

test('bounded LOD validation and deterministic sampling indexes', () => {
  assert.deepEqual(sampleIndices(8, 3), [0, 2, 5]);
  assert.deepEqual(sampleIndices(2, 4), [0, 1]);
  assert.deepEqual(sampleIndices(0, 4), []);
  for (const population of [-1, NaN, 1_000_001]) assert.throws(() => sampleIndices(population, 4));
  for (const budget of [0, 1.5, Infinity, 4097]) assert.throws(() => assertPointLod({ budget, depth: 2 }, 'harness'));
  for (const depth of [-1, 4, 1.5]) assert.throws(() => assertPointLod({ budget: 4, depth }, 'display'));
  assert.throws(() => assertPointLod({ budget: 100001, depth: 3 }, 'display'));
});

test('strict interleaved decoder, local coordinates, RGB, provenance and semantic labels', () => {
  const f = fixture(), layout = parseMetadata(f.metadata);
  assert.deepEqual(decodePoint(f.payload, 5, layout), { positions: [5, 5, 125], colors: [255, 128, 0], sourceIds: [2, 5], label: 5 });
  assert.throws(() => decodePoint(f.payload, 8, layout));
  assert.throws(() => decodePoint(f.payload, -1, layout));
  const malformed = Buffer.from(f.payload); malformed.writeFloatLE(NaN, 24);
  assert.throws(() => decodePoint(malformed, 0, layout));
  malformed.writeFloatLE(0, 24); malformed.writeInt32LE(100000, 0);
  assert.throws(() => decodePoint(malformed, 0, layout));
  assert.throws(() => parseMetadata({ ...f.metadata, encoding: 'BROTLI' }));
  assert.throws(() => parseMetadata({ ...f.metadata, scale: [NaN, 1, 1] }));
  assert.throws(() => parseMetadata({ ...f.metadata, hierarchy: { firstChunkSize: 1e9 } }));
  assert.throws(() => parseMetadata({ ...f.metadata, attributes: [...f.metadata.attributes, f.metadata.attributes[0]] }));
  assert.throws(() => parseMetadata({ ...f.metadata, attributes: f.metadata.attributes.slice(1) }));
});

test('hierarchy rejects truncated, overlapping, unsafe, proxy and excessive byte ranges', () => {
  const f = fixture(), layout = parseMetadata(f.metadata);
  assert.deepEqual(parseHierarchy(f.hierarchy, layout, 224, 44, 1).map(n => n.name), ['r', 'r0']);
  assert.equal(parseHierarchy(f.hierarchy, layout, 224, 44, 0).length, 1);
  assert.throws(() => parseHierarchy(f.hierarchy.subarray(0, 22), layout, 224, 44, 1));
  const overlap = Buffer.from(f.hierarchy); overlap.writeBigUInt64LE(0n, 28);
  assert.throws(() => parseHierarchy(overlap, layout, 224, 44, 1));
  const unsafe = Buffer.from(f.hierarchy); unsafe.writeBigUInt64LE(2n ** 63n, 6);
  assert.throws(() => parseHierarchy(unsafe, layout, Number.MAX_SAFE_INTEGER, 44, 1));
  const proxy = Buffer.from(f.hierarchy); proxy[0] = 2;
  assert.throws(() => parseHierarchy(proxy, layout, 224, 224, 1));
  const huge = Buffer.from(f.hierarchy); huge.writeUInt32LE(200_000, 2); huge.writeBigUInt64LE(5_600_000n, 14);
  assert.throws(() => parseHierarchy(huge, layout, 10_000_000, 44, 1));
  assert.throws(() => parseHierarchy(f.hierarchy, layout, 100, 44, 1));
});

test('real file adapter produces reproducible independent harness observations with strict limits', async () => {
  const f = await temporaryDataset();
  try {
    const adapter = new PotreeDataset(f.root);
    const a = await adapter.observe({ budget: 3, depth: 1 });
    assert.equal(a.count, 3); assert.equal(a.candidatePoints, 8); assert.equal(a.bytesRead, 268);
    assert.deepEqual(a.positions, [0, 0, 120, 2, 2, 122, 5, 5, 125]);
    assert.deepEqual(a.sourceIds, [1, 0, 1, 2, 2, 5]);
    assert.equal(a.purpose, 'harness'); assert.equal(a.algorithm, 'potree-bfs-even-v1');
    await adapter.sample({ budget: 8, depth: 0 }, 'display');
    assert.deepEqual(await adapter.observe({ budget: 3, depth: 1 }), a);
    const changed = await adapter.observe({ budget: 2, depth: 1 });
    assert.notEqual(changed.sampleHash, a.sampleHash);
    assert.equal(changed.dataset.revision, a.dataset.revision);
    await assert.rejects(adapter.observe({ budget: 4097, depth: 1 }));
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(adapter.observe({ budget: 3, depth: 1 }, aborted.signal));
    await writeFile(join(f.root, 'octree/metadata.json'), Buffer.alloc(READ_LIMITS.json + 1));
    await assert.rejects(adapter.info());
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('read-only dataset HTTP routes validate inputs and never expose files or raw ranges', async () => {
  const f = await temporaryDataset();
  const server = createDemoServer({ datasetRoot: f.root });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const route = '/datasets/toronto3d/observation';
    assert.equal((await fetch(base + '/datasets/toronto3d')).status, 200);
    const response = await fetch(base + route + '?purpose=harness&budget=3&depth=1');
    assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).count, 3);
    for (const query of ['purpose=harness&budget=4097&depth=1', 'purpose=display&budget=100001&depth=1', 'purpose=harness&budget=1&depth=4', 'purpose=harness&budget=-1&depth=0', 'purpose=harness&budget=1.1&depth=0', 'purpose=harness&budget=3&depth=1&path=/etc/passwd', 'purpose=harness&budget=3&budget=2&depth=1']) {
      assert.equal((await fetch(base + route + '?' + query)).status, 400, query);
    }
    for (const range of ['bytes=0-99', 'bytes=-1', 'bytes=0-1,2-3', 'garbage']) {
      assert.equal((await fetch(base + route, { headers: { Range: range } })).status, 416);
    }
    for (const path of ['/datasets/toronto3d/octree.bin', '/datasets/toronto3d/manifest.json', '/datasets/toronto3d/%2e%2e/%2e%2e/etc/passwd']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + route, { method: 'POST' })).status, 404);
    // Fetch normalizes Host; raw HTTP is needed to actually exercise a forged header.
    const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(base + '/datasets/toronto3d', { headers: { Host: 'external.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(base + '/datasets/toronto3d', { headers: { Origin: 'https://external.example' } })).status, 403);
    const file = join(f.root, 'octree/octree.bin');
    await rm(file); await symlink(join(f.root, 'manifest.json'), file);
    assert.equal((await fetch(base + '/datasets/toronto3d')).status, 503);
    await rm(join(f.root, 'manifest.json'));
    const missing = await fetch(base + '/datasets/toronto3d');
    assert.equal(missing.status, 503); assert.ok(!(await missing.text()).includes(f.root));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(f.root, { recursive: true, force: true }); }
});

test('independent channels reject stale requests, cancellation and post-disposal publications', async () => {
  const f = await temporaryDataset();
  try {
    const sample = await new PotreeDataset(f.root).observe({ budget: 3, depth: 1 });
    const pending: { purpose: string; signal: AbortSignal; resolve: (value: PointObservation) => void }[] = [];
    const loader: ObservationLoader = (purpose, _lod, signal) => new Promise(resolve => pending.push({ purpose, signal, resolve }));
    const shown: string[] = [], observed: string[] = [];
    const display = createObservationChannel('display', value => shown.push(value.sampleHash), loader);
    const harness = createObservationChannel('harness', value => observed.push(value.sampleHash), loader);
    const old = display.load({ budget: 3, depth: 0 });
    const observation = harness.load({ budget: 3, depth: 1 });
    const latest = display.load({ budget: 4, depth: 1 });
    assert.equal(pending[0].signal.aborted, true); assert.equal(pending[1].signal.aborted, false);
    pending[2].resolve({ ...sample, sampleHash: 'display-new' }); await latest;
    pending[0].resolve({ ...sample, sampleHash: 'display-old' }); await old;
    pending[1].resolve(sample); await observation;
    assert.deepEqual(shown, ['display-new']); assert.deepEqual(observed, [sample.sampleHash]);
    const canceled = harness.load({ budget: 4, depth: 1 }); harness.dispose();
    pending[3].resolve({ ...sample, sampleHash: 'disposed' }); await canceled;
    assert.deepEqual(observed, [sample.sampleHash]); assert.deepEqual(shown, ['display-new']);
    display.dispose();
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('progressive display requests root then target; harness requests only its selected LOD', async () => {
  const f = await temporaryDataset();
  try {
    const sample = await new PotreeDataset(f.root).observe({ budget: 3, depth: 1 });
    const calls: string[] = [];
    const loader: ObservationLoader = async (purpose, lod) => { calls.push(`${purpose}:${lod.budget}:${lod.depth}`); return sample; };
    const display = createObservationChannel('display', () => {}, loader);
    const harness = createObservationChannel('harness', () => {}, loader);
    await display.load({ budget: 50000, depth: 3 }, true);
    await harness.load({ budget: 1024, depth: 2 }, true);
    assert.deepEqual(calls, ['display:10000:0', 'display:50000:3', 'harness:1024:2']);
    display.dispose(); harness.dispose();
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('HTTP client rejects oversized bodies before parsing and malformed observations', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { headers: { 'content-length': String(17 * 1024 * 1024) } });
    await assert.rejects(fetchObservation('harness', { budget: 3, depth: 1 }, new AbortController().signal), /Oversized/);
    globalThis.fetch = async () => new Response('{}');
    await assert.rejects(fetchObservation('harness', { budget: 3, depth: 1 }, new AbortController().signal), /Invalid/);
  } finally { globalThis.fetch = original; }
});
