import { assertVec3 } from './index';
import { canonicalProtocolJson, protocolHash, protocolInteger, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';
import type { VisualObservation, VisualPixelResolution } from './visual-observation';
import { canonicalAgentViewReceipt } from './agent-view';

/** Model transport may crop/resample the source capture; viewport and camera always describe the ORIGINAL capture. */
export interface ModelVisualObservation extends Omit<VisualObservation, 'image'> {
  readonly image: { readonly mimeType: 'image/png' | 'image/jpeg'; readonly dataUrl: string; readonly sha256: string; readonly byteLength: number };
  readonly sourceImage?: { readonly mimeType: 'image/png'; readonly sha256: string; readonly byteLength: number };
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly outputWidth: number; readonly outputHeight: number };
}
export function modelVisualImageSize(visual: ModelVisualObservation): { width: number; height: number } {
  return visual.crop ? { width: visual.crop.outputWidth, height: visual.crop.outputHeight } : { width: visual.viewport.width, height: visual.viewport.height };
}
/** Pixel-center nearest source sample. Coordinates in tool calls/results refer to the SENT image. */
export function modelVisualSourcePixel(visual: ModelVisualObservation, x: number, y: number): { x: number; y: number } {
  const size = modelVisualImageSize(visual);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= size.width || y >= size.height) throw new TypeError('Invalid transmitted image pixel');
  const c = visual.crop;
  return c ? { x: Math.min(c.x + c.width - 1, Math.max(c.x, Math.floor(c.x + (x + .5) * c.width / c.outputWidth))),
    y: Math.min(c.y + c.height - 1, Math.max(c.y, Math.floor(c.y + (y + .5) * c.height / c.outputHeight))) } : { x, y };
}
export const MODEL_VISUAL_LIMITS = Object.freeze({ imageBytes: 2 * 1024 * 1024, pngBytes: 2 * 1024 * 1024, sourcePngBytes: 12 * 1024 * 1024, maxDimension: 4096, jpegMemoryMiB: 128, requestBytes: 3 * 1024 * 1024,
  metadataBytes: 32768, resultBytes: 16384, toolDeadlineMs: 15000 });
