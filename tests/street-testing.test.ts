import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { PointObservation } from '@spatial/contracts';
import { representativeStreetChunk } from '../apps/web/src/street-chunk';
import { createPreprocessingLayer, fetchPreprocessing, validatePreprocessing, type PreprocessingSummary } from '../apps/web/src/preprocessing-overlays';

const revision = 'a'.repeat(64);
const summary: PreprocessingSummary = { version: 'toronto-preprocessing-v1', datasetId: 'toronto3d', artifactRevision: revision,
  frameId: 'toronto3d-local-v1', units: 'm', status: 'ready', message: 'Derived connectivity only.', truncated: false,
  overlays: [{ id: 'instance-1', label: 6, name: 'Pole', points: 20, bounds: { min: [1, 2, 120], max: [2, 3, 124] } }] };
const sample = { count: 4, positions: [0, 0, 120, 100, 100, 121, 101, 102, 122, 900, 900, 150], labels: [1, 1, 1, 4],
  dataset: { bounds: { min: [0, 0, 115], max: [1100, 1100, 1200] } } } as unknown as PointObservation;

test('startup chunk anchors actual central ground, bounded to 40m not padded whole-cloud metadata', () => {
  const box = representativeStreetChunk(sample)!;
  assert.deepEqual(box, { min: [80, 80, 118], max: [120, 120, 146] });
  assert.deepEqual(representativeStreetChunk(sample), box);
  assert.equal(representativeStreetChunk({ ...sample, count: 0 }), undefined);
  const clipped = representativeStreetChunk({ ...sample, count: 1, labels: [4] })!;
  assert.deepEqual(clipped.min, [0, 0, 117]);
  assert.ok(clipped.max.every((n, i) => n - clipped.min[i] <= (i === 2 ? 28 : 40)));
});
test('preprocessing validates revision/frame, bounded honest empty/unavailable and geometry', () => {
  assert.equal(validatePreprocessing(summary, revision), summary);
  for (const status of ['empty', 'unavailable']) assert.doesNotThrow(() => validatePreprocessing({ ...summary, status, overlays: [] }, revision));
  for (const value of [
    { ...summary, artifactRevision: 'b'.repeat(64) }, { ...summary, units: 'mm' },
    { ...summary, status: 'completed' }, { ...summary, status: 'empty' }, { ...summary, overlays: [] },
    { ...summary, overlays: Array(2001).fill(summary.overlays[0]) },
    { ...summary, overlays: [...summary.overlays, ...summary.overlays] },
    { ...summary, overlays: [{ ...summary.overlays[0], bounds: { min: [0, 0, 0], max: [-1, 1, 1] } }] },
  ]) assert.throws(() => validatePreprocessing(value, revision));
});
test('derived wire bounds are separate disposable render caches, not solids', () => {
  const scene = new THREE.Scene(), layer = createPreprocessingLayer(scene);
  layer.set(summary); assert.equal(layer.count, 1);
  const group = scene.children[0] as THREE.Group;
  const helper = group.children[0] as THREE.Box3Helper;
  assert.equal(helper.type, 'Box3Helper'); assert.equal(helper.userData.derivedInstanceId, 'instance-1');
  let disposed = 0; helper.geometry.addEventListener('dispose', () => disposed++);
  layer.set(); assert.equal(disposed, 1); assert.equal(layer.count, 0);
  layer.set(summary); layer.dispose(); assert.equal(scene.children.length, 0);
});
test('fits and supported observed ground tiles render and dispose alongside bounds', () => {
  const scene = new THREE.Scene(), layer = createPreprocessingLayer(scene);
  const observed: PreprocessingSummary = { ...summary, overlays: [{ ...summary.overlays[0], fit: {
    kind: 'vertical-cylinder', status: 'fitted', center: [1.5, 2.5, 122], dimensions: [1, 1, 4], radius: .5, yawRadians: 0,
    evaluatedPoints: 20, toleranceMeters: .2, rmseMeters: .1, coverage: .9, qualityScore: .9 * Math.exp(-.1 / .2),
    qualityMeaning: 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity' } }],
    ground: { cellMeters: 2, origin: [0, 0], minimumSupport: 3, method: 'observed-cell-minimum-v1',
      cells: [{ x: 0, y: 0, elevation: 120, maxElevation: 121, points: 3 }] } };
  validatePreprocessing(observed, revision); layer.set(observed); assert.equal(layer.count, 3);
  const group = scene.children[0] as THREE.Group;
  assert.equal(group.children[1].userData.observedFit, true); assert.equal(group.children[2].userData.observedGround, true);
  let geometryDisposed = 0, materialDisposed = 0;
  for (const child of group.children as THREE.Mesh[]) {
    child.geometry.addEventListener('dispose', () => geometryDisposed++);
    (child.material as THREE.Material).addEventListener('dispose', () => materialDisposed++);
  }
  layer.set(); assert.equal(geometryDisposed, 3); assert.equal(materialDisposed, 3);
  assert.throws(() => validatePreprocessing({ ...observed, ground: { ...observed.ground, cells: [{ ...observed.ground!.cells[0], points: 2 }] } }, revision));
  assert.throws(() => validatePreprocessing({ ...observed, overlays: [{ ...observed.overlays[0], fit: { ...observed.overlays[0].fit, radius: -1 } }] }, revision));
  layer.dispose(); assert.equal(scene.children.length, 0);
});
test('browser fit schema rejects null/malformed metrics and mismatched class, evaluation or dimensions', () => {
  const fit = {
    kind: 'vertical-cylinder' as const, status: 'fitted' as const, center: [1.5, 2.5, 122], dimensions: [1, 1, 4], radius: .5, yawRadians: 0,
    evaluatedPoints: 20, toleranceMeters: .2, rmseMeters: .1, coverage: .9, qualityScore: .9 * Math.exp(-.1 / .2),
    qualityMeaning: 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity',
  };
  const withFit = (value: unknown, label = 6) => ({ ...summary, overlays: [{ ...summary.overlays[0], label, fit: value }] });
  for (const invalid of [
    null,
    ...['rmseMeters', 'coverage', 'qualityScore'].flatMap(key => [
      { ...fit, [key]: null }, { ...fit, [key]: undefined }, { ...fit, [key]: '0.5' }, { ...fit, [key]: NaN },
    ]),
    { ...fit, rmseMeters: -1 }, { ...fit, coverage: 2 }, { ...fit, qualityScore: -1 },
    { ...fit, toleranceMeters: 0 }, { ...fit, evaluatedPoints: 19 }, { ...fit, evaluatedPoints: 21 },
    { ...fit, qualityScore: fit.qualityScore + 1e-6 }, { ...fit, radius: 0 },
    { ...fit, dimensions: [1.1, 1, 4] }, { ...fit, dimensions: [1, 1.1, 4] },
    { ...fit, kind: 'pca-xy-box' },
  ]) assert.throws(() => validatePreprocessing(withFit(invalid), revision), /Invalid observed fit/);
  for (const label of [4, 7]) assert.throws(() => validatePreprocessing(withFit(fit, label), revision), /Invalid observed fit/);
  for (const accepted of [
    fit,
    { ...fit, rmseMeters: 100, coverage: 0, qualityScore: 0 },
    { ...fit, qualityScore: fit.qualityScore + 5e-10, dimensions: [1 + 5e-10, 1, 4] },
    ...['insufficient', 'degenerate'].map(status => ({ ...fit, status, evaluatedPoints: 0,
      radius: 0, dimensions: [0, 0, 0], rmseMeters: null, coverage: null, qualityScore: null })),
  ]) assert.doesNotThrow(() => validatePreprocessing(withFit(accepted), revision));
  for (const [label, kind] of [[4, 'footprint-height-extrusion'], [7, 'pca-xy-box']] as const) {
    assert.doesNotThrow(() => validatePreprocessing(withFit({ ...fit, kind }, label), revision));
  }
});
test('summary client rejects HTTP and oversized responses instead of inventing overlays', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('no', { status: 503 });
    await assert.rejects(fetchPreprocessing(revision, new AbortController().signal), /503/);
    globalThis.fetch = async () => new Response(' '.repeat(1024 * 1024 + 1));
    await assert.rejects(fetchPreprocessing(revision, new AbortController().signal), /too large/);
    globalThis.fetch = async () => new Response(JSON.stringify(summary));
    assert.deepEqual(await fetchPreprocessing(revision, new AbortController().signal), summary);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetchPreprocessing(revision, controller.signal));
  } finally { globalThis.fetch = original; }
});
