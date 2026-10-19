import * as THREE from 'three';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';

export type PointColorMode = 'rgb' | 'type';
// Source-class colors, independent of derived clusters and pending-edit styling.
const hex = ['#9ca3af', '#b49a74', '#ffe45c', '#62c778', '#d899ef', '#f49a50', '#4cc9f0', '#fa718d', '#8b9bff'];
export const POINT_TYPE_KEY = Object.entries(TORONTO_SEMANTIC_LABELS).map(([label, name]) => ({
  label: Number(label), name: name.replaceAll('_', ' '), color: hex[Number(label)],
}));
export const UNKNOWN_POINT_COLOR = '#ffffff';
const palette = [...hex, UNKNOWN_POINT_COLOR].map(value => new THREE.Color(value).toArray());
export function pointTypeColor(label: unknown): readonly number[] {
  return palette[typeof label === 'number' && Number.isInteger(label) && label >= 0 && label <= 8 ? label : 9];
}
export function pointColors(rgb: ArrayLike<number>, labels: ArrayLike<number> | undefined, mode: PointColorMode): Float32Array {
  const result = new Float32Array(rgb.length), color = new THREE.Color();
  for (let i = 0; i < rgb.length; i += 3) {
    if (mode === 'type') result.set(pointTypeColor(labels?.[i / 3]), i);
    else { color.setRGB(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255, THREE.SRGBColorSpace); color.toArray(result, i); }
  }
  return result;
}
