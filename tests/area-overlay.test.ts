import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAreaOverlay } from '../apps/web/src/area-overlay';

test('AOI fill and border persist in world XY, clear, replace and dispose without becoming pick occluders', () => {
  const scene = new THREE.Scene(), overlay = createAreaOverlay(scene);
  assert.equal(overlay.visible, false);
  const group = scene.children[0] as THREE.Group;
  const fill = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const border = group.children[1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  const corners = [[1, 2, 3], [3, 4, 3], [2, 5, 3], [0, 3, 3]] as const;
  overlay.set(corners);
  assert.equal(overlay.visible, true);
  assert.deepEqual(Array.from(fill.geometry.getAttribute('position').array), corners.flat());
  assert.deepEqual(Array.from(fill.geometry.index!.array), [0, 1, 2, 0, 2, 3]);
  assert.equal(fill.material.depthTest, false); assert.equal(fill.material.depthWrite, false);
  assert.ok(fill.material.opacity > 0 && fill.material.opacity < .3);
  assert.equal(fill.material.side, THREE.DoubleSide);
  assert.equal(border.material.depthTest, false); assert.ok(border.renderOrder > fill.renderOrder);
  const hits: THREE.Intersection[] = [];
  fill.raycast(new THREE.Raycaster(new THREE.Vector3(1, 3, 10), new THREE.Vector3(0, 0, -1)), hits);
  assert.deepEqual(hits, []);
  let disposed = 0;
  fill.geometry.addEventListener('dispose', () => disposed++);
  overlay.set(corners); assert.equal(disposed, 1); assert.equal(overlay.visible, true);
  overlay.set(corners, [-20, 120]);
  const positions = fill.geometry.getAttribute('position');
  assert.equal(positions.count, 8); assert.equal(fill.geometry.index!.count, 36);
  assert.equal(border.geometry.index!.count, 24);
  for (let i = 0; i < 8; i++) {
    assert.equal(positions.getX(i), corners[i % 4][0]);
    assert.equal(positions.getY(i), corners[i % 4][1]);
    assert.equal(positions.getZ(i), i < 4 ? -20 : 120);
  }
  assert.ok(fill.material.opacity < .1);
  overlay.set(); assert.equal(overlay.visible, false);
  assert.equal(fill.geometry.getAttribute('position').count, 0);
  let materials = 0;
  fill.material.addEventListener('dispose', () => materials++);
  border.material.addEventListener('dispose', () => materials++);
  overlay.dispose(); assert.equal(scene.children.length, 0); assert.equal(materials, 2);
});
