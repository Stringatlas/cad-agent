import * as THREE from 'three';
import type { VisualBinding, VisualPixelResolution } from '@spatial/contracts';

export const CAPTURE_GROUNDING_LIMITS = Object.freeze({ bytes: 192 * 1024 * 1024, scratchBytes: 16 * 1024 * 1024,
  objects: 1024, triangles: 1_000_000, ttlMs: 300_000, copyMs: 250, resolveMs: 500, pixelTolerance: 3 });
/** Bulk copy into owned destinations, never per-point provenance objects or live aliases. */
export interface CapturePointSource {
  count: number;
  copy(start: number, count: number, positions: Float64Array, keys: Uint32Array): void;
}
interface FrozenPoints { positions: Float32Array; originals: Float64Array; keys: Uint32Array; matrix: THREE.Matrix4; layer: string }
interface FrozenMesh { positions: Float32Array; indices?: Uint32Array; matrix: THREE.Matrix4; start: number; count: number; side: THREE.Side }
const visible = (object: THREE.Object3D) => { for (let at: THREE.Object3D | null = object; at; at = at.parent) if (!at.visible) return false; return true; };
const supported = (material: THREE.Material, circular: boolean) => {
  if (!(material instanceof THREE.PointsMaterial || material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshNormalMaterial || material instanceof THREE.MeshDepthMaterial)) return false;
  const m = material as THREE.PointsMaterial;
  return m.visible && m.opacity === 1 && !m.transparent && m.depthTest && m.depthWrite && m.depthFunc === THREE.LessEqualDepth &&
    !m.alphaTest && !m.alphaHash && !m.map && !m.alphaMap && !m.clippingPlanes?.length && !m.stencilWrite && !m.polygonOffset && m.colorWrite &&
    !('wireframe' in m && m.wireframe) && !('displacementMap' in m && m.displacementMap) &&
    (m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile || circular && m.userData.captureCenterPicking === 'opaque-circle-v1');
};
export function captureGroundingBytes(points: number, blockerBytes = 0, objects = 0): number {
  const bytes = points * 44 + blockerBytes + objects * 1024 + CAPTURE_GROUNDING_LIMITS.scratchBytes;
  if (![points, blockerBytes, objects, bytes].every(n => Number.isSafeInteger(n) && n >= 0) || bytes > CAPTURE_GROUNDING_LIMITS.bytes || objects > CAPTURE_GROUNDING_LIMITS.objects) throw new Error('Capture grounding resource limit');
  return bytes;
}

