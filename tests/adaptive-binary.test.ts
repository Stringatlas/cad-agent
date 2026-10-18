import assert from 'node:assert/strict';
import test from 'node:test';
import { ADAPTIVE_BINARY_LIMITS, encodeAdaptiveBinary, decodeAdaptiveBinary, type AdaptiveBinaryInput } from '@spatial/contracts';

const payload: AdaptiveBinaryInput = {
  dataset: { id: 'toronto3d', revision: 'a'.repeat(64), coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }, bounds: { min: [0, 0, 0], max: [10, 10, 10] }, totalPoints: 2 },
  name: 'r07', count: 2, positions: [0.1 + 0.2, -0, Number.MIN_VALUE, 1234567.89012345, -55.000000001, 1e20],
  colors: [0, 255, 128, 1, 2, 3], sourceIds: [65535, 0xffffffff, 1, 0], labels: [8, 0],
};

test('binary transport preserves exact binary64, RGB, uint16/uint32 provenance and semantic labels', () => {
  const bytes = encodeAdaptiveBinary(payload), output = decodeAdaptiveBinary(bytes, payload);
  for (const field of ['positions', 'colors', 'sourceIds', 'labels'] as const) assert.deepEqual(Array.from(output[field]), Array.from(payload[field]));
  assert.ok(output.positions instanceof Float64Array); assert.ok(output.colors instanceof Uint8Array);
  assert.ok(output.sourceIds instanceof Uint32Array); assert.ok(output.labels instanceof Uint8Array);
  assert.deepEqual(output.dataset, payload.dataset); assert.equal(output.name, payload.name); assert.equal(output.count, payload.count);
  bytes.fill(255);
  assert.deepEqual(Array.from(output.positions), Array.from(payload.positions), 'decoded point arrays must not alias transport bytes');
  const padded = new Uint8Array(encodeAdaptiveBinary(payload).length + 7); padded.set(encodeAdaptiveBinary(payload), 3);
  assert.deepEqual(Array.from(decodeAdaptiveBinary(padded.subarray(3, -4), payload).sourceIds), Array.from(payload.sourceIds));
});

test('binary response is bound to requested dataset metadata, revision, node and count', () => {
  const bytes = encodeAdaptiveBinary(payload);
  for (const expected of [
    { ...payload, name: 'r0' }, { ...payload, count: 1 },
    { ...payload, dataset: { ...payload.dataset, revision: 'b'.repeat(64) } },
    { ...payload, dataset: { ...payload.dataset, totalPoints: 3 } },
    { ...payload, dataset: { ...payload.dataset, coordinates: { ...payload.dataset.coordinates, localOrigin: [0, 0, 0] as const } } },
  ]) assert.throws(() => decodeAdaptiveBinary(bytes, expected));
});

test('binary decoder rejects malformed versions, reserved bits, lengths, truncation, oversized input and nonfinite positions/labels', () => {
  const bytes = encodeAdaptiveBinary(payload), metadataBytes = new DataView(bytes.buffer).getUint32(12, true);
  const mutations = [
    (v: DataView) => v.setUint32(0, 0, true), (v: DataView) => v.setUint16(4, 2, true), (v: DataView) => v.setUint16(6, 1, true),
    (v: DataView) => v.setUint32(8, 0xffffffff, true), (v: DataView) => v.setUint32(12, 0, true),
    (v: DataView) => v.setUint32(12, ADAPTIVE_BINARY_LIMITS.metadataBytes + 1, true),
    (v: DataView) => v.setFloat64(16 + metadataBytes, Infinity, true),
    (v: DataView) => v.setFloat64(16 + metadataBytes, NaN, true),
    (v: DataView) => v.setUint8(16 + metadataBytes + 33, 255),
    (v: DataView) => v.setUint8(16, 0xff), // invalid UTF-8
    (v: DataView) => v.setUint8(16, 0x5b), // malformed JSON
  ];
  for (const mutate of mutations) { const copy = bytes.slice(); mutate(new DataView(copy.buffer)); assert.throws(() => decodeAdaptiveBinary(copy, payload)); }
  for (const short of [0, 1, 15, 16, bytes.length - 1]) assert.throws(() => decodeAdaptiveBinary(bytes.subarray(0, short), payload));
  const trailing = new Uint8Array(bytes.length + 1); trailing.set(bytes); assert.throws(() => decodeAdaptiveBinary(trailing, payload));
  assert.throws(() => decodeAdaptiveBinary(new Uint8Array(ADAPTIVE_BINARY_LIMITS.responseBytes + 1), payload));
});

test('binary encoder never silently wraps invalid scalars, lengths or counts', () => {
  for (const invalid of [
    { count: -1 }, { count: ADAPTIVE_BINARY_LIMITS.points + 1 }, { positions: [0] }, { colors: [0] }, { sourceIds: [0] }, { labels: [0] },
    { positions: [NaN, 0, 0, 0, 0, 0] }, { colors: [-1, 0, 0, 0, 0, 0] }, { colors: [256, 0, 0, 0, 0, 0] },
    { sourceIds: [65536, 0, 1, 0] }, { sourceIds: [1, 0x100000000, 1, 0] }, { sourceIds: [1, 0.5, 1, 0] },
    { labels: [9, 0] }, { labels: [-1, 0] }, { labels: [0.5, 0] },
    { dataset: { ...payload.dataset, revision: 'invalid' } }, { name: '../r' },
  ]) assert.throws(() => encodeAdaptiveBinary({ ...payload, ...invalid }));
  const empty = { ...payload, count: 0, positions: [], colors: [], sourceIds: [], labels: [] };
  assert.equal(decodeAdaptiveBinary(encodeAdaptiveBinary(empty), empty).count, 0);
});

test('binary maximum native node fits the strict byte bound', () => {
  const count = ADAPTIVE_BINARY_LIMITS.points, max = { ...payload, count,
    positions: new Float64Array(count * 3).fill(0.123456789123456), colors: new Uint8Array(count * 3).fill(255),
    sourceIds: new Uint32Array(count * 2).fill(65535), labels: new Uint8Array(count).fill(8) };
  const bytes = encodeAdaptiveBinary(max); assert.ok(bytes.length <= ADAPTIVE_BINARY_LIMITS.responseBytes);
  assert.ok(bytes.length < 2.25 * 1024 * 1024);
  const decoded = decodeAdaptiveBinary(bytes, max); assert.equal(decoded.count, count); assert.equal(decoded.positions.at(-1), max.positions.at(-1));
});
