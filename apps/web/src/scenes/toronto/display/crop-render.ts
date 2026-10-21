import * as THREE from 'three';
import { CROP_BATCH_POINTS } from '@spatial/contracts';
import { pointColors, type PointColorMode } from './point-colors';

/** Progressive independent GPU chunks. Total is uncapped; only each allocation is bounded. */
export function createCropLayer(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  const material = new THREE.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false });
  let count = 0, mode: PointColorMode = 'rgb';
  const sources = new Map<THREE.Points, { rgb: Uint8Array; labels?: Uint8Array }>();
  return {
    group,
    get count() { return count; },
    setColorMode(value: PointColorMode) {
      if (mode === value) return;
      mode = value;
      for (const [object, source] of sources) {
        const attribute = object.geometry.getAttribute('color') as THREE.BufferAttribute;
        (attribute.array as Float32Array).set(pointColors(source.rgb, source.labels, mode)); attribute.needsUpdate = true;
      }
    },
    append(positions: readonly number[], sourceColors: readonly number[], labels?: readonly number[]) {
      if (positions.length % 3 || positions.length > CROP_BATCH_POINTS * 3 || sourceColors.length !== positions.length) throw new Error('Invalid crop GPU chunk');
      if (labels && (labels.length !== positions.length / 3 || labels.some(label => !Number.isInteger(label) || label < 0 || label > 8))) throw new Error('Invalid crop labels');
      if (!positions.length) return;
      const geometry = new THREE.BufferGeometry();
      try {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const colors = pointColors(sourceColors, labels, mode);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeBoundingSphere();
        const points = new THREE.Points(geometry, material);
        sources.set(points, { rgb: Uint8Array.from(sourceColors), labels: labels ? Uint8Array.from(labels) : undefined });
        group.add(points); count += positions.length / 3;
        return points;
      } catch (error) { geometry.dispose(); throw error; }
    },
    clear() { for (const child of [...group.children]) { (child as THREE.Points).geometry.dispose(); group.remove(child); } sources.clear(); count = 0; },
    dispose() { this.clear(); material.dispose(); scene.remove(group); },
  };
}
