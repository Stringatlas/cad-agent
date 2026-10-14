import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertCropBox, assertCropSelection, type CropSelection, type CropBox, type DatasetInfo, type PointLod, type PointObservation, type Vec3 } from '@spatial/contracts';
import { readFullResolutionCrop, CROP_LIMITS } from './crop';
import { assertPointLod, sampleIndices } from '@spatial/agent-harness';

export const READ_LIMITS = Object.freeze({ json: 64 * 1024, hierarchy: 64 * 1024, node: 4 * 1024 * 1024, total: 16 * 1024 * 1024 });
interface Layout { rootBox?: CropBox; stride: number; scale: Vec3; offset: Vec3; bounds: DatasetInfo['bounds']; points: number; firstChunk: number; fields: Record<string, number> }
export interface PotreeNode { name: string; depth: number; count: number; offset: number; size: number }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Integer out of bounds');
  return value;
}
function triple(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7)) throw new Error('Invalid coordinate');
  return value as unknown as Vec3;
}

/** Only uncompressed, interleaved Potree2 is supported; never guess a decoder. */
export function parseMetadata(input: unknown): Layout {
  const m = record(input);
  if (m.version !== '2.0' || m.encoding !== 'UNCOMPRESSED' || !Array.isArray(m.attributes) || m.attributes.length > 64) throw new Error('Unsupported Potree encoding');
  const fields: Record<string, number> = Object.create(null);
  const required: Record<string, [string, number]> = { position: ['int32', 12], rgb: ['uint16', 6], 'point source id': ['uint16', 2], source_row: ['uint32', 4], scalar_Label: ['float', 4] };
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

/** Breadth-first first chunk only. Reject proxies within requested depth; never follow unbounded pointers. */
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

async function safeOpen(root: string, asset: string) {
  const path = join(root, asset);
  // Asset names are internal constants. Reject symlink escapes, including intermediate directories.
  if (await realpath(path) !== path) throw new Error('Dataset symlinks are unsupported');
  return open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
}
async function readSmall(root: string, asset: string) {
  const file = await safeOpen(root, asset);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > READ_LIMITS.json) throw new Error('Metadata exceeds size limit');
    const bytes = Buffer.alloc(stat.size);
    if ((await file.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length) throw new Error('Truncated metadata');
    return bytes;
  } finally { await file.close(); }
}
async function readRange(file: Awaited<ReturnType<typeof open>>, offset: number, size: number, max: number) {
  const stat = await file.stat();
  if (!stat.isFile() || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || size > max || offset > stat.size - size) throw new Error('Read range exceeds limits');
  const bytes = Buffer.alloc(size);
  if ((await file.read(bytes, 0, size, offset)).bytesRead !== size) throw new Error('Truncated payload');
  return bytes;
}

export function decodePoint(bytes: Buffer, index: number, layout: Layout) {
  const at = index * layout.stride;
  if (!Number.isSafeInteger(index) || index < 0 || at + layout.stride > bytes.length) throw new Error('Point index out of range');
  const positions = [0, 1, 2].map(axis => bytes.readInt32LE(at + layout.fields.position + axis * 4) * layout.scale[axis] + layout.offset[axis]);
  if (positions.some((n, axis) => !Number.isFinite(n) || n < layout.bounds.min[axis] - 0.002 || n > layout.bounds.max[axis] + 0.002)) throw new Error('Point outside local bounds');
  const colors = [0, 1, 2].map(axis => Math.round(bytes.readUInt16LE(at + layout.fields.rgb + axis * 2) / 257));
  const sourceIds = [bytes.readUInt16LE(at + layout.fields['point source id']), bytes.readUInt32LE(at + layout.fields.source_row)];
  const label = bytes.readFloatLE(at + layout.fields.scalar_Label);
  if (sourceIds[0] < 1 || sourceIds[0] > 4 || !Number.isInteger(label) || label < 0 || label > 8) throw new Error('Invalid provenance or label');
  return { positions, colors, sourceIds, label };
}

