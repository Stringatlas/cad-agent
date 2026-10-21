import * as THREE from 'three';
import type { Vec3, ModelAreaOfInterest } from '@spatial/contracts';
import type { VisualModelAttachment } from '../../../chat/model-chat-client';

export interface AreaOfInterestInput {
  readonly area: ModelAreaOfInterest;
  clear(): void;
  readonly attachment?: VisualModelAttachment;
  readonly pending: boolean;
  readonly error?: string;
}

/** Diagonal on the orbit-target XY plane; horizontal screen axis supplies rectangle yaw.
 * This is a user reference plane, not a terrain intersection or a depth crop. */
export function projectAreaOfInterest(camera: THREE.PerspectiveCamera, start: { x: number; y: number }, end: { x: number; y: number }, width: number, height: number, z: number): readonly [Vec3, Vec3, Vec3, Vec3] {
  if (![width, height, z, start.x, start.y, end.x, end.y].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Area selection unavailable. Try a downward view.');
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  const point = (p: { x: number; y: number }) => {
    ray.setFromCamera(new THREE.Vector2(Math.max(0, Math.min(width, p.x)) / width * 2 - 1, 1 - Math.max(0, Math.min(height, p.y)) / height * 2), camera);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit || Math.abs(ray.ray.direction.z) < .02 || hit.distanceTo(camera.position) > camera.far) throw new Error('Look down toward the scene, then select the area again.');
    return hit;
  };
  const a = point(start), b = point(end);
  const u = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); u.z = 0;
  if (u.lengthSq() < 1e-8) throw new Error('Look down toward the scene, then select the area again.');
  u.normalize(); const v = new THREE.Vector3(-u.y, u.x, 0), delta = b.clone().sub(a);
  const du = delta.dot(u), dv = delta.dot(v);
  if (Math.abs(du) < .01 || Math.abs(dv) < .01) throw new Error('Drag a larger area.');
  return [a, a.clone().addScaledVector(u, du), a.clone().addScaledVector(u, du).addScaledVector(v, dv), a.clone().addScaledVector(v, dv)].map(p => p.toArray() as Vec3) as unknown as readonly [Vec3, Vec3, Vec3, Vec3];
}
