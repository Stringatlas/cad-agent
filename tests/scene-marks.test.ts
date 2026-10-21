import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { canonicalSceneMarkSnapshot, canonicalSetSceneMarksRequest, type SceneMarkSnapshot } from '../packages/contracts/src/scene-marks';
import { sceneMarksMatchScene } from '../apps/web/src/scene-marks-client';
import { createAreaCandidateRender } from '../apps/web/src/area-candidate-render';
const hash = 'a'.repeat(64);
function snapshot(): SceneMarkSnapshot {
  return { kind: 'scene-marks', annotationRevision: 1, binding: { artifactRevision: hash, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], points: { sessionId: 'points-one', revision: 2 }, cad: { sessionId: 'cad-one', revision: 3 } },
    marks: [{ id: 'mark-one', rank: 1, position: [3, 4, 5], rationale: 'Model-selected location', uncertainty: 'Ground and clearance need checking', observationId: 'capture-one' }] };
}
test('scene annotations are strict, detached, frozen hypotheses with bounded positions and text', () => {
  const input = snapshot(), result = canonicalSceneMarkSnapshot(input);
  assert.notEqual(result, input); assert.ok(Object.isFrozen(result.marks[0].position));
  assert.deepEqual(result, input);
  for (const mutate of [
    (r: any) => r.kind = 'geometry', (r: any) => r.annotationRevision = -1,
    (r: any) => r.extra = true, (r: any) => r.binding.extra = true,
    (r: any) => r.binding.localOrigin = [0, 0, 0], (r: any) => r.binding.artifactRevision = 'unknown',
    (r: any) => r.binding.points.revision = 0.5, (r: any) => r.binding.cad.extra = true,
    (r: any) => r.marks[0].rank = 2, (r: any) => r.marks[0].groundReliefMeters = 0,
    (r: any) => r.marks[0].position = [NaN, 0, 0], (r: any) => r.marks[0].position = [1e7 + 1, 0, 0],
    (r: any) => r.marks[0].position = [1, 2], (r: any) => r.marks[0].rationale = 'x'.repeat(401),
    (r: any) => r.marks[0].uncertainty = '', (r: any) => r.marks[0].observationId = '../bad',
    (r: any) => r.marks.push({ ...r.marks[0], rank: 2 }),
    (r: any) => r.marks = Array.from({ length: 21 }, (_, i) => ({ ...r.marks[0], id: `mark-${i}`, rank: i + 1 })),
  ]) { const value = structuredClone(input); mutate(value); assert.throws(() => canonicalSceneMarkSnapshot(value)); }
  assert.deepEqual(canonicalSceneMarkSnapshot({ ...input, marks: [] }).marks, []);
});
test('annotation replacement accepts optional ids but never evidence claims or ranks', () => {
  const request = { expectedRevision: 0, marks: [{ position: [-1e7, 0, 1e7], rationale: 'Consider here', uncertainty: 'Not inspected' }] };
  assert.deepEqual(canonicalSetSceneMarksRequest(request), request);
  for (const value of [ { ...request, expectedRevision: -1 }, { ...request, extra: true }, { ...request, marks: [{ ...request.marks[0], rank: 1 }] }, { ...request, marks: [{ ...request.marks[0], id: '' }] } ]) assert.throws(() => canonicalSetSceneMarksRequest(value));
  assert.throws(() => canonicalSetSceneMarksRequest({ expectedRevision: 0, marks: Array(2) }));
  const getter = { expectedRevision: 0, get marks() { throw new Error('getter executed'); } };
  assert.throws(() => canonicalSetSceneMarksRequest(getter), /Unexpected protocol fields/);
  assert.deepEqual(canonicalSetSceneMarksRequest({ expectedRevision: 1, marks: [] }).marks, []);
});
test('annotation binding rejects missing/replaced/revised optional authority but allows edited scenes', () => {
  const s = snapshot();
  const points = { artifactRevision: hash, sessionId: 'points-one', revision: 2, entries: [{}] } as any;
  const cad = { artifactRevision: hash, sessionId: 'cad-one', revision: 3, bodies: [{}] } as any;
  assert.equal(sceneMarksMatchScene(s, hash, points, cad), true);
  assert.equal(sceneMarksMatchScene(s, hash), false);
  assert.equal(sceneMarksMatchScene(s, 'b'.repeat(64), points, cad), false);
  assert.equal(sceneMarksMatchScene(s, hash, { ...points, revision: 3 }, cad), false);
  assert.equal(sceneMarksMatchScene(s, hash, points, { ...cad, sessionId: 'replaced' }), false);
  assert.equal(sceneMarksMatchScene({ ...s, binding: { artifactRevision: hash, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0] } }, hash), true);
});
test('optional object binding is strict and invalidates missing, revised, replaced or cross-artifact authority', () => {
  const base = snapshot();
  const s = canonicalSceneMarkSnapshot({ ...base, binding: { ...base.binding, objects: { sessionId: 'objects-one', revision: 4 } } });
  assert.ok(Object.isFrozen(s.binding.objects));
  const points = { artifactRevision: hash, sessionId: 'points-one', revision: 2 } as any;
  const cad = { artifactRevision: hash, sessionId: 'cad-one', revision: 3 } as any;
  const objects = { artifactRevision: hash, sessionId: 'objects-one', revision: 4 } as any;
  assert.equal(sceneMarksMatchScene(s, hash, points, cad, objects), true);
  assert.equal(sceneMarksMatchScene(s, hash, points, cad), false);
  for (const changed of [{ revision: 5 }, { sessionId: 'objects-replaced' }, { artifactRevision: 'b'.repeat(64) }]) {
    assert.equal(sceneMarksMatchScene(s, hash, points, cad, { ...objects, ...changed }), false);
  }
  for (const binding of [null, {}, { sessionId: 'objects-one', revision: -1 }, { sessionId: 'objects-one', revision: 0.5 }, { sessionId: '../bad', revision: 4 }, { sessionId: 'objects-one', revision: 4, extra: true }]) {
    assert.throws(() => canonicalSceneMarkSnapshot({ ...base, binding: { ...base.binding, objects: binding } }));
  }
  assert.equal(sceneMarksMatchScene(base, hash, points, cad), true);
  assert.equal(sceneMarksMatchScene(base, hash, points, cad, { ...objects, revision: 5 }), true);
});
test('thin annotation renderer accepts marks directly without manufactured scan metrics', () => {
  const original = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {}, arc() {} }) }) } as any;
  try {
    const scene = new THREE.Scene(), render = createAreaCandidateRender(scene), s = canonicalSceneMarkSnapshot(snapshot());
    render.set(s, 'mark-one'); assert.equal(render.count, 1);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 1000); camera.position.set(3, -20, 20); camera.lookAt(3, 4, 5);
    render.update(camera, 390, 520); assert.equal(render.layout[0].text, 'C1'); assert.equal(render.layout[0].selected, true);
    const dot = scene.children[0].children.find(child => child instanceof THREE.Sprite && child.renderOrder === 8)!;
    assert.deepEqual(dot.position.toArray(), [3, 4, 5]); render.set(); assert.equal(render.count, 0); render.dispose();
  } finally { globalThis.document = original; }
});
test('web bridge exposes hypotheses, rationale, unknowns and invalidates changed area/authority', () => {
  for (const file of ['App.svelte', 'Chat.svelte', 'ModelChat.svelte']) assert.match(readFileSync(`apps/web/src/${file}`, 'utf8'), /onscenemarks/);
  const toronto = readFileSync('apps/web/src/Toronto.svelte', 'utf8');
  assert.match(toronto, /receiveSceneMarks/); assert.match(toronto, /sceneMarkAuthority !== placementAuthorityKey/); assert.match(toronto, /sceneMarkArea !==/);
  assert.match(toronto, /sceneMarksMatchScene\(snapshot, cadArtifact, sceneSnapshot, cadView\.snapshot, objectView\.snapshot\)/);
  assert.match(toronto, /sceneMarksMatchScene\(sceneMarks, cadArtifact, sceneSnapshot, cadView\.snapshot, objectView\.snapshot\)/);
  const ui = readFileSync('apps/web/src/SceneMarks.svelte', 'utf8');
  assert.match(ui, /aria-pressed/); assert.match(ui, /Unknowns: \{mark.uncertainty\}/); assert.match(ui, /\{mark.rationale\}/); assert.match(ui, /C\{mark.rank\}/);
  assert.doesNotMatch(ui, /groundReliefMeters|groundPoints|poleDistanceMeters/);
});
