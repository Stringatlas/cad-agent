import { readDisplayHierarchy, DISPLAY_LIMITS, type NativeDisplayNode, type DisplayNode } from './adaptive-display';
import type { PreparedNodeInput } from '@spatial/contracts';
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
  readonly instances?: { readonly attribute: string; readonly type: 'int32'; readonly unassigned: number };
}
export interface PreparedCloudInfo {
  readonly descriptor: PreparedCloudDescriptor;
  /** Fingerprint of descriptor/metadata/first hierarchy chunk plus asset identities, not a full content digest. */
  readonly revision: string;
  readonly bounds: CropBox;
  readonly totalPoints: number;
  readonly capabilities: { readonly boundedSample: true; readonly adaptiveDisplay: true; readonly semanticLabels: boolean; readonly instanceLabels?: boolean; readonly fullResolution: false; readonly editing: false };
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
  readonly instances?: number[];
  readonly nodes: string[];
  readonly bytesRead: number;
  readonly sampleHash: string;
}
export interface PreparedCloudReader {
  info(signal?: AbortSignal): Promise<PreparedCloudInfo>;
  sample(revision: string, lod: PointLod, signal?: AbortSignal, purpose?: 'harness' | 'display'): Promise<PreparedCloudSample>;
  displayHierarchy(revision: string, signal?: AbortSignal): Promise<{ cloud: PreparedCloudInfo; nodes: DisplayNode[] }>;
  displayNode(revision: string, name: string, signal?: AbortSignal): Promise<PreparedNodeInput>;
  queryOriginal(revision: string, query: PreparedPointQuery, signal?: AbortSignal): Promise<PreparedQueryResult>;
}
export interface PreparedPointQuery {
  operation: 'nearest' | 'radius' | 'box' | 'key'; position?: Vec3; radiusMeters?: number;
  bounds?: CropBox; label?: number | null; maxResults: number;
  key?: { sourceFileId: number; sourceRow: number };
}
export interface PreparedSourcePoint { key: { sourceFileId: number; sourceRow: number }; position: Vec3; label?: number; instanceId?: number }
export interface PreparedQueryResult { complete: true; count: number; checkedPoints: number; points: PreparedSourcePoint[] }
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
  let instances: PreparedCloudDescriptor['instances'];
  if (d.instances !== undefined) {
    const i = record(d.instances);
    if (typeof i.attribute !== 'string' || !identifier.test(i.attribute) || i.type !== 'int32' ||
      ['position', 'rgb', 'point source id', 'source_row', semantics?.attribute].includes(i.attribute) ||
      !Number.isInteger(i.unassigned) || Number(i.unassigned) < -2147483648 || Number(i.unassigned) > 2147483647) throw new Error('Unsupported instance mapping');
    instances = { attribute: i.attribute, type: 'int32', unassigned: Number(i.unassigned) };
  }
  return { version: 1, format: 'potree2-uncompressed', id: d.id, frameId: d.frameId,
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin }, sources, ...(semantics ? { semantics } : {}), ...(instances ? { instances } : {}) };
}

function layoutFor(metadata: unknown, descriptor: PreparedCloudDescriptor): Layout {
  const required: Record<string, readonly [string, number]> = { position: ['int32', 12], rgb: ['uint16', 6], 'point source id': ['uint16', 2], source_row: ['uint32', 4] };
  const s = descriptor.semantics;
  if (s) required[s.attribute] = [s.type, s.type === 'uint8' ? 1 : s.type === 'uint16' ? 2 : 4];
  if (descriptor.instances) required[descriptor.instances.attribute] = ['int32', 4];
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
  const instance = descriptor.instances ? bytes.readInt32LE(at + layout.fields[descriptor.instances.attribute]) : undefined;
  if (!semantics) return { positions, colors, sourceIds, instance };
  const offset = at + layout.fields[semantics.attribute];
  const label = semantics.type === 'float' ? bytes.readFloatLE(offset) : semantics.type === 'uint16' ? bytes.readUInt16LE(offset) : bytes.readUInt8(offset);
  if (!Number.isInteger(label) || !Object.hasOwn(semantics.classes, String(label))) throw new Error('Unmapped semantic label');
  return { positions, colors, sourceIds, label, instance };
}

