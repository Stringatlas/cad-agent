import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { canonicalModelCaptureRequest, canonicalBrowserCaptureRequest, canonicalSceneRegion, canonicalSceneSourceBinding, canonicalAgentViewReceipt, CaptureViewError, type BrowserCaptureRequest, type SceneBox } from '@spatial/contracts';
import { constructAgentCamera, agentBoxCorners } from '../../apps/web/src/viewer/agent-camera';
const binding = { sourceId: 'stpls3d-1', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm' as const, origin: [1000, 2000, 3000] as const };
const frame = (bounds: SceneBox, orientation: 'top' | 'oblique' = 'top'): Extract<BrowserCaptureRequest, { kind: 'framed' }> => ({ kind: 'framed', binding, bounds, pivot: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2], orientation, targetKind: 'declared-box', region: { binding, shape: { kind: 'box', bounds } } });
const boxes: SceneBox[] = [{ min: [-10, -20, -3], max: [40, 30, 5] }, { min: [0, 0, 0], max: [0, 0, 0] }, { min: [-5000, -20, 0], max: [5000, -20, 0] }, { min: [-10000, -10000, -200], max: [-9000, -9500, -199] }];
for (const aspect of [.25, 1, 3]) for (const orientation of ['top', 'oblique'] as const) test(`${orientation} fit all eight corners in aspect ${aspect}, including degenerate/negative/narrow boxes`, () => {
  for (const bounds of boxes) {
    const view = constructAgentCamera(frame(bounds, orientation), aspect, 'points', 'rgb');
    for (const p of agentBoxCorners(bounds)) { p.project(view.camera); assert(Math.abs(p.x) <= 1 / 1.1 + 1e-12); assert(Math.abs(p.y) <= 1 / 1.1 + 1e-12); assert(p.z >= -1 && p.z <= 1); }
    assert(view.camera.near >= .01); assert(view.camera.far > view.camera.near); assert(view.camera.far / view.camera.near <= 1e7);
    assert.equal(view.camera.fov, 50); assert.equal(view.camera.zoom, 1); assert.equal(view.receipt.fitGuaranteed, true);
    assert.deepEqual(view.receipt.bounds, bounds);
  }
});
test('top axes and deterministic oblique direction are explicit', () => {
  const top = constructAgentCamera(frame(boxes[0]!), 1, 'points', 'rgb');
  const right = new THREE.Vector3(...top.focus).add(new THREE.Vector3(1, 0, 0)).project(top.camera);
  const up = new THREE.Vector3(...top.focus).add(new THREE.Vector3(0, 1, 0)).project(top.camera);
  assert(right.x > 0); assert(up.y > 0); assert.equal(top.receipt.azimuthDegrees, 45); assert.equal(top.receipt.elevationDegrees, 90);
  const oblique = constructAgentCamera(frame(boxes[0]!, 'oblique'), 1, 'points', 'rgb');
  const direction = oblique.camera.position.clone().sub(new THREE.Vector3(...oblique.focus)).normalize();
  assert(Math.abs(direction.x - .5) < 1e-12); assert(Math.abs(direction.y - .5) < 1e-12); assert(Math.abs(direction.z - Math.SQRT1_2) < 1e-12);
});
test('relative orbit/dolly keeps issued pivot/lens, signs, and top azimuth, with explicit inward crop', () => {
  const first = constructAgentCamera(frame(boxes[0]!), 1, 'points', 'rgb');
  const next = constructAgentCamera({ kind: 'adjust', binding, observationId: 'first', base: first.receipt, adjustment: { azimuthDeltaDegrees: 90, elevationDeltaDegrees: -45, distanceScale: .5 } }, .3, 'points', 'semantic');
  assert.deepEqual(next.focus, first.focus); assert.equal(next.receipt.azimuthDegrees, 135); assert.equal(next.receipt.elevationDegrees, 45);
  assert.equal(next.receipt.distance, first.receipt.distance / 2); assert.equal(next.receipt.fitGuaranteed, false); assert.equal(next.camera.fov, first.camera.fov); assert.equal(next.receipt.colorMode, 'semantic');
  assert.equal(first.camera.aspect, 1); assert.equal(next.camera.aspect, .3);
  assert.throws(() => constructAgentCamera({ kind: 'adjust', binding, observationId: 'first', base: first.receipt, adjustment: { azimuthDeltaDegrees: 0, elevationDeltaDegrees: 1, distanceScale: 1 } }, 1, 'points', 'rgb'), error => error instanceof CaptureViewError && error.code === 'invalid-view-adjustment');
});
test('binding/box/request/receipt contracts are closed, detached, source-bound and polygon-free', () => {
  const region = { binding, shape: { kind: 'box', bounds: boxes[0]! } };
  const request = { kind: 'frame', target: { kind: 'region', region }, orientation: 'top' };
  assert.deepEqual(canonicalModelCaptureRequest(request), request);
  assert.notEqual(canonicalModelCaptureRequest(request), request);
  assert.throws(() => canonicalSceneSourceBinding({ ...binding, authority: 'invented' }));
  assert.throws(() => canonicalSceneSourceBinding({ ...binding, sourceRevision: 'wrong' }));
  assert.throws(() => canonicalSceneRegion({ binding, shape: { kind: 'polygon-prism', polygon: [], z: { min: 0, max: 1 } } }));
  assert.throws(() => canonicalSceneRegion({ binding, shape: { kind: 'box', bounds: { min: [1, 0, 0], max: [0, 0, 0] } } }));
  for (const bad of [{ ...request, extra: true }, { ...request, target: { kind: 'reference', reference: { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 } }, spanMeters: 0 } }, { kind: 'relative', observationId: 'first', azimuthDeltaDegrees: 181, elevationDeltaDegrees: 0, distanceScale: 1 }]) assert.throws(() => canonicalModelCaptureRequest(bad));
  assert.throws(() => canonicalBrowserCaptureRequest(request), /Unresolved/);
  const receipt = constructAgentCamera(frame(boxes[0]!), 1, 'points', 'rgb').receipt;
  assert.deepEqual(canonicalAgentViewReceipt(receipt), receipt);
  assert.throws(() => canonicalAgentViewReceipt({ ...receipt, serverVerifiedVisibility: true }));
});
test('pathological camera range refuses rather than silently clipping the target', () => {
  assert.throws(() => constructAgentCamera(frame({ min: [-1e7, -1e7, -1e7], max: [1e7, 1e7, 1e7] }), .1, 'points', 'rgb'), error => error instanceof CaptureViewError && error.code === 'numerical-range');
});
