import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCaptureGrounding, captureGroundingBytes, CAPTURE_GROUNDING_LIMITS as L } from '../../apps/web/src/viewer/capture-grounding';
const binding = { sourceId: 'stpls3d-1', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm' as const, origin: [10, 20, 30] as const };
function fixture(raw = [0, 0, 0]) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(raw, 3)), new THREE.PointsMaterial({ size: 4, sizeAttenuation: false }));
  scene.add(points);
  const originals = Float64Array.from(raw), keys = Uint32Array.from(raw.flatMap((_, i) => i % 3 ? [] : [1, i / 3]));
  const source = (o: THREE.Object3D) => o === points ? { count: raw.length / 3, copy(start: number, count: number, xyz: Float64Array, ids: Uint32Array) {
    xyz.set(originals.subarray(start * 3, (start + count) * 3)); ids.set(keys.subarray(start * 2, (start + count) * 2));
  } } : undefined;
  const snapshot = (now?: () => number) => createCaptureGrounding(scene, camera, 101, 101, binding, source, now);
  return { scene, camera, points, originals, keys, source, snapshot };
}
test('owned snapshot survives draw compaction, source mutation, camera/transform changes and preserves binary64', () => {
  const f = fixture([.000000000001, 0, 0]), frozen = f.snapshot();
  f.originals.fill(999); f.keys.fill(999); f.points.geometry.getAttribute('position').setXYZ(0, 99, 99, 99); f.points.position.x = 99; f.camera.position.x = 99;
  const hit = frozen.resolve('capture', 50, 50); assert.equal(hit.status, 'resolved');
  if (hit.status === 'resolved') { assert.deepEqual(hit.provenance.position, [.000000000001, 0, 0]); assert.deepEqual(hit.provenance.key, { sourceFileId: 1, sourceRow: 0 }); }
});
test('nearby front/back source centers remain ambiguous; empty and clipped centers do not resolve', () => {
  assert.equal(fixture([0, 0, 0, 0, 0, -10]).snapshot().resolve('capture', 50, 50).status, 'ambiguous');
  assert.equal(fixture().snapshot().resolve('capture', 0, 0).status, 'no-hit');
  assert.equal(fixture([0, 0, 20]).snapshot().resolve('capture', 50, 50).status, 'no-hit');
  assert.equal(fixture([0, 0, -200]).snapshot().resolve('capture', 50, 50).status, 'no-hit');
  assert.equal(fixture().snapshot().resolve('capture', 101, 50).status, 'invalid');
});
test('frozen opaque mesh blocks source independently of later removal or geometry edits', () => {
  const f = fixture(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.z = 5; f.scene.add(mesh); const frozen = f.snapshot();
  f.scene.remove(mesh); mesh.geometry.dispose();
  assert.equal(frozen.resolve('capture', 50, 50).status, 'no-hit');
});
test('zero-opacity depth-writing blockers cannot be omitted from capture visibility', () => {
  const f = fixture();
  const blocker = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ opacity: 0, transparent: false, depthWrite: true, side: THREE.DoubleSide }));
  blocker.position.z = 5; f.scene.add(blocker);
  assert.throws(() => f.snapshot(), /unsupported/);
  blocker.material.visible = false;
  assert.equal(f.snapshot().resolve('capture', 50, 50).status, 'resolved', 'Material visibility explicitly removes the draw, unlike opacity');
});
test('a raster-only mesh has no original source grounding, rather than an empty supported point selection', () => {
  const f = fixture(); f.scene.remove(f.points);
  f.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ vertexColors: true })));
  assert.throws(() => f.snapshot(), /original source points unavailable/);
});
for (const kind of ['transparent', 'clip', 'shader', 'line', 'marker', 'alpha'] as const) test(`unsupported rendered ${kind} refuses grounding`, () => {
  const f = fixture();
  if (kind === 'transparent') f.points.material.transparent = true;
  if (kind === 'clip') f.points.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];
  if (kind === 'shader') f.points.material.onBeforeCompile = () => {};
  if (kind === 'alpha') f.points.material.alphaTest = .5;
  if (kind === 'line') f.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial()));
  if (kind === 'marker') f.scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial()));
  assert.throws(() => f.snapshot(), /unsupported|provenance/);
});
test('known circular splat explicitly retains center-candidate semantics', () => {
  const f = fixture(); f.points.material.onBeforeCompile = () => {}; f.points.material.userData.captureCenterPicking = 'opaque-circle-v1';
  assert.equal(f.snapshot().resolve('capture', 50, 50).status, 'resolved');
});
test('draw ranges and world transforms are frozen correctly', () => {
  const f = fixture([0, 0, 0, 0, 0, 0]); f.points.geometry.setDrawRange(1, 1); f.points.position.x = 1;
  const frozen = f.snapshot(), p = new THREE.Vector3(1, 0, 0).project(f.camera);
  const hit = frozen.resolve('capture', Math.floor((p.x + 1) * 101 / 2), 50);
  assert.equal(hit.status, 'resolved'); if (hit.status === 'resolved') assert.deepEqual(hit.provenance.key, { sourceFileId: 1, sourceRow: 1 });
});
test('3M accounting fits while 12M/50M and blocker overhead reject before allocation', () => {
  assert.equal(captureGroundingBytes(3_000_000), 132_000_000 + L.scratchBytes);
  for (const points of [12_000_000, 50_000_000, Number.MAX_SAFE_INTEGER]) assert.throws(() => captureGroundingBytes(points), /resource/);
  assert.throws(() => captureGroundingBytes(3_000_000, L.bytes), /resource/);
  assert.throws(() => captureGroundingBytes(1, 0, L.objects + 1), /resource/);
  const f = fixture(); let copied = false;
  const huge = new THREE.BufferAttribute(new Float32Array(0), 3); Object.defineProperty(huge, 'count', { value: 50_000_000 }); f.points.geometry.setAttribute('position', huge);
  assert.throws(() => createCaptureGrounding(f.scene, f.camera, 101, 101, binding, () => ({ count: 50_000_000, copy() { copied = true; } })), /resource/);
  assert.equal(copied, false);
});
test('expiry and monotonic copy/resolve deadlines cannot report partial no-hit or resolved', () => {
  const f = fixture(); let now = 0; const frozen = f.snapshot(() => now);
  now = L.ttlMs; assert(frozen.expired()); assert.equal(frozen.resolve('capture', 50, 50).status, 'unavailable');
  now = 0; assert.throws(() => f.snapshot(() => now += L.copyMs + 1), /deadline/);
  let running = false; now = 0; const timed = f.snapshot(() => running ? now += L.resolveMs + 1 : now);
  running = true; assert.equal(timed.resolve('capture', 50, 50).status, 'unavailable');
});
