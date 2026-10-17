import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatasetInfo } from '@spatial/contracts';
import { preprocessingSummary, SUMMARY_LIMITS } from '../apps/server/src/preprocessing-summary';
import { validatePreprocessing } from '../apps/web/src/preprocessing-overlays';

const dataset = { id: 'toronto3d', revision: 'a'.repeat(64), bounds: { min: [0, 0, 0], max: [100, 100, 100] }, totalPoints: 100, coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] } } as DatasetInfo;
function artifact() {
  return { version: 'scene-preprocessing-v1', complete: true, binding: { datasetId: dataset.id, artifactRevision: dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: dataset.coordinates, indexHash: 'b'.repeat(64), sourceHash: 'c'.repeat(64), instanceManifestHash: 'd'.repeat(64), membershipHash: 'e'.repeat(64) },
    instances: [{ id: 'instance-' + '1'.repeat(64), label: 6, name: 'Pole', points: 10, bounds: { min: [1, 1, 0], max: [2, 2, 5] },
      fit: { kind: 'vertical-cylinder', status: 'fitted', center: [1.5, 1.5, 2.5], yawRadians: 0, dimensions: [1, 1, 5], radius: .5, evaluatedPoints: 10,
        toleranceMeters: .2, rmseMeters: .1, coverage: .9, qualityScore: .5, qualityMeaning: 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity' } }],
    ground: { cellMeters: 2, origin: [0, 0], labels: [1, 2], minimumSupport: 3, method: 'observed-cell-minimum-v1',
      cells: [{ x: 0, y: 0, elevation: 0, maxElevation: .2, points: 3 }, { x: 1, y: 1, elevation: 0, maxElevation: 0, points: 2 }] } };
}
test('fixed offline summary filters the current box, preserves fits and only supported observed tiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'summary-test-')), path = join(root, 'manifest.json');
  try {
    await writeFile(path, JSON.stringify(artifact()));
    const result = await preprocessingSummary(dataset, { min: [0, 0, -1], max: [3, 3, 10] }, path);
    assert.equal(result.status, 'ready'); assert.equal(result.overlays.length, 1);
    assert.equal(result.ground?.cells.length, 1); assert.equal(result.overlays[0].fit?.qualityScore, .5);
    assert.doesNotThrow(() => validatePreprocessing(result, dataset.revision));
    const empty = await preprocessingSummary(dataset, { min: [50, 50, 50], max: [60, 60, 60] }, path);
    assert.equal(empty.status, 'empty'); assert.equal(empty.overlays.length, 0);
    const c = new AbortController(); c.abort(); await assert.rejects(preprocessingSummary(dataset, undefined, path, c.signal));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing, stale, malformed, duplicate, unsafe or over-budget files fail closed without preprocessing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'summary-invalid-')), path = join(root, 'manifest.json');
  try {
    assert.equal((await preprocessingSummary(dataset, undefined, path)).status, 'unavailable');
    for (const mutate of [
      (a: ReturnType<typeof artifact>) => { a.binding.artifactRevision = 'f'.repeat(64); },
      (a: ReturnType<typeof artifact>) => { a.binding.coordinates = { ...a.binding.coordinates, localOrigin: [0, 0, 0] }; },
      (a: ReturnType<typeof artifact>) => { a.binding.indexHash = 'bad'; },
      (a: ReturnType<typeof artifact>) => { a.complete = false; },
      (a: ReturnType<typeof artifact>) => { a.instances.push(a.instances[0]); },
      (a: ReturnType<typeof artifact>) => { a.instances[0].fit.radius = -1; },
      (a: ReturnType<typeof artifact>) => { a.instances[0].fit.coverage = 2; },
      (a: ReturnType<typeof artifact>) => { a.ground.cells.push(a.ground.cells[0]); },
      (a: ReturnType<typeof artifact>) => { a.ground.cells[0].elevation = Infinity; },
    ]) {
      const a = artifact(); mutate(a); await writeFile(path, JSON.stringify(a));
      assert.equal((await preprocessingSummary(dataset, undefined, path)).status, 'unavailable');
    }
    await writeFile(path, '{broken'); assert.equal((await preprocessingSummary(dataset, undefined, path)).status, 'unavailable');
    await truncate(path, SUMMARY_LIMITS.fileBytes + 1); assert.equal((await preprocessingSummary(dataset, undefined, path)).status, 'unavailable');
    await writeFile(path, JSON.stringify(artifact())); const link = join(root, 'link'); await symlink(path, link);
    assert.equal((await preprocessingSummary(dataset, undefined, link)).status, 'unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('summary caps instances, ground cells and total response bytes explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'summary-budget-')), path = join(root, 'manifest.json');
  try {
    const a = artifact(); const instance = a.instances[0];
    a.instances = Array.from({ length: 2100 }, (_, i) => ({ ...instance, id: 'instance-' + i.toString(16).padStart(64, '0') }));
    a.ground.cells = Array.from({ length: 11000 }, (_, x) => ({ x, y: 0, elevation: 0, maxElevation: .2, points: 3 }));
    await writeFile(path, JSON.stringify(a)); const result = await preprocessingSummary(dataset, undefined, path);
    assert.equal(result.status, 'ready'); assert.equal(result.truncated, true); assert.ok(result.overlays.length <= 2000);
    assert.ok((result.ground?.cells.length ?? 0) <= 10000); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SUMMARY_LIMITS.responseBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
