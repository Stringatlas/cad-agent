import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateStableOrbitControls } from '../../apps/web/src/viewer/orbit-stability';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
type InstalledControls = OrbitControls & {
  _sphericalDelta: THREE.Spherical; _panOffset: THREE.Vector3; _scale: number; _performCursorZoom: boolean;
};
function fixture(target = new THREE.Vector3(), scale = 1) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10_000);
  camera.up.set(0, 0, 1);
  // No DOM listeners needed: exercise the installed update/damping implementation directly.
  const controls = new OrbitControls(camera, null) as unknown as InstalledControls;
  controls.enableDamping = true;
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(6, -8, 6).multiplyScalar(scale));
  controls.update();
  // This is the viewers' exact pre-capture residual damping flush sequence.
  controls.enableDamping = false; controls.update(); controls.enableDamping = true;
  camera.updateMatrixWorld(true);
  return { camera, controls };
}
function pose(f: ReturnType<typeof fixture>) {
  f.camera.updateMatrixWorld(true);
  return { matrix: f.camera.matrixWorld.toArray(), target: f.controls.target.toArray() };
}
function visual(f: ReturnType<typeof fixture>) {
  const renderer = {
    getContext: () => ({ isContextLost: () => false }),
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(101, 101), getPixelRatio: () => 1,
    render: () => {}, domElement: { toDataURL: () => PNG },
  } as unknown as THREE.WebGLRenderer;
  return createVisualCapture({ renderer, camera: f.camera, scene: new THREE.Scene(),
    binding: () => ({ sourceId: 'fixture', sourceRevision: 1, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'fixture', complete: true, displayedPointCount: 0 }),
    points: () => [], resolve: () => undefined, available: () => true });
}

for (const [name, extent, scale] of [['synthetic', 3, 1], ['Toronto', 500, 30]] as const) {
  test(`${name}: 300 varied targets retain exact target/camera/capture through 120 idle frames`, async () => {
    for (let i = 0; i < 300; i++) {
      // Includes both exact corrective-review failures at i=3, not just the default origin.
      const target = i === 0 ? new THREE.Vector3(0, 0, 0.4) :
        new THREE.Vector3(Math.sin(i * 37) * extent, Math.cos(i * 23) * extent, Math.sin(i * 17) * extent / 25);
      const f = fixture(target, scale), before = pose(f), capture = visual(f);
      const pending = capture.capture();
      // Also exercise animation while the PNG digest is pending.
      updateStableOrbitControls(f.camera, f.controls);
      const observation = await pending;
      for (let frame = 0; frame < 120; frame++) {
        updateStableOrbitControls(f.camera, f.controls);
        assert.deepEqual(pose(f), before, `target ${i}, frame ${frame}`);
      }
      assert.equal(capture.isCurrent(observation.observationId), true, `target ${i}`);
      capture.dispose();
    }
  });
}

for (const damping of [false, true]) for (const magnitude of [1e-7, 1e-14]) {
  for (const motion of ['orbit', 'pan'] as const) {
    test(`real ${motion} ${magnitude}, damping=${damping}, survives below change-event threshold`, async () => {
      const actual = fixture(), raw = fixture(), capture = visual(actual);
      const observation = await capture.capture(), before = pose(actual);
      for (const f of [actual, raw]) {
        f.controls.enableDamping = damping;
        if (motion === 'orbit') f.controls._sphericalDelta.theta = magnitude;
        else f.controls._panOffset.x = magnitude;
      }
      // A false return/event is not a no-motion oracle. Even motions within the numerical
      // noise envelope must match unmodified OrbitControls, including residual damping.
      assert.equal(raw.controls.update(), false);
      assert.equal(updateStableOrbitControls(actual.camera, actual.controls), false);
      assert.notDeepEqual(pose(raw), before);
      assert.deepEqual(pose(actual), pose(raw));
      assert.equal(capture.isCurrent(observation.observationId), false);
      const after = pose(actual);
      for (let frame = 0; frame < 10; frame++) {
        updateStableOrbitControls(actual.camera, actual.controls);
        if (damping) {
          raw.controls.update();
          assert.deepEqual(pose(actual), pose(raw));
        } else {
          // Without damping the input is consumed; only idle round-off remains.
          assert.deepEqual(pose(actual), after);
        }
      }
      capture.dispose();
    });
  }
}

test('zoom and automatic orbit retain the installed controls behavior', () => {
  for (const motion of ['zoom', 'autoRotate'] as const) {
    const actual = fixture(), raw = fixture(), before = pose(actual);
    for (const f of [actual, raw]) {
      if (motion === 'zoom') f.controls._scale = 1 + 1e-14;
      else { f.controls.autoRotate = true; f.controls.autoRotateSpeed = 1e-10; }
    }
    raw.controls.update(); updateStableOrbitControls(actual.camera, actual.controls);
    assert.notDeepEqual(pose(raw), before);
    assert.deepEqual(pose(actual), pose(raw));
  }
});

test('capture damping flush clears residuals and subsequent idle frames retain the new view', async () => {
  const f = fixture(new THREE.Vector3(-432.27572430530415, 496.6951898611358, 13.404583516867495), 30);
  f.controls._sphericalDelta.theta = 0.02; f.controls._panOffset.set(0.1, -0.2, 0.3);
  updateStableOrbitControls(f.camera, f.controls);
  f.controls.enableDamping = false; f.controls.update(); f.controls.enableDamping = true;
  assert.equal(f.controls._sphericalDelta.theta, 0);
  assert.equal(f.controls._sphericalDelta.phi, 0);
  assert.equal(f.controls._panOffset.length(), 0);
  const before = pose(f), capture = visual(f), observation = await capture.capture();
  for (let i = 0; i < 120; i++) updateStableOrbitControls(f.camera, f.controls);
  assert.deepEqual(pose(f), before);
  assert.equal(capture.isCurrent(observation.observationId), true);
  capture.dispose();
});