class PreparedPotreeReader implements PreparedCloudReader {
  private catalog?: { revision: string; nodes: NativeDisplayNode[]; byName: Map<string, NativeDisplayNode> };
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
        capabilities: { boundedSample: true, adaptiveDisplay: true, semanticLabels: !!descriptor.semantics, instanceLabels: !!descriptor.instances, fullResolution: false, editing: false } };
      await check();
      return { files, layout, first, cloud, stats, check, close: () => Promise.all(files.map(file => file.close())) };
    } catch (error) { await Promise.all(files.map(file => file.close())); throw error; }
  }
  async info(signal?: AbortSignal): Promise<PreparedCloudInfo> {
    const loaded = await this.load(signal);
    try { await loaded.check(); return loaded.cloud; } finally { await loaded.close(); }
  }
  private async nativeNodes(loaded: Awaited<ReturnType<PreparedPotreeReader['load']>>, signal?: AbortSignal) {
    if (this.catalog?.revision === loaded.cloud.revision) return this.catalog;
    if (!loaded.layout.rootBox) throw new Error('Missing native root bounds');
    const nodes = await readDisplayHierarchy({ first: loaded.first, rootBox: loaded.layout.rootBox,
      hierarchySize: loaded.stats[2].size, payloadSize: loaded.stats[3].size, stride: loaded.layout.stride,
      totalPoints: loaded.cloud.totalPoints,
      readHierarchy: (offset, size) => readRange(loaded.files[2], offset, size, DISPLAY_LIMITS.hierarchyBytes),
    }, signal);
    await loaded.check();
    return this.catalog = { revision: loaded.cloud.revision, nodes, byName: new Map(nodes.map(node => [node.name, node])) };
  }
  async displayHierarchy(revision: string, signal?: AbortSignal) {
    const loaded = await this.load(signal);
    try {
      if (loaded.cloud.revision !== revision) throw new Error('Stale cloud revision');
      const { nodes } = await this.nativeNodes(loaded, signal);
      await loaded.check();
      return { cloud: loaded.cloud, nodes: nodes.map(({ name, count, bounds }) => ({ name, count, bounds })) };
    } finally { await loaded.close(); }
  }
  async displayNode(revision: string, name: string, signal?: AbortSignal): Promise<PreparedNodeInput> {
    if (!/^[a-f0-9]{64}$/.test(revision) || !/^r[0-7]{0,24}$/.test(name)) throw new RangeError('Invalid native node request');
    const loaded = await this.load(signal);
    try {
      if (loaded.cloud.revision !== revision) throw new Error('Stale cloud revision');
      const node = (await this.nativeNodes(loaded, signal)).byName.get(name);
      if (!node) throw new RangeError('Unknown native node');
      const bytes = await readRange(loaded.files[3], node.offset, node.size, DISPLAY_LIMITS.nodeBytes);
      const positions = new Float64Array(node.count * 3), colors = new Uint8Array(node.count * 3), sourceIds = new Uint32Array(node.count * 2);
      const labels = loaded.cloud.descriptor.semantics ? new Uint16Array(node.count) : undefined;
      const instances = loaded.cloud.descriptor.instances ? new Int32Array(node.count) : undefined;
      for (let i = 0; i < node.count; i++) {
        if (i % 2048 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
        const point = decode(bytes, i, loaded.layout, loaded.cloud.descriptor);
        positions.set(point.positions, i * 3); colors.set(point.colors, i * 3); sourceIds.set(point.sourceIds, i * 2);
        if (labels) labels[i] = point.label!;
        if (instances) instances[i] = point.instance!;
      }
      await loaded.check();
      return { cloudId: this.id, revision, name, count: node.count, positions, colors, sourceIds, ...(labels ? { labels } : {}), ...(instances ? { instances } : {}) };
    } finally { await loaded.close(); }
  }
  /** Exact source scan, bounded buffers and witnesses, independent of displayed LOD. */
  async queryOriginal(revision: string, query: PreparedPointQuery, signal?: AbortSignal): Promise<PreparedQueryResult> {
    const q = structuredClone(query);
    const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1e7);
    if (!/^[a-f0-9]{64}$/.test(revision) || !['nearest', 'radius', 'box', 'key'].includes(q.operation) ||
      !Number.isInteger(q.maxResults) || q.maxResults < 1 || q.maxResults > 64 ||
      (q.operation === 'box' && (!q.bounds || !vector(q.bounds.min) || !vector(q.bounds.max) || q.bounds.min.some((n, a) => n > q.bounds!.max[a]))) ||
      (['nearest', 'radius'].includes(q.operation) && !vector(q.position)) ||
      (q.operation === 'radius' && (!Number.isFinite(q.radiusMeters) || q.radiusMeters! < 0 || q.radiusMeters! > 1000)) ||
      (q.operation === 'key' && (!q.key || !Number.isInteger(q.key.sourceFileId) || !Number.isInteger(q.key.sourceRow) || q.key.sourceRow < 0))) throw new RangeError('Invalid original-source query');
    const loaded = await this.load(signal);
    try {
      if (loaded.cloud.revision !== revision) throw new Error('Stale cloud revision');
      const { layout, cloud } = loaded, semantics = cloud.descriptor.semantics;
      if (q.label != null && (!Number.isInteger(q.label) || !semantics || !Object.hasOwn(semantics.classes, String(q.label)))) throw new RangeError('Unknown bound semantic ID');
      if (loaded.stats[3].size !== layout.points * layout.stride) throw new Error('Incomplete physical payload');
      const records = Math.max(1, Math.floor(READ_LIMITS.node / layout.stride));
      const result: PreparedQueryResult = { complete: true, count: 0, checkedPoints: 0, points: [] };
      let nearestDistance = Infinity;
      for (let start = 0; start < layout.points; start += records) {
        signal?.throwIfAborted();
        const count = Math.min(records, layout.points - start);
        const bytes = await readRange(loaded.files[3], start * layout.stride, count * layout.stride, READ_LIMITS.node);
        for (let i = 0; i < count; i++) {
          const at = i * layout.stride;
          result.checkedPoints++;
          if (q.operation === 'key' && (bytes.readUInt16LE(at + layout.fields['point source id']) !== q.key!.sourceFileId || bytes.readUInt32LE(at + layout.fields.source_row) !== q.key!.sourceRow)) continue;
          if (q.label != null && semantics) {
            const p = at + layout.fields[semantics.attribute];
            const label = semantics.type === 'float' ? bytes.readFloatLE(p) : semantics.type === 'uint16' ? bytes.readUInt16LE(p) : bytes.readUInt8(p);
            if (label !== q.label) continue;
          }
          const xyz = [0, 1, 2].map(a => bytes.readInt32LE(at + layout.fields.position + a * 4) * layout.scale[a] + layout.offset[a]) as unknown as Vec3;
          const distance = q.position ? xyz.reduce((sum, n, a) => sum + (n - q.position![a]) ** 2, 0) : 0;
          if (q.operation === 'box' && xyz.some((n, a) => n < q.bounds!.min[a] || n > q.bounds!.max[a]) ||
              q.operation === 'radius' && distance > q.radiusMeters! ** 2) continue;
          result.count++;
          if (q.operation === 'nearest' && distance > nearestDistance) continue;
          if (q.operation !== 'nearest' && result.points.length >= q.maxResults) continue;
          const point = decode(bytes, i, layout, cloud.descriptor);
          const record: PreparedSourcePoint = { key: { sourceFileId: point.sourceIds[0], sourceRow: point.sourceIds[1] },
            position: point.positions as unknown as Vec3, ...(point.label !== undefined ? { label: point.label } : {}),
            ...(point.instance !== undefined ? { instanceId: point.instance } : {}) };
          if (q.operation === 'nearest') {
            const previous = result.points[0];
            if (distance === nearestDistance && previous && (record.key.sourceFileId > previous.key.sourceFileId || record.key.sourceFileId === previous.key.sourceFileId && record.key.sourceRow >= previous.key.sourceRow)) continue;
            nearestDistance = distance; result.points = [record];
          } else result.points.push(record);
        }
        await yieldTurn();
      }
      if (q.operation === 'nearest') result.count = result.points.length;
      await loaded.check(); return result;
    } finally { await loaded.close(); }
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
      const instances = loaded.cloud.descriptor.instances ? [] as number[] : undefined;
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
            if (instances) instances.push(point.instance!);
          }
        }
        start += node.count;
      }
      await loaded.check();
      const sampleHash = createHash('sha256').update(JSON.stringify({ positions, colors, sourceIds, labels, ...(instances ? { instances } : {}) })).digest('hex');
      return { cloud: loaded.cloud, lod: requestedLod, algorithm: 'potree-bfs-even-v1', count: indices.length, candidatePoints,
        positions, colors, sourceIds, ...(labels ? { labels } : {}), ...(instances ? { instances } : {}), nodes: used, bytesRead, sampleHash };
    } finally { await loaded.close(); }
  }
}

/** Registration is startup/operator-owned. Request callers select an ID, never a path. */
export function createPreparedCloudRegistry(registrations: Readonly<Record<string, string>>): { open(id: string): PreparedCloudReader } {
  const roots = new Map(Object.entries(registrations));
  const readers = new Map<string, PreparedCloudReader>();
  for (const [id, directory] of roots) if (!identifier.test(id) || typeof directory !== 'string' || !directory) throw new Error('Invalid cloud registration');
  return { open(id) {
    if (!roots.has(id)) throw new Error('Unknown prepared cloud');
    let reader = readers.get(id);
    if (!reader) { reader = new PreparedPotreeReader(id, roots.get(id)!); readers.set(id, reader); }
    return reader;
  } };
}
