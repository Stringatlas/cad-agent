import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGroundQueryRoutes } from '../../apps/server/src/spatial/ground-query-routes';
import { PotreeDataset } from '../../apps/server/src/datasets/potree';
import type { GroundCell, ScenePreprocessing } from '../../apps/server/src/preprocessing/scene-preprocessing';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ground-route-'));
  await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, -10], max: [10, 10, 10] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, -10], max: [10, 10, 10] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0] }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), Buffer.alloc(28));
  const dataset = await new PotreeDataset(root).info();
  const cells: GroundCell[] = [[0, 0, 0], [1, 0, .2], [0, 1, .4], [1, 1, .6]].map(([x, y, elevation]) => ({ x, y, elevation, maxElevation: elevation + .1, points: 3 }));
  const artifact: ScenePreprocessing = {
    version: 'scene-preprocessing-v1', complete: true,
    binding: { datasetId: 'toronto3d', artifactRevision: dataset.revision, frameId: 'toronto3d-local-v1', units: 'm', coordinates: dataset.coordinates,
      indexHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), instanceManifestHash: 'c'.repeat(64), membershipHash: 'd'.repeat(64) },
    settings: { algorithm: 'streaming-ground-primitives-v1', residual: 'distance-to-finite-surface', toleranceMeters: .2 }, instances: [],
    ground: { cellMeters: 2, origin: [0, 0], labels: [1, 2], minimumSupport: 3, points: 12, method: 'observed-cell-minimum-v1', cells,
      limitation: 'Lower envelope of Ground/Road_markings only; sensitive to low outliers; no interpolation or extrapolation' },
    statistics: { totalSourcePoints: 12, memberships: 0, indexPasses: 3, fitted: 0, insufficient: 0, degenerate: 0 },
    limitation: 'Derived original-source observations, not edited effective coordinates, physical-instance certification or CAD solids',
  };
  const manifest = join(root, 'preprocessing.json');
  const save = async () => { artifact.ground.points = artifact.ground.cells.reduce((sum, cell) => sum + cell.points, 0); await writeFile(manifest, JSON.stringify(artifact)); };
  await save();
  const route = createGroundQueryRoutes(root, manifest);
  const server = createServer((req, res) => { void route(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const path = `/datasets/toronto3d/ground-elevation?revision=${dataset.revision}&x=2&y=2`;
  return { root, artifact, dataset, manifest, save, base, path, get: () => fetch(base + path), async clean() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  } };
}

test('ground HTTP exposes bound original minima/interpolation, range-not-uncertainty and honest limitations', async () => {
  const f = await fixture();
  try {
    const response = await f.get(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-type')!, /application\/json/);
    const body = await response.json(); assert.deepEqual(body.binding, f.artifact.binding); assert.deepEqual(body.position, [2, 2]);
    assert.equal(body.ground.status, 'available'); assert.equal(body.ground.elevation, .3); assert.equal(body.ground.supportingCells.length, 4);
    assert.equal(body.ground.method, 'cell-center-triangulation-v1'); assert.equal(body.ground.spreadMeters, .7);
    assert.equal(body.cadVerification, false); assert.equal(body.independentVerification, false);
    assert.match(body.limitations, /not uncertainty/); assert.match(body.limitations, /Excludes edits/); assert.match(body.limitations, /not a fresh source audit/);
    const center = await (await fetch(f.base + f.path.replace('x=2&y=2', 'x=1&y=1'))).json();
    assert.equal(center.ground.elevation, 0); assert.equal(center.ground.method, 'observed-cell-center');
    assert.equal((await fetch(f.base + '/unrelated')).status, 404);
  } finally { await f.clean(); }
});

test('ground HTTP coverage holes, weak cells, outside support and slope cutoff are 200 unavailable, never filled', async () => {
  const f = await fixture();
  try {
    f.artifact.ground.cells.pop(); await f.save();
    let body = await (await f.get()).json(); assert.deepEqual(body.ground, { status: 'unavailable', reason: 'outside-support' });
    f.artifact.ground.cells.push({ x: 1, y: 1, elevation: .6, maxElevation: .7, points: 2 }); await f.save();
    body = await (await f.get()).json(); assert.equal(body.ground.reason, 'insufficient-support');
    Object.assign(f.artifact.ground.cells[3], { points: 3, elevation: 100, maxElevation: 100 }); await f.save();
    body = await (await f.get()).json(); assert.equal(body.ground.reason, 'slope-limit');
    const outside = await fetch(f.base + f.path.replace('x=2', 'x=-100')); assert.equal(outside.status, 200); assert.equal((await outside.json()).ground.reason, 'outside-support');
  } finally { await f.clean(); }
});

test('ground HTTP reads the full artifact beyond the 10000-cell display cap', async () => {
  const f = await fixture();
  try {
    f.artifact.ground.cells = Array.from({ length: 10010 }, (_, x) => ({ x, y: 0, points: 3, elevation: 4, maxElevation: 4 }));
    f.artifact.ground.cells.push({ x: 10009, y: 1, points: 3, elevation: 4, maxElevation: 4 }, { x: 10008, y: 1, points: 3, elevation: 4, maxElevation: 4 });
    await f.save();
    const response = await fetch(f.base + f.path.replace('x=2&y=2', 'x=20018&y=2'));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ground.status, 'available');
    assert.equal(body.ground.elevation, 4); assert.equal(body.ground.supportingCells.length, 4);
  } finally { await f.clean(); }
});

test('ground HTTP strict unique keys, numeric grammar, finite coordinates and revision bounds', async () => {
  const f = await fixture();
  try {
    const prefix = f.base + '/datasets/toronto3d/ground-elevation?';
    for (const query of ['', 'revision=x&x=1', 'revision=&x=1&y=1', 'revision=%20&x=1&y=1', `revision=${'x'.repeat(129)}&x=1&y=1`,
      'revision=x&x=1&y=1&x=2', 'revision=x&x=1&y=1&%78=2', 'revision=x&x=1&y=1&path=/tmp/file',
      ...['', 'NaN', 'Infinity', '1e999', '0x1', '1.2foo', '%201', '+1', '.5', '1.'].map(x => `revision=x&x=${x}&y=1`),
      'revision=x&x=1&y=1&padding=' + 'a'.repeat(4096)]) {
      assert.equal((await fetch(prefix + query)).status, 400, query);
    }
    assert.equal((await fetch(f.base + f.path.replace('x=2&y=2', 'x=-1e1&y=1E%2B0'))).status, 200);
    assert.equal((await fetch(f.base + f.path.replace(f.dataset.revision, 'outdated'))).status, 409);
  } finally { await f.clean(); }
});

test('ground HTTP loopback host/origin, method and range guards', async () => {
  const f = await fixture();
  try {
    const hostileHost = await new Promise<number>(resolve => {
      const req = httpRequest(f.base + f.path, { headers: { host: 'localhost.evil.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    }); assert.equal(hostileHost, 403);
    for (const origin of ['null', 'https://localhost', 'http://127.0.0.1.evil.example', 'http://evil.example']) assert.equal((await fetch(f.base + f.path, { headers: { origin } })).status, 403);
    assert.equal((await fetch(f.base + f.path, { headers: { origin: 'http://localhost:5173' } })).status, 200);
    assert.equal((await fetch(f.base + f.path, { method: 'POST' })).status, 404);
    assert.equal((await fetch(f.base + f.path, { headers: { range: 'bytes=0-1' } })).status, 416);
  } finally { await f.clean(); }
});

test('ground HTTP missing, malformed, stale or unsafe artifacts fail closed without leaking operator paths', async () => {
  const f = await fixture();
  try {
    const unavailable = async () => {
      const response = await f.get(); assert.equal(response.status, 503); const body = await response.json();
      assert.equal(body.complete, false); assert.equal(body.ground, undefined); assert.ok(!JSON.stringify(body).includes(f.root));
    };
    await rm(f.manifest); await unavailable(); await writeFile(f.manifest, '{broken'); await unavailable();
    f.artifact.binding = { ...f.artifact.binding, artifactRevision: 'a'.repeat(64) }; await f.save(); await unavailable();
    f.artifact.binding = { ...f.artifact.binding, artifactRevision: f.dataset.revision }; f.artifact.ground.cells.push(f.artifact.ground.cells[0]); await f.save(); await unavailable();
    f.artifact.ground.cells.pop(); await f.save();
    const target = join(f.root, 'target.json'); await writeFile(target, JSON.stringify(f.artifact)); await rm(f.manifest); await symlink(target, f.manifest); await unavailable();
  } finally { await f.clean(); }
});

test('ground HTTP rechecks current metadata before returning any elevation', async t => {
  const f = await fixture(), original = PotreeDataset.prototype.info;
  let calls = 0;
  t.mock.method(PotreeDataset.prototype, 'info', async function (this: PotreeDataset) {
    const info = await original.call(this); return ++calls === 2 ? { ...info, revision: 'f'.repeat(64) } : info;
  });
  try { const response = await f.get(); assert.equal(response.status, 409); assert.equal((await response.json()).ground, undefined); }
  finally { await f.clean(); }
});

test('ground HTTP single admission aborts disconnected metadata waits and admits again', async t => {
  const f = await fixture(), original = PotreeDataset.prototype.info;
  let enter!: () => void, release!: () => void, first = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(PotreeDataset.prototype, 'info', async function (this: PotreeDataset) {
    if (first) { first = false; enter(); await gate; } return original.call(this);
  });
  try {
    const request = httpRequest(f.base + f.path); request.on('error', () => {}); request.end(); await entered;
    assert.equal((await f.get()).status, 429); request.destroy(); release();
    let response: Response | undefined;
    for (let i = 0; i < 100; i++) { response = await f.get(); if (response.status !== 429) break; await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(response!.status, 200);
  } finally { release(); await f.clean(); }
});

test('ground HTTP five-second deadline returns 503 and releases admission', async t => {
  const f = await fixture(), original = PotreeDataset.prototype.info;
  let enter!: () => void, release!: () => void, first = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(PotreeDataset.prototype, 'info', async function (this: PotreeDataset) {
    if (first) { first = false; enter(); await gate; } return original.call(this);
  });
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = f.get(); await entered; t.mock.timers.tick(5000);
    const response = await pending; assert.equal(response.status, 503); assert.equal((await response.json()).complete, false);
    t.mock.timers.reset(); release(); assert.equal((await f.get()).status, 200);
  } finally { t.mock.timers.reset(); release(); await f.clean(); }
});
