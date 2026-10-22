import * as THREE from 'three';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { cloudColors } from '../../../viewer/cloud-colors';

export type PointColorMode = 'rgb' | 'type' | 'semantic' | 'instance';
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
  return cloudColors(rgb, labels, undefined, mode === 'type' ? 'semantic' : mode, pointTypeColor);
}
