import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { PotreeDataset, decodePoint, parseMetadata } from '../apps/server/src/potree';
import { childBox, CROP_LIMITS, readFullResolutionCrop } from '../apps/server/src/crop';
import { createIsolatedDemoServer as createDemoServer } from '../scripts/isolated-demo-server';
import { createCropChannel, fetchCrop, type CropLoader } from '../apps/web/src/crop-client';
import { createCropLayer } from '../apps/web/src/crop-render';
import { projectCropRectangle } from '../apps/web/src/crop-projection';
import { assertCropSelection, containsCropPoint, intersectsCropNode, CROP_BATCH_POINTS, CROP_LINE_BYTES, type CropBox, type CropEvent, type CropSelection } from '@spatial/contracts';

const box: CropBox = { min: [2, 2, 122], max: [4, 4, 124] };
const rootBox: CropBox = { min: [0, 0, 120], max: [10, 10, 130] };
function record(type: number, mask: number, count: number, offset: number, size: number) {
  const bytes = Buffer.alloc(22); bytes[0] = type; bytes[1] = mask;
  bytes.writeUInt32LE(count, 2); bytes.writeBigUInt64LE(BigInt(offset), 6); bytes.writeBigUInt64LE(BigInt(size), 14); return bytes;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-crop-test-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 7, hierarchy: { firstChunkSize: 66 }, boundingBox: rootBox,
    scale: [0.001, 0.001, 0.001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: rootBox.min, max: rootBox.max }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const positions = [0, 4, 2, 4, 3, 4, 9], payload = Buffer.alloc(positions.length * 28);
  positions.forEach((value, i) => {
    for (let axis = 0; axis < 3; axis++) payload.writeInt32LE(value * 1000, i * 28 + axis * 4);
    payload.writeUInt16LE(65535, i * 28 + 12); payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20);
  });
  const hierarchy = Buffer.concat([record(0, 129, 2, 0, 56), record(2, 128, 2, 66, 44), record(1, 0, 1, 168, 28),
    record(0, 128, 2, 56, 56), record(2, 0, 2, 110, 22), record(1, 0, 2, 112, 56)]);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0] }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, metadata, hierarchy, payload, adapter: new PotreeDataset(root), clean: () => rm(root, { recursive: true, force: true }) };
}
async function collect(stream: AsyncIterable<CropEvent>) {
  const events: CropEvent[] = [], positions: number[] = [], colors: number[] = [];
  for await (const event of stream) { events.push(event); if (event.type === 'batch') { positions.push(...event.positions); colors.push(...event.colors); } }
  const end = events.at(-1); assert.ok(end?.type === 'end' && end.complete);
  return { events, positions, colors, ...end.stats, sampleHash: end.sampleHash };
}

test('inclusive full resolution streams all ancestors/nested proxies and preserves harness', async () => {
  const f = await fixture();
  try {
    const before = await f.adapter.observe({ budget: 1, depth: 0 }), result = await collect(f.adapter.crop(box));
    assert.equal(result.count, 5); assert.deepEqual(result.positions, [4, 4, 124, 2, 2, 122, 4, 4, 124, 3, 3, 123, 4, 4, 124]);
    assert.deepEqual(result.events.flatMap(event => event.type === 'batch' ? event.sourceIds! : []), [1, 1, 1, 2, 1, 3, 1, 4, 1, 5]);
    assert.ok(result.events.every(event => event.type !== 'batch' || event.sourceIds?.length === event.positions.length / 3 * 2));
    assert.equal(result.hierarchyChunks, 3); assert.equal(result.payloadNodes, 3); assert.equal(result.scannedPoints, 6); assert.equal(result.bytesRead, 300);
    assert.deepEqual(await collect(f.adapter.crop(box)), result);
    assert.deepEqual(await f.adapter.observe({ budget: 1, depth: 0 }), before);
    assert.equal((await collect(f.adapter.crop({ min: [20, 20, 140], max: [21, 21, 141] }))).count, 0);
    const controller = new AbortController(); controller.abort(); await assert.rejects(collect(f.adapter.crop(box, controller.signal)), /abort/i);
  } finally { await f.clean(); }
});

