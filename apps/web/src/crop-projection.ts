import * as THREE from 'three';
import { assertCropSelection, type CropBox, type CropSelection, type CropPlane } from '@spatial/contracts';

export interface ScreenRectangle { left: number; top: number; right: number; bottom: number }
/** Freeze the rectangle's camera volume, NOT an axis-aligned approximation.
 * Perspective => truncated frustum; orthographic => prism. Clip near/far then dataset extent.
 * Screen values are relative CSS pixels of the canvas (not framebuffer/device pixels).
 */
export function projectCropRectangle(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, rectangle: ScreenRectangle,
  width: number, height: number, datasetBounds: CropBox): CropSelection {
  if (![width, height, ...Object.values(rectangle)].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError('Invalid selection viewport');
  const left = Math.max(0, Math.min(width, Math.min(rectangle.left, rectangle.right))) / width * 2 - 1;
  const right = Math.max(0, Math.min(width, Math.max(rectangle.left, rectangle.right))) / width * 2 - 1;
  const bottom = 1 - Math.max(0, Math.min(height, Math.max(rectangle.top, rectangle.bottom))) / height * 2;
  const top = 1 - Math.max(0, Math.min(height, Math.min(rectangle.top, rectangle.bottom))) / height * 2;
  if (left >= right || bottom >= top) throw new RangeError('Selection window has no area');
  camera.updateMatrixWorld();
  const cropClip = new THREE.Matrix4().set(2 / (right - left), 0, 0, -(right + left) / (right - left),
    0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom), 0, 0, 1, 0, 0, 0, 0, 1);
  const matrix = cropClip.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const selection: CropSelection = { min: [...datasetBounds.min], max: [...datasetBounds.max],
    planes: frustum.planes.map(p => [...p.normal.toArray(), p.constant] as unknown as CropPlane) };
  assertCropSelection(selection); return selection;
}
