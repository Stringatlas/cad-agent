import * as THREE from 'three';
import { CaptureViewError, canonicalAgentViewReceipt, type AgentViewReceipt, type BrowserCaptureRequest, type ModelCaptureColorMode, type SceneBox, type Vec3 } from '@spatial/contracts';
const tuple = (v: THREE.Vector3) => v.toArray() as Vec3;
const normalize = (n: number) => ((n + 180) % 360 + 360) % 360 - 180;
export function agentBoxCorners(bounds: SceneBox): THREE.Vector3[] {
  return Array.from({ length: 8 }, (_, i) => new THREE.Vector3(...bounds.min.map((n, a) => i & 1 << a ? bounds.max[a] : n) as [number, number, number]));
}
/** Pure construction on a cloned camera; never invokes controls or mutates the user view. */
export function constructAgentCamera(request: Extract<BrowserCaptureRequest, { kind: 'framed' | 'adjust' }>, aspect: number, layer: string, colorMode: ModelCaptureColorMode) {
  const base = request.kind === 'adjust' ? request.base : undefined;
  const declared = request.kind === 'framed' ? request.bounds : request.base.bounds;
  const pivot = new THREE.Vector3(...(base ? base.pivot : request.kind === 'framed' ? request.pivot : [0, 0, 0] as const));
  const half = new THREE.Vector3(...declared.max).sub(new THREE.Vector3(...declared.min)).multiplyScalar(.5);
  const expanded = half.x < .1 || half.y < .1 || half.z < .1;
  half.set(Math.max(.1, half.x), Math.max(.1, half.y), Math.max(.1, half.z));
  const bounds: SceneBox = { min: tuple(pivot.clone().sub(half)), max: tuple(pivot.clone().add(half)) };
  const azimuth = base ? normalize(base.azimuthDegrees + (request.kind === 'adjust' ? request.adjustment.azimuthDeltaDegrees : 0)) : 45;
  const elevation = base ? base.elevationDegrees + (request.kind === 'adjust' ? request.adjustment.elevationDeltaDegrees : 0) : request.kind === 'framed' && request.orientation === 'top' ? 90 : 45;
  if (elevation < 5 || elevation > 90) throw new CaptureViewError('invalid-view-adjustment');
  const camera = new THREE.PerspectiveCamera(base?.fov ?? 50, aspect, .01, 100); camera.zoom = base?.zoom ?? 1;
  if (!(aspect > 0 && Number.isFinite(aspect))) throw new CaptureViewError('numerical-range');
  const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation);
  const back = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  const up = elevation === 90 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = up.clone().cross(back).normalize(), vertical = back.clone().cross(right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom, tanH = tanV * aspect;
  const corners = agentBoxCorners(bounds);
  let distance = .2;
  for (const corner of corners) {
    const q = corner.clone().sub(pivot), z = q.dot(back);
    distance = Math.max(distance, z + 1.1 * Math.abs(q.dot(right)) / tanH, z + 1.1 * Math.abs(q.dot(vertical)) / tanV, z + .02);
  }
  if (base && request.kind === 'adjust') distance = base.distance * request.adjustment.distanceScale;
  if (!Number.isFinite(distance) || distance < .2 || distance > 1e7) throw new CaptureViewError('numerical-range');
  camera.position.copy(pivot).addScaledVector(back, distance); camera.up.copy(up); camera.lookAt(pivot);
  if (camera.position.toArray().some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new CaptureViewError('numerical-range');
  const depths = corners.map(c => distance - c.clone().sub(pivot).dot(back)), positive = [distance, ...depths.filter(n => n > 0)];
  camera.near = Math.max(.01, Math.min(...positive) / 2);
  camera.far = Math.max(...positive) + Math.max(1, .1 * (Math.max(...positive) - Math.min(...positive)));
  if (!Number.isFinite(camera.far) || camera.far <= camera.near || camera.far / camera.near > 1e7) throw new CaptureViewError('numerical-range');
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const targetBehind = depths.some(n => n <= 0);
  const receipt = canonicalAgentViewReceipt({ schemaVersion: 1, scope: 'current-turn', targetKind: base?.targetKind ?? (request.kind === 'framed' ? request.targetKind : 'browser-focus'),
    pivot: tuple(pivot), bounds: declared, azimuthDegrees: azimuth, elevationDegrees: elevation, distance, fov: camera.fov, zoom: camera.zoom,
    ...(base?.targetKind === 'declared-polygon-prism' || request.kind === 'framed' && request.targetKind === 'declared-polygon-prism' ? { fitMethod: 'enclosing-box' } : {}),
    expanded, fitGuaranteed: !base, targetBehind, layer, colorMode,
    ...(request.kind === 'adjust' ? { requested: request.adjustment } : {}),
    ...(request.kind === 'framed' && request.reference ? { reference: request.reference } : base?.reference ? { reference: base.reference } : {}),
    ...(request.kind === 'framed' && request.region ? { region: request.region } : base?.region ? { region: base.region } : {}) });
  return { camera, focus: tuple(pivot), receipt };
}
export function legacyAgentView(camera: THREE.PerspectiveCamera, pivot: Vec3, layer: string, colorMode: ModelCaptureColorMode, explicit: boolean): AgentViewReceipt | undefined {
  const offset = camera.position.clone().sub(new THREE.Vector3(...pivot)), distance = offset.length();
  if (distance < .2 || distance > 1e7) return;
  return canonicalAgentViewReceipt({ schemaVersion: 1, scope: 'current-turn', targetKind: explicit ? 'explicit-camera' : 'browser-focus', pivot,
    bounds: { min: pivot, max: pivot }, azimuthDegrees: normalize(THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.y))),
    elevationDegrees: THREE.MathUtils.radToDeg(Math.asin(offset.z / distance)), distance, fov: camera.fov, zoom: camera.zoom,
    expanded: true, fitGuaranteed: false, targetBehind: false, layer, colorMode });
}
