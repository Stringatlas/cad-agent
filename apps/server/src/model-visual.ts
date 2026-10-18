import { createHash } from 'node:crypto';
import { inflate } from 'node:zlib';
import jpeg from 'jpeg-js';
import { MODEL_VISUAL_LIMITS, canonicalModelVisualObservation, modelVisualImageSize, type ModelTurnRequest, type ModelVisualObservation } from '@spatial/contracts';
import { ModelError } from './provider-model';

/** Validates actual bounded PNG/JPEG bytes, not client-declared MIME/hash/dimensions alone. No image is persisted. */
export async function validateModelVisual(call: ModelTurnRequest, signal: AbortSignal): Promise<ModelVisualObservation | undefined> {
  if (!call.visualObservation) return undefined;
  const visual = canonicalModelVisualObservation(call.visualObservation);
  const encoded = visual.image.dataUrl.slice(`data:${visual.image.mimeType};base64,`.length);
  const bytes = Buffer.from(encoded, 'base64');
  const invalid = (): never => { throw new ModelError('invalid-visual-observation'); };
  const size = modelVisualImageSize(visual);
  if (bytes.length > MODEL_VISUAL_LIMITS.imageBytes || bytes.length !== visual.image.byteLength ||
    bytes.toString('base64') !== encoded || createHash('sha256').update(bytes).digest('hex') !== visual.image.sha256) invalid();
  signal.throwIfAborted();
  if (visual.image.mimeType === 'image/jpeg') {
    // Decoder has independent allocation/resolution limits; strict decoding rejects truncation.
    // The route's single admission is held throughout this bounded synchronous decode.
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
    try {
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
        maxResolutionInMP: MODEL_VISUAL_LIMITS.maxDimension ** 2 / 1e6, maxMemoryUsageInMB: MODEL_VISUAL_LIMITS.jpegMemoryMiB });
      if (decoded.width !== size.width || decoded.height !== size.height || decoded.data.length !== size.width * size.height * 3) invalid();
    } catch { invalid(); }
    signal.throwIfAborted();
  } else {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
  let at = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataEnded = false, chunkCount = 0;
  const compressed: Buffer[] = [];
  const crc = (data: Buffer) => { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  while (at < bytes.length) {
    if (at + 12 > bytes.length || ++chunkCount > 4096) invalid();
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8), end = at + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/u.test(type) || crc(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (at === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (at !== 8 || length !== 13) invalid();
      width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12);
      // Canvas PNGs are non-interlaced RGB/RGBA8; reject unsupported encodings explicitly.
      const color = bytes[at + 17]; channels = color === 6 ? 4 : color === 2 ? 3 : 0;
      if (width !== size.width || height !== size.height || bytes[at + 16] !== 8 || !channels ||
        bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) invalid();
    } else if (type === 'IDAT') { if (dataEnded) invalid(); seenData = true; compressed.push(bytes.subarray(at + 8, end - 4)); }
    else if (type === 'IEND') { if (length || !seenData || end !== bytes.length) invalid(); ended = true; }
    else { if (seenData) dataEnded = true; if (type[0] === type[0].toUpperCase() && type !== 'PLTE') invalid(); }
    at = end;
  }
  if (!ended) invalid();
  const rowBytes = width * channels + 1, expected = height * rowBytes;
  signal.throwIfAborted();
  // Hold the route's single admission until bounded native decompression completes,
  // even on cancellation; repeated disconnects cannot accumulate background inflates.
  const raw = await new Promise<Buffer>((resolve, reject) => inflate(Buffer.concat(compressed), { maxOutputLength: expected }, (error, data) => error ? reject(new ModelError('invalid-visual-observation')) : resolve(data)));
  signal.throwIfAborted();
  if (raw.length !== expected) invalid();
  for (let row = 0; row < height; row++) if (raw[row * rowBytes] > 4) invalid();
  }
  // Capture binding describes a past observation, not the authority granting tools.
  // Validate its source/frame shape without comparing it to current session/revision.
  const b = visual.binding;
  if (call.scene.mode === 'demo') {
    if (typeof b.sourceRevision !== 'number') throw new ModelError('invalid-visual-observation');
  } else if (call.scene.mode !== 'toronto' || b.sourceId !== 'toronto3d' || b.frameId !== 'toronto3d-local-v1' ||
    typeof b.sourceRevision !== 'string' || !b.sourceRevision.length || JSON.stringify(b.origin) !== '[627285,4841948,0]') throw new ModelError('invalid-visual-observation');
  return visual;
}