export interface ModelVisualToolResult {
  readonly requestId: string; readonly toolCallId: string; readonly nonce: string; readonly observationId: string;
  readonly result: VisualPixelResolution;
}
export function canonicalModelVisualObservation(value: unknown): ModelVisualObservation {
  const r = protocolRecord(value); protocolKeys(r, ['schemaVersion', 'observationId', 'viewGeneration', 'image', 'viewport', 'camera', 'binding', 'coverage'], ['crop', 'sourceImage']);
  if (r.schemaVersion !== 1) throw new TypeError('Invalid visual schema');
  protocolToken(r.observationId); protocolInteger(r.viewGeneration, Number.MAX_SAFE_INTEGER);
  const image = protocolRecord(r.image); protocolKeys(image, ['mimeType', 'dataUrl', 'sha256', 'byteLength']);
  protocolHash(image.sha256); protocolInteger(image.byteLength, MODEL_VISUAL_LIMITS.pngBytes);
  if (!['image/png', 'image/jpeg'].includes(String(image.mimeType)) || image.byteLength < 1 || typeof image.dataUrl !== 'string' ||
    image.dataUrl.length > Math.ceil(MODEL_VISUAL_LIMITS.imageBytes / 3) * 4 + 23 ||
    !image.dataUrl.startsWith(`data:${image.mimeType};base64,`) ||
    !/^data:image\/(?:png|jpeg);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.dataUrl)) throw new TypeError('Invalid visual image');
  const viewport = protocolRecord(r.viewport); protocolKeys(viewport, ['width', 'height', 'pixelRatio', 'pixelOrigin']);
  protocolInteger(viewport.width, 4096); protocolInteger(viewport.height, 4096);
  if (viewport.width < 1 || viewport.height < 1 || typeof viewport.pixelRatio !== 'number' || !Number.isFinite(viewport.pixelRatio) || viewport.pixelRatio <= 0 || viewport.pixelRatio > 16 || viewport.pixelOrigin !== 'top-left') throw new TypeError('Invalid viewport');
  if (image.mimeType === 'image/jpeg' && r.sourceImage === undefined) throw new TypeError('JPEG requires original source image metadata');
  if (r.sourceImage !== undefined) {
    const source = protocolRecord(r.sourceImage); protocolKeys(source, ['mimeType', 'sha256', 'byteLength']);
    protocolHash(source.sha256); protocolInteger(source.byteLength, MODEL_VISUAL_LIMITS.sourcePngBytes);
    if (source.mimeType !== 'image/png' || source.byteLength < 1) throw new TypeError('Invalid source image metadata');
  }
  if (r.crop !== undefined) {
    const c = protocolRecord(r.crop); protocolKeys(c, ['x', 'y', 'width', 'height', 'outputWidth', 'outputHeight']);
    for (const key of ['x', 'y', 'width', 'height', 'outputWidth', 'outputHeight']) protocolInteger(c[key], MODEL_VISUAL_LIMITS.maxDimension);
    if ((c.width as number) < 1 || (c.height as number) < 1 || (c.outputWidth as number) < 1 || (c.outputHeight as number) < 1 ||
      (c.x as number) + (c.width as number) > (viewport.width as number) || (c.y as number) + (c.height as number) > (viewport.height as number) ||
      (c.outputWidth as number) > (c.width as number) || (c.outputHeight as number) > (c.height as number)) throw new TypeError('Invalid source crop');
  }
  const camera = protocolRecord(r.camera); protocolKeys(camera, ['position', 'quaternion', 'up', 'near', 'far', 'fov', 'aspect', 'zoom', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix']);
  assertVec3(camera.position); assertVec3(camera.up);
  for (const [key, length] of [['quaternion', 4], ['matrixWorld', 16], ['matrixWorldInverse', 16], ['projectionMatrix', 16]] as const)
    if (!Array.isArray(camera[key]) || camera[key].length !== length || camera[key].some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) throw new TypeError('Invalid camera');
  for (const key of ['near', 'far', 'fov', 'aspect', 'zoom']) if (typeof camera[key] !== 'number' || !Number.isFinite(camera[key]) || camera[key] <= 0) throw new TypeError('Invalid camera');
  if ((camera.far as number) <= (camera.near as number) || (camera.fov as number) >= 180) throw new TypeError('Invalid camera');
  const binding = protocolRecord(r.binding); protocolToken(binding.sourceId); protocolToken(binding.frameId); assertVec3(binding.origin);
  if (binding.units !== 'm' || !(typeof binding.sourceRevision === 'string' && binding.sourceRevision.length <= 256 || Number.isSafeInteger(binding.sourceRevision) && (binding.sourceRevision as number) >= 0)) throw new TypeError('Invalid binding');
  const coverage = protocolRecord(r.coverage); protocolToken(coverage.kind); protocolInteger(coverage.displayedPointCount, Number.MAX_SAFE_INTEGER);
  if (typeof coverage.complete !== 'boolean') throw new TypeError('Invalid coverage');
  if (coverage.agentView !== undefined) canonicalAgentViewReceipt(coverage.agentView);
  const metadata = { ...r, image: { mimeType: image.mimeType, sha256: image.sha256, byteLength: image.byteLength } };
  if (new TextEncoder().encode(canonicalProtocolJson(metadata, { maxStringLength: 4096, maxNodes: 2048, maxArrayLength: 128 })).length > MODEL_VISUAL_LIMITS.metadataBytes) throw new TypeError('Visual metadata limit');
  return JSON.parse(JSON.stringify(r)) as ModelVisualObservation;
}
export function canonicalModelVisualToolResult(value: unknown): ModelVisualToolResult {
  const r = protocolRecord(value); protocolKeys(r, ['requestId', 'toolCallId', 'nonce', 'observationId', 'result']);
  for (const key of ['requestId', 'nonce', 'observationId']) protocolToken(r[key]);
  if (typeof r.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(r.toolCallId)) throw new TypeError('Invalid tool call ID');
  const result = protocolRecord(r.result);
  protocolToken(result.observationId); protocolInteger(result.x, 4095); protocolInteger(result.y, 4095);
  if (result.observationId !== r.observationId) throw new TypeError('Conflicting observation');
  if (result.status === 'resolved') { protocolKeys(result, ['status', 'observationId', 'x', 'y', 'provenance']); protocolRecord(result.provenance); }
  else {
    protocolKeys(result, ['status', 'observationId', 'x', 'y', 'reason']);
    if (!['ambiguous', 'no-hit', 'stale', 'invalid', 'unavailable'].includes(String(result.status)) || typeof result.reason !== 'string' || result.reason.length > 512) throw new TypeError('Invalid visual result');
  }
  if (new TextEncoder().encode(canonicalProtocolJson(r, { maxNodes: 1024, maxArrayLength: 128, maxStringLength: 4096 })).length > MODEL_VISUAL_LIMITS.resultBytes) throw new TypeError('Visual result limit');
  return JSON.parse(JSON.stringify(r)) as ModelVisualToolResult;
}
