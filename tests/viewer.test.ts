import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createDemoProject, selectEntity } from '@spatial/project-state';
import { createEntityObject, highlight, resolvePickedEntityId } from '../apps/web/src/entities';

test('rendered box dimensions and placement match authoritative parameters', () => {
  const project = createDemoProject();
  const entity = project.entities.find(entity => entity.kind === 'box')!;
  assert.equal(entity.kind, 'box');
  const object = createEntityObject(entity);
  const bounds = new THREE.Box3().setFromObject(object);
  assert.deepEqual(bounds.getCenter(new THREE.Vector3()).toArray(), [0, 0, 0.75]);
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  assert.ok(Math.abs(size[0]! - 1.8) < 1e-6);
  assert.ok(Math.abs(size[1]! - 1.2) < 1e-6);
  assert.ok(Math.abs(size[2]! - 1.5) < 1e-6);
  object.geometry.dispose(); object.material.dispose();
});

test('actual raycast hits resolve authoritative box and cloud IDs and highlight the render cache', () => {
  const project = createDemoProject();
  const objects = project.entities.map(createEntityObject);
  objects.forEach(object => object.updateMatrixWorld(true));
  const ray = new THREE.Raycaster();
  ray.params.Points.threshold = 0.12;
  ray.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  const boxHit = ray.intersectObjects(objects)[0]?.object;
  assert.equal(resolvePickedEntityId(project, boxHit), 'proposal-box');
  const selected = selectEntity(project, resolvePickedEntityId(project, boxHit));
  assert.equal(selected.selectedEntityId, 'proposal-box');
  highlight(objects[1]!, true);
  assert.equal(objects[1]!.material.color.getHex(), 0xffc766);
  highlight(objects[1]!, false);
  assert.equal(objects[1]!.material.color.getHex(), 0x5f8cff);
  ray.set(new THREE.Vector3(-3, -3, 5), new THREE.Vector3(0, 0, -1));
  assert.equal(resolvePickedEntityId(project, ray.intersectObjects(objects)[0]?.object), 'synthetic-cloud');
  assert.equal(resolvePickedEntityId(project, undefined), null);
  const stale = new THREE.Object3D(); stale.userData.entityId = 'deleted-id';
  assert.equal(resolvePickedEntityId(project, stale), null);
  for (const object of objects) { object.geometry.dispose(); object.material.dispose(); }
});
