import { realpath } from 'node:fs/promises';
import { parseMetadataLayout, parseHierarchy as coreHierarchy, safeOpen, readSmall, readRange } from './potree-core';
import { createHash } from 'node:crypto';
import { assertCropSelection, type CropSelection, type CropBox, type DatasetInfo, type PointLod, type PointObservation, type Vec3 } from '@spatial/contracts';
import { readFullResolutionCrop, CROP_LIMITS } from './crop';
import { assertPointLod, sampleIndices } from '@spatial/agent-harness';
import { DISPLAY_LIMITS, readDisplayHierarchy, type DisplayHierarchy, type DisplayPayload, type NativeDisplayNode } from './adaptive-display';
import { setImmediate as yieldTurn } from 'node:timers/promises';

export const READ_LIMITS = Object.freeze({ json: 64 * 1024, hierarchy: 64 * 1024, node: 4 * 1024 * 1024, total: 16 * 1024 * 1024 });
interface Layout { rootBox?: CropBox; stride: number; scale: Vec3; offset: Vec3; bounds: DatasetInfo['bounds']; points: number; firstChunk: number; fields: Record<string, number> }
export interface PotreeNode { name: string; depth: number; count: number; offset: number; size: number }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}

/** Only uncompressed, interleaved Potree2 is supported; never guess a decoder. */
export function parseMetadata(input: unknown): Layout {
  return parseMetadataLayout(input, { position: ['int32', 12], rgb: ['uint16', 6], 'point source id': ['uint16', 2], source_row: ['uint32', 4], scalar_Label: ['float', 4] });
}

/** Breadth-first first chunk only. Reject proxies within requested depth; never follow unbounded pointers. */
export function parseHierarchy(bytes: Buffer, layout: Layout, octreeSize: number, hierarchySize: number, depth: number): PotreeNode[] {
  return coreHierarchy(bytes, layout, octreeSize, hierarchySize, depth);
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
  private displayCache?: { revision: string; identity: string; nodes: NativeDisplayNode[] };
  /** Dedicated bounded native-display path; never changes observe/crop sampling semantics. */
  private async nativeDisplay<T>(revision: string | undefined, signal: AbortSignal | undefined,
    consume: (loaded: Awaited<ReturnType<PotreeDataset['load']>>, nodes: NativeDisplayNode[]) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    const loaded = await this.load();
    try {
      if (revision !== undefined && revision !== loaded.dataset.revision) throw new Error('Stale display revision');
      if (!loaded.layout.rootBox) throw new Error('Missing native root bounds');
      const root = await realpath(this.directory);
      const hierarchy = await safeOpen(root, 'octree/hierarchy.bin');
      try {
        const identityOf = async () => {
          const identities = [];
          for (const asset of ['octree/hierarchy.bin', 'octree/octree.bin'] as const) {
            const file = await safeOpen(root, asset);
            try { const s = await file.stat(); identities.push([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]); }
            finally { await file.close(); }
          }
          return JSON.stringify(identities);
        };
        const identity = await identityOf();
        const hs = await hierarchy.stat(), ps = await loaded.payload.stat();
        if (identity !== JSON.stringify([hs, ps].map(s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]))) throw new Error('Native artifact changed');
        const cached = this.displayCache;
        // Existing artifact revisions fingerprint the first chunk only. A changed proxy file
        // with the same revision must fail closed rather than reuse a stale catalog.
        if (cached?.revision === loaded.dataset.revision && cached.identity !== identity) throw new Error('Native artifact changed without revision');
        const nodes = cached?.revision === loaded.dataset.revision ? cached.nodes : await readDisplayHierarchy({
          first: loaded.hierarchy, rootBox: loaded.layout.rootBox, hierarchySize: loaded.hierarchySize,
          payloadSize: loaded.size, stride: loaded.layout.stride, totalPoints: loaded.dataset.totalPoints,
          readHierarchy: (offset, size) => readRange(hierarchy, offset, size, CROP_LIMITS.chunkBytes),
        }, signal);
        signal?.throwIfAborted();
        const result = await consume(loaded, nodes);
        signal?.throwIfAborted();
        if (identity !== await identityOf() || (await this.info()).revision !== loaded.dataset.revision) throw new Error('Native artifact changed during read');
        this.displayCache = { revision: loaded.dataset.revision, identity, nodes };
        return result;
      } finally { await hierarchy.close(); }
    } finally { await loaded.payload.close(); }
  }
  async displayHierarchy(signal?: AbortSignal): Promise<DisplayHierarchy> {
    return this.nativeDisplay(undefined, signal, async (loaded, nodes) => ({ dataset: loaded.dataset,
      nodes: nodes.map(({ name, count, bounds }) => ({ name, count, bounds })) }));
  }
  async displayNode(revision: string, name: string, signal?: AbortSignal): Promise<DisplayPayload> {
    if (!/^[a-f0-9]{64}$/.test(revision) || !/^r[0-7]{0,24}$/.test(name)) throw new RangeError('Invalid native display request');
    return this.nativeDisplay(revision, signal, async (loaded, nodes) => {
      const node = nodes.find(n => n.name === name);
      if (!node) throw new RangeError('Unknown native display node');
      const bytes = await readRange(loaded.payload, node.offset, node.size, DISPLAY_LIMITS.nodeBytes);
      const positions: number[] = [], colors: number[] = [], sourceIds: number[] = [], labels: number[] = [];
      for (let i = 0; i < node.count; i++) {
        if (i % 2048 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
        const point = decodePoint(bytes, i, loaded.layout);
        positions.push(...point.positions); colors.push(...point.colors); sourceIds.push(...point.sourceIds); labels.push(point.label);
      }
      return { dataset: loaded.dataset, name, count: node.count, positions, colors, sourceIds, labels };
    });
  }
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
