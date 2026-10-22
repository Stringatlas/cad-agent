/** Actual standard GeoTIFF reader compatibility for all operator-prepared scenes. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud';
import { preparedCloudRegistrations } from '../apps/server/src/datasets/scene-registry';
import { openPreparedElevation } from '../apps/server/src/datasets/prepared-elevation';
const registrations = preparedCloudRegistrations(), registry = createPreparedCloudRegistry(registrations), scenes = [];
for (const [id, directory] of Object.entries(registrations)) {
  const source = await registry.open(id).info(), model = await openPreparedElevation(directory, source); assert(model, id);
  const { info } = model;
  assert.equal(info.coverage.sourcePoints, source.totalPoints);
  assert.equal(info.frameId, source.descriptor.frameId);
  for (const layer of ['dtm', 'dsm', 'ndsm'] as const) {
    const grid = await model.grid(layer, 64);
    assert(grid.values.length <= 4096 && grid.values.every(v => v === null || Number.isFinite(v)));
    assert(grid.values.some(v => v !== null), `${id} ${layer} needs observed support`);
  }
  const x = (source.bounds.min[0] + source.bounds.max[0]) / 2, y = (source.bounds.min[1] + source.bounds.max[1]) / 2;
  const query = await model.query({ x, y });
  assert.equal(query.sourceRevision, source.revision);
  assert(query.dtm === null || query.dsm !== null && query.dtm <= query.dsm + 1e-9);
  scenes.push({ id, points: source.totalPoints, groundPoints: info.coverage.groundPoints, dtmCells: info.layers.dtm.validCells, dsmCells: info.layers.dsm.validCells, revision: info.revision, status: 'pass' });
  console.log(`${id}: standard GeoTIFF windows and elevation query pass`);
}
await writeFile('/tmp/elevation-compatibility.json', JSON.stringify({ status: 'pass', sourcePoints: scenes.reduce((sum, scene) => sum + scene.points, 0), scenes }, null, 2) + '\n');