test('camera rectangle selects a frustum/prism, includes depth and boundaries, not its AABB', () => {
  const bounds: CropBox = { min: [-100, -100, -100], max: [100, 100, 100] };
  const perspective = new THREE.PerspectiveCamera(90, 1, 1, 20); perspective.position.set(0, 0, 0); perspective.lookAt(0, 0, -1);
  const selection = projectCropRectangle(perspective, { left: 25, top: 25, right: 75, bottom: 75 }, 100, 100, bounds);
  assert.equal(containsCropPoint(selection, [0, 0, -2]), true); assert.equal(containsCropPoint(selection, [0, 0, -15]), true);
  assert.equal(containsCropPoint(selection, [1, 0, -2]), true); // exact side plane
  assert.equal(containsCropPoint(selection, [1.01, 0, -2]), false);
  assert.equal(containsCropPoint(selection, [3, 0, -2]), false); // same dataset AABB but outside projection
  assert.equal(containsCropPoint(selection, [3, 0, -10]), true); // perspective expands with depth
  assert.equal(containsCropPoint(selection, [0, 0, -0.5]), false); assert.equal(containsCropPoint(selection, [0, 0, -21]), false);
  assert.equal(containsCropPoint(selection, [0, 0, -1]), true); assert.equal(containsCropPoint(selection, [0, 0, -20]), true);
  const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 20); ortho.lookAt(0, 0, -1);
  const prism = projectCropRectangle(ortho, { left: 25, top: 25, right: 75, bottom: 75 }, 100, 100, bounds);
  assert.equal(containsCropPoint(prism, [5, 0, -2]), true); assert.equal(containsCropPoint(prism, [5.01, 0, -15]), false);
  assert.equal(intersectsCropNode(selection, { min: [1.001, -0.1, -2], max: [1.002, 0.1, -1.999] }, [0.002, 0.002, 0.002]), true);
  assert.equal(intersectsCropNode(selection, { min: [4, -0.1, -2], max: [5, 0.1, -1] }, [0.001, 0.001, 0.001]), false);
  // Oblique Z-up camera: selection matches direct camera projection, not a world-axis box.
  perspective.up.set(0, 0, 1); perspective.position.set(10, -10, 10); perspective.lookAt(0, 0, 0);
  const oblique = projectCropRectangle(perspective, { left: 20, top: 30, right: 65, bottom: 80 }, 100, 100, bounds);
  for (const point of [[0, 0, 0], [5, 0, 0], [-5, 4, 2], [10, 10, -10]]) {
    const clip = new THREE.Vector3(...point).project(perspective);
    const expected = clip.x >= -0.6 && clip.x <= 0.3 && clip.y >= -0.6 && clip.y <= 0.4 && clip.z >= -1 && clip.z <= 1;
    assert.equal(containsCropPoint(oblique, point), expected);
  }
  assert.throws(() => projectCropRectangle(perspective, { left: 1, top: 1, right: 1, bottom: 5 }, 100, 100, bounds));
});

test('Potree axes, quantized pruning and exact projected point tests survive nested proxies', async () => {
  assert.deepEqual(childBox(rootBox, 4), { min: [5, 0, 120], max: [10, 5, 125] });
  assert.deepEqual(childBox(rootBox, 2), { min: [0, 5, 120], max: [5, 10, 125] });
  assert.deepEqual(childBox(rootBox, 1), { min: [0, 0, 125], max: [5, 5, 130] });
  const f = await fixture();
  try {
    f.payload.writeInt32LE(5001, 4 * 28); await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    assert.equal((await collect(f.adapter.crop({ min: [5.001, 2.9, 122.9], max: [5.002, 3.1, 123.1] }))).count, 1);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20); camera.position.set(3, 3, 140); camera.lookAt(3, 3, 120);
    const selected = projectCropRectangle(camera, { left: 0, top: 0, right: 100, bottom: 100 }, 100, 100, rootBox);
    const whole = await collect(f.adapter.crop(rootBox)), result = await collect(f.adapter.crop(selected));
    assert.deepEqual(result.positions, whole.positions.flatMap((_, i, all) => i % 3 === 0 && containsCropPoint(selected, all.slice(i, i + 3)) ? all.slice(i, i + 3) : []));
  } finally { await f.clean(); }
});

