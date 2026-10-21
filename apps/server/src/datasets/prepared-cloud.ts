import { createHash } from 'node:crypto';
import { lstat, realpath, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { assertPointLod, sampleIndices } from '@spatial/agent-harness';
import type { CropBox, PointLod, Vec3 } from '@spatial/contracts';
import { integer, parseHierarchy, parseMetadataLayout, READ_LIMITS, readRange, record, safeOpen, triple, type Layout } from './potree-core';

/** Operator-prepared cloud.json. No paths, edit authority, or implicit semantic taxonomy. */
export interface PreparedCloudDescriptor {
  readonly version: 1;
  readonly format: 'potree2-uncompressed';
  readonly id: string;
  readonly frameId: string;
  readonly coordinates: { readonly units: 'm'; readonly handedness: 'right'; readonly upAxis: 'Z'; readonly localOrigin: Vec3 };
  readonly sources: readonly { readonly id: number; readonly name: string; readonly points: number }[];
  readonly semantics?: { readonly attribute: string; readonly type: 'uint8' | 'uint16' | 'float'; readonly classes: Readonly<Record<string, string>> };
}
export interface PreparedCloudInfo {
  readonly descriptor: PreparedCloudDescriptor;
  /** Fingerprint of descriptor/metadata/first hierarchy chunk plus asset identities, not a full content digest. */
  readonly revision: string;
  readonly bounds: CropBox;
  readonly totalPoints: number;
  readonly capabilities: { readonly boundedSample: true; readonly semanticLabels: boolean; readonly fullResolution: false; readonly editing: false };
}
export interface PreparedCloudSample {
  readonly cloud: PreparedCloudInfo;
  readonly lod: PointLod;
  readonly algorithm: 'potree-bfs-even-v1';
  readonly count: number;
  readonly candidatePoints: number;
  readonly positions: number[];
  readonly colors: number[];
  /** Interleaved source ID / original row; IDs belong only to this cloud and revision. */
  readonly sourceIds: number[];
  readonly labels?: number[];
  readonly nodes: string[];
  readonly bytesRead: number;
  readonly sampleHash: string;
}
export interface PreparedCloudReader {
  info(signal?: AbortSignal): Promise<PreparedCloudInfo>;
  sample(revision: string, lod: PointLod, signal?: AbortSignal, purpose?: 'harness' | 'display'): Promise<PreparedCloudSample>;
}
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const assets = ['cloud.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin'] as const;

export function parsePreparedCloudDescriptor(input: unknown): PreparedCloudDescriptor {
  const d = record(input), c = record(d.coordinates);
  if (d.version !== 1 || d.format !== 'potree2-uncompressed' || typeof d.id !== 'string' || !identifier.test(d.id) ||
    typeof d.frameId !== 'string' || !identifier.test(d.frameId) || c.units !== 'm' || c.handedness !== 'right' || c.upAxis !== 'Z') throw new Error('Unsupported prepared cloud descriptor/frame');
  const localOrigin = triple(c.localOrigin);
  if (!Array.isArray(d.sources) || !d.sources.length || d.sources.length > 65536) throw new Error('Invalid source mapping');
  const ids = new Set<number>();
  const sources = d.sources.map(value => {
    const s = record(value), id = integer(s.id, 0, 65535), points = integer(s.points, 0, 0x100000000);
    if (ids.has(id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 256) throw new Error('Invalid source mapping');
    ids.add(id); return { id, name: s.name, points };
  });
  let semantics: PreparedCloudDescriptor['semantics'];
  if (d.semantics !== undefined) {
    const s = record(d.semantics), classes = record(s.classes);
    if (typeof s.attribute !== 'string' || !identifier.test(s.attribute) || ['position', 'rgb', 'point source id', 'source_row'].includes(s.attribute) ||
      !['uint8', 'uint16', 'float'].includes(String(s.type)) || !Object.keys(classes).length || Object.keys(classes).length > 65536) throw new Error('Unsupported semantic mapping');
    const checked: Record<string, string> = Object.create(null);
    for (const [key, name] of Object.entries(classes)) {
      if (!/^(0|[1-9]\d{0,4})$/.test(key) || Number(key) > (s.type === 'uint8' ? 255 : 65535) || typeof name !== 'string' || !name.trim() || name.length > 128) throw new Error('Invalid semantic class');
      checked[key] = name;
    }
    semantics = { attribute: s.attribute, type: s.type as NonNullable<PreparedCloudDescriptor['semantics']>['type'], classes: checked };
  }
  return { version: 1, format: 'potree2-uncompressed', id: d.id, frameId: d.frameId,
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin }, sources, ...(semantics ? { semantics } : {}) };
}

function layoutFor(metadata: unknown, descriptor: PreparedCloudDescriptor): Layout {
  const required: Record<string, readonly [string, number]> = { position: ['int32', 12], rgb: ['uint16', 6], 'point source id': ['uint16', 2], source_row: ['uint32', 4] };
  const s = descriptor.semantics;
  if (s) required[s.attribute] = [s.type, s.type === 'uint8' ? 1 : s.type === 'uint16' ? 2 : 4];
  const layout = parseMetadataLayout(metadata, required);
  if (descriptor.sources.reduce((sum, source) => sum + source.points, 0) !== layout.points) throw new Error('Source point count mismatch');
  return layout;
}
function decode(bytes: Buffer, index: number, layout: Layout, descriptor: PreparedCloudDescriptor) {
  const at = index * layout.stride;
  if (!Number.isSafeInteger(index) || index < 0 || at + layout.stride > bytes.length) throw new Error('Point index out of range');
  const positions = [0, 1, 2].map(axis => bytes.readInt32LE(at + layout.fields.position + axis * 4) * layout.scale[axis] + layout.offset[axis]);
  if (positions.some((n, axis) => !Number.isFinite(n) || n < layout.bounds.min[axis] - 0.002 || n > layout.bounds.max[axis] + 0.002)) throw new Error('Point outside local bounds');
  const colors = [0, 1, 2].map(axis => Math.round(bytes.readUInt16LE(at + layout.fields.rgb + axis * 2) / 257));
  const sourceIds = [bytes.readUInt16LE(at + layout.fields['point source id']), bytes.readUInt32LE(at + layout.fields.source_row)];
  const source = descriptor.sources.find(s => s.id === sourceIds[0]);
  if (!source || sourceIds[1] >= source.points) throw new Error('Invalid cloud source key');
  const semantics = descriptor.semantics;
  if (!semantics) return { positions, colors, sourceIds };
  const offset = at + layout.fields[semantics.attribute];
  const label = semantics.type === 'float' ? bytes.readFloatLE(offset) : semantics.type === 'uint16' ? bytes.readUInt16LE(offset) : bytes.readUInt8(offset);
  if (!Number.isInteger(label) || !Object.hasOwn(semantics.classes, String(label))) throw new Error('Unmapped semantic label');
  return { positions, colors, sourceIds, label };
}

class PreparedPotreeReader implements PreparedCloudReader {
  constructor(private readonly id: string, private readonly directory: string) {}
  private async load(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const root = await realpath(this.directory), files: FileHandle[] = [];
    try {
      for (const asset of assets) { signal?.throwIfAborted(); files.push(await safeOpen(root, asset)); }
      const stats = await Promise.all(files.map(file => file.stat()));
      if (stats.some(s => !s.isFile() || !Number.isSafeInteger(s.size))) throw new Error('Invalid cloud asset');
      const descriptorBytes = await readRange(files[0], 0, stats[0].size, READ_LIMITS.json);
      const metadataBytes = await readRange(files[1], 0, stats[1].size, READ_LIMITS.json);
      const descriptor = parsePreparedCloudDescriptor(JSON.parse(descriptorBytes.toString('utf8')));
      if (descriptor.id !== this.id) throw new Error('Cloud identity mismatch');
      const layout = layoutFor(JSON.parse(metadataBytes.toString('utf8')), descriptor);
      const first = await readRange(files[2], 0, layout.firstChunk, READ_LIMITS.hierarchy);
      const identity = (s: typeof stats[number]) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs];
      const revision = createHash('sha256').update(descriptorBytes).update(metadataBytes).update(first).update(JSON.stringify(stats.map(identity))).digest('hex');
      const check = async () => {
        signal?.throwIfAborted();
        for (let i = 0; i < assets.length; i++) {
          const path = join(root, assets[i]);
          if (await realpath(path) !== path || JSON.stringify(identity(await lstat(path))) !== JSON.stringify(identity(stats[i])) ||
            JSON.stringify(identity(await files[i].stat())) !== JSON.stringify(identity(stats[i]))) throw new Error('Cloud artifact changed during read');
        }
        signal?.throwIfAborted();
      };
      const cloud: PreparedCloudInfo = { descriptor, revision, bounds: layout.bounds, totalPoints: layout.points,
        capabilities: { boundedSample: true, semanticLabels: !!descriptor.semantics, fullResolution: false, editing: false } };
      await check();
      return { files, layout, first, cloud, stats, check, close: () => Promise.all(files.map(file => file.close())) };
    } catch (error) { await Promise.all(files.map(file => file.close())); throw error; }
  }
  async info(signal?: AbortSignal): Promise<PreparedCloudInfo> {
    const loaded = await this.load(signal);
    try { await loaded.check(); return loaded.cloud; } finally { await loaded.close(); }
  }
  async sample(revision: string, lod: PointLod, signal?: AbortSignal, purpose: 'harness' | 'display' = 'harness'): Promise<PreparedCloudSample> {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid cloud revision');
    const requestedLod = { budget: lod.budget, depth: lod.depth };
    assertPointLod(requestedLod, purpose);
    const loaded = await this.load(signal);
    try {
      if (loaded.cloud.revision !== revision) throw new Error('Stale cloud revision');
      const nodes = parseHierarchy(loaded.first, loaded.layout, loaded.stats[3].size, loaded.stats[2].size, requestedLod.depth);
      const candidatePoints = nodes.reduce((sum, node) => sum + node.count, 0), indices = sampleIndices(candidatePoints, requestedLod.budget);
      const positions: number[] = [], colors: number[] = [], sourceIds: number[] = [], labels = loaded.cloud.descriptor.semantics ? [] as number[] : undefined;
      const used: string[] = [];
      let cursor = 0, start = 0, bytesRead = loaded.first.length;
      for (const node of nodes) {
        signal?.throwIfAborted();
        if (cursor < indices.length && indices[cursor] < start + node.count) {
          const bytes = await readRange(loaded.files[3], node.offset, node.size, READ_LIMITS.node);
          bytesRead += bytes.length; used.push(node.name);
          while (cursor < indices.length && indices[cursor] < start + node.count) {
            if (cursor % 2048 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
            const point = decode(bytes, indices[cursor++] - start, loaded.layout, loaded.cloud.descriptor);
            positions.push(...point.positions); colors.push(...point.colors); sourceIds.push(...point.sourceIds);
            if (labels) labels.push(point.label!);
          }
        }
        start += node.count;
      }
      await loaded.check();
      const sampleHash = createHash('sha256').update(JSON.stringify({ positions, colors, sourceIds, labels })).digest('hex');
      return { cloud: loaded.cloud, lod: requestedLod, algorithm: 'potree-bfs-even-v1', count: indices.length, candidatePoints,
        positions, colors, sourceIds, ...(labels ? { labels } : {}), nodes: used, bytesRead, sampleHash };
    } finally { await loaded.close(); }
  }
}

/** Registration is startup/operator-owned. Request callers select an ID, never a path. */
export function createPreparedCloudRegistry(registrations: Readonly<Record<string, string>>): { open(id: string): PreparedCloudReader } {
  const roots = new Map(Object.entries(registrations));
  for (const [id, directory] of roots) if (!identifier.test(id) || typeof directory !== 'string' || !directory) throw new Error('Invalid cloud registration');
  return { open(id) {
    if (!roots.has(id)) throw new Error('Unknown prepared cloud');
    return new PreparedPotreeReader(id, roots.get(id)!);
  } };
}
