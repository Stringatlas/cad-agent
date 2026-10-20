import * as THREE from 'three';
import type { PlacementCandidate } from './placement-search-client';
import { placementAccessBounds } from './placement-search-client';

export interface PlacementPreview { candidates: readonly PlacementCandidate[]; frontAccessDepth: number; selectedId?: string }
/** Disposable, non-pickable search illustrations. Never pending CAD or authoritative geometry. */
export function createPlacementSearchRender(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'placement-search-previews'; scene.add(group);
  function clear() {
    group.traverse(object => {
      if ('geometry' in object) (object as THREE.Mesh).geometry.dispose();
      if ('material' in object) {
        const material = (object as THREE.Mesh).material;
        for (const m of Array.isArray(material) ? material : [material]) {
          if ('map' in m) (m as THREE.SpriteMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    group.clear();
  }
  return {
    get count() { return group.children.length; },
    set(preview?: PlacementPreview) {
      clear();
      for (const candidate of preview?.candidates ?? []) {
        const selected = candidate.id === preview?.selectedId, color = selected ? 0xc2ffff : 0x50d6cc;
        const { center, dimensions } = candidate.operation;
        const geometry = new THREE.BoxGeometry(...dimensions);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? .3 : .13, depthWrite: false }));
        mesh.position.set(...center); mesh.userData.placementCandidateId = candidate.id; group.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : .65 }));
        edges.position.copy(mesh.position); group.add(edges);
        const access = placementAccessBounds(candidate, preview!.frontAccessDepth);
        if (access) {
          const [x, y, z] = access.min, [X, Y] = access.max;
          const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, y, z + .03), new THREE.Vector3(X, y, z + .03), new THREE.Vector3(X, Y, z + .03), new THREE.Vector3(x, Y, z + .03), new THREE.Vector3(x, y, z + .03),
          ]), new THREE.LineDashedMaterial({ color, dashSize: .18, gapSize: .1, depthTest: false }));
          outline.computeLineDistances(); group.add(outline);
        }
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = selected ? '#c2ffff' : '#50d6cc'; context.beginPath(); context.arc(64, 64, 44, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#102524'; context.font = 'bold 64px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(candidate.rank), 64, 67);
          const texture = new THREE.CanvasTexture(canvas);
          const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
          label.position.set(center[0], center[1], center[2] + dimensions[2] / 2 + .65); label.scale.set(1.1, 1.1, 1.1); label.renderOrder = 5; group.add(label);
        }
      }
    },
    dispose() { clear(); scene.remove(group); },
  };
}
