/** Actual prepared reader + Three.js geometry/color compatibility for all real-world scenes. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud';
import { preparedCloudRegistrations, preparedCloudName } from '../apps/server/src/datasets/scene-registry';
import { cloudColors } from '../apps/web/src/viewer/cloud-colors';

const root = resolve('data/processed/stpls3d_realworld');
const index = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')) as { points: number; scenes: { id: string; path: string; points: number }[] };
const registry = createPreparedCloudRegistry(preparedCloudRegistrations());
const results = [];
for (const scene of index.scenes) {
  const reader = registry.open(scene.id), info = await reader.info();
  assert.equal(info.totalPoints, scene.points);
  assert.equal(info.descriptor.frameId, `${scene.id}-local`);
  assert.equal(info.capabilities.instanceLabels, false);
  assert.equal(info.descriptor.instances, undefined);
  const sample = await reader.sample(info.revision, { budget: 100000, depth: 1 }, undefined, 'display');
  assert(sample.count > 0 && sample.count <= 100000);
  assert.equal(sample.labels?.length, sample.count);
  assert.equal(sample.instances, undefined);
  const source = info.descriptor.sources[0];
  assert(sample.sourceIds.every((value, index) => index % 2 ? value < source.points : value === source.id));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
  geometry.computeBoundingSphere();
  assert(Number.isFinite(geometry.boundingSphere!.radius) && geometry.boundingSphere!.radius > 0);
  for (const mode of ['rgb', 'semantic'] as const) {
    const colors = cloudColors(sample.colors, sample.labels, undefined, mode);
    assert.equal(colors.length, sample.count * 3);
    assert(colors.every(Number.isFinite));
  }
  results.push({ id: scene.id, name: preparedCloudName(scene.id), points: info.totalPoints, sample: sample.count, revision: info.revision, status: 'pass' });
  geometry.dispose();
  console.log(`${scene.id}: ${info.totalPoints.toLocaleString()} points; ${sample.count.toLocaleString()} sampled; pass`);
}
assert.equal(results.reduce((n, s) => n + s.points, 0), index.points);
await writeFile(resolve(root, 'viewer-compatibility.json'), JSON.stringify({ status: 'pass', check: 'Actual prepared reader, source identities, Three.js bounds and RGB/semantic buffers; instance capability absent', scenes: results }, null, 2) + '\n');
