import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { ModelCaptureRequest, Vec3 } from '@spatial/contracts';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function cameraFixture(target?: Vec3) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.up.set(0, 0, 1); camera.position.set(6, -8, 6); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const point = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial()); scene.add(point);
  const frames: THREE.PerspectiveCamera[] = []; let extractionError = false;
  const renderer = { getContext: () => ({ isContextLost: () => false }), getDrawingBufferSize: (size: THREE.Vector2) => size.set(101, 101),
    getPixelRatio: () => 1, render: (_scene: THREE.Scene, view: THREE.PerspectiveCamera) => { frames.push(view.clone()); },
    domElement: { toDataURL: () => { if (extractionError) throw new Error('extraction failed'); return PNG; } } } as unknown as THREE.WebGLRenderer;
  const capture = createVisualCapture({ scene, camera, renderer, ...(target ? { target: () => target } : {}), available: () => true,
    binding: () => ({ sourceId: 'fixture', sourceRevision: 1, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'fixture', complete: true, displayedPointCount: 1 }), points: () => [point],
    resolve: () => ({ entityId: 'cloud', pointIndex: 0, position: [0, 0, 0] }) });
  return { camera, frames, capture, failExtraction: () => { extractionError = true; } };
}

test('requested camera renders a clone, restores live frame and grounds pixels from the requested angle', async () => {
  const f = cameraFixture(), original = f.camera.toJSON();
  const observation = await f.capture.capture({ kind: 'camera', position: [0, -10, 0], target: [0, 0, 0] });
  assert.deepEqual(f.camera.toJSON(), original);
  assert.equal(f.frames.length, 2);
  assert.deepEqual(f.frames[0]!.position.toArray(), [0, -10, 0]);
  assert.deepEqual(f.frames[1]!.position.toArray(), f.camera.position.toArray());
  assert.deepEqual(observation.camera.position, [0, -10, 0]);
  assert.deepEqual(observation.camera.up, [0, 0, 1]);
  assert.deepEqual(observation.camera.matrixWorld, f.frames[0]!.matrixWorld.toArray());
  assert.equal(f.capture.isCurrent(observation.observationId), true);
  assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'resolved');
  f.camera.position.x++;
  assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'stale');
});

test('top-down preserves local Z-up geometry, centers orbit focus, and does not navigate', async () => {
  const focus: Vec3 = [2, 3, 4], f = cameraFixture(focus), original = f.camera.toJSON();
  const observation = await f.capture.capture({ kind: 'top-down' });
  const distance = f.camera.position.distanceTo(new THREE.Vector3(...focus));
  assert.deepEqual(observation.camera.position, [2, 3, 4 + distance]);
  assert.deepEqual(observation.camera.up, [0, 1, 0]);
  assert.ok(f.frames[0]!.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-10);
  assert.deepEqual(f.camera.toJSON(), original);
});

test('top-down fallback uses current look direction rather than arbitrary world origin', async () => {
  const f = cameraFixture();
  f.camera.position.set(25, 30, 15); f.camera.lookAt(25, 30, 5); f.camera.updateMatrixWorld(true);
  const expectedFocus = f.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(f.camera.position);
  const observation = await f.capture.capture({ kind: 'top-down' });
  assert.ok(new THREE.Vector3(...observation.camera.position).distanceTo(expectedFocus.add(new THREE.Vector3(0, 0, 10))) < 1e-10);
});

test('vertical custom camera defaults to deterministic nondegenerate plan-view up', async () => {
  const f = cameraFixture();
  const observation = await f.capture.capture({ kind: 'camera', position: [0, 0, 10], target: [0, 0, 0] });
  assert.deepEqual(observation.camera.up, [0, 1, 0]);
  assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'resolved');
});

test('capture restores live frame even when image extraction throws', async () => {
  const f = cameraFixture(), original = f.camera.toJSON(); f.failExtraction();
  await assert.rejects(f.capture.capture({ kind: 'top-down' }), /extraction failed/);
  assert.equal(f.frames.length, 2);
  assert.deepEqual(f.frames[1]!.position.toArray(), f.camera.position.toArray());
  assert.deepEqual(f.camera.toJSON(), original);
});

test('invalid camera requests fail before rendering; explicit current preserves existing screenshot behavior', async () => {
  const f = cameraFixture();
  for (const request of [
    { kind: 'camera', position: [0, 0, 0], target: [0, 0, 0] },
    { kind: 'camera', position: [NaN, 0, 0], target: [0, 0, 0] },
    { kind: 'camera', position: [0, 0, 10], target: [0, 0, 0], up: [0, 0, 1] },
  ]) await assert.rejects(f.capture.capture(request as ModelCaptureRequest));
  assert.equal(f.frames.length, 0);
  const observation = await f.capture.capture({ kind: 'current' });
  assert.equal(f.frames.length, 1);
  assert.deepEqual(observation.camera.position, f.camera.position.toArray());
});
