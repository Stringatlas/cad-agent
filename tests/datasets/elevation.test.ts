import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalElevationCoordinates, type ElevationGrid, type ElevationInfo, type ElevationQuery } from '@spatial/contracts';
import { elevationFixture } from '../helpers/elevation-fixture';
import { openPreparedElevation } from '../../apps/server/src/datasets/prepared-elevation';
import { createDemoServer } from '../../apps/server/src/index';
import { createElevationSurface } from '../../apps/web/src/viewer/elevation-surface';

test('DTM/DSM queries use actual GeoTIFF cells, explicit ground support and NoData', async t => {
  const f = await elevationFixture(t), model = await openPreparedElevation(f.root, f.info); assert(model);
  const ground = await model.query({ x: .1, y: .1 });
  assert.equal(ground.dtm, 11); assert.equal(ground.dsm, 20); assert.equal(ground.heightAboveGround, 9);
  assert.deepEqual(ground.support, { groundPoints: 3, surfacePoints: 4, groundMin: 10, groundMax: 12 });
  assert.deepEqual(ground.cell?.center, [.5, .5]); assert.equal(ground.frameId, 'elevation-local');
  const roof = await model.query({ x: 1.1, y: .1 }); assert.equal(roof.dtm, null); assert.equal(roof.dsm, 25); assert.equal(roof.heightAboveGround, null);
  const sparse = await model.query({ x: 2.1, y: .1 }); assert.equal(sparse.dtm, null); assert.equal(sparse.support.groundPoints, 2);
  const empty = await model.query({ x: 1.1, y: 1.1 }); assert.equal(empty.status, 'no-data'); assert.equal(empty.dsm, null);
  const outside = await model.query({ x: -1, y: 0 }); assert.equal(outside.status, 'outside-grid'); assert.equal(outside.cell, null);
  const grid = await model.grid('dtm', 192); assert.equal(grid.values.length, 6); assert.deepEqual(grid.values, [1, null, null, 11, null, null]);
  const mesh = createElevationSurface(grid); assert.equal(mesh.mesh.geometry.getIndex()!.count, 0, 'No triangles connect isolated cells across NoData'); mesh.dispose();
  const filled = createElevationSurface({ ...grid, width: 2, height: 2, values: [1, 2, 3, 4] });
  assert.equal(filled.mesh.geometry.getIndex()!.count, 6);
  assert.deepEqual(Array.from(filled.mesh.geometry.getAttribute('position').array).filter((_, index) => index % 3 === 2), [1, 2, 3, 4]);
  filled.dispose();
});

test('elevation rejects stale/modified/symlinked assets and aborted or malformed queries', async t => {
  const f = await elevationFixture(t), model = await openPreparedElevation(f.root, f.info); assert(model);
  for (const bad of [{ x: NaN, y: 0 }, { x: 0, y: 1e8 }, { x: 0, y: 0, path: 'secret' }]) assert.throws(() => canonicalElevationCoordinates(bad));
  await assert.rejects(openPreparedElevation(f.root, { ...f.info, revision: '0'.repeat(64) }), /Stale/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(model.query({ x: 0, y: 0 }, abort.signal), /abort/i);
  await writeFile(join(f.root, 'elevation/dtm.tif'), Buffer.from('corrupt'));
  await assert.rejects(model.query({ x: .1, y: .1 }), /changed/);
  await assert.rejects(openPreparedElevation(f.root, f.info), /asset/);
  await unlink(join(f.root, 'elevation/dtm.tif')); await symlink(join(f.root, 'elevation/dsm.tif'), join(f.root, 'elevation/dtm.tif'));
  await assert.rejects(openPreparedElevation(f.root, f.info), /asset/);
  const missing = await elevationFixture(t, false); assert.equal(await openPreparedElevation(missing.root, missing.info), undefined);
});

test('elevation HTTP metadata/grid/point endpoints are revision-bound, bounded and read-only', async t => {
  const f = await elevationFixture(t), server = createDemoServer({ datasetRoot: join(f.root, 'no-toronto'), preparedClouds: { [f.id]: f.root } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/datasets/prepared/${f.id}`;
  const info = await (await fetch(`${base}/elevation?revision=${f.info.revision}`)).json() as ElevationInfo;
  assert.equal(info.sourceRevision, f.info.revision); assert.equal(info.grid.resolution, 1);
  const query = `${base}/elevation-query?revision=${f.info.revision}&modelRevision=${info.revision}&x=0.1&y=0.1`;
  const result = await (await fetch(query)).json() as ElevationQuery; assert.equal(result.dtm, 11);
  const gridPath = `${base}/elevation-grid?revision=${f.info.revision}&modelRevision=${info.revision}&layer=dsm&maxSize=192`;
  const grid = await (await fetch(gridPath)).json() as ElevationGrid; assert.equal(grid.values[4], 25);
  for (const path of [`${query}&path=secret`, gridPath.replace('192', '257'), query.replace('x=0.1', 'x=Infinity'), `${base}/elevation`]) assert.equal((await fetch(path)).status, 400);
  assert.equal((await fetch(query.replace(info.revision, '0'.repeat(64)))).status, 503);
  assert.equal((await fetch(query, { method: 'POST' })).status, 405);
  assert.equal((await fetch(query, { headers: { range: 'bytes=0-10' } })).status, 416);
  assert.equal((await fetch(query, { headers: { origin: 'https://example.com' } })).status, 403);
});