test('malformed bounds/planes/proxies, cycles, ranges, overlaps never complete', async () => {
  for (const bad of [{ min: [NaN, 0, 0], max: [1, 1, 1] }, { min: [0, 0, 0], max: [0, 1, 1] }, { ...box, planes: [] }, { ...box, planes: Array(6).fill([0, 0, 0, 0]) }]) assert.throws(() => assertCropSelection(bad as CropSelection));
  const f = await fixture();
  try {
    for (const corrupt of [(b: Buffer) => b.writeBigUInt64LE(0n, 28), (b: Buffer) => b.writeUInt32LE(3, 68), (b: Buffer) => b.writeBigUInt64LE(0n, 72),
      (b: Buffer) => b.writeBigUInt64LE(2n ** 63n, 6), (b: Buffer) => { b[66] = 2; }, (b: Buffer) => { b[1] = 131; }]) {
      const bytes = Buffer.from(f.hierarchy); corrupt(bytes); await writeFile(join(f.root, 'octree/hierarchy.bin'), bytes); await assert.rejects(collect(f.adapter.crop(box)));
    }
  } finally { await f.clean(); }
});

test('no total caps: >100k points and >64MiB source, large nodes read in bounded chunks; pull and abort stop reads', async () => {
  const f = await fixture();
  try {
    let reads = 0, maxRead = 0;
    const count = 100_001, stride = 256;
    const first = Buffer.concat([record(0, 3, count, 0, count * stride), record(1, 0, count, count * stride, count * stride), record(1, 0, count, count * stride * 2, count * stride)]);
    const input = { dataset: await f.adapter.info(), rootBox, scale: [0.001, 0.001, 0.001] as const, stride, first, hierarchySize: first.length, payloadSize: count * stride * 3,
      readHierarchy: async () => { throw new Error('Unexpected read'); },
      readPayload: async (_offset: number, size: number) => { reads++; maxRead = Math.max(maxRead, size); return Buffer.alloc(size); },
      decode: () => ({ positions: [3, 3, 123], colors: [255, 0, 0] }) };
    let total = 0, last: CropEvent | undefined;
    for await (const event of readFullResolutionCrop(input, rootBox)) {
      if (event.type === 'batch') { assert.ok(event.positions.length <= CROP_BATCH_POINTS * 3); total += event.positions.length / 3; }
      last = event;
    }
    assert.equal(total, count * 3); assert.ok(last?.type === 'end' && last.stats.bytesRead > 64 * 1024 * 1024); assert.ok(maxRead <= CROP_LIMITS.nodeBytes);
    reads = 0; const controller = new AbortController(), stream = readFullResolutionCrop(input, rootBox, controller.signal);
    await stream.next(); assert.equal(reads, 0); await stream.next(); assert.equal(reads, 1);
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(reads, 1, 'no prefetch when downstream pauses');
    controller.abort(); await assert.rejects(stream.next(), /abort/i); assert.equal(reads, 1);
    reads = 0; const closed = readFullResolutionCrop(input, rootBox); await closed.next(); await closed.next(); await closed.return(undefined); assert.equal(reads, 1);
    await assert.rejects(collect(readFullResolutionCrop({ ...input, first: record(2, 0, 0, 22, 66000), hierarchySize: 66022 }, rootBox)));
    const chain = Array.from({ length: 26 }, (_, i) => record(i < 25 ? 0 : 1, i < 25 ? 1 : 0, 0, 0, 0));
    await assert.rejects(collect(readFullResolutionCrop({ ...input, first: Buffer.concat(chain), hierarchySize: 26 * 22 }, rootBox)));
  } finally { await f.clean(); }
});

