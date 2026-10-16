import * as THREE from 'three';
import { VISUAL_OBSERVATION_LIMITS as LIMITS, type Vec3, type VisualBinding, type VisualCoverage, type VisualObservation, type VisualPixelResolution, type VisualPointProvenance } from '@spatial/contracts';

export interface VisualCaptureOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  binding: () => VisualBinding;
  coverage: () => VisualCoverage;
  /** Displayed point layers; blocking scene meshes are included automatically. */
  points: () => THREE.Object3D[];
  resolve: (object: THREE.Object3D, index: number) => VisualPointProvenance | undefined;
  available: () => boolean;
}

/** Detached immutable JSON, rejecting nonfinite numbers and renderer/class instances. */
function detached<T>(value: T): T {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Nonfinite visual metadata');
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') throw new Error('Non-JSON visual metadata');
    if (item && typeof item === 'object' && !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Visual metadata must be plain JSON');
    return item;
  });
  if (json.length > 256 * 1024) throw new Error('Visual metadata exceeds limit');
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  const copy: T = JSON.parse(json); freeze(copy); return copy;
}
function visible(object: THREE.Object3D): boolean {
  for (let item: THREE.Object3D | null = object; item; item = item.parent) if (!item.visible) return false;
  if (object instanceof THREE.Points || object instanceof THREE.Mesh) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some(material => material.visible && material.opacity > 0);
  }
  return true;
}

