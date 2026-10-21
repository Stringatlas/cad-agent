import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { assertCropBox, type CropBox, type Vec3 } from '@spatial/contracts';

export const READ_LIMITS = Object.freeze({ json: 64 * 1024, hierarchy: 64 * 1024, node: 4 * 1024 * 1024, total: 16 * 1024 * 1024 });
export interface Layout { rootBox?: CropBox; stride: number; scale: Vec3; offset: Vec3; bounds: CropBox; points: number; firstChunk: number; fields: Record<string, number> }
export interface PotreeNode { name: string; depth: number; count: number; offset: number; size: number }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Integer out of bounds');
  return value;
}
export function triple(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7)) throw new Error('Invalid coordinate');
  return value as unknown as Vec3;
}

/** Format validation is shared; callers explicitly supply their supported attribute schema. */
export function parseMetadataLayout(input: unknown, required: Record<string, readonly [string, number]>): Layout {
  const m = record(input);
  if (m.version !== '2.0' || m.encoding !== 'UNCOMPRESSED' || !Array.isArray(m.attributes) || m.attributes.length > 64) throw new Error('Unsupported Potree encoding');
  const fields: Record<string, number> = Object.create(null);
  let stride = 0;
  let bounds: Layout['bounds'] | undefined;
  for (const value of m.attributes) {
    const a = record(value);
    if (typeof a.name !== 'string' || Object.hasOwn(fields, a.name)) throw new Error('Invalid/duplicate attribute');
    fields[a.name] = stride;
    const size = integer(a.size, 1, 256);
    if (Object.hasOwn(required, a.name)) {
      const [type, expected] = required[a.name];
      if (a.type !== type || size !== expected) throw new Error('Unsupported attribute layout');
    }
    if (a.name === 'position') bounds = { min: triple(a.min), max: triple(a.max) };
    stride += size;
  }
  if (stride > 256 || !bounds || Object.keys(required).some(name => !Object.hasOwn(fields, name))) throw new Error('Missing attributes or excessive stride');
  if (bounds.min.some((n, i) => n > bounds!.max[i])) throw new Error('Invalid bounds');
  const scale = triple(m.scale);
  if (scale.some(n => n <= 0 || n > 1)) throw new Error('Invalid scale');
  const firstChunk = integer(record(m.hierarchy).firstChunkSize, 22, READ_LIMITS.hierarchy);
  if (firstChunk % 22) throw new Error('Unaligned hierarchy');
  let rootBox: CropBox | undefined;
  if (m.boundingBox !== undefined) {
    const b = record(m.boundingBox);
    rootBox = { min: triple(b.min), max: triple(b.max) };
    assertCropBox(rootBox);
    if (rootBox.min.some((v, i) => v > bounds!.min[i] || rootBox!.max[i] < bounds!.max[i])) throw new Error('Octree root does not enclose dataset');
  }
  return { rootBox, stride, fields, bounds, scale, offset: triple(m.offset), points: integer(m.points, 1, 1e9), firstChunk };
}

/** Breadth-first first chunk only. Reject proxies within requested depth. */
export function parseHierarchy(bytes: Buffer, layout: Layout, octreeSize: number, hierarchySize: number, depth: number): PotreeNode[] {
  if (bytes.length !== layout.firstChunk || bytes.length > READ_LIMITS.hierarchy || bytes.length % 22) throw new Error('Truncated hierarchy');
  const queue = [{ name: 'r', depth: 0 }];
  const nodes: PotreeNode[] = [];
  const ranges: [number, number][] = [];
  for (let i = 0; i < bytes.length / 22; i++) {
    const current = queue[i];
    if (!current) throw new Error('Unreachable hierarchy record');
    const at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
    const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
    const limit = type === 2 ? hierarchySize : octreeSize;
    if (type > 2 || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || size > limit || offset > limit - size) throw new Error('Invalid payload range');
    if (type === 2) {
      if (!size || size % 22 || size > READ_LIMITS.hierarchy || current.depth <= depth) throw new Error('Unsupported hierarchy proxy');
      continue;
    }
    if (size !== count * layout.stride || (type === 1 && mask !== 0)) throw new Error('Invalid node payload');
    if (current.depth <= depth && count) {
      if (size > READ_LIMITS.node) throw new Error('Node exceeds read limit');
      nodes.push({ ...current, count, offset, size });
      ranges.push([offset, offset + size]);
    }
    for (let child = 0; child < 8; child++) if (mask & (1 << child)) queue.push({ name: current.name + child, depth: current.depth + 1 });
    if (queue.length > READ_LIMITS.hierarchy / 22) throw new Error('Excessive hierarchy');
  }
  if (queue.length !== bytes.length / 22) throw new Error('Missing hierarchy children');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) throw new Error('Overlapping nodes');
  if (nodes.reduce((sum, n) => sum + n.size, 0) > READ_LIMITS.total) throw new Error('LOD exceeds total read limit');
  return nodes;
}

/** Only internal asset constants are accepted, never request-provided paths. */
export async function safeOpen(root: string, asset: 'manifest.json' | 'cloud.json' | 'octree/metadata.json' | 'octree/hierarchy.bin' | 'octree/octree.bin') {
  const path = join(root, asset);
  if (await realpath(path) !== path) throw new Error('Dataset symlinks are unsupported');
  return open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
}
export async function readSmall(root: string, asset: Parameters<typeof safeOpen>[1]) {
  const file = await safeOpen(root, asset);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > READ_LIMITS.json) throw new Error('Metadata exceeds size limit');
    const bytes = Buffer.alloc(stat.size);
    if ((await file.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length) throw new Error('Truncated metadata');
    return bytes;
  } finally { await file.close(); }
}
export async function readRange(file: Awaited<ReturnType<typeof open>>, offset: number, size: number, max: number) {
  const stat = await file.stat();
  if (!stat.isFile() || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || size > max || offset > stat.size - size) throw new Error('Read range exceeds limits');
  const bytes = Buffer.alloc(size);
  if ((await file.read(bytes, 0, size, offset)).bytesRead !== size) throw new Error('Truncated payload');
  return bytes;
}
