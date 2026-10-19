import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Points, PointsMaterial, Raycaster, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusOrbit, isOrbitFocusGesture, orbitHitPosition } from '../apps/web/src/orbit-focus';
import { updateStableOrbitControls } from '../apps/web/src/orbit-stability';

function fixture() {
  const camera = new PerspectiveCamera(45, 1, .1, 10000); camera.up.set(0, 0, 1); camera.position.set(300, -400, 250);
  const controls = new OrbitControls(camera, null); controls.enableDamping = true; controls.minDistance = 1; controls.update();
  return { camera, controls };
}
test('edge retarget keeps the eye, aims at the hit and subsequent orbit uses the new pivot', () => {
  const { camera, controls } = fixture(), eye = camera.position.clone(), target = new Vector3(250, 400, 15);
  assert.equal(focusOrbit(camera, controls, target), true);
  assert.ok(camera.position.distanceTo(eye) < 1e-10);
  assert.ok(controls.target.distanceTo(target) < 1e-10);
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(target.clone().sub(eye).normalize()) < 1e-12);
  const radius = camera.position.distanceTo(target); controls.rotateLeft(.2); controls.update();
  assert.ok(camera.position.distanceTo(eye) > 1);
  assert.ok(Math.abs(camera.position.distanceTo(target) - radius) < 1e-9);
  assert.ok(controls.target.distanceTo(target) < 1e-10);
});
test('retarget flushes damping and then stays idle without drift', () => {
  const { camera, controls } = fixture(); controls.rotateLeft(.3); controls.update();
  assert.ok(focusOrbit(camera, controls, new Vector3(400, 250, 5)));
  const eye = camera.position.clone(), target = controls.target.clone();
  for (let i = 0; i < 120; i++) updateStableOrbitControls(camera, controls);
  assert.deepEqual(camera.position.toArray(), eye.toArray()); assert.deepEqual(controls.target.toArray(), target.toArray());
  assert.equal(controls.enableDamping, true);
});
test('point pivots use the rendered vertex, including object transforms, not the picking ray', () => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([.5, 0, 0], 3));
  const points = new Points(geometry, new PointsMaterial()); points.position.set(1, 0, 0); points.updateMatrixWorld();
  const ray = new Raycaster(new Vector3(1, 0, 10), new Vector3(0, 0, -1)); ray.params.Points.threshold = 1;
  const hit = ray.intersectObject(points)[0]!;
  assert.equal(hit.point.x, 1);
  assert.deepEqual(orbitHitPosition(hit).toArray(), [1.5, 0, 0]);
  geometry.dispose(); points.material.dispose();
});
test('invalid, too-close and beyond-limit pivots leave camera and target alone', () => {
  const { camera, controls } = fixture(), eye = camera.position.clone(), target = controls.target.clone();
  controls.maxDistance = 1000;
  for (const point of [new Vector3(NaN, 2, 3), eye, eye.clone().addScalar(.01), new Vector3(0, 4000, 0)]) assert.equal(focusOrbit(camera, controls, point), false);
  assert.deepEqual(camera.position.toArray(), eye.toArray()); assert.deepEqual(controls.target.toArray(), target.toArray());
});
test('double-click focus excludes selection/window modifiers and non-primary buttons', () => {
  const plain = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  assert.equal(isOrbitFocusGesture(plain), true);
  for (const key of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(isOrbitFocusGesture({ ...plain, [key]: true }), false);
  assert.equal(isOrbitFocusGesture({ ...plain, button: 2 }), false);
});
