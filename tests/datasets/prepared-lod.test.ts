import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../../apps/server/src/index';
import { createPreparedCloudRegistry } from '../../apps/server/src/datasets/prepared-cloud';
import { decodePreparedNode, PREPARED_NODE_MIME } from '@spatial/contracts';

const record = (type: number, mask: number, count: number, offset: number, size: number) => {
  const b = Buffer.alloc(22); b[0] = type; b[1] = mask; b.writeUInt32LE(count, 2); b.writeBigUInt64LE(BigInt(offset), 6); b.writeBigUInt64LE(BigInt(size), 14); return b;
};
async function fixture(t: { after(callback: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'prepared-lod-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  const descriptor = { version: 1, format: 'potree2-uncompressed', id: 'native-test', frameId: 'native-local',
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [0, 0, 0] }, sources: [{ id: 42, name: 'native.ply', points: 2 }],
    semantics: { attribute: 'semantic_id', type: 'uint16', classes: { '65535': 'Native class', '19': 'Grass' } },
    instances: { attribute: 'instance_id', type: 'int32', unassigned: -100 } };
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, scale: [0.001, 0.001, 0.001], offset: [0, 0, 0], hierarchy: { firstChunkSize: 44 }, boundingBox: { min: [0, 0, 0], max: [8, 8, 8] }, attributes: [
    { name: 'position', type: 'int32', size: 12, min: [1, 1, 1], max: [6, 6, 6] }, { name: 'rgb', type: 'uint16', size: 6 },
    { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'semantic_id', type: 'uint16', size: 2 }, { name: 'instance_id', type: 'int32', size: 4 },
  ] };
  const payload = Buffer.alloc(60);
  for (let i = 0; i < 2; i++) {
    const at = i * 30;
    for (let axis = 0; axis < 3; axis++) payload.writeInt32LE(i ? 6000 : 1000, at + axis * 4);
    payload.writeUInt16LE(65535, at + 12); payload.writeUInt16LE(32896, at + 14);
    payload.writeUInt16LE(42, at + 18); payload.writeUInt32LE(i, at + 20); payload.writeUInt16LE(i ? 19 : 65535, at + 24); payload.writeInt32LE(i ? 2147483647 : -100, at + 26);
  }
  const hierarchy = Buffer.concat([record(0, 128, 1, 0, 30), record(2, 0, 1, 44, 22), record(1, 0, 1, 30, 30)]);
  await Promise.all([writeFile(join(root, 'cloud.json'), JSON.stringify(descriptor)), writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)), writeFile(join(root, 'octree/hierarchy.bin'), hierarchy), writeFile(join(root, 'octree/octree.bin'), payload)]);
  const registry = createPreparedCloudRegistry({ 'native-test': root }), reader = registry.open('native-test');
  return { root, reader, registry, hierarchy, info: await reader.info() };
}

test('prepared display follows proxy chunks exactly, keeps native labels/instances and invalidates stale revisions', async t => {
  const f = await fixture(t), hierarchy = await f.reader.displayHierarchy(f.info.revision);
  assert.deepEqual(hierarchy.nodes.map(n => n.name), ['r', 'r7']);
  assert.deepEqual(hierarchy.nodes[1].bounds, { min: [4, 4, 4], max: [8, 8, 8] });
  assert.equal(hierarchy.nodes.reduce((sum, node) => sum + node.count, 0), 2);
  assert.equal(f.registry.open('native-test'), f.reader);
  const node = await f.reader.displayNode(f.info.revision, 'r7');
  assert.deepEqual(Array.from(node.positions), [6, 6, 6]); assert.deepEqual(Array.from(node.colors), [255, 128, 0]);
  assert.deepEqual(Array.from(node.sourceIds), [42, 1]); assert.equal(node.labels![0], 19); assert.equal(node.instances![0], 2147483647);
  await assert.rejects(f.reader.displayNode(f.info.revision, 'r0'), /Unknown/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(f.reader.displayNode(f.info.revision, 'r', abort.signal), /abort/i);
  const changed = Buffer.from(f.hierarchy); changed.writeUInt32LE(2, 46);
  await writeFile(join(f.root, 'octree/hierarchy.bin'), changed);
  await assert.rejects(f.reader.displayNode(f.info.revision, 'r'), /Stale/);
  const next = await f.reader.info(); await assert.rejects(f.reader.displayHierarchy(next.revision), /range|payload|Incomplete|limits|disagreement/);
});

test('prepared native HTTP is fixed-path/revision-bound binary, retains source precision and rejects unsafe requests', async t => {
  const f = await fixture(t), server = createDemoServer({ datasetRoot: join(f.root, 'no-toronto'), preparedClouds: { 'native-test': f.root } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/datasets/prepared/native-test`;
  const catalog = await (await fetch(`${base}/display-hierarchy?revision=${f.info.revision}`)).json();
  assert.deepEqual(catalog.nodes.map((n: { name: string }) => n.name), ['r', 'r7']);
  const path = `${base}/display-node?revision=${f.info.revision}&name=r`;
  const response = await fetch(path); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), PREPARED_NODE_MIME);
  const node = decodePreparedNode(new Uint8Array(await response.arrayBuffer()), { cloudId: 'native-test', revision: f.info.revision, name: 'r', count: 1 });
  assert.equal(node.labels![0], 65535); assert.equal(node.instances![0], -100); assert.deepEqual(Array.from(node.sourceIds), [42, 0]);
  for (const url of [`${base}/display-node?revision=${f.info.revision}`, `${path}&path=secret`, `${path}&name=r7`, `${base}/display-hierarchy`, `${base}/display-node?revision=${f.info.revision}&name=..`]) assert.equal((await fetch(url)).status, 400);
  assert.equal((await fetch(path.replace(f.info.revision, '0'.repeat(64)))).status, 503);
  assert.equal((await fetch(path, { method: 'POST' })).status, 405);
  assert.equal((await fetch(path, { headers: { range: 'bytes=0-10' } })).status, 416);
  assert.equal((await fetch(path, { headers: { origin: 'https://example.com' } })).status, 403);
});
