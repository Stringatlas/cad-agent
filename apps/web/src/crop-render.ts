import * as THREE from 'three';
import { CROP_BATCH_POINTS } from '@spatial/contracts';

/** Progressive independent GPU chunks. Total is uncapped; only each allocation is bounded. */
export function createCropLayer(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  const material = new THREE.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false });
  let count = 0;
  return {
    group,
    get count() { return count; },
    append(positions: readonly number[], sourceColors: readonly number[]) {
      if (positions.length % 3 || positions.length > CROP_BATCH_POINTS * 3 || sourceColors.length !== positions.length) throw new Error('Invalid crop GPU chunk');
      if (!positions.length) return;
      const geometry = new THREE.BufferGeometry();
      try {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const colors = new Float32Array(sourceColors.length), color = new THREE.Color();
        for (let i = 0; i < colors.length; i += 3) {
          color.setRGB(sourceColors[i] / 255, sourceColors[i + 1] / 255, sourceColors[i + 2] / 255, THREE.SRGBColorSpace); color.toArray(colors, i);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeBoundingSphere();
        const points = new THREE.Points(geometry, material);
        group.add(points); count += positions.length / 3;
        return points;
      } catch (error) { geometry.dispose(); throw error; }
    },
    clear() { for (const child of [...group.children]) { (child as THREE.Points).geometry.dispose(); group.remove(child); } count = 0; },
    dispose() { this.clear(); material.dispose(); scene.remove(group); },
  };
}
