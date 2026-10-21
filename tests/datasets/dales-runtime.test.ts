import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../../apps/server/src/index';
import { DALES_TILES, dalesRegistrations } from '../../apps/server/src/datasets/prepared-cloud-routes';
import { createPreparedCloudRegistry } from '../../apps/server/src/datasets/prepared-cloud';
import { preparedPoint, loadPreparedSample, type PreparedSample } from '../../apps/web/src/scenes/dales/prepared-cloud-client';

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'dales-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  const id = 'dales2-5080-54435', count = 5000;
  const descriptor = { version: 1, format: 'potree2-uncompressed', id, frameId: `${id}-local`,
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [0, 0, 0] },
    sources: [{ id: 1, name: '5080_54435.laz', points: count }],
    semantics: { attribute: 'classification', type: 'uint8', classes: { '12': 'Habitat' } } };
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: count, scale: [0.01, 0.01, 0.01], offset: [0, 0, 0], hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [500, 500, 100] }, attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [500, 500, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'classification', type: 'uint8', size: 1 },
    ] };
  const payload = Buffer.alloc(count * 25), hierarchy = Buffer.alloc(22);
  for (let i = 0; i < count; i++) {
    const at = i * 25; payload.writeInt32LE(i, at); payload.writeUInt16LE(65535, at + 12);
    payload.writeUInt16LE(1, at + 18); payload.writeUInt32LE(i, at + 20); payload[at + 24] = 12;
  }
  hierarchy[0] = 1; hierarchy.writeUInt32LE(count, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await Promise.all([writeFile(join(root, 'cloud.json'), JSON.stringify(descriptor)), writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)),
    writeFile(join(root, 'octree/hierarchy.bin'), hierarchy), writeFile(join(root, 'octree/octree.bin'), payload)]);
  const server = createDemoServer({ datasetRoot: join(root, 'no-toronto'), preparedClouds: { [id]: root } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, id, base, path: `${base}/datasets/prepared/${id}` };
}

test('operator inventory registers all 29 independent DALES tiles and no Toronto fallback', () => {
  const registrations = dalesRegistrations('/operator/dales');
  assert.equal(DALES_TILES.length, 29); assert.equal(new Set(DALES_TILES).size, 29);
  assert.equal(Object.keys(registrations).length, 29);
  assert.equal(registrations['dales2-5080-54435'], '/operator/dales/5080_54435');
  assert.ok(Object.keys(registrations).every(id => id.startsWith('dales2-')));
});

test('DALES routes load independently of missing Toronto and expose native labels plus bound picks', async t => {
  const f = await fixture(t);
  const inventory = await (await fetch(`${f.base}/datasets/prepared`)).json();
  assert.deepEqual(inventory.scenes, [{ id: f.id, name: 'DALES-2 · 5080_54435' }]);
  assert.ok(!JSON.stringify(inventory).includes(f.root));
  const info = await (await fetch(f.path)).json();
  assert.equal(info.descriptor.frameId, `${f.id}-local`); assert.equal(info.capabilities.editing, false);
  const response = await fetch(`${f.path}/sample?revision=${info.revision}&budget=5000&depth=0`);
  assert.equal(response.status, 200);
  const sample = await response.json() as PreparedSample;
  assert.equal(sample.count, 5000); assert.equal(sample.labels?.[0], 12);
  const pick = preparedPoint(sample, 4999);
  assert.equal(pick.type, 'Habitat'); assert.equal(pick.cloudId, f.id); assert.equal(pick.sourceRow, 4999);
  assert.deepEqual(pick.position, [49.99, 0, 0]); assert.equal(pick.frameId, `${f.id}-local`);
  assert.equal(pick.revision, info.revision); assert.equal('artifactRevision' in pick, false);
  assert.throws(() => preparedPoint(sample, 5000), /Invalid sample/);
  const reader = createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id);
  // Widening the display sample does not widen the harness default.
  await assert.rejects(reader.sample(info.revision, { budget: 5000, depth: 0 }), { name: 'RangeError' });
});

test('prepared routes fail closed on unsafe requests, stale revisions, missing assets and mutation', async t => {
  const f = await fixture(t), info = await (await fetch(f.path)).json();
  for (const query of ['budget=100001&depth=0', 'budget=4096&depth=3', 'budget=4096&depth=0&path=/tmp/cloud', 'budget=4&budget=5&depth=0']) {
    assert.equal((await fetch(`${f.path}/sample?revision=${info.revision}&${query}`)).status, 400);
  }
  assert.equal((await fetch(`${f.path}/sample?revision=${'a'.repeat(64)}&budget=4&depth=0`)).status, 503);
  assert.equal((await fetch(`${f.path}/octree/octree.bin`)).status, 404);
  assert.equal((await fetch(`${f.path}?path=/tmp/cloud`)).status, 400);
  assert.equal((await fetch(`${f.path}`, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(f.path, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(f.path, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.once('error', reject); request.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(f.path, { headers: { Range: 'bytes=0-10' } })).status, 416);
  assert.equal((await fetch(`${f.base}/datasets/prepared/toronto3d`)).status, 404);
  await rm(join(f.root, 'octree/octree.bin'));
  const unavailable = await fetch(f.path); assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes(f.root));
});

test('browser sample loader refuses mismatched scene/frame/revision before publication', async t => {
  const f = await fixture(t), info = await (await fetch(f.path)).json();
  const sample = await (await fetch(`${f.path}/sample?revision=${info.revision}&budget=4&depth=0`)).json();
  const originalFetch = globalThis.fetch;
  const mock = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).includes('/sample?')) return new Response(JSON.stringify({ ...sample, cloud: { ...sample.cloud, revision: 'f'.repeat(64) } }));
    return new Response(JSON.stringify(info));
  });
  try { await assert.rejects(loadPreparedSample(f.id, 4, 0, new AbortController().signal), /stale/); }
  finally { mock.mock.restore(); assert.equal(globalThis.fetch, originalFetch); }
});

test('DALES is default and its branch never mounts Toronto scene/chat/edits', async () => {
  const app = await readFile(new URL('../../apps/web/src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /\$state<'dales' \| 'toronto' \| 'pole'>\('dales'\)/);
  assert.match(app, /\{#if mode === 'dales'\}\s*<Dales \/>\s*\{:else if mode === 'toronto'\}/);
  assert.match(app, /\{#if mode === 'dales'\}<p class="chat-unavailable">[^<]*<\/p>\{:else\}<Chat/);
  const viewer = await readFile(new URL('../../apps/web/src/scenes/dales/dales-viewer.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../../apps/web/src/scenes/dales/Dales.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(viewer + component, /Toronto|toronto-point|PointEdits|TorontoCad|\/chat\//);
  assert.match(component, /selected\.type/); assert.match(component, /Point types/);
  assert.match(viewer, /preparedPoint\(sample, hit.index\)/);
});
