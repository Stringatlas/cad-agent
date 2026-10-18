import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PotreeDataset, parseMetadata, decodePoint } from '../apps/server/src/potree';
import { createDatasetRoutes } from '../apps/server/src/dataset-routes';
import { DISPLAY_LIMITS, parseDisplayRequest, readDisplayHierarchy } from '../apps/server/src/adaptive-display';
import { ADAPTIVE_BINARY_MIME, decodeAdaptiveBinary, type CropBox } from '@spatial/contracts';

const bounds: CropBox = { min: [0, 0, 120], max: [10, 10, 130] };
function record(type: number, mask: number, count: number, offset: number, size: number) {
  const bytes = Buffer.alloc(22); bytes[0] = type; bytes[1] = mask;
  bytes.writeUInt32LE(count, 2); bytes.writeBigUInt64LE(BigInt(offset), 6); bytes.writeBigUInt64LE(BigInt(size), 14); return bytes;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'adaptive-display-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 7, hierarchy: { firstChunkSize: 66 }, boundingBox: bounds,
    scale: [0.001, 0.001, 0.001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: bounds.min, max: bounds.max }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(7 * 28);
  for (let i = 0; i < 7; i++) {
    for (let axis = 0; axis < 3; axis++) { payload.writeInt32LE(i * 1000 + axis + 1, i * 28 + axis * 4); payload.writeUInt16LE(65535 - i * 257, i * 28 + 12 + axis * 2); }
    payload.writeUInt16LE(1 + i % 4, i * 28 + 18); payload.writeUInt32LE(0xffffffff - i, i * 28 + 20); payload.writeFloatLE(i, i * 28 + 24);
  }
  const hierarchy = Buffer.concat([record(0, 129, 2, 0, 56), record(2, 128, 2, 66, 44), record(1, 0, 1, 168, 28),
    record(0, 128, 2, 56, 56), record(2, 0, 2, 110, 22), record(1, 0, 2, 112, 56)]);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0] }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, metadata, hierarchy, payload, adapter: new PotreeDataset(root), clean: () => rm(root, { recursive: true, force: true }) };
}
async function serving(root: string) {
  const routes = createDatasetRoutes(root), server = createServer((req, res) => { void routes(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { base: `http://127.0.0.1:${address.port}/datasets/toronto3d`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test('native display expands nested proxies and preserves every additive exact original record', async () => {
  const f = await fixture();
  try {
    const before = await f.adapter.observe({ budget: 1, depth: 0 });
    const catalog = await f.adapter.displayHierarchy();
    assert.deepEqual(catalog.nodes.map(n => [n.name, n.count]), [['r', 2], ['r0', 2], ['r07', 2], ['r7', 1]]);
    assert.deepEqual(catalog.nodes[0].bounds, bounds);
    assert.deepEqual(catalog.nodes[2].bounds, { min: [2.5, 2.5, 122.5], max: [5, 5, 125] });
    const layout = parseMetadata(f.metadata), starts = [0, 2, 4, 6];
    for (let n = 0; n < catalog.nodes.length; n++) {
      const node = catalog.nodes[n], result = await f.adapter.displayNode(catalog.dataset.revision, node.name);
      const exact = Array.from({ length: node.count }, (_, i) => decodePoint(f.payload, starts[n] + i, layout));
      assert.equal(result.name, node.name); assert.equal(result.count, node.count);
      assert.deepEqual(result.positions, exact.flatMap(p => p.positions)); assert.deepEqual(result.colors, exact.flatMap(p => p.colors));
      assert.deepEqual(result.sourceIds, exact.flatMap(p => p.sourceIds)); assert.deepEqual(result.labels, exact.map(p => p.label));
      assert.deepEqual(JSON.parse(JSON.stringify(result)).positions, result.positions, 'binary64 roundtrip, not Float32');
    }
    assert.deepEqual(await f.adapter.displayHierarchy(), catalog);
    assert.deepEqual(await f.adapter.observe({ budget: 1, depth: 0 }), before);
    await assert.rejects(f.adapter.displayNode('0'.repeat(64), 'r'), /revision/);
    await assert.rejects(f.adapter.displayNode(catalog.dataset.revision, 'r6'), /Unknown/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(f.adapter.displayHierarchy(abort.signal), /abort/i);
    await assert.rejects(f.adapter.displayNode(catalog.dataset.revision, 'r', abort.signal), /abort/i);
  } finally { await f.clean(); }
});

test('native hierarchy rejects cycles, disagreement, overlap, work/point limits and incomplete totals', async () => {
  const f = await fixture();
  try {
    for (const corrupt of [
      (b: Buffer) => b.writeBigUInt64LE(0n, 28),
      (b: Buffer) => b.writeUInt32LE(3, 68),
      (b: Buffer) => b.writeBigUInt64LE(0n, 72),
      (b: Buffer) => b.writeBigUInt64LE(2n ** 63n, 6),
      (b: Buffer) => { b[66] = 2; },
      (b: Buffer) => { b[1] = 131; },
    ]) {
      const bytes = Buffer.from(f.hierarchy); corrupt(bytes);
      await writeFile(join(f.root, 'octree/hierarchy.bin'), bytes);
      await assert.rejects(new PotreeDataset(f.root).displayHierarchy());
    }
    const input = { first: record(1, 0, 1, 0, 28), rootBox: bounds, hierarchySize: 22, payloadSize: 28, stride: 28, totalPoints: 2,
      readHierarchy: async () => { throw new Error('Unexpected'); } };
    await assert.rejects(readDisplayHierarchy(input), /Incomplete/);
    await assert.rejects(readDisplayHierarchy({ ...input, first: record(1, 0, DISPLAY_LIMITS.nodePoints + 1, 0, (DISPLAY_LIMITS.nodePoints + 1) * 28), payloadSize: 4e6 }), /limits/);
    const abort = new AbortController();
    await assert.rejects(readDisplayHierarchy({ ...input, first: record(2, 0, 1, 22, 22), hierarchySize: 44,
      readHierarchy: async () => { abort.abort(); return record(1, 0, 1, 0, 28); } }, abort.signal), /abort/i);
  } finally { await f.clean(); }
});

test('cached hierarchy fails closed on proxy-only changes even when legacy artifact revision is unchanged', async () => {
  const f = await fixture();
  try {
    const catalog = await f.adapter.displayHierarchy();
    const path = join(f.root, 'octree/hierarchy.bin'), s = await stat(path);
    const bytes = Buffer.from(f.hierarchy); bytes.writeUInt32LE(1, 68);
    await writeFile(path, bytes); await utimes(path, s.atime, new Date(s.mtimeMs + 2000));
    assert.equal((await f.adapter.info()).revision, catalog.dataset.revision);
    await assert.rejects(f.adapter.displayNode(catalog.dataset.revision, 'r'), /changed/);
    await assert.rejects(f.adapter.displayHierarchy(), /changed/);
  } finally { await f.clean(); }
});

test('fixed HTTP native display validates revision/query/security; no sampling or raw ranges', async () => {
  const f = await fixture(), s = await serving(f.root);
  try {
    const response = await fetch(s.base + '/display-hierarchy'); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /json/); assert.equal(response.headers.get('cache-control'), 'no-store');
    const catalog = await response.json() as Awaited<ReturnType<PotreeDataset['displayHierarchy']>>;
    const query = `?revision=${catalog.dataset.revision}&name=r07`;
    const node = await fetch(s.base + '/display-node' + query); assert.equal(node.status, 200);
    assert.deepEqual(await node.json(), await f.adapter.displayNode(catalog.dataset.revision, 'r07'));
    for (const bad of ['', '?name=r', query + '&name=r', query + '&path=foo', query.replace('r07', '../r'), query.replace('r07', 'r8'), query.replace('r07', 'r' + '0'.repeat(25)), query.replace(catalog.dataset.revision, 'xyz')]) {
      assert.equal((await fetch(s.base + '/display-node' + bad)).status, 400, bad);
    }
    assert.equal((await fetch(s.base + '/display-node?revision=' + '0'.repeat(64) + '&name=r')).status, 503);
    assert.equal((await fetch(s.base + '/display-node' + query.replace('r07', 'r6'))).status, 400);
    assert.equal((await fetch(s.base + '/display-hierarchy?revision=' + catalog.dataset.revision)).status, 400);
    assert.equal((await fetch(s.base + '/display-node' + query, { headers: { Range: 'bytes=0-22' } })).status, 416);
    assert.equal((await fetch(s.base + '/display-hierarchy', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(s.base + '/display-hierarchy', { method: 'POST' })).status, 404);
    assert.throws(() => parseDisplayRequest(new URLSearchParams('revision=' + 'a'.repeat(64) + '&name=r&revision=' + 'a'.repeat(64))));
  } finally { await s.close(); await f.clean(); }
});

test('native routes share two-operation admission and cancellation releases both slots', async () => {
  const original = PotreeDataset.prototype.displayHierarchy;
  let entered = 0, cancelled = 0;
  PotreeDataset.prototype.displayHierarchy = async function(signal) {
    entered++;
    await new Promise<void>((_resolve, reject) => { signal!.addEventListener('abort', () => { cancelled++; reject(new Error('cancelled')); }, { once: true }); });
    throw new Error('Unexpected');
  };
  const s = await serving('/unneeded'), a = new AbortController(), b = new AbortController();
  try {
    const first = fetch(s.base + '/display-hierarchy', { signal: a.signal }).catch(() => undefined);
    const second = fetch(s.base + '/display-hierarchy', { signal: b.signal }).catch(() => undefined);
    for (let i = 0; i < 100 && entered < 2; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(entered, 2);
    assert.equal((await fetch(s.base)).status, 429, 'shared with existing metadata path');
    a.abort(); b.abort(); await Promise.all([first, second]);
    for (let i = 0; i < 100 && cancelled < 2; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(cancelled, 2);
    assert.equal((await fetch(s.base)).status, 503, 'admitted again, now only unavailable fixture');
  } finally { a.abort(); b.abort(); PotreeDataset.prototype.displayHierarchy = original; await s.close(); }
});

test('opt-in binary native route preserves exact data and JSON compatibility without weakening guards', async () => {
  const f = await fixture(), s = await serving(f.root);
  try {
    const catalog = await f.adapter.displayHierarchy();
    for (const node of catalog.nodes) {
      const query = `?revision=${catalog.dataset.revision}&name=${node.name}`;
      const response = await fetch(s.base + '/display-node' + query + '&format=binary');
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), ADAPTIVE_BINARY_MIME);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(Number(response.headers.get('content-length')), bytes.length);
      const binary = decodeAdaptiveBinary(bytes, { dataset: catalog.dataset, ...node });
      const json = await (await fetch(s.base + '/display-node' + query)).json() as Awaited<ReturnType<PotreeDataset['displayNode']>>;
      for (const key of ['positions', 'colors', 'sourceIds', 'labels'] as const) assert.deepEqual(Array.from(binary[key]), json[key]);
    }
    const query = `?revision=${catalog.dataset.revision}&name=r&format=binary`;
    for (const bad of [query + '&format=binary', query.replace('format=binary', 'format=json'), query.replace('format=binary', 'format='), query + '&offset=0', query + '&name=r', query + '&revision=' + catalog.dataset.revision]) {
      assert.equal((await fetch(s.base + '/display-node' + bad)).status, 400, bad);
    }
    assert.equal((await fetch(s.base + '/display-hierarchy?format=binary')).status, 400);
    assert.equal((await fetch(s.base + '/display-node' + query, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(s.base + '/display-node' + query, { headers: { Range: 'bytes=0-22' } })).status, 416);
    assert.equal((await fetch(s.base + '/display-node' + query.replace(catalog.dataset.revision, '0'.repeat(64)))).status, 503);
    // Changing an existing source file must still fail closed through nativeDisplay.
    const changed = Buffer.from(f.payload); changed[0] ^= 1; await writeFile(join(f.root, 'octree/octree.bin'), changed);
    assert.equal((await fetch(s.base + '/display-node' + query)).status, 503);
  } finally { await s.close(); await f.clean(); }
});
