import * as THREE from 'three';

export type CloudColorMode = 'rgb' | 'semantic' | 'instance';
export const UNASSIGNED_COLOR = '#8c919a';
export const UNKNOWN_COLOR = '#ffffff';
const hues = ['#b7a17c', '#dd8f85', '#a4ca75', '#68ad6d', '#3f8059', '#67bfe0',
  '#879cdb', '#b59adb', '#d0b4e2', '#e8c76b', '#eaa36e', '#f280a5', '#b8b9e4', '#99a6b4', '#dbab77',
  '#a8a29e', '#ffffff', '#91dbe3', '#96734d', '#c4d96b'];
export function semanticColor(id: number): string { return hues[((id % hues.length) + hues.length) % hues.length]; }
/** Stable scene-local instance identity; negative/unassigned IDs are neutral, never wrapped. */
export function instanceColor(id: number, unassigned = -100): string {
  if (!Number.isSafeInteger(id) || id === unassigned || id < 0) return UNASSIGNED_COLOR;
  let hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0;
  return new THREE.Color().setHSL((hash % 360) / 360, 0.58 + ((hash >>> 8) % 15) / 100, 0.55).getStyle();
}
/** Input photometric RGB is sRGB; output buffers are linear for Three.js. */
export function cloudColors(rgb: ArrayLike<number>, labels: ArrayLike<number> | undefined,
  instances: ArrayLike<number> | undefined, mode: CloudColorMode,
  classColor: (label: number | undefined) => readonly number[] = label => new THREE.Color(label === undefined ? UNKNOWN_COLOR : semanticColor(label)).toArray(),
  unassigned = -100): Float32Array {
  const colors = new Float32Array(rgb.length), color = new THREE.Color();
  const cached = new Map<number, readonly number[]>();
  for (let at = 0; at < rgb.length; at += 3) {
    const index = at / 3;
    if (mode === 'rgb') {
      color.setRGB(rgb[at] / 255, rgb[at + 1] / 255, rgb[at + 2] / 255, THREE.SRGBColorSpace);
      color.toArray(colors, at);
    } else if (mode === 'semantic') colors.set(classColor(labels?.[index]), at);
    else {
      const id = instances?.[index] ?? unassigned;
      let value = cached.get(id);
      if (!value) { value = new THREE.Color(instanceColor(id, unassigned)).toArray(); cached.set(id, value); }
      colors.set(value, at);
    }
  }
  return colors;
}
