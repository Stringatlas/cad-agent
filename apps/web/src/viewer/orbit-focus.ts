import { Points, Vector3, type Intersection, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** THREE.Points hit.point lies on the ray, not on the displayed vertex. */
export function orbitHitPosition(hit: Intersection): Vector3 {
  if (hit.object instanceof Points && hit.index !== undefined) {
    return new Vector3().fromBufferAttribute(hit.object.geometry.getAttribute('position'), hit.index).applyMatrix4(hit.object.matrixWorld);
  }
  return hit.point.clone();
}

/** View-only retargeting. Keep the eye stationary; aim and orbit about the hit. */
export function focusOrbit(camera: PerspectiveCamera, controls: OrbitControls, point: Vector3): boolean {
  const distance = camera.position.distanceTo(point);
  if (!point.toArray().every(Number.isFinite) || distance <= Math.max(camera.near, controls.minDistance) || distance > controls.maxDistance) return false;
  // Finish pending damping before changing the center, so the previous gesture
  // cannot keep rotating/panning the newly chosen pivot.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.target.copy(point);
  controls.update();
  controls.enableDamping = damping;
  return true;
}

export function isOrbitFocusGesture(event: Pick<MouseEvent, 'button' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}
