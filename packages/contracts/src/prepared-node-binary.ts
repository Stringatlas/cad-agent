/** Dataset-neutral exact native-node transport. Optional labels and signed instances stay native. */
export const PREPARED_NODE_MIME = 'application/vnd.spatial.prepared-node';
export const PREPARED_NODE_LIMITS = Object.freeze({ points: 65_536, metadataBytes: 1024, pointBytes: 39, responseBytes: 16 + 1024 + 65_536 * 39 });
export interface PreparedNodeIdentity { cloudId: string; revision: string; name: string; count: number }
export interface PreparedNodeInput extends PreparedNodeIdentity {
  positions: ArrayLike<number>; colors: ArrayLike<number>; sourceIds: ArrayLike<number>; labels?: ArrayLike<number>; instances?: ArrayLike<number>;
}
export interface PreparedNodePayload extends PreparedNodeIdentity {
  positions: Float64Array; colors: Uint8Array; sourceIds: Uint32Array; labels?: Uint16Array; instances?: Int32Array;
}
const MAGIC = 0x314e4350;
function identity(value: PreparedNodeIdentity) {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.cloudId) || !/^[a-f0-9]{64}$/.test(value.revision) || !/^r[0-7]{0,24}$/.test(value.name) || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > PREPARED_NODE_LIMITS.points) throw new RangeError('Invalid native node identity');
}
function integer(n: number, min: number, max: number) {
  if (!Number.isInteger(n) || n < min || n > max) throw new RangeError('Invalid native scalar');
  return n;
}
export function encodePreparedNode(value: PreparedNodeInput): Uint8Array {
  identity(value);
  const { count } = value;
  if (value.positions.length !== count * 3 || value.colors.length !== count * 3 || value.sourceIds.length !== count * 2 || value.labels && value.labels.length !== count || value.instances && value.instances.length !== count) throw new RangeError('Invalid native array lengths');
  const metadata = new TextEncoder().encode(JSON.stringify({ cloudId: value.cloudId, revision: value.revision, name: value.name }));
  if (metadata.length > PREPARED_NODE_LIMITS.metadataBytes) throw new RangeError('Oversized native metadata');
  const bytes = new Uint8Array(16 + metadata.length + count * 39), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint16(4, 1, true); view.setUint16(6, (value.labels ? 1 : 0) | (value.instances ? 2 : 0), true);
  view.setUint32(8, count, true); view.setUint32(12, metadata.length, true); bytes.set(metadata, 16);
  for (let i = 0, at = 16 + metadata.length; i < count; i++, at += 39) {
    for (let axis = 0; axis < 3; axis++) {
      const position = value.positions[i * 3 + axis];
      if (!Number.isFinite(position)) throw new RangeError('Nonfinite native position');
      view.setFloat64(at + axis * 8, position, true); bytes[at + 24 + axis] = integer(value.colors[i * 3 + axis], 0, 255);
    }
    view.setUint16(at + 27, integer(value.sourceIds[i * 2], 0, 65535), true);
    view.setUint32(at + 29, integer(value.sourceIds[i * 2 + 1], 0, 0xffffffff), true);
    view.setUint16(at + 33, integer(value.labels?.[i] ?? 0, 0, 65535), true);
    view.setInt32(at + 35, integer(value.instances?.[i] ?? 0, -2147483648, 2147483647), true);
  }
  return bytes;
}
export function decodePreparedNode(bytes: Uint8Array, expected: PreparedNodeIdentity): PreparedNodePayload {
  identity(expected);
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > PREPARED_NODE_LIMITS.responseBytes) throw new RangeError('Invalid native response size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(8, true), flags = view.getUint16(6, true), meta = view.getUint32(12, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== 1 || flags > 3 || count !== expected.count || !meta || meta > PREPARED_NODE_LIMITS.metadataBytes || bytes.length !== 16 + meta + count * 39) throw new RangeError('Invalid native header');
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + meta)));
  if (JSON.stringify(metadata) !== JSON.stringify({ cloudId: expected.cloudId, revision: expected.revision, name: expected.name })) throw new Error('Native response binding mismatch');
  const positions = new Float64Array(count * 3), colors = new Uint8Array(count * 3), sourceIds = new Uint32Array(count * 2);
  const labels = flags & 1 ? new Uint16Array(count) : undefined, instances = flags & 2 ? new Int32Array(count) : undefined;
  for (let i = 0, at = 16 + meta; i < count; i++, at += 39) {
    for (let axis = 0; axis < 3; axis++) {
      const position = view.getFloat64(at + axis * 8, true);
      if (!Number.isFinite(position)) throw new RangeError('Nonfinite native position');
      positions[i * 3 + axis] = position; colors[i * 3 + axis] = bytes[at + 24 + axis];
    }
    sourceIds[i * 2] = view.getUint16(at + 27, true); sourceIds[i * 2 + 1] = view.getUint32(at + 29, true);
    if (labels) labels[i] = view.getUint16(at + 33, true);
    if (instances) instances[i] = view.getInt32(at + 35, true);
  }
  return { ...expected, positions, colors, sourceIds, ...(labels ? { labels } : {}), ...(instances ? { instances } : {}) };
}
