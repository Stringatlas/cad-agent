import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Dataset-neutral render resources. Geometry and authoritative scene state live elsewhere. */
export function createPointCloudViewport(host: HTMLElement, options: {
  label: string; background?: number; fov?: number; damping?: boolean; minDistance?: number;
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? 0x101927);
  const camera = new THREE.PerspectiveCamera(options.fov ?? 45, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('aria-label', options.label);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = options.damping ?? true;
  controls.zoomToCursor = true;
  controls.maxDistance = 5000;
  controls.minDistance = options.minDistance ?? 1;
  return { scene, camera, renderer, controls, dispose() {
    controls.dispose(); renderer.dispose(); renderer.domElement.remove();
  } };
}