/** Renderer-owned disposable observation cache. It never owns source geometry or point identity. */
export function createVisualCapture(options: VisualCaptureOptions) {
  const { renderer, scene, camera } = options;
  let generation = 0, serial = 0, disposed = false;
  let retained: { observation: VisualObservation; signature: string; camera: THREE.PerspectiveCamera; objects: THREE.Object3D[]; generation: number } | undefined;
  const available = () => {
    try { return !disposed && options.available() && !renderer.getContext().isContextLost(); }
    catch { return false; }
  };
  const invalidate = () => { generation++; serial++; retained = undefined; };
  function state() {
    camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const binding = detached(options.binding()), coverage = detached(options.coverage());
    if (!binding.sourceId || !binding.frameId || binding.units !== 'm' ||
        !((typeof binding.sourceRevision === 'string' && binding.sourceRevision.length > 0) || (Number.isSafeInteger(binding.sourceRevision) && Number(binding.sourceRevision) >= 0)) ||
        !Array.isArray(binding.origin) || binding.origin.length !== 3 || !binding.origin.every(Number.isFinite) ||
        !coverage.kind || typeof coverage.complete !== 'boolean' || !Number.isSafeInteger(coverage.displayedPointCount) || coverage.displayedPointCount < 0) throw new Error('Invalid visual binding/coverage');
    const objects = new Set<THREE.Object3D>();
    for (const root of options.points()) root.traverse(object => { if (visible(object) && (object instanceof THREE.Points || object instanceof THREE.Mesh)) objects.add(object); });
    scene.traverse(object => { if (visible(object) && object instanceof THREE.Mesh) objects.add(object); });
    const layers = [...objects].filter(object => camera.layers.test(object.layers));
    const signature = JSON.stringify({ size: size.toArray(), pixelRatio: renderer.getPixelRatio(), binding, coverage,
      camera: [camera.matrixWorld.elements, camera.projectionMatrix.elements, camera.near, camera.far, camera.fov, camera.aspect, camera.zoom, camera.layers.mask],
      objects: layers.map(object => {
        const drawable = object as THREE.Points | THREE.Mesh;
        const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
        return [object.uuid, object.matrixWorld.elements, object.layers.mask, drawable.geometry.uuid,
          drawable.geometry.index?.version, drawable.geometry.drawRange,
          Object.entries(drawable.geometry.attributes).map(([name, attr]) => [name, attr.count, 'version' in attr ? attr.version : attr.data.version]),
          materials.map(material => [material.uuid, material.version, material.visible, material.opacity, material.side, 'size' in material ? material.size : null])];
      }) });
    return { size, binding, coverage, objects: layers, signature };
  }
  function current(bundle: NonNullable<typeof retained>): boolean {
    return available() && bundle.generation === generation && state().signature === bundle.signature;
  }
  return {
    async capture(): Promise<VisualObservation> {
      retained = undefined;
      const ticket = ++serial;
      if (!available()) throw new Error('Visual capture unavailable');
      const before = state(), viewGeneration = generation;
      const { x: width, y: height } = before.size;
      if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= LIMITS.maxDimension)) throw new Error('Visual viewport exceeds capture limits');
      const frozenCamera = camera.clone();
      // render + PNG extraction are synchronous: the animation loop cannot replace this frame.
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > Math.ceil(LIMITS.maxPngBytes / 3) * 4 + 22) throw new Error('PNG unavailable or exceeds capture limit');
      const binary = atob(dataUrl.slice(22));
      if (binary.length === 0 || binary.length > LIMITS.maxPngBytes) throw new Error('PNG exceeds capture limit');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if ([137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)) throw new Error('Invalid PNG capture');
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      if (!available() || ticket !== serial || viewGeneration !== generation || state().signature !== before.signature) throw new Error('Visual capture became stale');
      const observation: VisualObservation = Object.freeze({ schemaVersion: 1, observationId: crypto.randomUUID(), viewGeneration,
        image: Object.freeze({ mimeType: 'image/png', dataUrl, sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), byteLength: bytes.length }),
        viewport: Object.freeze({ width, height, pixelRatio: renderer.getPixelRatio(), pixelOrigin: 'top-left' }),
        camera: detached({ position: frozenCamera.position.toArray() as unknown as Vec3, quaternion: frozenCamera.quaternion.toArray(), up: frozenCamera.up.toArray() as unknown as Vec3,
          near: frozenCamera.near, far: frozenCamera.far, fov: frozenCamera.fov, aspect: frozenCamera.aspect, zoom: frozenCamera.zoom,
          matrixWorld: frozenCamera.matrixWorld.toArray(), matrixWorldInverse: frozenCamera.matrixWorldInverse.toArray(), projectionMatrix: frozenCamera.projectionMatrix.toArray() }),
        binding: before.binding, coverage: before.coverage });
      retained = { observation, signature: before.signature, camera: frozenCamera, objects: before.objects, generation: viewGeneration };
      return observation;
    },
    /** Check retention and live view metadata without intersecting displayed geometry. */
    isCurrent(observationId: string): boolean {
      const bundle = retained;
      // A caller checking an old/unknown ID must not discard the latest observation.
      if (!bundle || observationId !== bundle.observation.observationId) return false;
      try { if (current(bundle)) return true; }
      catch { /* Invalid/unavailable metadata also makes the retained view stale. */ }
      invalidate();
      return false;
    },
    resolvePixel(observationId: string, x: number, y: number): VisualPixelResolution {
      const fail = (status: Exclude<VisualPixelResolution['status'], 'resolved'>, reason: string): VisualPixelResolution => ({ status, observationId, x, y, reason });
      if (typeof observationId !== 'string' || !observationId || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) return fail('invalid', 'Expected observation ID and integer top-left image pixel');
      if (!available()) { retained = undefined; return fail('unavailable', 'Viewer unavailable'); }
      const bundle = retained;
      if (!bundle || observationId !== bundle.observation.observationId) return fail('stale', 'Only the latest live observation can be resolved');
      try { if (!current(bundle)) { invalidate(); return fail('stale', 'View changed since capture'); } }
      catch { invalidate(); return fail('stale', 'Visual binding unavailable'); }
      const { width, height } = bundle.observation.viewport;
      if (x >= width || y >= height) return fail('invalid', 'Pixel lies outside captured drawing buffer');
      const ndc = new THREE.Vector2((x + 0.5) / width * 2 - 1, 1 - (y + 0.5) / height * 2);
      const ray = new THREE.Raycaster(); ray.layers.mask = bundle.camera.layers.mask;
      ray.setFromCamera(ndc, bundle.camera);
      // Broad phase only: camera near/far are depths, not radial ray distances.
      // Clip each candidate's center below rather than clipping this tolerance ray.
      ray.params.Points.threshold = 2 * bundle.camera.far * Math.tan(THREE.MathUtils.degToRad(bundle.camera.fov / 2)) / bundle.camera.zoom * LIMITS.pixelTolerance / height;
      const hits = ray.intersectObjects(bundle.objects.filter(object => object instanceof THREE.Points), false);
      const meshes = bundle.objects.filter(object => object instanceof THREE.Mesh);
      const sightline = new THREE.Raycaster(); sightline.layers.mask = bundle.camera.layers.mask;
      const candidates: { object: THREE.Object3D; index: number }[] = [];
      for (const hit of hits) {
        if (!(hit.object instanceof THREE.Points) || hit.index === undefined) continue;
        const attr = hit.object.geometry.getAttribute('position');
        const world = new THREE.Vector3().fromBufferAttribute(attr, hit.index).applyMatrix4(hit.object.matrixWorld);
        const projected = world.clone().project(bundle.camera);
        // WebGL clips point primitives by their center, including the x/y planes.
        if (![projected.x, projected.y, projected.z].every(value => Number.isFinite(value) && value >= -1 && value <= 1)) continue;
        if (Math.hypot((projected.x + 1) / 2 * width - (x + 0.5), (1 - projected.y) / 2 * height - (y + 0.5)) > LIMITS.pixelTolerance) continue;
        // A tolerated point need not lie on the requested pixel's ray. Test its
        // actual sightline, converting camera clip depths to radial distances.
        sightline.setFromCamera(new THREE.Vector2(projected.x, projected.y), bundle.camera);
        const depthPerDistance = -sightline.ray.direction.clone().transformDirection(bundle.camera.matrixWorldInverse).z;
        sightline.near = bundle.camera.near / depthPerDistance;
        sightline.far = Math.min(bundle.camera.far / depthPerDistance, world.distanceTo(sightline.ray.origin));
        if (sightline.intersectObjects(meshes, false).length) continue;
        candidates.push({ object: hit.object, index: hit.index });
      }
      if (!candidates.length) return fail('no-hit', 'No unoccluded displayed point at this pixel');
      if (candidates.length !== 1) return fail('ambiguous', 'Multiple displayed points lie within the pixel tolerance');
      try {
        const candidate = candidates[0]!;
        const original = options.resolve(candidate.object, candidate.index);
        if (!original || Object.keys(original).length === 0) return fail('no-hit', 'Original point provenance unavailable');
        const provenance = detached(original);
        if (!current(bundle)) { invalidate(); return fail('stale', 'View changed while resolving'); }
        return { status: 'resolved', observationId, x, y, provenance };
      } catch { return fail('no-hit', 'Original point provenance unavailable'); }
    },
    invalidate,
    dispose() { disposed = true; invalidate(); },
  };
}
