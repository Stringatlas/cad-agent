import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SCENE_POINT_LIMIT, type CropBox, type CropSelection, type PointObservation, type DatasetInfo, type Vec3, type PointOverrideSnapshot, type PointMoveProposal, type TorontoCadSnapshot, type ModelCaptureRequest } from '@spatial/contracts';
import { createVisualCapture } from './visual-capture';
import { createViewportSizer } from './viewport-size';
import { createCameraFlight } from './camera-flight';
import { updateStableOrbitControls } from './orbit-stability';
import { createAdaptiveDisplay, type AdaptiveSettings, type AdaptiveStats } from './adaptive-display';
import { createAdaptiveRender } from './adaptive-render';
import { createCropLayer } from './crop-render';
import { pointColors, type PointColorMode } from './point-colors';
import { createTorontoCadRender } from './toronto-cad-render';
import { createPreprocessingLayer, type PreprocessingSummary } from './preprocessing-overlays';
import { createPointOverrideRender } from './point-override-render';
import { projectCropRectangle } from './crop-projection';
import { projectAreaOfInterest } from './area-of-interest';
import { createAreaOverlay } from './area-overlay';
import { createPolePickCache, createDetailPickCache, poleGestureKind, isPoleClick, type PoleSelection } from './pole-picking';

/** Disposable point projection; prepared dataset remains authoritative, not this render cache. */
export function createTorontoViewer(host: HTMLElement, onPick?: (center: Vec3) => void, onSelect?: (selection: CropSelection) => void, onFailure?: (error: string) => void, onQuery?: (selection: PoleSelection) => void, onAdaptiveStatus?: (stats: AdaptiveStats) => void, onArea?: (corners?: readonly [Vec3, Vec3, Vec3, Vec3], error?: string) => void, onInteraction?: () => void) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101927);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10_000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', 'Toronto3D point cloud, meters, right-handed Z-up');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxDistance = 5000;
  controls.minDistance = 1;
  const material = new THREE.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false });
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  scene.add(points);
  const cropLayer = createCropLayer(scene);
  let colorMode: PointColorMode = 'rgb';
  let overviewColors: { rgb: Uint8Array; labels: Uint8Array } | undefined;
  const pointOverrides = createPointOverrideRender(scene);
  const cad = createTorontoCadRender(scene);
  const preprocessing = createPreprocessingLayer(scene);
  const overlay = document.createElement('div'); overlay.className = 'selection-window';
  overlay.setAttribute('data-testid', 'selection-window'); overlay.hidden = true;
  Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', border: '2px solid #ffd65a', background: '#ffd65a22', zIndex: '3', boxSizing: 'border-box' });
  host.appendChild(overlay);
  let gpuFailed = false;
  const failGpu = (message: string) => { if (!gpuFailed) { gpuFailed = true; visual.invalidate(); onFailure?.(message); } };
  const contextLost = (event: Event) => { event.preventDefault(); failGpu('GPU context lost — full resolution incomplete. Clear detail and reload the scene; no downsampling.'); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const selection = new THREE.Box3Helper(new THREE.Box3(), 0xffd65a); selection.visible = false;
  const selectionMaterials = Array.isArray(selection.material) ? selection.material : [selection.material];
  selectionMaterials.forEach(value => { value.depthTest = false; }); selection.renderOrder = 2; scene.add(selection);
  const areaOverlay = createAreaOverlay(scene);
  let selectedBox: CropBox | undefined;
  const raycaster = new THREE.Raycaster();
  let pickCache: ReturnType<typeof createPolePickCache> | undefined;
  const detailCaches = new Map<THREE.Object3D, ReturnType<typeof createDetailPickCache>>();
  const nativeMaterial = new THREE.PointsMaterial({ vertexColors: true, size: 4, sizeAttenuation: false });
  // Opaque circular splats retain depth testing/writes: no transparency sort or
  // blending passes, and no square corners around isolated source samples.
  nativeMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) > 0.25) discard;');
  };
  nativeMaterial.customProgramCacheKey = () => 'opaque-circular-splats-v1';
  const native = createAdaptiveRender(nativeMaterial, {
    register: (object, ids) => pointOverrides.register(object, ids),
    unregister: object => pointOverrides.unregister(object),
  });
  scene.add(native.group);
  let adaptiveStats: AdaptiveStats = { loadedPoints: 0, chunks: 0, pending: 0, budgetLimited: false, error: null };
  let adaptiveRevision: string | undefined;
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  let pickVersion = 0, dataset: DatasetInfo | undefined;
  let overview: { count: number; sampleHash: string; lod: PointObservation['lod']; algorithm: string; candidatePoints: number } | undefined;
  let detailState = 'idle';
  const clearDetail = () => { visual.invalidate(); detailState = 'idle'; pickVersion++; for (const [object, cache] of detailCaches) { pointOverrides.unregister(object as THREE.Points); cache.dispose(); } detailCaches.clear(); cropLayer.clear(); material.transparent = false; material.opacity = 1; };
  let disposed = false, renderDirty = true, renderedFrames = 0;
  const captureSource = createVisualCapture({
    renderer, scene, camera, target: () => controls.target.toArray() as [number, number, number],
    available: () => !disposed && !gpuFailed && !!dataset && !!overview && viewport.sync(),
    binding: () => {
      if (!dataset) throw new Error('Toronto dataset unavailable');
      return { sourceId: dataset.id, sourceRevision: dataset.revision, frameId: 'toronto3d-local-v1', units: dataset.coordinates.units,
        origin: dataset.coordinates.localOrigin, upAxis: dataset.coordinates.upAxis, handedness: dataset.coordinates.handedness };
    },
    coverage: () => ({ kind: 'sampled-overview-with-adaptive-and-manual-detail', complete: false,
      displayedPointCount: (points.visible ? overview?.count ?? 0 : 0) + cropLayer.count + adaptiveStats.loadedPoints,
      // Keep capture metadata bounded even after hundreds of native nodes settle.
      // Actual geometry participates in the capture signature independently of this sample.
      adaptive: adaptive ? { ...adaptiveStats, nodes: native.names.slice(0, 32), nodeCount: native.names.length,
        omittedNodeCount: Math.max(0, native.names.length - 32), settings: { ...adaptiveSettings } } : null,
      datasetPointCount: dataset?.totalPoints ?? 0,
      overview: overview ? { displayedPointCount: points.visible ? overview.count : 0, sampleHash: overview.sampleHash, lod: { budget: overview.lod.budget, depth: overview.lod.depth },
        algorithm: overview.algorithm, candidatePoints: overview.candidatePoints, opacity: material.opacity } : null,
      detail: { displayedPointCount: cropLayer.count, chunkCount: cropLayer.group.children.length, state: detailState },
      pointColorMode: colorMode,
      observation: 'capture-time-rendered-scene-not-current-geometry',
      layers: { areaOfInterest: areaOverlay.visible, cadSolidsOrGhosts: cad.captureBlocked, pointEditsOrPreview: pointOverrides.captureBlocked, derivedOverlays: preprocessing.count },
      pointProvenance: pointOverrides.captureBlocked ? 'unavailable-for-edited-imagery' : 'original-source-records-only',
      pointCountScope: 'overview-adaptive-manual-detail-only-excludes-edit-preview-and-fallback-markers',
      scope: 'Displayed scene including CAD solids, pending ghosts, point edits and overlays when present; not whole-dataset or authoritative geometry evidence' }),
    points: () => [...(points.visible ? [points] : []), ...native.objects, ...cropLayer.group.children],
    resolve: (object, index) => {
      // Original pick caches do not describe effective/preview positions. Keep image
      // capture usable but do not falsely ground edited imagery to original coordinates.
      if (pointOverrides.captureBlocked) return;
      const original = object === points ? pickCache?.resolve(index) : detailCaches.get(object)?.resolve(index) ?? native.resolve(object, index);
      if (!original || !dataset || original.artifactRevision !== dataset.revision) return;
      return { datasetId: original.datasetId, artifactRevision: original.artifactRevision,
        key: { sourceFileId: original.key.sourceFileId, sourceRow: original.key.sourceRow }, position: original.position,
        frameId: 'toronto3d-local-v1', units: dataset.coordinates.units, origin: dataset.coordinates.localOrigin,
        layer: object === points ? 'overview' : 'detail' };
    },
  });
  const visual = { ...captureSource, invalidate() { renderDirty = true; captureSource.invalidate(); } };
  const viewport = createViewportSizer(host, renderer, camera, () => visual.invalidate());
  let adaptiveSettings: Partial<AdaptiveSettings> = {};
  let adaptive: ReturnType<typeof createAdaptiveDisplay> | undefined;
  const makeAdaptive = onAdaptiveStatus ? () => createAdaptiveDisplay({
    add(payload) {
      if (disposed || gpuFailed || payload.dataset.revision !== dataset?.revision) throw new Error('Scene unavailable; reload display.');
      native.add(payload);
      points.visible = false; pickVersion++; visual.invalidate();
    },
    remove(name) {
      native.remove(name);
      points.visible = native.count === 0; pickVersion++; visual.invalidate();
    },
    removeMany(names) {
      native.remove(names);
      points.visible = native.count === 0; pickVersion++; visual.invalidate();
    },
    status(stats) { adaptiveStats = stats; onAdaptiveStatus(stats); },
  }) : undefined;
  const controlsChanged = () => visual.invalidate();
  controls.addEventListener('change', controlsChanged);
  const flight = createCameraFlight(renderer.domElement, camera, controls, 50, () => visual.invalidate(),
    () => !disposed && !gpuFailed && !!dataset);
  const queryMarkers = new THREE.Group(); scene.add(queryMarkers);
  const markerGeometry = new THREE.BufferGeometry();
  const markerMaterial = new THREE.PointsMaterial({ color: 0x72d9cd, size: 14, sizeAttenuation: false, depthTest: false });
  const originMarker = new THREE.Points(markerGeometry, markerMaterial); originMarker.renderOrder = 4; queryMarkers.add(originMarker);
  const winnerGeometry = new THREE.BufferGeometry();
  const winnerMaterial = new THREE.PointsMaterial({ color: 0xff7799, size: 11, sizeAttenuation: false, depthTest: false });
  const winnerMarker = new THREE.Points(winnerGeometry, winnerMaterial); winnerMarker.renderOrder = 5; queryMarkers.add(winnerMarker);
  const lineGeometry = new THREE.BufferGeometry(), lineMaterial = new THREE.LineBasicMaterial({ color: 0xffd65a, depthTest: false });
  const distanceLine = new THREE.Line(lineGeometry, lineMaterial); distanceLine.renderOrder = 3; queryMarkers.add(distanceLine);
  queryMarkers.visible = false;
  let queryPositions: { selected: Vec3; nearest?: Vec3 } | undefined;
  // Draft labels are disposable display markers, independent of semantic-query results.
  let draftMarkerSignature = '';
  const draftMarkers = new Map<string, { sprite: THREE.Sprite; texture: THREE.CanvasTexture; material: THREE.SpriteMaterial; artifactRevision: string }>();
  const removeDraftMarker = (name: string) => {
    const marker = draftMarkers.get(name);
    if (!marker) return;
    scene.remove(marker.sprite); marker.material.dispose(); marker.texture.dispose(); draftMarkers.delete(name);
  };
  const createDraftMarker = (name: string, artifactRevision: string, proposed = false) => {
    // Copies keep the same number; amber versus mint distinguishes pending moves.
    // Fit even a safe-integer suffix, with at most 512 × 64 texels per marker.
    const label = name.slice('Point '.length);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = 'bold 34px system-ui';
    canvas.width = Math.min(512, Math.max(64, Math.ceil(context.measureText(label).width) + 28)); canvas.height = 64;
    context.beginPath(); context.roundRect(4, 5, canvas.width - 8, 54, 25);
    context.fillStyle = proposed ? '#ffb84d' : '#8be6d4'; context.fill();
    context.strokeStyle = '#ffffff'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#102b2e'; context.font = 'bold 34px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, 33, canvas.width - 28);
    const texture = new THREE.CanvasTexture(canvas); texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(material); sprite.scale.set(.035 * canvas.width / 64, .035, 1); sprite.renderOrder = 6; scene.add(sprite);
    return { sprite, texture, material, artifactRevision };
  };
  let pointerStart: { x: number; y: number; id: number; kind: 'shift' | 'query'; travel: number; cache: typeof pickCache; version: number } | undefined;
  let pendingShift: { x: number; y: number; id: number } | undefined;
  const pointerDown = (event: PointerEvent) => {
    if (event.button === 0 && !disposed && !gpuFailed) onInteraction?.();
    const kind = poleGestureKind(event, !!onQuery);
    if (!kind && event.button === 0 && !pointerStart) pendingShift = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (!kind || pointerStart || disposed || gpuFailed) return;
    pendingShift = undefined;
    // Capture phase precedes OrbitControls: a Shift gesture must never rotate/pan the camera.
    event.preventDefault(); event.stopImmediatePropagation(); controls.enabled = false; flight.reset();
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, kind, travel: 0, cache: pickCache, version: pickVersion };
    visual.invalidate();
    renderer.domElement.setPointerCapture(event.pointerId); overlay.hidden = kind !== 'shift';
    pointerMove(event);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointerStart && pendingShift?.id === event.pointerId) {
      const start = pendingShift;
      if (event.shiftKey && event.buttons === 1) {
        pendingShift = undefined;
        // Shift may arrive just after mouse-down. Clean up OrbitControls' pointer
        // before taking over, so the first drag doesn't become an accidental orbit.
        renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: event.pointerId }));
        pointerDown(new PointerEvent('pointerdown', { pointerId: event.pointerId, button: 0, buttons: 1, shiftKey: true,
          clientX: start.x, clientY: start.y }));
      } else if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4 || event.buttons !== 1) pendingShift = undefined;
    }
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    visual.invalidate();
    event.preventDefault(); event.stopImmediatePropagation();
    pointerStart.travel = Math.max(pointerStart.travel, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
    if (pointerStart.kind === 'query') return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = Math.max(rect.left, Math.min(rect.right, event.clientX)), y = Math.max(rect.top, Math.min(rect.bottom, event.clientY));
    Object.assign(overlay.style, { left: Math.min(pointerStart.x, x) - rect.left + 'px', top: Math.min(pointerStart.y, y) - rect.top + 'px',
      width: Math.abs(x - pointerStart.x) + 'px', height: Math.abs(y - pointerStart.y) + 'px' });
  };
  const finishGesture = () => {
    if (pointerStart) visual.invalidate();
    const id = pointerStart?.id; pointerStart = undefined; overlay.hidden = true; controls.enabled = true;
    if (id !== undefined && renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id);
  };
  const cancelGesture = (event: PointerEvent) => {
    // A delayed loss from a previous click must not cancel the next captured drag.
    if (event.type === 'lostpointercapture' && renderer.domElement.hasPointerCapture(event.pointerId)) return;
    if (pendingShift?.id === event.pointerId) pendingShift = undefined;
    if (pointerStart?.id !== event.pointerId) return;
    finishGesture();
  };
  const pointerUp = (event: PointerEvent) => {
    if (pendingShift?.id === event.pointerId) pendingShift = undefined;
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const start = pointerStart, rect = renderer.domElement.getBoundingClientRect(); finishGesture();
    const dx = Math.abs(event.clientX - start.x), dy = Math.abs(event.clientY - start.y);
    if (start.kind === 'query') {
      if (!isPoleClick(Math.max(start.travel, Math.hypot(dx, dy)), false, start.cache === pickCache && start.version === pickVersion) || disposed || gpuFailed) return;
      raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 6;
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      // Detail is the active picking layer; overview is context/fallback only.
      const hit = raycaster.intersectObjects([...detailCaches.keys(), ...native.objects])[0] ?? raycaster.intersectObject(pointOverrides.fallback)[0] ?? (points.visible ? raycaster.intersectObject(points)[0] : undefined);
      const resolved = hit?.index === undefined ? undefined : hit.object === pointOverrides.fallback ? pointOverrides.resolveFallback(hit.index) :
        hit.object === points ? start.cache?.resolve(hit.index) : detailCaches.get(hit.object)?.resolve(hit.index) ?? native.resolve(hit.object, hit.index);
      if (resolved) onQuery?.(resolved);
      return;
    }
    if (dx >= 4 && dy >= 4 && bounds) {
      if (onArea) {
        try { onArea(projectAreaOfInterest(camera, { x: start.x - rect.left, y: start.y - rect.top },
          { x: event.clientX - rect.left, y: event.clientY - rect.top }, rect.width, rect.height, controls.target.z)); }
        catch (error) { onArea(undefined, error instanceof Error ? error.message : 'Area selection unavailable.'); }
      } else onSelect?.(projectCropRectangle(camera, { left: start.x - rect.left, top: start.y - rect.top, right: event.clientX - rect.left, bottom: event.clientY - rect.top }, rect.width, rect.height, bounds));
      return;
    }
    // Tiny click places the existing AABB on a visible point. Thin accidental drags are ignored.
    if (Math.hypot(dx, dy) > 4) return;
    raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 6;
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...cropLayer.group.children, ...native.objects, pointOverrides.fallback, ...(points.visible ? [points] : [])])[0];
    if (hit && hit.index !== undefined) {
      const original = hit.object === pointOverrides.fallback ? pointOverrides.resolveFallback(hit.index) :
        (hit.object === points ? pickCache?.resolve(hit.index) : detailCaches.get(hit.object)?.resolve(hit.index) ?? native.resolve(hit.object, hit.index));
      if (original) onPick?.(original.position);
    }
  };
  const contextMenu = (event: MouseEvent) => { if (onQuery && (event.ctrlKey || event.metaKey || pointerStart?.kind === 'query')) { event.preventDefault(); event.stopImmediatePropagation(); } };
  renderer.domElement.addEventListener('contextmenu', contextMenu, true);
  renderer.domElement.addEventListener('pointerdown', pointerDown, true);
  renderer.domElement.addEventListener('pointermove', pointerMove, true);
  renderer.domElement.addEventListener('pointerup', pointerUp, true);
  renderer.domElement.addEventListener('pointercancel', cancelGesture, true);
  renderer.domElement.addEventListener('lostpointercapture', cancelGesture, true);
  let initialized = false;
  let bounds: PointObservation['dataset']['bounds'] | undefined;
  function frameDataset() {
    if (!bounds) return;
    visual.invalidate();
    const center = new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(0.5);
    const extent = new THREE.Vector3(...bounds.max).sub(new THREE.Vector3(...bounds.min)).length();
    controls.target.copy(center);
    // Fit bounding sphere at both wide and narrow aspect ratios, with a Z-up oblique view.
    const fov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
    const distance = extent / (2 * Math.sin(fov / 2)) * 1.05;
    camera.position.copy(center).add(new THREE.Vector3(0.5, -0.6, 1).normalize().multiplyScalar(distance));
    controls.update();
  }
  const resize = new ResizeObserver(() => { viewport.sync(); });
  viewport.sync(); // Dataset framing and capture use the real aspect immediately.
  resize.observe(host);
  let frame = 0;
  const smoke = new URLSearchParams(location.search).has('smoke');
  function animate() {
    frame = requestAnimationFrame(animate);
    if (!pointerStart && updateStableOrbitControls(camera, controls)) renderDirty = true;
    flight.update();
    if (!gpuFailed && renderDirty) {
      renderDirty = false;
      try {
        if (adaptive && dataset && host.clientHeight > 0) {
          camera.updateMatrixWorld();
          frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          adaptive.update({ position: camera.position.toArray() as [number, number, number],
            planes: frustum.planes.map(p => [p.normal.x, p.normal.y, p.normal.z, p.constant] as const),
            viewportHeight: host.clientHeight, fovDegrees: camera.fov });
        }
        renderer.render(scene, camera); renderedFrames++;
        const gl = renderer.getContext(), error = gl.getError();
        if (error !== gl.NO_ERROR) failGpu(`GPU rendering failed (${error === gl.OUT_OF_MEMORY ? 'out of memory' : error}); full resolution incomplete. Clear detail and reload the scene; no downsampling.`);
      } catch (error) { failGpu(`Rendering/resource failure: ${String(error)}. Full resolution incomplete; reload the scene.`); }
    }
    host.dataset.ready = String(!gpuFailed);
    host.dataset.points = String(renderer.info.render.points);
    host.dataset.adaptivePoints = String(adaptiveStats.loadedPoints);
    host.dataset.adaptiveChunks = String(adaptiveStats.chunks);
    host.dataset.adaptivePending = String(adaptiveStats.pending);
    host.dataset.adaptiveLimited = String(adaptiveStats.budgetLimited);
    host.dataset.adaptiveError = adaptiveStats.error ?? '';
    host.dataset.cropPoints = String(cropLayer.count);
    host.dataset.cropChunks = String(cropLayer.group.children.length);
    host.dataset.boxVisible = String(selection.visible);
    host.dataset.cadBodies = String(cad.group.children.filter(m => !m.userData.pending).length);
    host.dataset.cadGhosts = String(cad.group.children.filter(m => m.userData.pending).length);
    if (smoke) {
      host.dataset.draftMarkers = JSON.stringify([...draftMarkers].map(([name, marker]) => ({ name, position: marker.sprite.position.toArray() })));
      host.dataset.adaptiveNodes = JSON.stringify(native.names);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.renderedFrames = String(renderedFrames);
      host.dataset.nativeBatches = String(native.chunks);
      host.dataset.gpuGeometries = String(renderer.info.memory.geometries);
      const detail = [...detailCaches.keys(), ...native.objects].find(object => {
        const positions = (object as THREE.Points).geometry.getAttribute('position');
        if (!positions?.count) return false;
        const p = new THREE.Vector3().fromBufferAttribute(positions, 0).project(camera);
        return Math.abs(p.x) < .8 && Math.abs(p.y) < .8 && Math.abs(p.z) < 1;
      }) as THREE.Points | undefined;
      const detailPositions = detail?.geometry.getAttribute('position');
      if (detailPositions?.count) {
        const point = new THREE.Vector3().fromBufferAttribute(detailPositions, 0).project(camera);
        host.dataset.detailPickPoint = JSON.stringify([(point.x + 1) * host.clientWidth / 2, (1 - point.y) * host.clientHeight / 2]);
      } else delete host.dataset.detailPickPoint;
      host.dataset.querySelected = String(!!queryPositions);
      host.dataset.queryWinner = String(!!queryPositions?.nearest);
      host.dataset.camera = JSON.stringify(camera.position.toArray());
      host.dataset.cameraTarget = JSON.stringify(controls.target.toArray());
      const positions = points.geometry.getAttribute('position');
      if (positions?.count) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, 0).project(camera);
        host.dataset.pickPoint = JSON.stringify([(point.x + 1) * host.clientWidth / 2, (1 - point.y) * host.clientHeight / 2]);
      }
    }
  }
  animate();
  return {
    setArea(corners?: readonly Vec3[]) {
      areaOverlay.set(corners, bounds ? [bounds.min[2], bounds.max[2]] : undefined); visual.invalidate();
      host.dataset.areaZRange = corners && bounds ? JSON.stringify([bounds.min[2], bounds.max[2]]) : '';
      host.dataset.areaOfInterest = corners ? JSON.stringify(corners) : '';
    },
    startAdaptive() {
      if (disposed || !dataset || !makeAdaptive) return;
      if (!adaptive) { adaptive = makeAdaptive(); adaptive.configure(adaptiveSettings); }
      if (adaptiveRevision !== dataset.revision) {
        adaptiveRevision = dataset.revision; adaptive.bind(dataset);
      }
      visual.invalidate();
    },
    stopAdaptive() {
      adaptive?.dispose(); adaptive = undefined; adaptiveRevision = undefined;
      adaptiveStats = { loadedPoints: 0, chunks: 0, pending: 0, budgetLimited: false, error: null };
      onAdaptiveStatus?.(adaptiveStats); visual.invalidate();
    },
    configureAdaptive(settings: Partial<AdaptiveSettings>) {
      adaptive?.configure(settings); adaptiveSettings = { ...adaptiveSettings, ...settings }; visual.invalidate();
    },
    retryAdaptive() { adaptive?.retry(); },
    setPointSize(size: number) {
      if (!Number.isFinite(size) || size < 2 || size > 6) throw new RangeError('Point size must be 2–6 pixels');
      nativeMaterial.size = size; visual.invalidate();
    },
    setPreprocessing(summary?: PreprocessingSummary) {
      if (disposed) return;
      visual.invalidate(); preprocessing.set(summary);
    },
    capture: (request?: ModelCaptureRequest) => {
      // Preserve the existing manual screenshot/crop stabilization. Model requests
      // never update controls or navigate the user's live viewport.
      if (!request) {
        const damping = controls.enableDamping;
        controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
      }
      return visual.capture(request);
    },
    isCaptureCurrent: visual.isCurrent,
    resolvePixel: visual.resolvePixel,
    setCad(snapshot?: TorontoCadSnapshot) {
      if (disposed) return;
      visual.invalidate(); cad.set(snapshot);
    },
    setPointOverrides(snapshot?: PointOverrideSnapshot) {
      if (disposed) return;
      visual.invalidate(); pickVersion++;
      pointOverrides.setPointOverrides(snapshot);
    },
    setPointMovePreview(proposal?: PointMoveProposal | readonly PointMoveProposal[]) {
      if (disposed) return;
      visual.invalidate(); pickVersion++;
      pointOverrides.setPointMovePreview(proposal);
    },
    setDetailState(state: string) {
      if (disposed || detailState === state) return;
      detailState = state; visual.invalidate();
    },
    setColorMode(mode: PointColorMode) {
      if (disposed || mode === colorMode) return;
      colorMode = mode;
      if (overviewColors) {
        const attribute = points.geometry.getAttribute('color') as THREE.BufferAttribute;
        (attribute.array as Float32Array).set(pointColors(overviewColors.rgb, overviewColors.labels, mode)); attribute.needsUpdate = true;
      }
      native.setColorMode(mode); cropLayer.setColorMode(mode); visual.invalidate();
    },
    update(sample: PointObservation) {
      if (disposed) return;
      visual.invalidate();
      const nextCache = createPolePickCache(sample);
      if (sample.count > 100_000 || sample.positions.length !== sample.count * 3) throw new Error('Display point limit exceeded');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
      overviewColors = { rgb: Uint8Array.from(sample.colors), labels: Uint8Array.from(sample.labels) };
      const colors = pointColors(overviewColors.rgb, overviewColors.labels, colorMode);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      pointOverrides.unregister(points);
      const previous = points.geometry;
      points.geometry = geometry;
      previous.dispose();
      if (dataset && dataset.revision !== sample.dataset.revision) clearDetail();
      dataset = sample.dataset; pickVersion++;
      if (adaptive && adaptiveRevision && adaptiveRevision !== dataset.revision) {
        adaptiveRevision = dataset.revision; adaptive.bind(dataset);
      }
      pointOverrides.setArtifactRevision(dataset.revision);
      pointOverrides.register(points, sample.sourceIds);
      overview = { count: sample.count, sampleHash: sample.sampleHash, lod: { ...sample.lod }, algorithm: sample.algorithm, candidatePoints: sample.candidatePoints };
      for (const [name, marker] of draftMarkers) { if (marker.artifactRevision !== dataset.revision) removeDraftMarker(name); }
      pickCache?.dispose(); pickCache = nextCache;
      bounds = sample.dataset.bounds;
      if (!initialized) { initialized = true; frameDataset(); }
    },
    setDraftMarkers(references: readonly { name: string; position: Vec3; artifactRevision: string; proposed?: boolean; markerId?: string }[]) {
      if (disposed) return;
      const signature = JSON.stringify(references);
      // Explicit clear/replacement also invalidates an in-flight pin gesture.
      if (signature !== draftMarkerSignature) { visual.invalidate(); draftMarkerSignature = signature; pickVersion++; }
      const active = new Map(references.filter(value => value.artifactRevision === dataset?.revision).slice(0, SCENE_POINT_LIMIT * 33).map(value => [value.markerId ?? value.name, value]));
      for (const [name, marker] of draftMarkers) {
        if (!active.has(name) || active.get(name)!.artifactRevision !== marker.artifactRevision) removeDraftMarker(name);
      }
      for (const [name, reference] of active) {
        const marker = draftMarkers.get(name) ?? createDraftMarker(reference.name, reference.artifactRevision, reference.proposed);
        marker.sprite.position.set(...reference.position); draftMarkers.set(name, marker);
      }
    },
    setQueryMarkers(selected?: Vec3, nearest?: Vec3) {
      if (JSON.stringify(queryPositions) === JSON.stringify(selected ? { selected, nearest } : undefined)) return;
      visual.invalidate();
      // Release previous GPU attributes before replacing this tiny disposable cache.
      markerGeometry.dispose(); winnerGeometry.dispose(); lineGeometry.dispose();
      queryPositions = selected ? { selected, nearest } : undefined; queryMarkers.visible = !!selected;
      markerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(selected ?? [], 3));
      winnerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(nearest ?? [], 3));
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(selected && nearest ? [...selected, ...nearest] : [], 3));
      for (const geometry of [markerGeometry, winnerGeometry, lineGeometry]) { if (geometry.getAttribute('position').count) geometry.computeBoundingSphere(); }
    },
    frameResult() {
      if (!queryPositions) return;
      const positions = [queryPositions.selected, queryPositions.nearest ?? queryPositions.selected];
      const previous = bounds;
      bounds = { min: [0, 1, 2].map(i => Math.min(...positions.map(p => p[i])) - 2) as unknown as Vec3,
        max: [0, 1, 2].map(i => Math.max(...positions.map(p => p[i])) + 2) as unknown as Vec3 };
      frameDataset(); bounds = previous;
    },
    setBox(box?: CropBox) {
      visual.invalidate();
      selectedBox = box; selection.visible = !!box;
      if (box) { selection.box.min.set(...box.min); selection.box.max.set(...box.max); }
    },
    clearCrop() {
      clearDetail();
    },
    appendCrop(positions: readonly number[], colors: readonly number[], sourceIds?: readonly number[], revision?: string, labels?: readonly number[]) {
      if (disposed || gpuFailed) throw new Error('GPU unavailable; reload the scene before loading full resolution');
      visual.invalidate(); detailState = 'loading';
      let cache: ReturnType<typeof createDetailPickCache> | undefined;
      if (dataset && revision === dataset.revision && sourceIds) {
        cache = createDetailPickCache(dataset, positions, sourceIds);
      } else if (onQuery) throw new Error('Missing or stale detail provenance');
      try {
        const chunk = cropLayer.append(positions, colors, labels);
        if (chunk && cache) {
          detailCaches.set(chunk, cache); pointOverrides.register(chunk, sourceIds!); pickVersion++;
        } else cache?.dispose();
      } catch (error) { cache?.dispose(); throw error; }
      material.transparent = true; material.opacity = 0.25;
    },
    frameBox() {
      if (!selectedBox) return;
      const previous = bounds; bounds = selectedBox; frameDataset(); bounds = previous;
    },
    viewCenter(): Vec3 { return controls.target.toArray() as [number, number, number]; },
    frameDataset,
    dispose() {
      adaptive?.dispose(); native.dispose(); scene.remove(native.group); nativeMaterial.dispose();
      flight.dispose(); visual.dispose(); areaOverlay.dispose();
      controls.removeEventListener('change', controlsChanged);
      disposed = true; clearDetail(); pickCache?.dispose(); pickCache = undefined; finishGesture();
      pointOverrides.dispose(); cad.dispose(); preprocessing.dispose();
      markerGeometry.dispose(); markerMaterial.dispose(); winnerGeometry.dispose(); winnerMaterial.dispose(); lineGeometry.dispose(); lineMaterial.dispose();
      for (const name of draftMarkers.keys()) removeDraftMarker(name);
      delete host.dataset.draftMarkers;
      renderer.domElement.removeEventListener('contextmenu', contextMenu, true);
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown, true); renderer.domElement.removeEventListener('pointermove', pointerMove, true);
      renderer.domElement.removeEventListener('pointerup', pointerUp, true); renderer.domElement.removeEventListener('pointercancel', cancelGesture, true);
      renderer.domElement.removeEventListener('lostpointercapture', cancelGesture, true); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      overlay.remove();
      points.geometry.dispose(); material.dispose();
      cropLayer.dispose(); selection.geometry.dispose(); selectionMaterials.forEach(value => value.dispose());
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
