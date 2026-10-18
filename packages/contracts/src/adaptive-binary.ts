import type { DatasetInfo } from './observation';

/** A bounded native node, not a raw prepared-file download. All fields are little endian. */
export const ADAPTIVE_BINARY_MIME = 'application/vnd.spatial.adaptive-node';
export const ADAPTIVE_BINARY_LIMITS = Object.freeze({ points: 65_536, metadataBytes: 16_384, headerBytes: 16, pointBytes: 34,
  responseBytes: 16 + 16_384 + 65_536 * 34 });
export interface AdaptiveBinaryIdentity { dataset: DatasetInfo; name: string; count: number }
export interface AdaptiveBinaryInput extends AdaptiveBinaryIdentity {
  positions: ArrayLike<number>; colors: ArrayLike<number>; sourceIds: ArrayLike<number>; labels: ArrayLike<number>;
}
export interface AdaptiveBinaryPayload extends AdaptiveBinaryIdentity {
  positions: Float64Array; colors: Uint8Array; sourceIds: Uint32Array; labels: Uint8Array;
}
const MAGIC = 0x314e4453; // SDN1
function identity(value: AdaptiveBinaryIdentity) {
  if (!value || !/^r[0-7]{0,24}$/.test(value.name) || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > ADAPTIVE_BINARY_LIMITS.points || !value.dataset || !/^[a-f0-9]{64}$/.test(value.dataset.revision)) throw new RangeError('Invalid binary node identity');
}
function integer(value: number, max: number) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError('Invalid binary point scalar');
  return value;
}
/** Labels are lossless uint8: the source adapter strictly accepts semantic labels 0..8. */
export function encodeAdaptiveBinary(value: AdaptiveBinaryInput): Uint8Array {
  identity(value);
  if (value.positions.length !== value.count * 3 || value.colors.length !== value.count * 3 || value.sourceIds.length !== value.count * 2 || value.labels.length !== value.count) throw new RangeError('Invalid binary point lengths');
  const metadata = new TextEncoder().encode(JSON.stringify({ dataset: value.dataset, name: value.name }));
  if (!metadata.length || metadata.length > ADAPTIVE_BINARY_LIMITS.metadataBytes) throw new RangeError('Binary metadata exceeds limit');
  const bytes = new Uint8Array(16 + metadata.length + value.count * 34), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint16(4, 1, true); view.setUint16(6, 0, true);
  view.setUint32(8, value.count, true); view.setUint32(12, metadata.length, true); bytes.set(metadata, 16);
  for (let i = 0, at = 16 + metadata.length; i < value.count; i++, at += 34) {
    for (let axis = 0; axis < 3; axis++) {
      const position = value.positions[i * 3 + axis];
      if (!Number.isFinite(position)) throw new RangeError('Invalid binary point position');
      view.setFloat64(at + axis * 8, position, true);
      bytes[at + 24 + axis] = integer(value.colors[i * 3 + axis], 255);
    }
    view.setUint16(at + 27, integer(value.sourceIds[i * 2], 0xffff), true);
    view.setUint32(at + 29, integer(value.sourceIds[i * 2 + 1], 0xffffffff), true);
    bytes[at + 33] = integer(value.labels[i], 8);
  }
  return bytes;
}

/** Validate the entire response against the requested catalog entry BEFORE allocating point arrays.
 * Output owns its storage: later wire-buffer mutations cannot change selection provenance.
 */
export function decodeAdaptiveBinary(bytes: Uint8Array, expected: AdaptiveBinaryIdentity): AdaptiveBinaryPayload {
  identity(expected);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > ADAPTIVE_BINARY_LIMITS.responseBytes) throw new RangeError('Invalid binary response size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true), metadataBytes = view.getUint32(12, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 0 || count !== expected.count || count > ADAPTIVE_BINARY_LIMITS.points || !metadataBytes || metadataBytes > ADAPTIVE_BINARY_LIMITS.metadataBytes || bytes.length !== 16 + metadataBytes + count * 34) throw new RangeError('Invalid binary header or lengths');
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + metadataBytes)));
  if (!metadata || Array.isArray(metadata) || Object.keys(metadata).sort().join(',') !== 'dataset,name' || metadata.name !== expected.name || JSON.stringify(metadata.dataset) !== JSON.stringify(expected.dataset)) throw new Error('Binary display request identity mismatch');
  const positions = new Float64Array(count * 3), colors = new Uint8Array(count * 3), sourceIds = new Uint32Array(count * 2), labels = new Uint8Array(count);
  for (let i = 0, at = 16 + metadataBytes; i < count; i++, at += 34) {
    for (let axis = 0; axis < 3; axis++) {
      const position = view.getFloat64(at + axis * 8, true);
      if (!Number.isFinite(position)) throw new RangeError('Invalid binary point position');
      positions[i * 3 + axis] = position; colors[i * 3 + axis] = bytes[at + 24 + axis];
    }
    sourceIds[i * 2] = view.getUint16(at + 27, true); sourceIds[i * 2 + 1] = view.getUint32(at + 29, true);
    labels[i] = integer(bytes[at + 33], 8);
  }
  return { dataset: metadata.dataset as DatasetInfo, name: metadata.name as string, count, positions, colors, sourceIds, labels };
}
