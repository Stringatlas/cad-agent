import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { canonicalSceneMarkSnapshot } from '@spatial/contracts';
import { SceneExploration } from '../../apps/server/src/agent/scene-exploration';
import { cloudSceneMarksMatch, createPreparedSceneMarks } from '../../apps/web/src/scenes/point-cloud/cloud-scene-marks';
import { sceneMarksMatchScene } from '../../apps/web/src/scenes/toronto/inspection/scene-marks-client';
import type { PreparedScene } from '../../apps/web/src/scenes/point-cloud/prepared-cloud-client';

const cloud: PreparedScene = { revision: 'a'.repeat(64), totalPoints: 100, bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  descriptor: { id: 'cloud-one', frameId: 'cloud-one-local', coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [100, 200, 0] }, sources: [{ id: 1, name: 'source', points: 100 }] },
  capabilities: { boundedSample: true, semanticLabels: false, fullResolution: false, editing: false } };
const binding = { mode: 'cloud' as const, cloudId: cloud.descriptor.id, artifactRevision: cloud.revision,
  frameId: cloud.descriptor.frameId, units: 'm' as const, localOrigin: [100, 200, 0] as const };
const snapshot = () => canonicalSceneMarkSnapshot({ kind: 'scene-marks', annotationRevision: 1, binding,
  marks: [{ id: 'cloud-mark', rank: 1, position: [1.125, 2.5, 3], rationale: 'Investigate this feature.', uncertainty: 'Identity needs another view.' }] });

test('prepared hypotheses preserve strict source/frame identity without Toronto authority', () => {
  const s = snapshot(); assert.ok(Object.isFrozen(s.binding.localOrigin));
  assert.equal(cloudSceneMarksMatch(s, cloud), true); assert.equal(sceneMarksMatchScene(s, cloud.revision), false);
  for (const patch of [{ cloudId: 'cloud-two' }, { artifactRevision: 'b'.repeat(64) }, { frameId: 'other-local' }, { localOrigin: [100, 201, 0] }]) {
    assert.equal(cloudSceneMarksMatch(canonicalSceneMarkSnapshot({ ...s, binding: { ...binding, ...patch } }), cloud), false);
  }
  for (const patch of [{ mode: 'toronto' }, { cloudId: '../cloud' }, { frameId: '' }, { artifactRevision: 'old' },
    { units: 'ft' }, { localOrigin: [0, Infinity, 0] }, { localOrigin: [0, 0] }, { points: { sessionId: 'points', revision: 0 } },
    { cad: { sessionId: 'cad', revision: 0 } }, { objects: { sessionId: 'objects', revision: 0 } }, { approved: true }]) {
    assert.throws(() => canonicalSceneMarkSnapshot({ ...s, binding: { ...binding, ...patch } }));
  }
  const toronto = canonicalSceneMarkSnapshot({ ...s, binding: { artifactRevision: cloud.revision,
    frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0] } });
  assert.equal(cloudSceneMarksMatch(toronto, cloud), false);
});

test('prepared hypothesis continuation preserves IDs and resets on every binding component change', () => {
  const s = snapshot();
  const same = new SceneExploration(binding, s); assert.deepEqual(same.snapshot(), s);
  const mark = s.marks[0]!;
  const moved = same.replace({ expectedRevision: 1, marks: [{ id: mark.id, position: [5, 6, 7], rationale: mark.rationale, uncertainty: mark.uncertainty }] });
  assert.equal(moved.kind, 'scene-marks');
  if (moved.kind !== 'scene-marks') assert.fail('Expected revised hypotheses');
  assert.equal(moved.marks[0].id, mark.id); assert.equal(moved.annotationRevision, 2);
  assert.equal(same.replace({ expectedRevision: 1, marks: [] }).kind, 'scene-marks-conflict');
  for (const patch of [{ cloudId: 'cloud-two' }, { artifactRevision: 'b'.repeat(64) }, { frameId: 'other-local' }, { localOrigin: [0, 0, 0] as const }]) {
    const reset = new SceneExploration({ ...binding, ...patch }, moved).snapshot();
    assert.equal(reset.annotationRevision, 0); assert.deepEqual(reset.marks, []);
  }
});

test('prepared annotation projection preserves coordinates and only explicit focus moves the view', () => {
  const original = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {}, arc() {} }) }) } as any;
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 1000);
    camera.position.set(10, -20, 30); const target = new THREE.Vector3(1, 2, 3); let changes = 0;
    const host = { dataset: {} } as HTMLElement;
    const render = createPreparedSceneMarks(scene, camera, { target, update: () => true }, cloud, host, () => changes++);
    const before = camera.position.clone(), s = snapshot(); render.set(s);
    assert.deepEqual(camera.position, before); assert.deepEqual(JSON.parse(host.dataset.sceneMarks!)[0].position, s.marks[0].position);
    assert.throws(() => render.set({ ...s, binding: { ...binding, cloudId: 'other-cloud' } }));
    assert.throws(() => render.set(s, 'invented-id'));
    const offset = camera.position.clone().sub(target); render.focusPosition([8, 9, 10]);
    assert.deepEqual(target.toArray(), [8, 9, 10]); assert.deepEqual(camera.position.clone().sub(target), offset);
    render.set(); assert.equal(host.dataset.sceneMarks, '[]'); assert.equal(changes, 3);
    render.dispose(); assert.equal(host.dataset.sceneMarks, undefined); assert.equal(scene.children.length, 0);
  } finally { globalThis.document = original; }
});
