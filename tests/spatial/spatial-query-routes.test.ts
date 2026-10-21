import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact, SemanticFailure } from '../../apps/server/src/spatial/semantic-artifact';
import { dropSemanticDiskIndexMemoryCache, getSemanticDiskIndex } from '../../apps/server/src/spatial/semantic-disk-index';
import { SpatialPageIndex, type SpatialQueryOptions } from '../../apps/server/src/spatial/spatial-page-index';
import { createSpatialQueryRoutes } from '../../apps/server/src/spatial/spatial-query-routes';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-route-test-'));
  await mkdir(join(root, 'octree'));
  const points = [[0, 0], [1000, 6], [-1000, 6], [2000, 8], [3000, 6]];
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, -10], max: [10, 10, 10] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, -10], max: [10, 10, 10] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(points.length * 28);
  points.forEach(([x, label], i) => { payload.writeInt32LE(x, i * 28); payload.writeUInt16LE(1, i * 28 + 18);
    payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(label, i * 28 + 24); });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? points.length : 0 })) };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root), revision = snapshot.dataset.revision;
  const { index } = await getSemanticDiskIndex(snapshot); await snapshot.close();
  const route = createSpatialQueryRoutes(root);
  const server = createServer((req, res) => { void route(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const query = (value: object = {}) => ({ revision, operation: 'nearest', position: [0, 0, 0], ...value });
  const path = (value: object = {}) => '/datasets/toronto3d/spatial-query?request=' + encodeURIComponent(JSON.stringify(query(value)));
  return { root, revision, base, query, path,
    get: (value: object = {}) => fetch(base + path(value)),
    async clean() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      dropSemanticDiskIndexMemoryCache(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); } };
}

test('spatial HTTP exact nearest, radius capped/count-only, point-distance, labels and empty domains', async () => {
  const f = await fixture();
  try {
    const response = await f.get(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-type')!, /application\/json/);
    const near = await response.json(); assert.equal(near.complete, true); assert.equal(near.point.label, 0);
    assert.equal(near.point.source.sourceRow, 0); assert.equal(near.binding.artifactRevision, f.revision);
    assert.equal(near.domain, 'original-source-points'); assert.equal(near.independentVerification, false); assert.equal(near.cadVerification, false);
    assert.equal(near.binding.units, 'm'); assert.equal(near.binding.frameId, 'toronto3d-local-v1');
    const poles = await (await f.get({ label: 6 })).json(); assert.equal(poles.point.source.sourceRow, 1); assert.equal(poles.point.distanceMeters, 1);
    const radius = await (await f.get({ operation: 'radius', radiusMeters: 1, maxResults: 1 })).json();
    assert.equal(radius.totalCount, 3); assert.equal(radius.points.length, 1); assert.equal(radius.truncated, true); assert.equal(radius.complete, true);
    const count = await (await f.get({ operation: 'radius', radiusMeters: 1, maxResults: 0, label: 6 })).json();
    assert.equal(count.totalCount, 2); assert.deepEqual(count.points, []); assert.equal(count.truncated, true);
    const distance = await (await f.get({ operation: 'point-distance', position: [5, 0, 0], label: 6 })).json();
    assert.equal(distance.distanceMeters, 2); assert.equal(distance.operation, 'point-distance');
    for (const operation of ['nearest', 'point-distance']) {
      const empty = await (await f.get({ operation, label: 1 })).json(); assert.equal(empty.point, null);
      if (operation === 'point-distance') assert.equal(empty.distanceMeters, null);
    }
    const empty = await (await f.get({ operation: 'radius', label: 1, radiusMeters: 20 })).json(); assert.equal(empty.totalCount, 0); assert.equal(empty.truncated, false);
    assert.equal((await f.get({ revision: 'outdated' })).status, 409);
    assert.equal((await fetch(f.base + '/unrelated')).status, 404);
  } finally { await f.clean(); }
});

test('spatial HTTP strictly rejects malformed, duplicate, unknown and unbounded input', async () => {
  const f = await fixture();
  try {
    for (const value of [{ revision: '' }, { revision: ' '.repeat(3) }, { revision: 'x'.repeat(129) }, { position: [0, 0] }, { position: ['0', 0, 0] },
      { label: null }, { label: 9 }, { label: -1 }, { label: 1.5 }, { operation: 'clearance' }, { operation: 'radius' },
      { operation: 'radius', radiusMeters: -1 }, { operation: 'radius', radiusMeters: null }, { operation: 'radius', radiusMeters: 1, maxResults: 1001 },
      { operation: 'radius', radiusMeters: 1, maxResults: 0.5 }, { radiusMeters: 1 }, { maxResults: 0 }, { directory: '/tmp' }, { maxPages: 5 }]) {
      assert.equal((await f.get(value)).status, 400, JSON.stringify(value));
    }
    const prefix = '/datasets/toronto3d/spatial-query?';
    for (const text of ['null', '[]', '{', JSON.stringify(f.query()).replace('"nearest"', '"nearest","operation":"radius"'),
      JSON.stringify(f.query()).replace('"nearest"', '"nearest","operat\\u0069on":"nearest"'),
      JSON.stringify(f.query()).replace('[0,0,0]', '[1e999,0,0]')]) {
      assert.equal((await fetch(f.base + prefix + 'request=' + encodeURIComponent(text))).status, 400);
    }
    for (const suffix of ['', 'request={}&request={}', 'request={}&path=x', 'request=' + 'x'.repeat(4100)]) {
      assert.equal((await fetch(f.base + prefix + suffix)).status, 400);
    }
  } finally { await f.clean(); }
});

test('spatial HTTP loopback Host/Origin, method and range guards', async () => {
  const f = await fixture();
  try {
    const hostileHost = await new Promise<number>(resolve => {
      const req = httpRequest(f.base + f.path(), { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(hostileHost, 403);
    for (const [headers, expected] of [[{ origin: 'https://localhost' }, 403],
      [{ origin: 'http://localhost.evil.example' }, 403], [{ range: 'bytes=0-1' }, 416], [{ origin: 'http://localhost:5173' }, 200]] as const) {
      assert.equal((await fetch(f.base + f.path(), { headers })).status, expected);
    }
    assert.equal((await fetch(f.base + f.path(), { method: 'POST' })).status, 404);
  } finally { await f.clean(); }
});

test('spatial HTTP rejects busy admission, cancels on disconnect, releases snapshot and admits again', async t => {
  const f = await fixture();
  const original = SpatialPageIndex.prototype.nearest;
  let entered!: () => void, cancelled!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  let first = true, closes = 0;
  const close = SemanticArtifact.prototype.close;
  t.mock.method(SemanticArtifact.prototype, 'close', async function (this: SemanticArtifact) { closes++; await close.call(this); });
  t.mock.method(SpatialPageIndex.prototype, 'nearest', async function (this: SpatialPageIndex, position: Vec3, options?: SpatialQueryOptions) {
    if (!first) return original.call(this, position, options);
    first = false; entered();
    return await new Promise((_, reject) => options!.signal!.addEventListener('abort', () => { cancelled(); reject(options!.signal!.reason); }, { once: true }));
  });
  try {
    const request = httpRequest(f.base + f.path()); request.on('error', () => {}); request.end();
    await started;
    assert.equal((await f.get()).status, 429);
    request.destroy(); await aborted;
    // Cancellation cleanup must finish before admission is available again.
    let response: Response | undefined;
    for (let i = 0; i < 100; i++) { response = await f.get(); if (response.status !== 429) break; await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(response!.status, 200); assert.ok(closes >= 2);
  } finally { await f.clean(); }
});

test('spatial HTTP deadline, budget and unavailable failures never return partial success', async t => {
  const f = await fixture();
  try {
    for (const failure of [new RangeError('Spatial page budget exceeded'), new Error('/secret/internal/path'), new SemanticFailure('stale-revision', 'changed')]) {
      const mock = t.mock.method(SpatialPageIndex.prototype, 'nearest', async () => { throw failure; });
      const response = await f.get(); assert.equal(response.status, failure instanceof SemanticFailure ? 409 : 503);
      const body = await response.json(); assert.equal(body.complete, false); assert.equal(body.point, undefined); assert.ok(!JSON.stringify(body).includes('/secret'));
      mock.mock.restore();
    }
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    t.mock.method(SpatialPageIndex.prototype, 'nearest', async (_position: Vec3, options?: SpatialQueryOptions) => {
      entered(); return await new Promise((_, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }));
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = f.get(); await started; t.mock.timers.tick(30000);
    const response = await pending; assert.equal(response.status, 503); assert.equal((await response.json()).complete, false);
    t.mock.timers.reset();
  } finally { t.mock.timers.reset(); await f.clean(); }
});
