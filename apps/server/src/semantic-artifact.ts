import { constants, type Stats } from 'node:fs';
import { open, realpath, lstat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DatasetInfo, QueryFailure, QueryErrorCode } from '@spatial/contracts';
import { parseMetadata } from './potree';

export const SEMANTIC_LIMITS = Object.freeze({ metadataBytes: 65536, hierarchyBytes: 65536, readBytes: 4 * 1024 * 1024, checkpointPoints: 8192, depth: 24 });
export const SEMANTIC_CONFIG = Object.freeze({ ...SEMANTIC_LIMITS, pruning: false, tie: 'numeric-source-key', arithmetic: 'xyz-binary64-v1' });
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class SemanticFailure extends Error {
  constructor(readonly code: QueryErrorCode, message: string) { super(message); }
}
export function semanticFailure(error: unknown, signal?: AbortSignal): QueryFailure {
  if (signal?.aborted) return { status: 'incomplete', complete: false, reason: 'cancelled' };
  if (error instanceof SemanticFailure) return { status: 'error', code: error.code };
  const code = (error as { code?: string })?.code;
  if (['ENOMEM', 'EMFILE', 'ENFILE', 'ENOSPC'].includes(code ?? '') || error instanceof RangeError) return { status: 'incomplete', complete: false, reason: 'resource' };
  if (code === 'EIO') return { status: 'incomplete', complete: false, reason: 'transport' };
  return { status: 'error', code: 'unavailable' };
}
export function requireData(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SemanticFailure('corrupt-data', message);
}
function sameStat(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
const assets = ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin'] as const;

/** Scoped, immutable-by-precondition read snapshot. No public path is accepted by a tool request. */
export class SemanticArtifact {
  readonly sourceReads = { metadataBytes: 0, hierarchyBytes: 0, payloadBytes: 0, maxReadBytes: 0 };
  private constructor(readonly root: string, private readonly files: FileHandle[], private readonly stats: Stats[],
    readonly manifestBytes: Buffer, readonly metadataBytes: Buffer, readonly first: Buffer,
    readonly layout: ReturnType<typeof parseMetadata>, readonly sourceCounts: readonly number[], readonly dataset: DatasetInfo) {}

  static async open(directory: string, signal?: AbortSignal): Promise<SemanticArtifact> {
    signal?.throwIfAborted();
    const root = await realpath(directory), files: FileHandle[] = [], stats: Stats[] = [];
    try {
      for (const asset of assets) {
        signal?.throwIfAborted(); const path = join(root, asset);
        requireData(await realpath(path) === path, 'Symlinked asset');
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); files.push(file);
        const stat = await file.stat(); stats.push(stat);
        requireData(stat.isFile() && Number.isSafeInteger(stat.size), 'Invalid asset');
      }
      const read = async (index: number) => {
        requireData(stats[index].size > 0 && stats[index].size <= SEMANTIC_LIMITS.metadataBytes, 'Invalid metadata size');
        const bytes = Buffer.alloc(stats[index].size);
        requireData((await files[index].read(bytes, 0, bytes.length, 0)).bytesRead === bytes.length, 'Truncated metadata');
        return bytes;
      };
      const manifestBytes = await read(0), metadataBytes = await read(1);
      let manifest: Record<string, unknown>, layout: ReturnType<typeof parseMetadata>;
      try { manifest = JSON.parse(manifestBytes.toString()); requireData(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid manifest'); layout = parseMetadata(JSON.parse(metadataBytes.toString())); }
      catch { throw new SemanticFailure('corrupt-data', 'Invalid metadata'); }
      requireData(manifest.units === 'm' && manifest.frame === 'right-handed Z-up' &&
        JSON.stringify(manifest.local_origin_world) === '[627285,4841948,0]' &&
        manifest.semantic_attribute === 'scalar_Label' && (manifest.semantic_classes as Record<string, unknown>)?.['6'] === 'Pole' &&
        JSON.stringify(manifest.potree_scale_m) === JSON.stringify(layout.scale), 'Unsupported dataset binding');
      requireData(Array.isArray(manifest.sources) && manifest.sources.length === 4, 'Invalid sources');
      const sourceCounts = Array<number>(5).fill(-1);
      for (const source of manifest.sources as { source_file_id: number; points: number; file: string }[]) {
        requireData(source && Number.isSafeInteger(source.source_file_id) && source.source_file_id >= 1 && source.source_file_id <= 4 &&
          sourceCounts[source.source_file_id] === -1 && Number.isSafeInteger(source.points) && source.points >= 0 && source.points <= 0x100000000 &&
          source.file === `L${String(source.source_file_id).padStart(3, '0')}.ply`, 'Invalid source mapping');
        sourceCounts[source.source_file_id] = source.points;
      }
      requireData(sourceCounts.slice(1).reduce((sum, count) => sum + count, 0) === layout.points && layout.rootBox, 'Point count/root mismatch');
      const first = Buffer.alloc(layout.firstChunk);
      requireData((await files[2].read(first, 0, first.length, 0)).bytesRead === first.length, 'Truncated root hierarchy');
      const revision = createHash('sha256').update(metadataBytes).update(manifestBytes).update(first).update(`${stats[3].size}:${stats[3].mtimeMs}`).digest('hex');
      const dataset: DatasetInfo = { id: 'toronto3d', revision, totalPoints: layout.points, bounds: layout.bounds,
        coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] } };
      const snapshot = new SemanticArtifact(root, files, stats, manifestBytes, metadataBytes, first, layout, sourceCounts, dataset);
      snapshot.sourceReads.metadataBytes = manifestBytes.length + metadataBytes.length;
      snapshot.sourceReads.hierarchyBytes = first.length;
      snapshot.sourceReads.maxReadBytes = Math.max(manifestBytes.length, metadataBytes.length, first.length);
      await snapshot.check(signal); return snapshot;
    } catch (error) { await Promise.all(files.map(file => file.close())); throw error; }
  }
  get hierarchySize() { return this.stats[2].size; }
  get payloadSize() { return this.stats[3].size; }
  async read(kind: 'hierarchy' | 'payload', offset: number, size: number, signal?: AbortSignal) {
    signal?.throwIfAborted(); const index = kind === 'hierarchy' ? 2 : 3;
    const max = kind === 'hierarchy' ? SEMANTIC_LIMITS.hierarchyBytes : SEMANTIC_LIMITS.readBytes;
    requireData(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && size <= max && offset <= this.stats[index].size - size, 'Invalid bounded read');
    const bytes = Buffer.alloc(size);
    requireData((await this.files[index].read(bytes, 0, size, offset)).bytesRead === size, 'Truncated asset read');
    this.sourceReads[kind === 'hierarchy' ? 'hierarchyBytes' : 'payloadBytes'] += bytes.length;
    this.sourceReads.maxReadBytes = Math.max(this.sourceReads.maxReadBytes, bytes.length);
    signal?.throwIfAborted(); return bytes;
  }
  async check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    for (let i = 0; i < assets.length; i++) {
      let current: Stats;
      try { current = await lstat(join(this.root, assets[i])); }
      catch { throw new SemanticFailure('stale-revision', 'Artifact replaced'); }
      if (!sameStat(this.stats[i], current) || !sameStat(this.stats[i], await this.files[i].stat()) ||
        await realpath(join(this.root, assets[i])) !== join(this.root, assets[i])) throw new SemanticFailure('stale-revision', 'Artifact changed');
    }
    // Check the fingerprint bytes as well as file identity; this is still not a full integrity hash.
    for (const [index, expected] of [[0, this.manifestBytes], [1, this.metadataBytes], [2, this.first]] as const) {
      const bytes = Buffer.alloc(expected.length);
      if ((await this.files[index].read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length || !bytes.equals(expected)) throw new SemanticFailure('stale-revision', 'Fingerprint changed');
      this.sourceReads[index === 2 ? 'hierarchyBytes' : 'metadataBytes'] += bytes.length;
      this.sourceReads.maxReadBytes = Math.max(this.sourceReads.maxReadBytes, bytes.length);
    }
    signal?.throwIfAborted();
  }
  async close() { await Promise.all(this.files.map(file => file.close())); }
}
