import * as THREE from 'three';
import type { Vec3 } from '@spatial/contracts';

/** Disposable XY intent overlay, drawn above the cloud; never geometry or a pick occluder. */
export function createAreaOverlay(scene: THREE.Scene) {
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
    color: 0x8be6d4, transparent: true, opacity: .18, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  const border = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: 0xb4ffec, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  // Visual capture tests candidate sightlines against scene meshes. An intent tint
  // must not obscure original points or masquerade as a CAD surface in those tests.
  fill.raycast = () => {};
  fill.renderOrder = 4; border.renderOrder = 5;
  const group = new THREE.Group(); group.add(fill, border); group.visible = false; scene.add(group);
  return {
    get visible() { return group.visible; },
    set(corners?: readonly Vec3[], zRange?: readonly [number, number]) {
      fill.geometry.dispose(); border.geometry.dispose();
      const points = (corners ?? []).map(p => new THREE.Vector3(...p));
      const edges: number[] = [], faces: number[] = [];
      if (corners) {
        if (zRange) {
          points.splice(0, points.length, ...zRange.flatMap(z => corners.map(p => new THREE.Vector3(p[0], p[1], z))));
          faces.push(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7);
          for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            faces.push(i, j, j + 4, i, j + 4, i + 4);
            edges.push(i, j, i + 4, j + 4, i, i + 4);
          }
        } else {
          faces.push(0, 1, 2, 0, 2, 3);
          for (let i = 0; i < 4; i++) edges.push(i, (i + 1) % 4);
        }
      }
      fill.material.opacity = zRange ? .07 : .18;
      border.geometry = new THREE.BufferGeometry().setFromPoints(points); border.geometry.setIndex(edges);
      fill.geometry = new THREE.BufferGeometry().setFromPoints(points); fill.geometry.setIndex(faces);
      group.visible = !!corners;
    },
    dispose() {
      group.removeFromParent(); fill.geometry.dispose(); border.geometry.dispose();
      fill.material.dispose(); border.material.dispose();
    },
  };
}
