import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { canonicalTerrainArgs } from '@spatial/contracts';
import { openPreparedElevation } from '../../apps/server/src/datasets/prepared-elevation';
import { openPreparedTerrain } from '../../apps/server/src/datasets/prepared-terrain';
import { createPreparedCloudRoutes } from '../../apps/server/src/datasets/prepared-cloud-routes';
import { terrainFixture } from '../helpers/terrain-fixture';

const polygon = [[0, 0], [3, 0], [3, 2], [0, 2]];
const signal = () => new AbortController().signal;

test('terrain validates requests, summarizes original cells, reports unsupported slope and maps real PNG pixels', async t => {
  const f = await terrainFixture(t), elevation = (await openPreparedElevation(f.root, f.info))!;
  const terrain = await openPreparedTerrain(f.root, elevation); assert(terrain, 'Install scripts/elevation-requirements.txt into the documented Python runtime');
  const summary = await terrain.analyze('query_terrain_region', { polygon }, signal());
  assert.match(summary.queryId, /^[a-f0-9]{64}$/);
  assert.equal(summary.sourceRevision, f.info.revision); assert.equal(summary.result.selectedCells, 6);
  const stats = summary.result.statistics as Record<string, { validCells: number; mean: number | null }>;
  assert.equal(stats.dtm.validCells, 2); assert.equal(stats.dtm.mean, 6); assert.equal(stats.slope.validCells, 0); assert.equal(stats.slope.mean, null);
  const image = await terrain.analyze('terrain_image', { polygon, layer: 'dtm', maxSize: 128 }, signal());
  assert(image.image?.dataUrl.startsWith('data:image/png;base64,'));
  const bytes = Buffer.from(image.image!.dataUrl.split(',')[1], 'base64'); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual((image.result.mapping as { origin: number[] }).origin, [0, 2]);
  const profile = await terrain.analyze('terrain_profile', { start: [.1, .1], end: [2.1, .1], samples: 3 }, signal());
  const samples = profile.result.samples as { dtm: number | null; dsm: number | null; gradeFromPreviousPercent: number | null }[];
  assert.deepEqual(samples.map(v => v.dtm), [11, null, null]); assert.equal(samples[1].dsm, 25); assert.equal(samples[1].gradeFromPreviousPercent, null);
  const filtered = await terrain.analyze('filter_terrain_regions', { polygon, maxSlopeDegrees: 5, minArea: 1, maxHeightAboveGround: null, maxRegions: 4 }, signal());
  assert.equal(filtered.result.matchingRegions, 0);
  await assert.rejects(terrain.analyze('query_terrain_region', { polygon: [[0, 0], [3, 2], [0, 2], [3, 0]] }, signal()), /unavailable|bounds/);
  await assert.rejects(terrain.analyze('query_terrain_region', { polygon: [[0, 0], [2000, 0], [2000, 2000]] }, signal()), /bounds/);
  await assert.rejects(terrain.analyze('terrain_image', { polygon, layer: 'slope', maxSize: 1024 }, signal()), /Invalid/);
  await assert.rejects(terrain.analyze('terrain_profile', { start: [0, 0], end: [0, 0], samples: 2 }, signal()), /Invalid/);
  assert.throws(() => canonicalTerrainArgs('query_terrain_region', { polygon, path: '/etc/passwd' }), /Invalid/);
  assert.throws(() => canonicalTerrainArgs('terrain_image', { polygon, layer: ['dtm'], maxSize: 128 }), /Invalid/);
  assert.throws(() => canonicalTerrainArgs('filter_terrain_regions', { polygon, maxSlopeDegrees: NaN, minArea: 1, maxHeightAboveGround: null, maxRegions: 4 }), /Invalid/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(terrain.analyze('query_terrain_region', { polygon }, abort.signal));
  const running = new AbortController();
  const pending = terrain.analyze('query_terrain_region', { polygon }, running.signal);
  const timer = setTimeout(() => running.abort(), 30);
  try { await assert.rejects(pending); } finally { clearTimeout(timer); }
  const grid = await terrain.grid(16, signal()); assert.equal(grid.color?.units, 'degrees'); assert(grid.values.every(v => v === null));
});

test('scientific worker rejects TIFF geometry that disagrees with even a rebound manifest', async t => {
  const f = await terrainFixture(t), basePath = join(f.root, 'elevation/manifest.json');
  const base = JSON.parse(await readFile(basePath, 'utf8')); base.grid.width++;
  const raw = JSON.stringify(base); await writeFile(basePath, raw);
  const terrainPath = join(f.root, 'elevation/terrain/manifest.json');
  const manifest = JSON.parse(await readFile(terrainPath, 'utf8'));
  manifest.elevationRevision = createHash('sha256').update(raw).digest('hex'); await writeFile(terrainPath, JSON.stringify(manifest));
  const elevation = (await openPreparedElevation(f.root, f.info))!, terrain = await openPreparedTerrain(f.root, elevation); assert(terrain);
  await assert.rejects(terrain.analyze('query_terrain_region', { polygon }, signal()), /unavailable|bounds/);
});

test('terrain assets reject stale bindings, changed files and symlinks; HTTP preview stays revision-bound and read-only', async t => {
  const f = await terrainFixture(t), elevation = (await openPreparedElevation(f.root, f.info))!, terrain = (await openPreparedTerrain(f.root, elevation))!;
  const routes = createPreparedCloudRoutes({ [f.id]: f.root });
  const server = createServer((req, res) => { void routes(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/datasets/prepared/${f.id}`;
  const params = new URLSearchParams({ revision: f.info.revision, modelRevision: elevation.info.revision, terrainRevision: terrain.info.revision, maxSize: '16' });
  assert.equal((await fetch(`${base}/terrain-grid?${params}`)).status, 200);
  const metadata = await (await fetch(`${base}/elevation?revision=${f.info.revision}`)).json(); assert.equal(metadata.terrain.revision, terrain.info.revision);
  assert.equal((await fetch(`${base}/terrain-grid?${params}`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/terrain-grid?${params}&maxSize=32`)).status, 400);
  params.set('terrainRevision', 'a'.repeat(64)); assert.equal((await fetch(`${base}/terrain-grid?${params}`)).status, 503);
  const manifestPath = join(f.root, 'elevation/terrain/manifest.json'), raw = await readFile(manifestPath), manifest = JSON.parse(raw.toString());
  await writeFile(manifestPath, JSON.stringify({ ...manifest, elevationRevision: 'b'.repeat(64) }));
  await assert.rejects(openPreparedTerrain(f.root, elevation), /Stale/); await assert.rejects(terrain.check(), /changed/);
  await writeFile(manifestPath, raw);
  const path = join(f.root, 'elevation/terrain/slope.tif'), original = await readFile(path);
  await writeFile(path, Buffer.alloc(original.length)); await assert.rejects(openPreparedTerrain(f.root, elevation), /checksum/);
  await unlink(path); await symlink(join(f.root, 'elevation/dtm.tif'), path); await assert.rejects(openPreparedTerrain(f.root, elevation), /Invalid/);
});
