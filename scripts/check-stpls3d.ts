/** Actual on-disk prepared-cloud and Three.js buffer compatibility, without WebGL. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud';

const root = resolve(process.argv[2] ?? 'data/processed/stpls3d');
const recipe = JSON.parse(await readFile('config/dataset-recipes/stpls3d.json', 'utf8')) as {
  sources: { source_file_id: number; points: number }[];
};
const registry = createPreparedCloudRegistry(Object.fromEntries(recipe.sources.map(source =>
  [`stpls3d-${source.source_file_id}`, resolve(root, String(source.source_file_id))])));
const results = [];
for (const source of recipe.sources) {
  const id = `stpls3d-${source.source_file_id}`, reader = registry.open(id);
  const info = await reader.info();
  assert.equal(info.totalPoints, source.points);
  assert.equal(info.descriptor.frameId, `${id}-local`);
  assert.equal(info.descriptor.semantics?.attribute, 'semantic_id');
  assert.equal(info.descriptor.instances?.attribute, 'instance_id');
  assert.equal(info.descriptor.instances?.unassigned, -100);
  const sample = await reader.sample(info.revision, { budget: 100000, depth: 1 }, undefined, 'display');
  assert(sample.count > 0 && sample.count <= 100000);
  assert.equal(sample.labels?.length, sample.count);
  assert.equal(sample.instances?.length, sample.count);
  assert(sample.instances!.every(id => Number.isInteger(id) && id >= -2147483648 && id <= 2147483647));
  assert(sample.sourceIds.every((value, index) => index % 2 ? value < source.points : value === source.source_file_id));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
  // Byte attributes stay exact; renderer integration must apply the correct sRGB color space.
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(sample.colors, 3, true));
  geometry.setAttribute('semantic_id', new THREE.Uint8BufferAttribute(sample.labels!, 1));
  geometry.setAttribute('instance_id', new THREE.Int32BufferAttribute(sample.instances!, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  assert(Number.isFinite(geometry.boundingSphere!.radius) && geometry.boundingSphere!.radius > 0);
  assert.equal(geometry.getAttribute('position').count, sample.count);
  assert.equal(geometry.getAttribute('color').count, sample.count);
  results.push({ id, points: info.totalPoints, sample: sample.count, nodes: sample.nodes.length,
    bytesRead: sample.bytesRead, revision: info.revision, status: 'pass' });
  geometry.dispose();
  console.log(`${id}: ${info.totalPoints.toLocaleString()} points; ${sample.count.toLocaleString()} sampled; pass`);
}
await writeFile(resolve(root, 'viewer-compatibility.json'), JSON.stringify({
  status: 'pass', check: 'Existing PreparedCloudReader display sample and Three.js BufferGeometry; no browser/WebGL rendering claim',
  scenes: results,
}, null, 2) + '\n');
