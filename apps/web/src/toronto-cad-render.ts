import * as THREE from 'three';
import type { TorontoCadSnapshot } from '@spatial/contracts';
/** Disposable native tessellations only: no primitive recreation or geometry ownership. */
export function createTorontoCadRender(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'toronto-native-cad'; scene.add(group);
  function clear() { for (const mesh of [...group.children] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } }
  return {
    group,
    get captureBlocked() { return group.children.length > 0; },
    set(snapshot?: TorontoCadSnapshot) {
      clear(); if (!snapshot) return;
      for (const [pending, bodies] of [[false, snapshot.bodies], [true, snapshot.proposals]] as const) for (const body of bodies) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.mesh.vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(body.mesh.normals, 3));
        geometry.setIndex([...body.mesh.triangles]); geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({ color: pending ? 0xffb45b : 0x79caff, transparent: pending, opacity: pending ? .35 : 1, depthWrite: !pending, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material); mesh.userData = { bodyId: body.bodyId, pending }; mesh.renderOrder = pending ? 2 : 0; group.add(mesh);
      }
    },
    dispose() { clear(); scene.remove(group); },
  };
}
