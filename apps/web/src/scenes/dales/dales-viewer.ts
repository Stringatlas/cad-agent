import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DALES_PALETTE, preparedPoint, type PreparedPoint, type PreparedSample } from './prepared-cloud-client';

/** Disposable sampled rendering. This viewer has no editing or product-agent authority. */
export function createDalesViewer(host: HTMLElement, sample: PreparedSample, onpick: (point: PreparedPoint | undefined) => void, onerror: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor('#151619');
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'DALES point cloud. Drag to orbit, scroll or pinch to zoom. Click a point to inspect its type. F fits the scene, Escape clears selection.');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  host.append(canvas);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = 0.2;
  controls.maxDistance = 5000;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
  const colors = new Float32Array(sample.count * 3);
  for (let i = 0; i < sample.count; i++) {
    const label = sample.labels?.[i], color = new THREE.Color();
    if (label !== undefined && DALES_PALETTE[label]) color.set(DALES_PALETTE[label]);
    else color.setRGB(sample.colors[i * 3] / 255, sample.colors[i * 3 + 1] / 255, sample.colors[i * 3 + 2] / 255, THREE.SRGBColorSpace);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geometry, material); scene.add(points);
  const markerGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const markerMaterial = new THREE.PointsMaterial({ color: '#ffffff', size: 10, sizeAttenuation: false, depthTest: false });
  const marker = new THREE.Points(markerGeometry, markerMaterial); marker.visible = false; marker.renderOrder = 2; scene.add(marker);
  let disposed = false;
  const render = () => { if (!disposed) renderer.render(scene, camera); };
  const bounds = sample.cloud.bounds, center = new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(0.5);
  const radius = Math.max(1, new THREE.Vector3(...bounds.max).distanceTo(new THREE.Vector3(...bounds.min)) / 2);
  function fit() {
    const angle = Math.min(THREE.MathUtils.degToRad(camera.fov) / 2, Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect));
    const distance = radius / Math.sin(angle) * 1.08;
    camera.position.copy(center).add(new THREE.Vector3(0.7, -1, 0.85).normalize().multiplyScalar(distance));
    camera.near = 0.1; camera.far = Math.max(10000, distance * 4); camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(5000, distance * 3); controls.target.copy(center); controls.update(); render();
  }
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
  };
  controls.addEventListener('change', render);
  const observer = new ResizeObserver(resize); observer.observe(host); resize(); fit();
  let down: { x: number; y: number; id: number } | undefined;
  const pointerDown = (event: PointerEvent) => { down = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined; };
  const pointerUp = (event: PointerEvent) => {
    const start = down; down = undefined;
    if (!start || event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.params.Points.threshold = Math.max(0.03, camera.position.distanceTo(controls.target) * 5 / Math.max(1, rect.height));
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = ray.intersectObject(points)[0];
    if (hit?.index === undefined) { marker.visible = false; onpick(undefined); }
    else { const point = preparedPoint(sample, hit.index); marker.position.fromArray(point.position); marker.visible = true; onpick(point); }
    render();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
    if (event.key === 'Escape') { marker.visible = false; onpick(undefined); render(); }
  };
  const cancel = () => { down = undefined; };
  const contextLost = (event: Event) => { event.preventDefault(); onerror(); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('keydown', key); canvas.addEventListener('webglcontextlost', contextLost);
  return { fit, dispose() {
    disposed = true; observer.disconnect(); controls.removeEventListener('change', render); controls.dispose();
    canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', contextLost);
    geometry.dispose(); material.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); renderer.dispose(); canvas.remove();
  } };
}
