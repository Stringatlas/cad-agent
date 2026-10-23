import * as THREE from 'three';
import type { Vec3 } from '@spatial/contracts';
import type { AdaptiveView } from './adaptive-plan';

/** The frozen capture projection, including zoom, in dataset-local meters. */
export function captureDetailView(camera: THREE.PerspectiveCamera, focus: Vec3, viewportHeight: number): AdaptiveView {
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return { position: camera.position.toArray() as Vec3, focus,
    planes: frustum.planes.map(p => [p.normal.x, p.normal.y, p.normal.z, p.constant] as const),
    viewportHeight, fovDegrees: camera.getEffectiveFOV() };
}