test('fixed HTTP stream validates input/security and projected volume; harness independent', async () => {
  const f = await fixture(), server = createDemoServer({ datasetRoot: f.root });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/datasets/toronto3d`, query = '?minX=2&minY=2&minZ=122&maxX=4&maxY=4&maxZ=124';
    const before = await (await fetch(base + '/observation?purpose=harness&budget=1&depth=0')).json();
    const response = await fetch(base + '/crop' + query); assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /ndjson/);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as CropEvent); const last = events.at(-1); assert.ok(last?.type === 'end'); assert.equal(last.stats.count, 5);
    for (const bad of ['', query + '&path=/etc/passwd', query + '&minX=1', query + '&planes=[]', query.replace('minX=2', 'minX=NaN'), query.replace('maxX=4', 'maxX=2'), query.replace('minY=2', 'minY=1e309')]) assert.equal((await fetch(base + '/crop' + bad)).status, 400);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20); camera.position.set(3, 3, 140); camera.lookAt(3, 3, 120);
    const selected = projectCropRectangle(camera, { left: 0, top: 0, right: 100, bottom: 100 }, 100, 100, box);
    const projected = await fetch(base + '/crop' + query + '&planes=' + encodeURIComponent(JSON.stringify(selected.planes)));
    assert.equal(projected.status, 200); assert.equal(JSON.parse((await projected.text()).trim().split('\n').at(-1)!).stats.count, 5);
    assert.equal((await fetch(base + '/crop' + query, { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/crop' + query, { headers: { Range: 'bytes=0-99' } })).status, 416);
    assert.equal((await fetch(base + '/crop' + query, { headers: { Origin: 'https://external.example' } })).status, 403);
    assert.deepEqual(await (await fetch(base + '/observation?purpose=harness&budget=1&depth=0')).json(), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
});

test('channel guards every stale batch/error, input mutation, clear/dispose and publish resource errors', async () => {
  const pending: { selection: CropSelection; signal: AbortSignal; emit: (e: CropEvent) => Promise<void> | void; resolve: () => void; reject: (e: Error) => void }[] = [];
  const loader: CropLoader = (selection, signal, emit) => new Promise((resolve, reject) => pending.push({ selection, signal, emit, resolve, reject }));
  const shown: string[] = [], channel = createCropChannel(event => { shown.push(event.type); }, loader);
  const mutable = { min: [2, 2, 122], max: [4, 4, 124] }, old = channel.load(mutable as unknown as CropSelection); mutable.min[0] = 1;
  assert.equal(pending[0].selection.min[0], 2);
  const latest = channel.load(box); assert.equal(pending[0].signal.aborted, true);
  const event: CropEvent = { type: 'error', error: 'test' };
  await pending[0].emit(event); await pending[1].emit(event); pending[1].resolve(); await latest; pending[0].reject(new Error('stale')); await old;
  const canceled = channel.load(box); channel.cancel(); await pending[2].emit(event); pending[2].resolve(); await canceled;
  const disposed = channel.load(box); channel.dispose(); await pending[3].emit(event); pending[3].resolve(); await disposed;
  assert.deepEqual(shown, ['error']); await channel.load(box); assert.equal(pending.length, 4);
  const resource = createCropChannel(() => { throw new Error('GPU allocation failed'); }, async (_selection, _signal, emit) => { await emit(event); });
  await assert.rejects(resource.load(box), /GPU allocation/); resource.dispose();
});

test('progressive GPU layer has uncapped total, bounded individual chunks, immediate disposal', () => {
  const scene = new THREE.Scene(), layer = createCropLayer(scene), positions = Array(CROP_BATCH_POINTS * 3).fill(3), colors = Array(CROP_BATCH_POINTS * 3).fill(255);
  for (let i = 0; i < 14; i++) layer.append(positions, colors);
  assert.equal(layer.count, CROP_BATCH_POINTS * 14); assert.ok(layer.count > 100000);
  let disposed = 0; layer.group.children.forEach(child => (child as THREE.Points).geometry.addEventListener('dispose', () => disposed++));
  layer.clear(); assert.equal(disposed, 14); assert.equal(layer.count, 0); assert.equal(layer.group.children.length, 0);
  assert.throws(() => layer.append([...positions, 0, 0, 0], [...colors, 0, 0, 0])); layer.dispose(); assert.equal(scene.children.length, 0);
});

test('client incrementally validates lines/batches/completion, interrupted/error/malformed/oversized streams and abort', async () => {
  const f = await fixture(), original = globalThis.fetch;
  try {
    const result = await collect(f.adapter.crop(box)), text = result.events.map(e => JSON.stringify(e) + '\n').join(''), signal = new AbortController().signal;
    const chunked = (value: string) => new Response(new ReadableStream<Uint8Array>({ start(controller) { const bytes = new TextEncoder().encode(value); for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.subarray(i, i + 13)); controller.close(); } }));
    globalThis.fetch = async () => chunked(text); const events: CropEvent[] = []; await fetchCrop(box, signal, e => { events.push(e); }); assert.deepEqual(events, result.events);
    for (const invalid of [text.slice(0, text.lastIndexOf('{"type":"end"')), text + '{}\n', '{"type":"error","error":"failure"}\n', ' '.repeat(CROP_LINE_BYTES + 1),
      text.replace('"sequence":0', '"sequence":1'), text.replace('"complete":true', '"complete":false'), text.replace('"positions":[4,4,124]', '"positions":[99,4,124]')]) {
      globalThis.fetch = async () => new Response(invalid); await assert.rejects(fetchCrop(box, signal, () => {}));
    }
    globalThis.fetch = async () => new Response('{}', { status: 429 }); await assert.rejects(fetchCrop(box, signal, () => {}), /429/);
    globalThis.fetch = async () => chunked(text); const controller = new AbortController(); let calls = 0;
    await assert.rejects(fetchCrop(box, controller.signal, () => { if (++calls === 2) controller.abort(); }), /abort/i); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; await f.clean(); }
});

test('actual Potree crop keeps binary64 decoded positions and uint32 provenance, even in empty batches', async () => {
  const f = await fixture();
  try {
    f.payload.writeInt32LE(4001, 28);
    f.payload.writeUInt16LE(4, 28 + 18); f.payload.writeUInt32LE(0xffffffff, 28 + 20);
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    const point = decodePoint(f.payload, 1, parseMetadata(f.metadata));
    assert.equal(point.positions[0], 4001 * 0.001);
    assert.notEqual(point.positions[0], Math.fround(point.positions[0]), 'original JS binary64, not GPU Float32');
    assert.deepEqual(point.sourceIds, [4, 0xffffffff]);
    const result = await collect(f.adapter.crop(rootBox));
    const first = result.events.find(event => event.type === 'batch'); assert.ok(first?.type === 'batch');
    assert.equal(first.positions[3], point.positions[0]); assert.deepEqual(first.sourceIds, [1, 0, 4, 0xffffffff]);
    const empty = await collect(f.adapter.crop({ min: [4.01, 4.01, 124.01], max: [4.02, 4.02, 124.02] }));
    assert.equal(empty.count, 0);
    assert.ok(empty.events.some(event => event.type === 'batch'));
    assert.ok(empty.events.every(event => event.type !== 'batch' || Array.isArray(event.sourceIds) && event.sourceIds.length === 0));
    f.payload.writeUInt32LE(42, 28 + 20); await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    assert.notEqual((await collect(f.adapter.crop(rootBox))).sampleHash, result.sampleHash, 'hash binds valid provenance changes');
    f.payload.writeUInt16LE(0, 28 + 18); await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    await assert.rejects(collect(f.adapter.crop(rootBox)), /provenance/);
  } finally { await f.clean(); }
});

test('crop decoder provenance is validated all-or-none; legacy synthetic hash remains stable', async () => {
  const f = await fixture();
  try {
    const input = { dataset: await f.adapter.info(), rootBox, scale: [0.001, 0.001, 0.001] as const, stride: 28,
      first: record(1, 0, 2, 0, 56), hierarchySize: 22, payloadSize: 56,
      readHierarchy: async () => { throw new Error('Unexpected read'); }, readPayload: async () => Buffer.alloc(56),
      decode: (_bytes: Buffer, _index: number): { positions: number[]; colors: number[]; sourceIds?: readonly number[] } => ({ positions: [3, 3, 123], colors: [255, 0, 0] }) };
    const legacy = await collect(readFullResolutionCrop(input, box));
    assert.ok(legacy.events.every(event => event.type !== 'batch' || event.sourceIds === undefined));
    assert.equal(legacy.sampleHash, createHash('sha256').update(JSON.stringify(box))
      .update(JSON.stringify({ positions: legacy.positions, colors: legacy.colors })).digest('hex'));
    await assert.rejects(collect(readFullResolutionCrop({ ...input, requireSourceIds: true }, box)), /provenance/);
    const withIds = await collect(readFullResolutionCrop({ ...input, decode: () => ({ positions: [3, 3, 123], colors: [255, 0, 0], sourceIds: [1, 0] }) }, box));
    assert.notEqual(withIds.sampleHash, legacy.sampleHash);
    for (const sourceIds of [[], [1], [1, 0, 2], [0, 0], [5, 0], [1.1, 0], [1, -1], [1, 0x100000000], [1, 0.5], [1, NaN]]) {
      // Invalid provenance is rejected even on a decoded point outside the requested selection.
      await assert.rejects(collect(readFullResolutionCrop({ ...input, decode: () => ({ positions: [9, 9, 129], colors: [255, 0, 0], sourceIds }) }, box)), /provenance/);
    }
    for (const missingFirst of [true, false]) await assert.rejects(collect(readFullResolutionCrop({ ...input,
      decode: (_bytes, index) => ({ positions: [3, 3, 123], colors: [255, 0, 0], ...(Boolean(index) === missingFirst ? { sourceIds: [1, index] } : {}) }) }, box)), /provenance/);
    const count = CROP_BATCH_POINTS + 1, size = count * input.stride;
    const large = { ...input, first: record(1, 0, count, 0, size), payloadSize: size,
      readPayload: async (_offset: number, bytes: number) => Buffer.alloc(bytes),
      decode: (_bytes: Buffer, index: number) => ({ positions: [3, 3, 123], colors: [255, 0, 0], sourceIds: [1, index] }) };
    const streamed = await collect(readFullResolutionCrop(large, box));
    const batches = streamed.events.filter(event => event.type === 'batch');
    assert.deepEqual(batches.map(event => event.sourceIds?.length), [CROP_BATCH_POINTS * 2, 2]);
    assert.deepEqual(batches[1].sourceIds, [1, CROP_BATCH_POINTS]);
    await assert.rejects(collect(readFullResolutionCrop({ ...large, decode: (_bytes, index) => ({ positions: [3, 3, 123], colors: [255, 0, 0],
      ...(index < CROP_BATCH_POINTS ? { sourceIds: [1, index] } : {}) }) }, box)), /provenance/);
  } finally { await f.clean(); }
});

test('client rejects tampered, partial and mismatched provenance or invalid start revisions; accepts wholly legacy streams', async () => {
  const f = await fixture(), original = globalThis.fetch, signal = new AbortController().signal;
  try {
    const result = await collect(f.adapter.crop(box));
    const run = async (events: unknown[]) => {
      globalThis.fetch = async () => new Response(events.map(event => JSON.stringify(event) + '\n').join(''));
      await fetchCrop(box, signal, () => {});
    };
    const modified = (change: (events: any[]) => void) => { const events = structuredClone(result.events); change(events); return events; };
    const batchAt = result.events.findIndex(event => event.type === 'batch');
    for (const sourceIds of [null, {}, [], [1], [1, 0, 1, 1], [0, 1], [5, 1], [1.5, 1], [1, -1], [1, 0x100000000], [1, 0.5]]) {
      await assert.rejects(run(modified(events => { events[batchAt].sourceIds = sourceIds; })), /provenance/);
    }
    await assert.rejects(run(modified(events => { delete events[batchAt + 1].sourceIds; })), /provenance/);
    await assert.rejects(run(modified(events => { delete events[batchAt].sourceIds; })), /provenance/);
    for (const revision of [undefined, null, '', 'stale', 'A'.repeat(64), 42]) {
      await assert.rejects(run(modified(events => { events[0].dataset.revision = revision; })), /start/);
    }
    await run(modified(events => { for (const event of events) if (event.type === 'batch') delete event.sourceIds; }));
    await run(result.events);
  } finally { globalThis.fetch = original; await f.clean(); }
});


test('crop propagates source scalar labels with selected points and empty batches, binding hashes', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 7; i++) f.payload.writeFloatLE(i === 5 ? 8 : i, i * 28 + 24);
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    const result = await collect(f.adapter.crop(box));
    assert.deepEqual(result.events.flatMap(event => event.type === 'batch' ? event.labels! : []), [1, 2, 3, 4, 8]);
    assert.ok(result.events.every(event => event.type !== 'batch' || event.labels?.length === event.positions.length / 3));
    const empty = await collect(f.adapter.crop({ min: [4.01, 4.01, 124.01], max: [4.02, 4.02, 124.02] }));
    assert.ok(empty.events.some(event => event.type === 'batch'));
    assert.ok(empty.events.every(event => event.type !== 'batch' || Array.isArray(event.labels) && event.labels.length === 0));
    f.payload.writeFloatLE(0, 28 + 24); await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    assert.notEqual((await collect(f.adapter.crop(box))).sampleHash, result.sampleHash);
  } finally { await f.clean(); }
});

test('crop validates scalar labels before selection, rejects mixed decoders, and keeps batch alignment', async () => {
  const f = await fixture();
  try {
    const count = CROP_BATCH_POINTS + 1, size = count * 28;
    const input = { dataset: await f.adapter.info(), rootBox, scale: [0.001, 0.001, 0.001] as const, stride: 28,
      first: record(1, 0, count, 0, size), hierarchySize: 22, payloadSize: size,
      readHierarchy: async () => { throw new Error('Unexpected read'); },
      readPayload: async (_offset: number, bytes: number) => Buffer.alloc(bytes),
      decode: (_bytes: Buffer, index: number) => ({ positions: [3, 3, 123], colors: [255, 0, 0], label: index % 9 }) };
    const streamed = await collect(readFullResolutionCrop(input, box));
    const batches = streamed.events.filter(event => event.type === 'batch');
    assert.deepEqual(batches.map(event => event.labels?.length), [CROP_BATCH_POINTS, 1]);
    assert.deepEqual(batches[1].labels, [CROP_BATCH_POINTS % 9]);
    for (const label of [-1, 9, 1.5, NaN, Infinity, null, '1']) {
      await assert.rejects(collect(readFullResolutionCrop({ ...input,
        decode: () => ({ positions: [9, 9, 129], colors: [255, 0, 0], label: label as number }) }, box)), /labels/);
    }
    for (const missingFirst of [true, false]) await assert.rejects(collect(readFullResolutionCrop({ ...input,
      decode: (_bytes, index) => ({ positions: [3, 3, 123], colors: [255, 0, 0],
        ...(Boolean(index) === missingFirst ? { label: 2 } : {}) }) }, box)), /labels/);
    await assert.rejects(collect(readFullResolutionCrop({ ...input,
      decode: (_bytes, index) => ({ positions: [3, 3, 123], colors: [255, 0, 0],
        ...(index < CROP_BATCH_POINTS ? { label: 2 } : {}) }) }, box)), /labels/);
  } finally { await f.clean(); }
});

test('client validates optional semantic label length/range and consistent presence; accepts legacy labels absent', async () => {
  const f = await fixture(), original = globalThis.fetch, signal = new AbortController().signal;
  try {
    const result = await collect(f.adapter.crop(box));
    const run = async (events: unknown[]) => {
      globalThis.fetch = async () => new Response(events.map(event => JSON.stringify(event) + '\n').join(''));
      const published: CropEvent[] = [];
      await fetchCrop(box, signal, event => { published.push(event); });
      return published;
    };
    const modified = (change: (events: any[]) => void) => { const events = structuredClone(result.events); change(events); return events; };
    const batchAt = result.events.findIndex(event => event.type === 'batch');
    for (const labels of [null, {}, [], [0, 1], [-1], [9], [0.5], ['1'], [null]]) {
      await assert.rejects(run(modified(events => { events[batchAt].labels = labels; })), /labels/);
    }
    for (const at of [batchAt, batchAt + 1]) await assert.rejects(run(modified(events => { delete events[at].labels; })), /labels/);
    assert.deepEqual(await run(result.events), result.events);
    const legacy = modified(events => { for (const event of events) if (event.type === 'batch') delete event.labels; });
    assert.deepEqual(await run(legacy), legacy);
  } finally { globalThis.fetch = original; await f.clean(); }
});