/** Read-only prepared artifact adapter. No public filesystem paths or raw binary routes. */
export class PotreeDataset {
  constructor(private readonly directory: string) {}
  private async load() {
    const root = await realpath(this.directory);
    const metadata = await readSmall(root, 'octree/metadata.json');
    const manifestBytes = await readSmall(root, 'manifest.json');
    const manifest = record(JSON.parse(manifestBytes.toString('utf8')));
    if (manifest.units !== 'm' || manifest.frame !== 'right-handed Z-up' || JSON.stringify(manifest.local_origin_world) !== '[627285,4841948,0]') throw new Error('Unsupported Toronto coordinate metadata');
    const layout = parseMetadata(JSON.parse(metadata.toString('utf8')));
    const hierarchyFile = await safeOpen(root, 'octree/hierarchy.bin');
    let hierarchy: Buffer, hierarchySize: number;
    try {
      hierarchySize = (await hierarchyFile.stat()).size;
      hierarchy = await readRange(hierarchyFile, 0, layout.firstChunk, READ_LIMITS.hierarchy);
    } finally { await hierarchyFile.close(); }
    const payload = await safeOpen(root, 'octree/octree.bin');
    try {
      const stat = await payload.stat();
      if (!stat.isFile()) throw new Error('Invalid payload');
      const revision = createHash('sha256').update(metadata).update(manifestBytes).update(hierarchy).update(`${stat.size}:${stat.mtimeMs}`).digest('hex');
      const dataset: DatasetInfo = { id: 'toronto3d', revision, coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }, bounds: layout.bounds, totalPoints: layout.points };
      return { dataset, layout, hierarchy, hierarchySize, payload, size: stat.size };
    } catch (error) { await payload.close(); throw error; }
  }
  async info(): Promise<DatasetInfo> {
    const loaded = await this.load();
    await loaded.payload.close();
    return loaded.dataset;
  }
  async sample(lod: PointLod, purpose: 'display' | 'harness', signal?: AbortSignal): Promise<PointObservation> {
    assertPointLod(lod, purpose);
    signal?.throwIfAborted();
    const loaded = await this.load();
    try {
      const nodes = parseHierarchy(loaded.hierarchy, loaded.layout, loaded.size, loaded.hierarchySize, lod.depth);
      const candidatePoints = nodes.reduce((sum, node) => sum + node.count, 0);
      const indices = sampleIndices(candidatePoints, lod.budget);
      const positions: number[] = [], colors: number[] = [], sourceIds: number[] = [], labels: number[] = [];
      let cursor = 0, start = 0, bytesRead = loaded.hierarchy.length;
      const used: string[] = [];
      for (const node of nodes) {
        signal?.throwIfAborted();
        if (cursor < indices.length && indices[cursor] < start + node.count) {
          const bytes = await readRange(loaded.payload, node.offset, node.size, READ_LIMITS.node);
          bytesRead += bytes.length;
          used.push(node.name);
          while (cursor < indices.length && indices[cursor] < start + node.count) {
            const point = decodePoint(bytes, indices[cursor++] - start, loaded.layout);
            positions.push(...point.positions); colors.push(...point.colors); sourceIds.push(...point.sourceIds); labels.push(point.label);
          }
        }
        start += node.count;
      }
      signal?.throwIfAborted();
      const sampleHash = createHash('sha256').update(JSON.stringify({ positions, colors, sourceIds, labels })).digest('hex');
      return { dataset: loaded.dataset, purpose, lod: { ...lod }, algorithm: 'potree-bfs-even-v1', candidatePoints, count: indices.length, bytesRead, nodes: used, sampleHash, positions, colors, sourceIds, labels };
    } finally { await loaded.payload.close(); }
  }
  /** Independent display-only full-resolution query. Never routes through sampled observe(). */
  async *crop(box: CropSelection, signal?: AbortSignal) {
    assertCropSelection(box); signal?.throwIfAborted();
    const loaded = await this.load();
    try {
      if (!loaded.layout.rootBox) throw new Error('Missing octree spatial bounds');
      const root = await realpath(this.directory);
      const hierarchy = await safeOpen(root, 'octree/hierarchy.bin');
      try {
        yield* readFullResolutionCrop({ dataset: loaded.dataset, rootBox: loaded.layout.rootBox, scale: loaded.layout.scale,
          stride: loaded.layout.stride, first: loaded.hierarchy, hierarchySize: loaded.hierarchySize, payloadSize: loaded.size, requireSourceIds: true,
          readHierarchy: (offset, size) => readRange(hierarchy, offset, size, CROP_LIMITS.chunkBytes),
          readPayload: (offset, size) => readRange(loaded.payload, offset, size, CROP_LIMITS.nodeBytes),
          decode: (bytes, index) => decodePoint(bytes, index, loaded.layout),
        }, box, signal);
      } finally { await hierarchy.close(); }
    } finally { await loaded.payload.close(); }
  }
  /** Product harness gets its own fixed-purpose adapter, never the display's buffers. */
  observe(lod: PointLod, signal?: AbortSignal) { return this.sample(lod, 'harness', signal); }
}
