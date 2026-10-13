import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ProjectState } from '@spatial/contracts';
import { createEntityObject, highlight, resolvePickedEntityId } from './entities';

export function createViewer(host: HTMLElement, initial: ProjectState, onSelect: (id: string | null) => void) {
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
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.12;
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
    onSelect(resolvePickedEntityId(state, raycaster.intersectObjects(objects, false)[0]?.object));
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
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
    controls.update();
    renderer.render(scene, camera);
    host.dataset.ready = 'true';
    if (smoke) {
      // Read-only diagnostics, enabled solely for smoke tests; never a state mutation API.
      const targets = state.entities.map(entity => {
        const point = new THREE.Vector3(...(entity.kind === 'box' ? entity.center : entity.points[0]!)).project(camera);
        return { id: entity.id, x: (point.x + 1) * host.clientWidth / 2, y: (1 - point.y) * host.clientHeight / 2 };
      });
      host.dataset.targets = JSON.stringify(targets);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.points = String(renderer.info.render.points);
      host.dataset.triangles = String(renderer.info.render.triangles);
    }
  }
  animate();
  return {
    updateSelection(next: ProjectState) {
      state = next;
      objects.forEach(object => highlight(object, object.userData.entityId === next.selectedEntityId));
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
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
