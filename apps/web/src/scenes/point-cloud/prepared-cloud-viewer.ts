import * as THREE from 'three';
import { createElevationSurface } from '../../viewer/elevation-surface';
import type { ElevationGrid, ModelCaptureColorMode, Vec3 } from '@spatial/contracts';
import { createPointCloudViewport } from '../../viewer/point-cloud-viewport';
import { createViewportSizer } from '../../viewer/viewport-size';
import { createVisualCapture } from '../../viewer/visual-capture';
import { focusOrbit, orbitHitPosition } from '../../viewer/orbit-focus';
import { cloudColors, type CloudColorMode } from '../../viewer/cloud-colors';
import { createAdaptiveLoader } from '../../viewer/adaptive-loader';
import type { AdaptiveStats } from '../../viewer/adaptive-plan';
import { createNativeCloudRender } from '../../viewer/native-cloud-render';
import { loadPreparedHierarchy, loadPreparedNode, preparedNativePoint } from './prepared-cloud-lod-client';
import { preparedPoint, type PreparedPoint, type PreparedSample } from './prepared-cloud-client';

/** Shared adaptive-cloud projection with native attributes; no dataset-specific palette or authority. */
export function createPreparedCloudViewer(host: HTMLElement, sample: PreparedSample, options: {
  onelevationpick?(x: number, y: number): void;
  pointBudget?: number; ondetail?(stats: AdaptiveStats): void;
  onpick(point: PreparedPoint | undefined): void; onerror(message: string): void;
}) {
  const resources = createPointCloudViewport(host, {
    label: 'Point cloud. Drag to orbit, scroll to zoom, double-click to focus. Click a point to inspect. F fits the scene.',
    damping: false, minDistance: 0.2, background: 0x151619, fov: 50,
  });
  const { scene, camera, controls, renderer } = resources, canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  let surface: ReturnType<typeof createElevationSurface> | undefined;
  let surfaceGrid: ElevationGrid | undefined;
  let mode: CloudColorMode = 'rgb', disposed = false, failed = false, navigated = false;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
  geometry.computeBoundingBox();
  geometry.setAttribute('color', new THREE.BufferAttribute(cloudColors(sample.colors, sample.labels, sample.instances, mode), 3));
  const material = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geometry, material); scene.add(points);
  const pointBudget = options.pointBudget ?? 3000000;
  const native = createNativeCloudRender(material, pointBudget, sample.cloud.descriptor.instances?.unassigned); scene.add(native.points);
  let stats: AdaptiveStats = { loadedPoints: 0, chunks: 0, pending: 1, budgetLimited: false, error: null };
  const markerGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const markerMaterial = new THREE.PointsMaterial({ color: '#ffffff', size: 10, sizeAttenuation: false, depthTest: false });
  const marker = new THREE.Points(markerGeometry, markerMaterial); marker.visible = false; marker.renderOrder = 2; scene.add(marker);
  const draw = () => { if (!disposed && !failed) renderer.render(scene, camera); };
  const viewport = createViewportSizer(host, renderer, camera, () => visual?.invalidate());
  const d = sample.cloud.descriptor;
  host.dataset.cloudId = d.id;
  function applyColors(next: CloudColorMode) {
    if (next === 'instance' && !sample.instances || next === 'semantic' && !sample.labels) throw new Error('Color attribute unavailable');
    mode = next;
    const attr = geometry.getAttribute('color') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(cloudColors(sample.colors, sample.labels, sample.instances, mode, undefined, d.instances?.unassigned));
    attr.needsUpdate = true; native.setColorMode(mode);
  }
  const fullColorModes: ModelCaptureColorMode[] = ['rgb', ...(sample.labels ? ['semantic' as const, 'type' as const] : []), ...(sample.instances ? ['instance' as const] : [])];
  const supportedColorModes = [...fullColorModes];
  const visual = createVisualCapture({ renderer, scene, camera, target: () => controls.target.toArray() as Vec3,
    pointColorMode: { get: () => mode, set: next => applyColors(next === 'type' ? 'semantic' : next) },
    available: () => !disposed && !failed && viewport.sync(),
    binding: () => ({ sourceId: d.id, sourceRevision: sample.cloud.revision, frameId: d.frameId,
      units: 'm', origin: d.coordinates.localOrigin as unknown as Vec3, upAxis: 'Z', handedness: 'right' }),
    coverage: () => ({ kind: surfaceGrid ? 'prepared-elevation-surface' : 'prepared-cloud-adaptive', complete: false, displayedPointCount: surfaceGrid ? 0 : native.count || sample.count,
      datasetPointCount: sample.cloud.totalPoints, pointColorMode: mode,
      scope: surfaceGrid ? `${surfaceGrid.layer} raster preview; derived cell summaries, not original point provenance` : 'Current camera-driven display only; not whole-source geometry or clearance evidence',
      ...(surfaceGrid ? { modelRevision: surfaceGrid.info.revision, surfaceLayer: surfaceGrid.layer } : {}) }),
    supportedColorModes,
    points: () => [points, native.points],
    resolve: (object, index) => {
      const entry = object === native.points ? native.resolve(index) : undefined;
      const p = entry ? preparedNativePoint(sample.cloud, entry.payload, entry.index) : object === points ? preparedPoint(sample, index) : undefined;
      if (!p) return undefined;
      return { datasetId: p.cloudId, artifactRevision: p.revision, key: { sourceFileId: p.sourceId, sourceRow: p.sourceRow },
        position: p.position as unknown as Vec3, frameId: p.frameId, units: 'm', origin: p.localOrigin as unknown as Vec3, layer: object === points ? 'overview' : 'native' };
    },
  });
  const adaptive = createAdaptiveLoader({
    settings: { nearRadius: 30, pixelThreshold: 60, pointBudget },
    hierarchy: signal => loadPreparedHierarchy(sample.cloud, signal),
    load: (node, signal) => loadPreparedNode(sample.cloud, node, signal),
    add: payload => { native.add(payload); points.visible = !surface && native.count === 0; native.points.visible = !surface && native.count > 0; visual.invalidate(); draw(); },
    remove: names => { native.remove(names); points.visible = !surface && native.count === 0; native.points.visible = !surface && native.count > 0; visual.invalidate(); draw(); },
    status: next => {
      stats = next; options.ondetail?.(next);
      host.dataset.adaptivePoints = String(next.loadedPoints); host.dataset.adaptivePending = String(next.pending);
      host.dataset.adaptiveChunks = String(next.chunks); host.dataset.adaptiveError = next.error ?? '';
      host.dataset.adaptiveLimited = String(next.budgetLimited);
      host.dataset.adaptiveNodes = JSON.stringify(native.names);
      host.dataset.pointBudget = String(pointBudget);
    },
  });
  const updateDetail = () => {
    if (!viewport.sync() || disposed || failed || surface) return;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    adaptive.update({ position: camera.position.toArray() as Vec3, focus: controls.target.toArray() as Vec3,
      planes: frustum.planes.map(p => [p.normal.x, p.normal.y, p.normal.z, p.constant] as const),
      viewportHeight: renderer.domElement.height, fovDegrees: camera.fov });
  };
  const change = () => { visual.invalidate(); draw(); updateDetail(); };
  const resize = new ResizeObserver(() => { if (!navigated) fit(); else { viewport.sync(); draw(); updateDetail(); } }); resize.observe(host);
  const navigate = () => { navigated = true; };
  controls.addEventListener('start', navigate);
  controls.addEventListener('change', change);
  function fit() {
    navigated = false;
    viewport.sync();
    // Fit visible geometry, not the Potree octree's padded cubic root volume.
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const angle = Math.min(THREE.MathUtils.degToRad(camera.fov) / 2, Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect));
    const distance = radius / Math.sin(angle) * 1.08;
    camera.position.copy(center).add(new THREE.Vector3(0.7, -1, 0.85).normalize().multiplyScalar(distance));
    camera.far = Math.max(10000, distance * 4); camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(5000, distance * 3); controls.target.copy(center); controls.update(); change();
  }
  function hit(event: PointerEvent | MouseEvent) {
    const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.params.Points.threshold = Math.max(0.03, camera.position.distanceTo(controls.target) * 5 / Math.max(1, rect.height));
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    return surface ? ray.intersectObject(surface.mesh, false)[0] : ray.intersectObjects([points, native.points].filter(p => p.visible), false)[0];
  }
  let down: { x: number; y: number; id: number } | undefined;
  const pointerDown = (event: PointerEvent) => { down = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined; };
  const pointerUp = (event: PointerEvent) => {
    const start = down; down = undefined;
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const picked = hit(event);
    if (surface) { if (picked) options.onelevationpick?.(picked.point.x, picked.point.y); return; }
    if (picked?.index === undefined) { marker.visible = false; options.onpick(undefined); }
    else {
      const entry = picked.object === native.points ? native.resolve(picked.index) : undefined;
      const point = entry ? preparedNativePoint(sample.cloud, entry.payload, entry.index) : preparedPoint(sample, picked.index);
      marker.position.fromArray(point.position); marker.visible = true; options.onpick(point);
    }
    draw();
  };
  const focus = (event: MouseEvent) => { const picked = hit(event); if (picked) { focusOrbit(camera, controls, orbitHitPosition(picked)); change(); } };
  const cancel = () => { down = undefined; };
  const key = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
    if (event.key === 'Escape') { marker.visible = false; options.onpick(undefined); draw(); }
  };
  const contextLost = (event: Event) => { event.preventDefault(); failed = true; adaptive.dispose(); visual.invalidate(); options.onerror('Graphics interrupted. Reload scene.'); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('dblclick', focus);
  canvas.addEventListener('keydown', key); canvas.addEventListener('webglcontextlost', contextLost);
  fit();
  return { fit, visual, setElevation(grid?: ElevationGrid) {
    if (grid && (grid.info.cloudId !== d.id || grid.info.sourceRevision !== sample.cloud.revision || grid.info.frameId !== d.frameId)) throw new Error('Stale elevation layer');
    const next = grid ? createElevationSurface(grid) : undefined;
    if (surface) { scene.remove(surface.mesh); surface.dispose(); }
    surface = next; surfaceGrid = grid;
    supportedColorModes.splice(0, supportedColorModes.length, ...(grid ? [] : fullColorModes));
    if (surface) scene.add(surface.mesh);
    points.visible = !surface && native.count === 0; native.points.visible = !surface && native.count > 0;
    host.dataset.surfaceLayer = grid?.layer ?? 'points'; host.dataset.surfaceCells = String(grid?.values.filter(value => value !== null).length ?? 0);
    marker.visible = false; visual.invalidate(); draw(); if (!surface) updateDetail();
  }, retryDetail: () => adaptive.retry(), get detail() { return stats; }, setSelection(point?: PreparedPoint) {
    if (point && (point.cloudId !== d.id || point.revision !== sample.cloud.revision)) throw new Error('Stale display selection');
    marker.visible = !!point;
    if (point) marker.position.fromArray(point.position);
    visual.invalidate(); draw();
  }, setColorMode(next: CloudColorMode) {
    if (mode === next) return;
    applyColors(next); visual.invalidate(); draw();
  }, dispose() {
    disposed = true; surface?.dispose(); surface = undefined; host.dataset.cloudId = ''; host.dataset.adaptivePoints = '0'; host.dataset.adaptivePending = '1'; adaptive.dispose(); native.dispose(); resize.disconnect(); visual.dispose(); controls.removeEventListener('change', change); controls.removeEventListener('start', navigate);
    canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('dblclick', focus);
    canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', contextLost);
    geometry.dispose(); material.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); resources.dispose();
  } };
}
