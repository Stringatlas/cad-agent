import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SCENE_POINT_LIMIT, type ScenePointName, type CropBox, type CropSelection, type PointObservation, type DatasetInfo, type Vec3, type PointOverrideSnapshot, type PointMoveProposal } from '@spatial/contracts';
import { createVisualCapture } from './visual-capture';
import { updateStableOrbitControls } from './orbit-stability';
import { createCropLayer } from './crop-render';
import { createPointOverrideRender } from './point-override-render';
import { projectCropRectangle } from './crop-projection';
import { createPolePickCache, createDetailPickCache, poleGestureKind, isPoleClick, type PoleSelection } from './pole-picking';

/** Disposable point projection; prepared dataset remains authoritative, not this render cache. */
export function createTorontoViewer(host: HTMLElement, onPick?: (center: Vec3) => void, onSelect?: (selection: CropSelection) => void, onFailure?: (error: string) => void, onQuery?: (selection: PoleSelection) => void) {
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
  const pointOverrides = createPointOverrideRender(scene);
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
  let selectedBox: CropBox | undefined;
  const raycaster = new THREE.Raycaster();
  let pickCache: ReturnType<typeof createPolePickCache> | undefined;
  const detailCaches = new Map<THREE.Object3D, ReturnType<typeof createDetailPickCache>>();
  let pickVersion = 0, dataset: DatasetInfo | undefined;
  let overview: { count: number; sampleHash: string; lod: PointObservation['lod']; algorithm: string; candidatePoints: number } | undefined;
  let detailState = 'idle';
  const clearDetail = () => { visual.invalidate(); detailState = 'idle'; pickVersion++; for (const [object, cache] of detailCaches) { pointOverrides.unregister(object as THREE.Points); cache.dispose(); } detailCaches.clear(); cropLayer.clear(); material.transparent = false; material.opacity = 1; };
  let disposed = false;
  const visual = createVisualCapture({
    renderer, scene, camera,
    available: () => !disposed && !gpuFailed && !!dataset && !!overview,
    binding: () => {
      if (!dataset) throw new Error('Toronto dataset unavailable');
      return { sourceId: dataset.id, sourceRevision: dataset.revision, frameId: 'toronto3d-local-v1', units: dataset.coordinates.units,
        origin: dataset.coordinates.localOrigin, upAxis: dataset.coordinates.upAxis, handedness: dataset.coordinates.handedness };
    },
    coverage: () => ({ kind: 'sampled-overview-with-partial-dataset-detail', complete: false,
      displayedPointCount: (overview?.count ?? 0) + cropLayer.count,
      datasetPointCount: dataset?.totalPoints ?? 0,
      overview: overview ? { displayedPointCount: overview.count, sampleHash: overview.sampleHash, lod: { budget: overview.lod.budget, depth: overview.lod.depth },
        algorithm: overview.algorithm, candidatePoints: overview.candidatePoints, opacity: material.opacity } : null,
      detail: { displayedPointCount: cropLayer.count, chunkCount: cropLayer.group.children.length, state: detailState },
      scope: 'Displayed sampled overview and retained detail only; never whole-dataset evidence' }),
    points: () => [points, ...cropLayer.group.children],
    resolve: (object, index) => {
      const original = (object === points ? pickCache : detailCaches.get(object))?.resolve(index);
      if (!original || !dataset || original.artifactRevision !== dataset.revision) return;
      return { datasetId: original.datasetId, artifactRevision: original.artifactRevision,
        key: { sourceFileId: original.key.sourceFileId, sourceRow: original.key.sourceRow }, position: original.position,
        frameId: 'toronto3d-local-v1', units: dataset.coordinates.units, origin: dataset.coordinates.localOrigin,
        layer: object === points ? 'overview' : 'detail' };
    },
  });
  const controlsChanged = () => visual.invalidate();
  controls.addEventListener('change', controlsChanged);
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
  const draftMarkers = new Map<ScenePointName, { sprite: THREE.Sprite; texture: THREE.CanvasTexture; material: THREE.SpriteMaterial; artifactRevision: string }>();
  const removeDraftMarker = (name: ScenePointName) => {
    const marker = draftMarkers.get(name);
    if (!marker) return;
    scene.remove(marker.sprite); marker.material.dispose(); marker.texture.dispose(); draftMarkers.delete(name);
  };
  const createDraftMarker = (name: ScenePointName, artifactRevision: string) => {
    // Numeric suffix only; full names/provenance remain in the attachment list.
    // Fit even a safe-integer suffix, with at most 512 × 64 texels per marker.
    const label = name.slice('Point '.length);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = 'bold 34px system-ui';
    canvas.width = Math.min(512, Math.max(64, Math.ceil(context.measureText(label).width) + 28)); canvas.height = 64;
    context.beginPath(); context.roundRect(4, 5, canvas.width - 8, 54, 25);
    context.fillStyle = '#8be6d4'; context.fill();
    context.strokeStyle = '#ffffff'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#102b2e'; context.font = 'bold 34px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, 33, canvas.width - 28);
    const texture = new THREE.CanvasTexture(canvas); texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(material); sprite.scale.set(.035 * canvas.width / 64, .035, 1); sprite.renderOrder = 6; scene.add(sprite);
    return { sprite, texture, material, artifactRevision };
  };
  let pointerStart: { x: number; y: number; id: number; kind: 'shift' | 'query'; travel: number; cache: typeof pickCache; version: number } | undefined;
  const pointerDown = (event: PointerEvent) => {
    const kind = poleGestureKind(event, !!onQuery);
    if (!kind || pointerStart || disposed || gpuFailed) return;
    // Capture phase precedes OrbitControls: a Shift gesture must never rotate/pan the camera.
    event.preventDefault(); event.stopImmediatePropagation(); controls.enabled = false;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, kind, travel: 0, cache: pickCache, version: pickVersion };
    visual.invalidate();
    renderer.domElement.setPointerCapture(event.pointerId); overlay.hidden = kind !== 'shift';
    pointerMove(event);
  };
  const pointerMove = (event: PointerEvent) => {
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
  const pointerUp = (event: PointerEvent) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const start = pointerStart, rect = renderer.domElement.getBoundingClientRect(); finishGesture();
    const dx = Math.abs(event.clientX - start.x), dy = Math.abs(event.clientY - start.y);
    if (start.kind === 'query') {
      if (!isPoleClick(Math.max(start.travel, Math.hypot(dx, dy)), false, start.cache === pickCache && start.version === pickVersion) || disposed || gpuFailed) return;
      raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 6;
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      // Detail is the active picking layer; overview is context/fallback only.
      const hit = raycaster.intersectObjects([...detailCaches.keys()])[0] ?? raycaster.intersectObject(pointOverrides.fallback)[0] ?? raycaster.intersectObject(points)[0];
      const cache = hit?.object === points ? start.cache : detailCaches.get(hit?.object);
      const resolved = hit?.index === undefined ? undefined : hit.object === pointOverrides.fallback ? pointOverrides.resolveFallback(hit.index) : cache?.resolve(hit.index);
      if (resolved) onQuery?.(resolved);
      return;
    }
    if (dx >= 4 && dy >= 4 && bounds) {
      onSelect?.(projectCropRectangle(camera, { left: start.x - rect.left, top: start.y - rect.top, right: event.clientX - rect.left, bottom: event.clientY - rect.top }, rect.width, rect.height, bounds));
      return;
    }
    // Tiny click places the existing AABB on a visible point. Thin accidental drags are ignored.
    if (Math.hypot(dx, dy) > 4) return;
    raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 6;
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...cropLayer.group.children, pointOverrides.fallback, points])[0];
    if (hit && hit.index !== undefined) {
      const original = hit.object === pointOverrides.fallback ? pointOverrides.resolveFallback(hit.index) :
        (hit.object === points ? pickCache : detailCaches.get(hit.object))?.resolve(hit.index);
      if (original) onPick?.(original.position);
    }
  };
  const contextMenu = (event: MouseEvent) => { if (onQuery && (event.ctrlKey || event.metaKey || pointerStart?.kind === 'query')) { event.preventDefault(); event.stopImmediatePropagation(); } };
  renderer.domElement.addEventListener('contextmenu', contextMenu, true);
  renderer.domElement.addEventListener('pointerdown', pointerDown, true);
  renderer.domElement.addEventListener('pointermove', pointerMove, true);
  renderer.domElement.addEventListener('pointerup', pointerUp, true);
  renderer.domElement.addEventListener('pointercancel', finishGesture, true);
  renderer.domElement.addEventListener('lostpointercapture', finishGesture, true);
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
  const resize = new ResizeObserver(() => {
    visual.invalidate();
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  let frame = 0;
  const smoke = new URLSearchParams(location.search).has('smoke');
  function animate() {
    frame = requestAnimationFrame(animate);
    if (!pointerStart) updateStableOrbitControls(camera, controls);
    if (!gpuFailed) {
      try {
        renderer.render(scene, camera);
        const gl = renderer.getContext(), error = gl.getError();
        if (error !== gl.NO_ERROR) failGpu(`GPU rendering failed (${error === gl.OUT_OF_MEMORY ? 'out of memory' : error}); full resolution incomplete. Clear detail and reload the scene; no downsampling.`);
      } catch (error) { failGpu(`Rendering/resource failure: ${String(error)}. Full resolution incomplete; reload the scene.`); }
    }
    host.dataset.ready = String(!gpuFailed);
    host.dataset.points = String(renderer.info.render.points);
    host.dataset.cropPoints = String(cropLayer.count);
    host.dataset.cropChunks = String(cropLayer.group.children.length);
    host.dataset.boxVisible = String(selection.visible);
    if (smoke) {
      host.dataset.draftMarkers = JSON.stringify([...draftMarkers].map(([name, marker]) => ({ name, position: marker.sprite.position.toArray() })));
      const detail = detailCaches.keys().next().value as THREE.Points | undefined;
      const detailPositions = detail?.geometry.getAttribute('position');
      if (detailPositions?.count) {
        const point = new THREE.Vector3().fromBufferAttribute(detailPositions, 0).project(camera);
        host.dataset.detailPickPoint = JSON.stringify([(point.x + 1) * host.clientWidth / 2, (1 - point.y) * host.clientHeight / 2]);
      } else delete host.dataset.detailPickPoint;
      host.dataset.querySelected = String(!!queryPositions);
      host.dataset.queryWinner = String(!!queryPositions?.nearest);
      host.dataset.camera = JSON.stringify(camera.position.toArray());
      const positions = points.geometry.getAttribute('position');
      if (positions?.count) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, 0).project(camera);
        host.dataset.pickPoint = JSON.stringify([(point.x + 1) * host.clientWidth / 2, (1 - point.y) * host.clientHeight / 2]);
      }
    }
  }
  animate();
  return {
    capture: () => {
      if (pointOverrides.captureBlocked) throw new Error('Scene screenshot capture is unavailable while point overrides or a move preview are active. Undo all point edits and clear the preview before capturing source-grounded imagery.');
      // Finish residual damping before freezing the view; it otherwise moves after the click.
      const damping = controls.enableDamping;
      controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
      return visual.capture();
    },
    isCaptureCurrent: visual.isCurrent,
    resolvePixel: visual.resolvePixel,
    setPointOverrides(snapshot?: PointOverrideSnapshot) {
      if (disposed) return;
      visual.invalidate(); pickVersion++;
      pointOverrides.setPointOverrides(snapshot);
    },
    setPointMovePreview(proposal?: PointMoveProposal) {
      if (disposed) return;
      visual.invalidate(); pickVersion++;
      pointOverrides.setPointMovePreview(proposal);
    },
    setDetailState(state: string) {
      if (disposed || detailState === state) return;
      detailState = state; visual.invalidate();
    },
    update(sample: PointObservation) {
      if (disposed) return;
      visual.invalidate();
      const nextCache = createPolePickCache(sample);
      if (sample.count > 100_000 || sample.positions.length !== sample.count * 3) throw new Error('Display point limit exceeded');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
      // Source colors are sRGB; Three vertex colors are linear.
      const colors = new Float32Array(sample.colors.length);
      const color = new THREE.Color();
      for (let i = 0; i < colors.length; i += 3) {
        color.setRGB(sample.colors[i] / 255, sample.colors[i + 1] / 255, sample.colors[i + 2] / 255, THREE.SRGBColorSpace);
        color.toArray(colors, i);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      pointOverrides.unregister(points);
      const previous = points.geometry;
      points.geometry = geometry;
      previous.dispose();
      if (dataset && dataset.revision !== sample.dataset.revision) clearDetail();
      dataset = sample.dataset; pickVersion++;
      pointOverrides.setArtifactRevision(dataset.revision);
      pointOverrides.register(points, sample.sourceIds);
      overview = { count: sample.count, sampleHash: sample.sampleHash, lod: { ...sample.lod }, algorithm: sample.algorithm, candidatePoints: sample.candidatePoints };
      for (const [name, marker] of draftMarkers) { if (marker.artifactRevision !== dataset.revision) removeDraftMarker(name); }
      pickCache?.dispose(); pickCache = nextCache;
      bounds = sample.dataset.bounds;
      if (!initialized) { initialized = true; frameDataset(); }
    },
    setDraftMarkers(references: readonly { name: ScenePointName; position: Vec3; artifactRevision: string }[]) {
      if (disposed) return;
      const signature = JSON.stringify(references);
      // Explicit clear/replacement also invalidates an in-flight pin gesture.
      if (signature !== draftMarkerSignature) { visual.invalidate(); draftMarkerSignature = signature; pickVersion++; }
      const active = new Map(references.filter(value => value.artifactRevision === dataset?.revision).slice(0, SCENE_POINT_LIMIT).map(value => [value.name, value]));
      for (const [name, marker] of draftMarkers) {
        if (!active.has(name) || active.get(name)!.artifactRevision !== marker.artifactRevision) removeDraftMarker(name);
      }
      for (const [name, reference] of active) {
        const marker = draftMarkers.get(name) ?? createDraftMarker(name, reference.artifactRevision);
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
    appendCrop(positions: readonly number[], colors: readonly number[], sourceIds?: readonly number[], revision?: string) {
      if (disposed || gpuFailed) throw new Error('GPU unavailable; reload the scene before loading full resolution');
      visual.invalidate(); detailState = 'loading';
      let cache: ReturnType<typeof createDetailPickCache> | undefined;
      if (dataset && revision === dataset.revision && sourceIds) {
        cache = createDetailPickCache(dataset, positions, sourceIds);
      } else if (onQuery) throw new Error('Missing or stale detail provenance');
      try {
        const chunk = cropLayer.append(positions, colors);
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
      visual.dispose();
      controls.removeEventListener('change', controlsChanged);
      disposed = true; clearDetail(); pickCache?.dispose(); pickCache = undefined; finishGesture();
      pointOverrides.dispose();
      markerGeometry.dispose(); markerMaterial.dispose(); winnerGeometry.dispose(); winnerMaterial.dispose(); lineGeometry.dispose(); lineMaterial.dispose();
      for (const name of draftMarkers.keys()) removeDraftMarker(name);
      delete host.dataset.draftMarkers;
      renderer.domElement.removeEventListener('contextmenu', contextMenu, true);
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown, true); renderer.domElement.removeEventListener('pointermove', pointerMove, true);
      renderer.domElement.removeEventListener('pointerup', pointerUp, true); renderer.domElement.removeEventListener('pointercancel', finishGesture, true);
      renderer.domElement.removeEventListener('lostpointercapture', finishGesture, true); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      overlay.remove();
      points.geometry.dispose(); material.dispose();
      cropLayer.dispose(); selection.geometry.dispose(); selectionMaterials.forEach(value => value.dispose());
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
