// Small complete queries plus explicitly client-cancelled large-volume checks. Never regenerates data.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import * as THREE from 'three';
import { PotreeDataset } from '../apps/server/src/potree';
import { CROP_LIMITS } from '../apps/server/src/crop';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';
import { createIsolatedDemoServer as createDemoServer } from './isolated-demo-server';
import { projectCropRectangle } from '../apps/web/src/crop-projection';
import { containsCropPoint, type CropBox, type CropSelection, type CropEvent, type CropStats, type Vec3 } from '@spatial/contracts';

const directory = new URL('../artifacts/projected-full-resolution/', import.meta.url);
await mkdir(directory, { recursive: true });
const adapter = new PotreeDataset(DEFAULT_DATASET_ROOT), before = await adapter.observe({ budget: 1024, depth: 2 });
const root = await adapter.sample({ budget: 10000, depth: 0 }, 'display');
const boxAt = (center: number[], width: number): CropBox => ({ min: center.map(n => n - width / 2) as unknown as Vec3, max: center.map(n => n + width / 2) as unknown as Vec3 });
// Test collector only; production NEVER aggregates. Deliberately bounded by this client's policy.
async function collect(selection: CropSelection) {
  const positions: number[] = [], colors: number[] = [];
  let end: Extract<CropEvent, { type: 'end' }> | undefined;
  for await (const event of adapter.crop(selection)) {
    if (event.type === 'batch') {
      assert.ok(event.stats.count < 50000, 'integration client collection guard, not a server cap');
      positions.push(...event.positions); colors.push(...event.colors);
    } else if (event.type === 'end') end = event;
  }
  assert.ok(end?.complete); return { positions, colors, ...end.stats, sampleHash: end.sampleHash };
}
const samples: unknown[] = [];
let firstBox: CropBox | undefined, firstHash = '', deepest = 0;
for (const index of [0, 300, 1000]) {
  const center = root.positions.slice(index * 3, index * 3 + 3).map(n => Math.round(n * 1000) / 1000);
  const box = boxAt(center, 5), start = performance.now(), crop = await collect(box), smallBox = boxAt(center, 2), small = await collect(smallBox);
  assert.ok(crop.count > 0); assert.equal((await collect(box)).sampleHash, crop.sampleHash);
  const expected = (selection: CropSelection) => {
    const positions: number[] = [], colors: number[] = [];
    for (let i = 0; i < crop.count; i++) if (containsCropPoint(selection, crop.positions.slice(i * 3, i * 3 + 3))) {
      positions.push(...crop.positions.slice(i * 3, i * 3 + 3)); colors.push(...crop.colors.slice(i * 3, i * 3 + 3));
    }
    return { positions, colors };
  };
  assert.deepEqual({ positions: small.positions, colors: small.colors }, expected(smallBox));
  // Oblique frozen frustum intersected with this small test extent; compare exact ordered points.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.up.set(0, 0, 1);
  camera.position.set(center[0] + 6, center[1] - 8, center[2] + 6); camera.lookAt(...center as [number, number, number]);
  const projected = projectCropRectangle(camera, { left: 40, top: 40, right: 60, bottom: 60 }, 100, 100, box);
  const projection = await collect(projected); assert.deepEqual({ positions: projection.positions, colors: projection.colors }, expected(projected));
  deepest = Math.max(deepest, crop.maxDepth);
  samples.push({ box, count: crop.count, bytesRead: crop.bytesRead, scannedPoints: crop.scannedPoints, hierarchyChunks: crop.hierarchyChunks,
    maxDepth: crop.maxDepth, sampleHash: crop.sampleHash, nestedCount: small.count, projectedCount: projection.count, milliseconds: performance.now() - start });
  if (!firstBox) { firstBox = box; firstHash = crop.sampleHash; }
}
assert.ok(deepest >= 8);
// Large actual volume is NOT rejected. Stop by CLIENT policy to avoid a full 78M-point audit/GPU allocation.
const controller = new AbortController(); let largeStats: CropStats | undefined, largeComplete = false;
await assert.rejects((async () => {
  for await (const event of adapter.crop(root.dataset.bounds, controller.signal)) {
    if (event.type === 'batch') { largeStats = event.stats; if (event.stats.count >= 131072) controller.abort(); }
    if (event.type === 'end') largeComplete = true;
  }
})(), /abort/i);
assert.ok(largeStats && largeStats.count > 100000); assert.equal(largeComplete, false);
// Actual view-projection through full dataset: client cancels after bounded scanned work, NOT server policy.
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000); camera.up.set(0, 0, 1);
const center = new THREE.Vector3(...root.dataset.bounds.min).add(new THREE.Vector3(...root.dataset.bounds.max)).multiplyScalar(0.5);
camera.position.copy(center).add(new THREE.Vector3(500, -600, 1000)); camera.lookAt(center);
const selection = projectCropRectangle(camera, { left: 25, top: 25, right: 75, bottom: 75 }, 100, 100, root.dataset.bounds);
const projectionController = new AbortController(); let projectedStats: CropStats | undefined;
await assert.rejects((async () => {
  for await (const event of adapter.crop(selection, projectionController.signal)) if (event.type === 'batch') {
    projectedStats = event.stats;
    assert.ok(event.positions.every((_, i) => i % 3 !== 0 || containsCropPoint(selection, event.positions.slice(i, i + 3))));
    if (event.stats.scannedPoints >= 150000) projectionController.abort();
  }
})(), /abort/i);
assert.deepEqual(await adapter.observe({ budget: 1024, depth: 2 }), before);
const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
let httpBytes = 0;
try {
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const query = new URLSearchParams(); ['X', 'Y', 'Z'].forEach((axis, i) => { query.set('min' + axis, String(firstBox!.min[i])); query.set('max' + axis, String(firstBox!.max[i])); });
  const response = await fetch(`http://127.0.0.1:${address.port}/datasets/toronto3d/crop?${query}`);
  assert.equal(response.status, 200); const text = await response.text(); httpBytes = Buffer.byteLength(text);
  assert.equal(JSON.parse(text.trim().split('\n').at(-1)!).sampleHash, firstHash);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
const report = { status: 'passed', dataset: root.dataset, samples, httpBytes, harnessUnchanged: true, perBatchLimits: CROP_LIMITS,
  largeVolume: { status: 'client-cancelled, incomplete, not sampled or server-limited', stats: largeStats },
  projectedVolume: { status: 'client-cancelled after 150k scanned points; not a server work limit', stats: projectedStats },
  scope: 'Small exact/nested/projected checks + bounded client-cancelled large queries; not full-dataset audit/browser verification' };
await writeFile(new URL('actual-crops.json', directory), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
