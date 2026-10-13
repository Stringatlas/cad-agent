import * as THREE from 'three';
import type { Entity, ProjectState } from '@spatial/contracts';
import { resolveEntity } from '@spatial/project-state';

export type EntityObject = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;

// Render caches only: dimensions/positions/IDs originate in project state.
export function createEntityObject(entity: Entity): EntityObject {
  const object: EntityObject = entity.kind === 'box'
    ? new THREE.Mesh(new THREE.BoxGeometry(...entity.dimensions), new THREE.MeshStandardMaterial({ color: 0x5f8cff, roughness: 0.6 }))
    : new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(entity.points.flat(), 3)), new THREE.PointsMaterial({ color: 0x66ddd2, size: 0.075 }));
  if (entity.kind === 'box') object.position.set(...entity.center);
  object.userData.entityId = entity.id;
  return object;
}

export function resolvePickedEntityId(state: ProjectState, object: THREE.Object3D | undefined): string | null {
  const id: unknown = object?.userData.entityId;
  return typeof id === 'string' && resolveEntity(state, id) ? id : null;
}

export function highlight(object: EntityObject, selected: boolean): void {
  object.material.color.set(selected ? 0xffc766 : object instanceof THREE.Mesh ? 0x5f8cff : 0x66ddd2);
}
