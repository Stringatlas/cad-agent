import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { PointObservation } from '@spatial/contracts';
import { observedPointLabel, semanticName, pointSemanticName } from '../apps/web/src/point-presentation';
import { createDraftPointGate } from '../apps/web/src/draft-context';
import { CLUSTER_CLASS_COLORS, createPreprocessingLayer, preprocessingLegend, type PreprocessingSummary } from '../apps/web/src/preprocessing-overlays';
import { createDetailPickCache, createPolePickCache } from '../apps/web/src/pole-picking';

const revision = 'a'.repeat(64);
const sample: PointObservation = { dataset: { id: 'toronto3d', revision, totalPoints: 2,
  coordinates: { units: 'm', upAxis: 'Z', handedness: 'right', localOrigin: [627285, 4841948, 0] }, bounds: { min: [0,0,0], max: [3,3,3] } },
  count: 2, positions: [1.123456789,0,0, 2,0,0], colors: [255,255,255,255,255,255], labels: [7,6], sourceIds: [1,3,1,4],
  purpose: 'display', lod: { budget: 2, depth: 0 }, algorithm: 'potree-bfs-even-v1', candidatePoints: 2, bytesRead: 0, nodes: ['r'], sampleHash: '0'.repeat(64) };

test('overview and detail labels match original source identity, never RGB/nearby bounds', () => {
  const overview = createPolePickCache(sample), detail = createDetailPickCache(sample.dataset, sample.positions, sample.sourceIds);
  for (const cache of [overview, detail]) {
    const picked = cache.resolve(0)!;
    assert.equal(observedPointLabel(picked, sample), 7);
    assert.equal(observedPointLabel({ ...picked, artifactRevision: 'b'.repeat(64) }, sample), undefined);
    assert.equal(observedPointLabel({ ...picked, key: { sourceFileId: 1, sourceRow: 99 } }, sample), undefined);
    assert.equal(observedPointLabel({ ...picked, position: [Math.fround(picked.position[0]),0,0] }, sample), undefined);
    assert.equal(observedPointLabel(picked, { ...sample, labels: [100,6] }), undefined);
    assert.equal(observedPointLabel(picked), undefined);
    cache.dispose();
  }
  assert.equal(semanticName(6), 'Pole'); assert.equal(semanticName(2), 'Road markings');
  for (const value of [undefined, null, '6', 6.5, -1, 99]) assert.equal(semanticName(value), 'Unknown');
  const gate = createDraftPointGate(); gate.bind(revision);
  const point = gate.accept(createPolePickCache(sample).resolve(0)!, 'Point 1')!;
  assert.equal(pointSemanticName(point), 'Unknown');
  assert.equal(pointSemanticName({ ...point, semanticLabel: 7 }), 'Car');
});

test('cluster class colors are distinct; representation legend counts only rendered fitted geometry', () => {
  const summary: PreprocessingSummary = { version: 'toronto-preprocessing-v1', datasetId: 'toronto3d', artifactRevision: revision,
    frameId: 'toronto3d-local-v1', units: 'm', status: 'ready', message: '', truncated: false,
    overlays: [6,7,8,4,6].map((label, i) => ({ id: String(i), label, name: semanticName(label), points: 3, bounds: { min: [0,0,0], max: [1,1,1] } })) };
  assert.deepEqual(preprocessingLegend(summary), { classes: [4,6,7,8], clusters: 5, fits: 0, ground: 0 });
  assert.equal(new Set(Object.values(CLUSTER_CLASS_COLORS)).size, 4);
  const scene = new THREE.Scene(), layer = createPreprocessingLayer(scene); layer.set(summary);
  const children = (scene.children[0] as THREE.Group).children as THREE.Box3Helper[];
  children.forEach((child, i) => assert.equal((child.material as THREE.LineBasicMaterial).color.getHexString(), new THREE.Color(CLUSTER_CLASS_COLORS[summary.overlays[i].label]).getHexString()));
  layer.dispose();
});
