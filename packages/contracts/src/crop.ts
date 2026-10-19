import type { DatasetInfo, Vec3 } from './index';

/** Inclusive local-meter bounds; display selection, never harness/project geometry. */
export interface CropBox { readonly min: Vec3; readonly max: Vec3 }
export function assertCropBox(value: CropBox): void {
  if (!value || ![value.min, value.max].every(v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) < 1e7)) ||
      value.min.some((n, i) => n >= value.max[i])) throw new RangeError('Expected finite local-meter box bounds with min < max');
}
/** Inward unit normal: nx*x + ny*y + nz*z + constant >= 0. */
export type CropPlane = readonly [number, number, number, number];
/** Six camera-frustum/prism planes intersected with dataset extent; absent planes means AABB. */
export interface CropSelection extends CropBox { readonly planes?: readonly CropPlane[] }
export const CROP_BATCH_POINTS = 8192;
export const CROP_LINE_BYTES = 2 * 1024 * 1024;
export const CROP_PLANE_EPSILON = 1e-9;
export function assertCropSelection(value: CropSelection): void {
  assertCropBox(value);
  if (value.planes !== undefined && (!Array.isArray(value.planes) || value.planes.length !== 6 || value.planes.some(p =>
    !Array.isArray(p) || p.length !== 4 || !p.every(n => Number.isFinite(n) && Math.abs(n) < 1e7) || Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) > 1e-6))) throw new RangeError('Expected six finite inward unit planes');
}
export function containsCropPoint(selection: CropSelection, point: readonly number[]): boolean {
  return point.every((v, i) => v >= selection.min[i] && v <= selection.max[i]) &&
    (!selection.planes || selection.planes.every(p => p[0] * point[0] + p[1] * point[1] + p[2] * point[2] + p[3] >= -CROP_PLANE_EPSILON));
}
/** Conservative AABB support-vertex test, including quantization expansion. */
export function intersectsCropNode(selection: CropSelection, node: CropBox, scale: Vec3): boolean {
  if (!node.min.every((v, i) => v - scale[i] <= selection.max[i] && node.max[i] + scale[i] >= selection.min[i])) return false;
  return !selection.planes || selection.planes.every(p => p[3] + [0, 1, 2].reduce((sum, i) =>
    sum + p[i] * (p[i] >= 0 ? node.max[i] + scale[i] : node.min[i] - scale[i]), 0) >= -CROP_PLANE_EPSILON);
}
export interface CropStats {
  readonly count: number; readonly bytesRead: number; readonly scannedPoints: number;
  readonly hierarchyRecords: number; readonly hierarchyChunks: number; readonly payloadNodes: number; readonly maxDepth: number;
}
export type CropEvent =
  | { readonly type: 'start'; readonly dataset: DatasetInfo; readonly selection: CropSelection; readonly algorithm: 'potree-inclusive-volume-v2'; readonly purpose: 'display-crop' }
  | { readonly type: 'batch'; readonly sequence: number;
      /** Original decoded binary64 local-meter XYZ, never GPU Float32 positions. */
      readonly positions: readonly number[]; readonly colors: readonly number[];
      /** Flat (sourceFileId 1..4, uint32 sourceRow) pairs aligned with XYZ. Optional only for legacy synthetic streams. */
      readonly sourceIds?: readonly number[];
      /** Source semantic type 0..8 per point, aligned with XYZ. Absent in legacy synthetic streams. */
      readonly labels?: readonly number[]; readonly stats: CropStats }
  | { readonly type: 'end'; readonly complete: true; readonly stats: CropStats; readonly sampleHash: string }
  | { readonly type: 'error'; readonly error: string };
