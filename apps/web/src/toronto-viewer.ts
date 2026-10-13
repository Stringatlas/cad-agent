import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CropBox, CropSelection, PointObservation, Vec3 } from '@spatial/contracts';
import { createCropLayer } from './crop-render';
import { projectCropRectangle } from './crop-projection';

/** Disposable point projection; prepared dataset remains authoritative, not this render cache. */
export function createTorontoViewer(host: HTMLElement, onPick?: (center: Vec3) => void, onSelect?: (selection: CropSelection) => void, onFailure?: (error: string) => void) {
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
  const overlay = document.createElement('div'); overlay.className = 'selection-window';
  overlay.setAttribute('data-testid', 'selection-window'); overlay.hidden = true;
  Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', border: '2px solid #ffd65a', background: '#ffd65a22', zIndex: '3', boxSizing: 'border-box' });
  host.appendChild(overlay);
  let gpuFailed = false;
  const failGpu = (message: string) => { if (!gpuFailed) { gpuFailed = true; onFailure?.(message); } };
  const contextLost = (event: Event) => { event.preventDefault(); failGpu('GPU context lost — full resolution incomplete. Clear detail and reload the scene; no downsampling.'); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const selection = new THREE.Box3Helper(new THREE.Box3(), 0xffd65a); selection.visible = false;
  const selectionMaterials = Array.isArray(selection.material) ? selection.material : [selection.material];
  selectionMaterials.forEach(value => { value.depthTest = false; }); selection.renderOrder = 2; scene.add(selection);
  let selectedBox: CropBox | undefined;
  const raycaster = new THREE.Raycaster();
  let pointerStart: { x: number; y: number; id: number } | undefined;
  const pointerDown = (event: PointerEvent) => {
    if (!event.shiftKey || event.button !== 0 || pointerStart) return;
    // Capture phase precedes OrbitControls: a Shift gesture must never rotate/pan the camera.
    event.preventDefault(); event.stopImmediatePropagation(); controls.enabled = false;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    renderer.domElement.setPointerCapture(event.pointerId); overlay.hidden = false;
    pointerMove(event);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = renderer.domElement.getBoundingClientRect();
    const x = Math.max(rect.left, Math.min(rect.right, event.clientX)), y = Math.max(rect.top, Math.min(rect.bottom, event.clientY));
    Object.assign(overlay.style, { left: Math.min(pointerStart.x, x) - rect.left + 'px', top: Math.min(pointerStart.y, y) - rect.top + 'px',
      width: Math.abs(x - pointerStart.x) + 'px', height: Math.abs(y - pointerStart.y) + 'px' });
  };
  const finishGesture = () => {
    const id = pointerStart?.id; pointerStart = undefined; overlay.hidden = true; controls.enabled = true;
    if (id !== undefined && renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id);
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const start = pointerStart, rect = renderer.domElement.getBoundingClientRect(); finishGesture();
    const dx = Math.abs(event.clientX - start.x), dy = Math.abs(event.clientY - start.y);
    if (dx >= 4 && dy >= 4 && bounds) {
      onSelect?.(projectCropRectangle(camera, { left: start.x - rect.left, top: start.y - rect.top, right: event.clientX - rect.left, bottom: event.clientY - rect.top }, rect.width, rect.height, bounds));
      return;
    }
    // Tiny click places the existing AABB on a visible point. Thin accidental drags are ignored.
    if (Math.hypot(dx, dy) > 4) return;
    raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 6;
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...cropLayer.group.children, points])[0];
    if (hit && hit.index !== undefined) {
      const position = (hit.object as THREE.Points).geometry.getAttribute('position');
      onPick?.([position.getX(hit.index), position.getY(hit.index), position.getZ(hit.index)]);
    }
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown, true);
  renderer.domElement.addEventListener('pointermove', pointerMove, true);
  renderer.domElement.addEventListener('pointerup', pointerUp, true);
  renderer.domElement.addEventListener('pointercancel', finishGesture, true);
  renderer.domElement.addEventListener('lostpointercapture', finishGesture, true);
  let initialized = false;
  let bounds: PointObservation['dataset']['bounds'] | undefined;
  function frameDataset() {
    if (!bounds) return;
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
    if (!pointerStart) controls.update();
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
    update(sample: PointObservation) {
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
      const previous = points.geometry;
      points.geometry = geometry;
      previous.dispose();
      bounds = sample.dataset.bounds;
      if (!initialized) { initialized = true; frameDataset(); }
    },
    setBox(box?: CropBox) {
      selectedBox = box; selection.visible = !!box;
      if (box) { selection.box.min.set(...box.min); selection.box.max.set(...box.max); }
    },
    clearCrop() {
      cropLayer.clear(); material.transparent = false; material.opacity = 1;
    },
    appendCrop(positions: readonly number[], colors: readonly number[]) {
      if (gpuFailed) throw new Error('GPU unavailable; reload the scene before loading full resolution');
      cropLayer.append(positions, colors); material.transparent = true; material.opacity = 0.25;
    },
    frameBox() {
      if (!selectedBox) return;
      const previous = bounds; bounds = selectedBox; frameDataset(); bounds = previous;
    },
    viewCenter(): Vec3 { return controls.target.toArray() as [number, number, number]; },
    frameDataset,
    dispose() {
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
