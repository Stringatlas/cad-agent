import * as THREE from 'three';
import { canonicalSceneObjectSnapshot, type SceneObjectSnapshot } from '@spatial/contracts';

/** Disposable local-meter projections, never object authority or source-point records. */
export function createSceneObjectRender(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  let snapshot: SceneObjectSnapshot | undefined;
  let selected: string | undefined;
  let hiddenSignature = '[]';
  const clear = () => {
    for (const child of [...group.children]) {
      const point = child as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
      point.geometry.dispose(); point.material.dispose(); group.remove(point);
    }
  };
  return {
    get count() { return group.children.length; },
    set(value?: SceneObjectSnapshot, selectedId?: string, hiddenIds: readonly string[] = []) {
      const next = value && canonicalSceneObjectSnapshot(value);
      const hidden = new Set(hiddenIds), signature = JSON.stringify([...hidden].sort());
      if (JSON.stringify(next) === JSON.stringify(snapshot) && selectedId === selected && signature === hiddenSignature) return false;
      clear(); snapshot = next; selected = selectedId; hiddenSignature = signature;
      // View-only visibility never changes authority or hides unreviewed proposals.
      for (const entry of [...(next?.objects ?? []).filter(object => !hidden.has(object.id)).map(object => ({ object, pending: false })), ...(next?.proposals ?? []).map(proposal => ({ object: proposal.object, pending: true }))]) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(entry.object.position, 3));
        const material = new THREE.PointsMaterial({ color: entry.pending ? 0xffc76b : entry.object.id === selected ? 0xffffff : 0x82e3e0, size: entry.pending ? 18 : 14, sizeAttenuation: false, depthTest: false, transparent: entry.pending, opacity: entry.pending ? 0.8 : 1 });
        // Diamond datum; hollow diamond candidate. Geometry remains a datum, not a solid.
        material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nfloat d = abs(gl_PointCoord.x - 0.5) + abs(gl_PointCoord.y - 0.5); if (d > 0.5${entry.pending ? ' || d < 0.3' : ''}) discard;`); };
        material.customProgramCacheKey = () => entry.pending ? 'pending-datum-diamond' : 'datum-diamond';
        const marker = new THREE.Points(geometry, material); marker.userData.objectId = entry.object.id; marker.userData.pending = entry.pending; marker.renderOrder = 5; group.add(marker);
      }
      return true;
    },
    pick(raycaster: THREE.Raycaster): string | undefined {
      const hit = raycaster.intersectObjects(group.children).find(hit => !hit.object.userData.pending);
      const id = hit?.object.userData.objectId;
      return snapshot?.objects.some(object => object.id === id) ? id : undefined;
    },
    dispose() { clear(); snapshot = undefined; scene.remove(group); },
  };
}
