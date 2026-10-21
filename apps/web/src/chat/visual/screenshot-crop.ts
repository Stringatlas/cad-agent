import { MODEL_VISUAL_LIMITS, canonicalModelVisualObservation, type ModelVisualObservation, type VisualObservation } from '@spatial/contracts';

export interface CropRect { x: number; y: number; width: number; height: number }
export const SCREENSHOT_JPEG_QUALITY = .78;
export const SCREENSHOT_LONG_EDGE = 1280;

/** All crop coordinates are ORIGINAL drawing-buffer pixels, never CSS pixels. */
export function clampCrop(rect: CropRect, width: number, height: number): CropRect {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !Object.values(rect).every(Number.isFinite)) throw new TypeError('Invalid crop dimensions');
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(rect.width))), height: Math.max(1, Math.min(height - y, Math.round(rect.height))) };
}
export function dragCrop(start: { x: number; y: number }, end: { x: number; y: number }, width: number, height: number): CropRect {
  const bound = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const ax = bound(start.x, width), ay = bound(start.y, height), bx = bound(end.x, width), by = bound(end.y, height);
  return clampCrop({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }, width, height);
}
export function cropOutputSize(width: number, height: number): { width: number; height: number } {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Invalid crop dimensions');
  const scale = Math.min(1, SCREENSHOT_LONG_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** PNG remains local. The callback gates preparation lifecycle/cancellation, NOT live view or geometry currency. */
export async function compressScreenshot(source: VisualObservation, rect: CropRect, isCurrent: () => boolean): Promise<ModelVisualObservation> {
  const check = () => { if (!isCurrent()) throw new Error('Screenshot preparation cancelled.'); };
  check();
  if (source.image.mimeType !== 'image/png' || source.image.byteLength > MODEL_VISUAL_LIMITS.sourcePngBytes) throw new Error('Source screenshot exceeds the 12 MiB capture limit.');
  const crop = clampCrop(rect, source.viewport.width, source.viewport.height), output = cropOutputSize(crop.width, crop.height);
  const image = new Image();
  const canvas = document.createElement('canvas'); canvas.width = output.width; canvas.height = output.height;
  try {
    image.src = source.image.dataUrl;
    await image.decode(); check();
    if (image.naturalWidth !== source.viewport.width || image.naturalHeight !== source.viewport.height) throw new Error('Source screenshot dimensions changed.');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image compression unavailable.');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image compression failed.')), 'image/jpeg', SCREENSHOT_JPEG_QUALITY));
    check();
    if (blob.type !== 'image/jpeg' || blob.size > MODEL_VISUAL_LIMITS.imageBytes) throw new Error('Compressed screenshot exceeds the 2 MiB attachment limit. Select a smaller crop.');
    const bytes = await blob.arrayBuffer(); check();
    const digest = await crypto.subtle.digest('SHA-256', bytes); check();
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Image encoding failed.')); reader.readAsDataURL(blob); });
    check();
    return canonicalModelVisualObservation({ ...source, image: { mimeType: 'image/jpeg', byteLength: blob.size, dataUrl, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') },
      sourceImage: { mimeType: source.image.mimeType, sha256: source.image.sha256, byteLength: source.image.byteLength }, crop: { ...crop, outputWidth: output.width, outputHeight: output.height } });
  } finally { canvas.width = 0; canvas.height = 0; image.src = ''; }
}
