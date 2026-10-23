import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud';
import { preparedCloudRegistrations } from '../apps/server/src/datasets/scene-registry';
import { openPreparedElevation } from '../apps/server/src/datasets/prepared-elevation';
import { openPreparedTerrain } from '../apps/server/src/datasets/prepared-terrain';

const registrations = preparedCloudRegistrations(), registry = createPreparedCloudRegistry(registrations);
const results: unknown[] = [];
for (const [id, directory] of Object.entries(registrations)) {
  const signal = AbortSignal.timeout(30000), source = await registry.open(id).info(signal);
  const elevation = await openPreparedElevation(directory, source, signal); assert(elevation);
  const terrain = await openPreparedTerrain(directory, elevation, signal); assert(terrain);
  const g = elevation.info.grid, [x, y] = g.origin, right = x + g.width * g.resolution, bottom = y - g.height * g.resolution;
  const polygon = [[x, bottom], [right, bottom], [right, y], [x, y]];
  const summary = await terrain.analyze('query_terrain_region', { polygon }, signal);
  const stats = summary.result.statistics as Record<string, { validCells: number; min: number | null; max: number | null }>;
  assert.equal(stats.dtm.validCells, elevation.info.layers.dtm.validCells); assert.equal(stats.dsm.validCells, elevation.info.layers.dsm.validCells);
  assert.equal(stats.slope.validCells, terrain.info.slope.validCells); assert.equal(stats.slope.min, terrain.info.slope.min); assert.equal(stats.slope.max, terrain.info.slope.max);
  const filter = await terrain.analyze('filter_terrain_regions', { polygon, maxSlopeDegrees: 5, minArea: 30, maxHeightAboveGround: null, maxRegions: 3 }, signal);
  const regions = filter.result.regions as { area: number; slope: { max: number } }[];
  assert(regions.every(r => r.area >= 30 && r.slope.max <= 5));
  const image = await terrain.analyze('terrain_image', { polygon, layer: 'slope', maxSize: 128 }, signal); assert(image.image);
  const profile = await terrain.analyze('terrain_profile', { start: [x + .5, y - .5], end: [right - .5, bottom + .5], samples: 32 }, signal);
  assert.equal(profile.result.totalSamples, 32);
  const grid = await terrain.grid(16, signal); assert.equal(grid.color?.kind, 'slope');
  results.push({ id, status: 'pass', slope: terrain.info.slope, regions: filter.result.matchingRegions });
  console.log(`${id}: full raster statistics, filters, image, profile and preview pass`);
}
await writeFile('/tmp/terrain-compatibility.json', JSON.stringify({ status: 'pass', scenes: results }, null, 2));
