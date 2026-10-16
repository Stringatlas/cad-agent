import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ProjectState, ScenePointReference, BoxProposal } from '@spatial/contracts';
import { createEntityObject, highlight, resolvePickedEntityId } from './entities';
import { createVisualCapture } from './visual-capture';
import { updateStableOrbitControls } from './orbit-stability';

export function createViewer(host: HTMLElement, initial: ProjectState, onSelect: (id: string | null) => void,
  onPoint?: (point: Omit<ScenePointReference, 'name'>) => void, onRenderError?: (cause: unknown) => void,
  onRenderRecovered?: () => void, binding?: { sessionId: string; frameId: string }) {
  let state = initial;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101927);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(6, -8, 6);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', 'Point cloud and proposed box, interactive 3D scene');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.4);
  controls.enableDamping = true;
  controls.update();
  const grid = new THREE.GridHelper(8, 16, 0x475773, 0x28384c);
  grid.rotation.x = Math.PI / 2; // Three grid is XZ; project ground is XY.
  grid.position.z = -0.05;
  const axes = new THREE.AxesHelper(2.5);
  axes.setColors(0xff6666, 0x66dd88, 0x7799ff);
  scene.add(grid, axes);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x59637d, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, -4, 8);
  scene.add(light);
  const objects = initial.entities.map(createEntityObject);
  scene.add(...objects);
  const overlays = new THREE.Group(); scene.add(overlays);
  function clearOverlays() {
    for (const object of [...overlays.children]) {
      overlays.remove(object);
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { object.geometry.dispose(); object.material.dispose(); }
      if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
    }
  }
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.12;
  const visual = createVisualCapture({ renderer, scene, camera,
    binding: () => ({ sourceId: binding?.sessionId ?? 'synthetic-preview', sourceRevision: state.revision,
      frameId: binding?.frameId ?? 'synthetic-local', units: 'm', origin: state.coordinates.localOrigin }),
    coverage: () => ({ kind: 'synthetic-project-display', complete: true,
      displayedPointCount: state.entities.reduce((n, entity) => n + (entity.kind === 'point-cloud' ? entity.points.length : 0), 0),
      wholeDatasetCoverage: false, geometry: 'mesh-proposal-not-CAD', overlays: overlays.children.length }),
    points: () => objects,
    resolve: (object, index) => {
      const id = resolvePickedEntityId(state, object), entity = state.entities.find(entity => entity.id === id);
      const position = entity?.kind === 'point-cloud' ? entity.points[index] : undefined;
      return position ? { entityId: id!, pointIndex: index, position, geometryRevision: state.revision,
        sessionId: binding?.sessionId ?? 'synthetic-preview', frameId: binding?.frameId ?? 'synthetic-local', units: 'm' } : undefined;
    },
    available: () => !disposed && !contextLost && !renderUnavailable && host.dataset.ready === 'true',
  });
  const viewChanged = () => visual.invalidate();
  controls.addEventListener('change', viewChanged);
  let down: [number, number] | null = null;
  const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
  const pointerUp = (event: PointerEvent) => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    ), camera);
    if (event.ctrlKey || event.metaKey) {
      const hit = raycaster.intersectObjects(objects.filter(object => object instanceof THREE.Points), false)[0];
      const id = resolvePickedEntityId(state, hit?.object), entity = state.entities.find(e => e.id === id);
      // Raycaster's index addresses the original ordered cloud. Never read float32 GPU coordinates.
      if (entity?.kind === 'point-cloud' && hit?.index !== undefined && entity.points[hit.index])
        onPoint?.({ entityId: entity.id, pointIndex: hit.index, position: entity.points[hit.index]! });
    } else onSelect(resolvePickedEntityId(state, raycaster.intersectObjects(objects, false)[0]?.object));
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    visual.invalidate();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  let frame = 0, contextLost = false, disposed = false, renderUnavailable = false;
  host.dataset.ready = 'false';
  function reportRenderError(cause: unknown) {
    visual.invalidate();
    cancelAnimationFrame(frame); renderUnavailable = true; host.dataset.ready = 'false';
    host.dataset.renderError = String(cause); onRenderError?.(cause);
  }
  const contextLostListener = (event: Event) => {
    // Allow browser restoration. Three's own listener rebuilds GPU caches, never project authority.
    event.preventDefault(); contextLost = true;
    reportRenderError(new Error('WebGL context lost. Waiting for restoration; project authority is unchanged.'));
  };
  const contextRestoredListener = () => {
    if (disposed) return;
    contextLost = false; cancelAnimationFrame(frame); animate();
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLostListener);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestoredListener);
  const smoke = new URLSearchParams(location.search).has('smoke');
  function animate() {
    if (disposed || contextLost) return;
    frame = requestAnimationFrame(animate);
    updateStableOrbitControls(camera, controls);
    try {
      renderer.render(scene, camera); host.dataset.ready = 'true';
      if (renderUnavailable) { renderUnavailable = false; delete host.dataset.renderError; onRenderRecovered?.(); }
    }
    catch (cause) { reportRenderError(cause); return; }
    if (smoke) {
      // Read-only diagnostics, enabled solely for smoke tests; never a state mutation API.
      const targets = state.entities.map(entity => {
        const point = new THREE.Vector3(...(entity.kind === 'box' ? entity.center : entity.points[0]!)).project(camera);
        return { id: entity.id, x: (point.x + 1) * host.clientWidth / 2, y: (1 - point.y) * host.clientHeight / 2 };
      });
      host.dataset.targets = JSON.stringify(targets);
      host.dataset.pointTargets = JSON.stringify(state.entities.flatMap(entity => entity.kind === 'point-cloud' ? entity.points.slice(0, 8).map((position, pointIndex) => {
        const point = new THREE.Vector3(...position).project(camera);
        return { entityId: entity.id, pointIndex, position, x: (point.x + 1) * host.clientWidth / 2, y: (1 - point.y) * host.clientHeight / 2 };
      }) : []));
      host.dataset.preview = String(overlays.children.some(o => o.userData.preview));
      host.dataset.markerPositions = JSON.stringify(overlays.children.filter(o => o.userData.pointName).map(o => ({ name: o.userData.pointName, position: o.position.toArray() })));
      host.dataset.revision = String(state.revision);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.points = String(renderer.info.render.points);
      host.dataset.triangles = String(renderer.info.render.triangles);
    }
  }
  animate();
  return {
    capture: () => {
      // Finish residual damping before freezing the view; it otherwise moves after the click.
      const damping = controls.enableDamping;
      controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
      return visual.capture();
    },
    isCaptureCurrent: (id: string) => visual.isCurrent(id),
    resolvePixel: (id: string, x: number, y: number) => visual.resolvePixel(id, x, y),
    updateSelection(next: ProjectState) {
      visual.invalidate(); state = next;
      objects.forEach(object => highlight(object, object.userData.entityId === next.selectedEntityId));
    },
    updateOverlays(points: readonly ScenePointReference[], proposal?: BoxProposal) {
      visual.invalidate(); clearOverlays();
      for (const point of points) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc766, depthTest: false }));
        marker.position.set(...point.position); marker.userData.pointName = point.name; marker.renderOrder = 10; overlays.add(marker);
        const canvas = document.createElement('canvas'), number = point.name.slice('Point '.length);
        const context = canvas.getContext('2d');
        if (context) {
          // Size from measured text so even large monotonic point numbers cannot clip.
          context.font = 'bold 48px sans-serif';
          canvas.width = Math.ceil(context.measureText(number).width) + 24; canvas.height = 72;
          context.fillStyle = '#ffc766'; context.font = 'bold 48px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
          context.fillText(number, canvas.width / 2, canvas.height / 2);
          const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
          label.position.set(point.position[0], point.position[1], point.position[2] + 0.3);
          label.scale.set(0.45 * canvas.width / canvas.height, 0.45, 1); label.renderOrder = 11; overlays.add(label);
        }
      }
      if (proposal) {
        const geometry = new THREE.BoxGeometry(...proposal.after.dimensions), edges = new THREE.EdgesGeometry(geometry); geometry.dispose();
        const preview = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffc766, depthTest: false }));
        preview.position.set(...proposal.after.center); preview.userData.preview = true; preview.renderOrder = 5; overlays.add(preview);
      }
    },
    dispose() {
      visual.dispose(); controls.removeEventListener('change', viewChanged);
      disposed = true; host.dataset.ready = 'false';
      cancelAnimationFrame(frame); clearOverlays();
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLostListener);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestoredListener);
      controls.dispose();
      for (const object of objects) { object.geometry.dispose(); object.material.dispose(); }
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose());
      scene.traverse(object => {
        if (object instanceof THREE.AxesHelper) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