/** Immutable CPU-only copy of the captured draw. No renderer/cache object survives. */
export function createCaptureGrounding(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number,
  binding: VisualBinding, source: (object: THREE.Object3D) => CapturePointSource | undefined, now = () => performance.now()) {
  const startTime = now(), deadline = startTime + CAPTURE_GROUNDING_LIMITS.copyMs;
  const check = () => { if (now() > deadline) throw new Error('Capture grounding copy deadline'); };
  if (scene.overrideMaterial) throw new Error('Capture grounding unsupported scene material');
  const layers: { object: THREE.Points; source: CapturePointSource; start: number; count: number }[] = [];
  const blockers: THREE.Mesh[] = [];
  let pointCount = 0, blockerBytes = 0, triangles = 0, objects = 0, hasSourceLayer = false;
  scene.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  scene.traverse(object => {
    if (!visible(object) || !camera.layers.test(object.layers)) return;
    if (!(object instanceof THREE.Points || object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite)) return;
    const drawable = object as THREE.Points | THREE.Mesh;
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    // Opacity does not suppress opaque depth writes. Only explicit material
    // visibility can remove a draw before the conservative support checks below.
    if (materials.every(m => !m.visible)) return;
    if (++objects > CAPTURE_GROUNDING_LIMITS.objects || materials.length !== 1 || !supported(materials[0]!, object instanceof THREE.Points) ||
      object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
      object instanceof THREE.Line || object instanceof THREE.Sprite || (object as THREE.InstancedMesh).isInstancedMesh ||
      (object as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(drawable.geometry.morphAttributes).length) throw new Error('Capture grounding unsupported visible layer');
    const attr = drawable.geometry.getAttribute('position');
    if (!(attr instanceof THREE.BufferAttribute) || !(attr.array instanceof Float32Array) || attr.normalized || object.renderOrder !== 0 || attr.itemSize !== 3 || drawable.geometry.groups.length || !object.matrixWorld.elements.every(Number.isFinite)) throw new Error('Capture grounding unsupported geometry');
    const begin = drawable.geometry.drawRange.start;
    const end = Math.min(object instanceof THREE.Points ? attr.count : drawable.geometry.index?.count ?? attr.count,
      begin + drawable.geometry.drawRange.count);
    const count = Math.max(0, end - begin);
    if (!Number.isSafeInteger(begin) || begin < 0 || !Number.isSafeInteger(count)) throw new Error('Capture grounding invalid draw range');
    if (object instanceof THREE.Points) {
      if (drawable.geometry.index) throw new Error('Capture grounding unsupported indexed points');
      const original = source(object);
      if (!original || original.count < end) throw new Error('Capture grounding original provenance unavailable');
      hasSourceLayer = true;
      if (object.frustumCulled && !frustum.intersectsObject(object)) return;
      layers.push({ object, source: original, start: begin, count }); pointCount += count;
    } else {
      if (object.matrixWorld.determinant() <= 0) throw new Error('Capture grounding unsupported mesh reflection');
      // Exact draw triangles only; unsupported partial triples fail closed.
      if (begin % 3 || count % 3) throw new Error('Capture grounding unsupported mesh draw range');
      triangles += count / 3; blockerBytes += attr.count * 12 + (drawable.geometry.index ? drawable.geometry.index.count * 4 : 0);
      blockers.push(object as THREE.Mesh);
    }
    captureGroundingBytes(pointCount, blockerBytes, objects);
    if (triangles > CAPTURE_GROUNDING_LIMITS.triangles) throw new Error('Capture grounding blocker limit');
    check();
  });
  if (!hasSourceLayer) throw new Error('Capture grounding original source points unavailable');
  const bytes = captureGroundingBytes(pointCount, blockerBytes, objects);
  const points: FrozenPoints[] = layers.map(layer => {
    check();
    const positions = new Float32Array(layer.count * 3), originals = new Float64Array(layer.count * 3), keys = new Uint32Array(layer.count * 2);
    const attr = layer.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < layer.count; i++) {
      if (!(i % 65536)) check();
      for (let axis = 0; axis < 3; axis++) positions[i * 3 + axis] = attr.array[(layer.start + i) * 3 + axis]!;
    }
    layer.source.copy(layer.start, layer.count, originals, keys); check();
    if (!positions.every(Number.isFinite) || !originals.every(Number.isFinite)) throw new Error('Capture grounding invalid coordinates');
    return { positions, originals, keys, matrix: layer.object.matrixWorld.clone(), layer: layer.object.name || 'original-source' };
  });
  const meshes: FrozenMesh[] = blockers.map(object => {
    check(); const g = object.geometry, attr = g.getAttribute('position') as THREE.BufferAttribute;
    const positions = Float32Array.from(attr.array), indices = g.index ? Uint32Array.from(g.index.array) : undefined;
    if (!positions.every(Number.isFinite) || indices?.some(index => index >= attr.count)) throw new Error('Capture grounding invalid blocker');
    return { positions, indices, matrix: object.matrixWorld.clone(), start: g.drawRange.start,
      count: Math.min(g.index?.count ?? attr.count, g.drawRange.start + g.drawRange.count) - g.drawRange.start,
      side: (object.material as THREE.Material).side };
  });
  check();
  const view = camera.clone(); view.updateMatrixWorld(true);
  const detachedBinding = JSON.parse(JSON.stringify(binding)) as VisualBinding;
  const expires = now() + CAPTURE_GROUNDING_LIMITS.ttlMs;
  return { bytes, pointCount, expires, expired: () => now() >= expires,
    resolve(observationId: string, x: number, y: number): VisualPixelResolution {
      const fail = (status: 'invalid' | 'unavailable' | 'no-hit' | 'ambiguous', reason: string): VisualPixelResolution => ({ status, observationId, x, y, reason });
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return fail('invalid', 'Pixel lies outside captured drawing buffer');
      if (now() >= expires) return fail('unavailable', 'Capture grounding expired');
      const end = now() + CAPTURE_GROUNDING_LIMITS.resolveMs;
      const world = new THREE.Vector3(), projected = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      let candidate: { layer: FrozenPoints; index: number } | undefined, work = 0;
      for (const layer of points) for (let i = 0; i < layer.positions.length / 3; i++) {
        if (!(work++ % 2048) && now() > end) return fail('unavailable', 'Capture grounding resolve deadline');
        world.fromArray(layer.positions, i * 3).applyMatrix4(layer.matrix); projected.copy(world).project(view);
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z) || projected.x < -1 || projected.x > 1 || projected.y < -1 || projected.y > 1 || projected.z < -1 || projected.z > 1 ||
          Math.hypot((projected.x + 1) * width / 2 - x - .5, (1 - projected.y) * height / 2 - y - .5) > CAPTURE_GROUNDING_LIMITS.pixelTolerance) continue;
        ray.setFromCamera(ndc.set(projected.x, projected.y), view);
        let blocked = false;
        for (const mesh of meshes) {
          for (let j = mesh.start; j < mesh.start + mesh.count; j += 3) {
            if (!(work++ % 2048) && now() > end) return fail('unavailable', 'Capture grounding blocker deadline');
            a.fromArray(mesh.positions, (mesh.indices?.[j] ?? j) * 3).applyMatrix4(mesh.matrix);
            b.fromArray(mesh.positions, (mesh.indices?.[j + 1] ?? j + 1) * 3).applyMatrix4(mesh.matrix);
            c.fromArray(mesh.positions, (mesh.indices?.[j + 2] ?? j + 2) * 3).applyMatrix4(mesh.matrix);
            const found = mesh.side === THREE.BackSide ? ray.ray.intersectTriangle(c, b, a, true, hit) : ray.ray.intersectTriangle(a, b, c, mesh.side !== THREE.DoubleSide, hit);
            if (found && hit.distanceTo(ray.ray.origin) <= world.distanceTo(ray.ray.origin)) {
              const z = hit.applyMatrix4(view.matrixWorldInverse).z;
              if (-z >= view.near && -z <= view.far) { blocked = true; break; }
            }
          }
          if (blocked) break;
        }
        if (blocked) continue;
        if (candidate) return fail('ambiguous', 'Multiple displayed point centers lie within three source-image pixels');
        candidate = { layer, index: i };
      }
      if (!candidate) return fail('no-hit', 'No supported unoccluded point center within three source-image pixels');
      const { layer, index } = candidate;
      return { status: 'resolved', observationId, x, y, provenance: { datasetId: detachedBinding.sourceId, artifactRevision: detachedBinding.sourceRevision,
        key: { sourceFileId: layer.keys[index * 2]!, sourceRow: layer.keys[index * 2 + 1]! },
        position: Array.from(layer.originals.subarray(index * 3, index * 3 + 3)), frameId: detachedBinding.frameId, units: 'm', origin: [...detachedBinding.origin], layer: layer.layer } };
    } };
}
