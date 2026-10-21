import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { TORONTO_SEMANTIC_LABELS, type Vec3, type PointWitness } from '@spatial/contracts';
import { SemanticArtifact, SemanticFailure, SEMANTIC_LIMITS, digest, requireData } from './semantic-artifact';
import type { SemanticProgressHandler } from './semantic-query';

export const recordBytes = 40;
export const pagePoints = 4096;
export const cacheRoot = join(tmpdir(), 'spatial-cad-semantic-disk-v1');
export const semanticDiskMemoryBudget = 96 * 1024 * 1024;
const VERSION = 'semantic-disk-index-v1';
const PARTITION_ROWS = 262144, TUPLE_BUFFER = 16384, MAX_SPOOL_BUFFERS = 8 * 1024 * 1024;
const LOOKUP_PAGE_BYTES = pagePoints * 4, PAGE_METADATA_BYTES = 40 + 9 * 52;
const MAX_METADATA_WEIGHT = 40 * 1024 * 1024, HEADER_BYTES = 4 * 1024 * 1024;
const MAX_HIERARCHY_RECORDS = 65536;
const CONFIG = { version: VERSION, recordBytes, pagePoints, lookupPageBytes: LOOKUP_PAGE_BYTES,
  pageMetadataBytes: PAGE_METADATA_BYTES, arithmetic: 'xyz-binary64-v1', tie: 'numeric-source-key' };
export interface SemanticPageLabel { readonly count: number; readonly min: Vec3; readonly max: Vec3 }
export interface SemanticDiskPage { readonly start: number; readonly count: number; readonly hash: string; readonly labels: readonly (SemanticPageLabel | null)[] }
export interface SemanticLookup { readonly bytes: number; readonly pages: readonly string[] }
interface HeaderBody {
  version: typeof VERSION; config: typeof CONFIG; identity: string; revision: string; totalPoints: number;
  counts: number[]; sourceHash: string; pageCount: number; pageMetadataHash: string; lookup: SemanticLookup[];
}
interface Header extends HeaderBody { hash: string }
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const weight = (points: number) => Math.ceil(points / pagePoints) * (256 + 9 * 160) + Math.ceil(points / pagePoints) * 192;
const sameStat = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function checkpoint(signal?: AbortSignal) { signal?.throwIfAborted(); await yieldTurn(); signal?.throwIfAborted(); }
async function cacheBase() {
  const base = join(await realpath(tmpdir()), 'spatial-cad-semantic-disk-v1');
  await mkdir(base, { recursive: true, mode: 0o700 });
  requireData(await realpath(base) === base && (await lstat(base)).isDirectory(), 'Invalid semantic cache root');
  return base;
}
async function binding(snapshot: SemanticArtifact, signal?: AbortSignal) {
  const identities = [];
  await snapshot.check(signal);
  for (const asset of ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']) {
    const s = await lstat(join(snapshot.root, asset)); identities.push([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
  }
  await snapshot.check(signal);
  return digest(JSON.stringify([CONFIG, snapshot.root, snapshot.dataset.revision, identities]));
}
async function secureStat(path: string, size?: number) {
  try {
    requireData(await realpath(path) === path, 'Symlinked semantic cache');
    const s = await lstat(path);
    requireData(s.isFile() && Number.isSafeInteger(s.size) && (size === undefined || s.size === size), 'Invalid semantic cache file');
    return s;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new SemanticFailure('corrupt-data', 'Missing/replaced semantic cache file');
    throw error;
  }
}
async function boundedRead(path: string, offset: number, length: number, expected: Stats, signal?: AbortSignal) {
  signal?.throwIfAborted();
  requireData(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 &&
    length <= SEMANTIC_LIMITS.readBytes && offset <= expected.size - length, 'Invalid semantic cache read');
  requireData(sameStat(expected, await secureStat(path, expected.size)), 'Semantic cache changed');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    requireData(sameStat(expected, await file.stat()), 'Semantic cache replaced');
    const bytes = Buffer.alloc(length);
    requireData((await file.read(bytes, 0, length, offset)).bytesRead === length, 'Truncated semantic cache read');
    requireData(sameStat(expected, await file.stat()) && sameStat(expected, await secureStat(path, expected.size)), 'Semantic cache changed during read');
    signal?.throwIfAborted(); return bytes;
  } finally { await file.close(); }
}
async function writeAll(file: FileHandle, bytes: Buffer) {
  let at = 0;
  while (at < bytes.length) { const { bytesWritten } = await file.write(bytes, at, bytes.length - at); requireData(bytesWritten > 0, 'Incomplete cache write'); at += bytesWritten; }
}

class IncompleteSemanticCache extends SemanticFailure {
  constructor() { super('corrupt-data', 'Incomplete semantic cache'); }
}

/** A manifest-only cache. Record and lookup buffers are always bounded, request-owned reads. */
export class SemanticDiskIndex {
  readonly directory: string; readonly hash: string; readonly totalPoints: number; readonly counts: readonly number[];
  readonly pages: readonly SemanticDiskPage[]; readonly sourceHash: string; readonly lookup: readonly SemanticLookup[];
  readonly revision: string; readonly identity: string;
  private constructor(directory: string, header: Header, pages: SemanticDiskPage[], private readonly stats: ReadonlyMap<string, Stats>) {
    this.directory = directory; this.hash = header.hash; this.totalPoints = header.totalPoints; this.counts = Object.freeze(header.counts);
    this.pages = Object.freeze(pages); this.sourceHash = header.sourceHash; this.lookup = Object.freeze(header.lookup.map(l => Object.freeze({ bytes: l.bytes, pages: Object.freeze(l.pages) })));
    this.revision = header.revision; this.identity = header.identity;
  }
  static async load(directory: string, identity: string, snapshot: SemanticArtifact, signal?: AbortSignal): Promise<SemanticDiskIndex | undefined> {
    let stat: Stats;
    try { stat = await lstat(join(directory, 'index.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Recovery is explicit in locateCache, never an implicit acceptance of partial data.
      let directoryStat: Stats;
      try { directoryStat = await lstat(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      requireData(directoryStat.isDirectory() && !directoryStat.isSymbolicLink() && await realpath(directory) === directory, 'Symlinked semantic cache directory');
      throw new IncompleteSemanticCache();
    } throw error; }
    requireData(await realpath(directory) === directory && (await lstat(directory)).isDirectory(), 'Symlinked semantic cache directory');
    requireData(stat.size > 0 && stat.size <= HEADER_BYTES, 'Invalid semantic manifest size');
    const manifest = await boundedRead(join(directory, 'index.json'), 0, stat.size, stat, signal);
    let header: Header;
    try { header = JSON.parse(manifest.toString()); } catch { throw new SemanticFailure('corrupt-data', 'Invalid semantic manifest'); }
    requireData(header && typeof header === 'object' && !Array.isArray(header), 'Invalid semantic manifest');
    const { hash, ...body } = header;
    requireData(validHash(hash) && hash === digest(JSON.stringify(body)) && header.version === VERSION &&
      JSON.stringify(header.config) === JSON.stringify(CONFIG) && header.identity === identity && header.revision === snapshot.dataset.revision &&
      header.totalPoints === snapshot.dataset.totalPoints && Number.isSafeInteger(header.totalPoints) && header.totalPoints >= 0 && header.totalPoints < 0xffffffff &&
      weight(header.totalPoints) <= MAX_METADATA_WEIGHT && header.pageCount === Math.ceil(header.totalPoints / pagePoints) &&
      validHash(header.sourceHash) && validHash(header.pageMetadataHash) && Array.isArray(header.counts) && header.counts.length === 9 &&
      header.counts.every(n => Number.isSafeInteger(n) && n >= 0) && header.counts.reduce((a, b) => a + b, 0) === header.totalPoints &&
      Array.isArray(header.lookup) && header.lookup.length === 4, 'Invalid semantic cache binding');
    const stats = new Map<string, Stats>([['index.json', stat]]);
    for (let file = 1; file <= 4; file++) {
      const table = header.lookup[file - 1], size = snapshot.sourceCounts[file] * 4;
      requireData(table && typeof table === 'object' && table.bytes === size && Array.isArray(table.pages) &&
        table.pages.length === Math.ceil(size / LOOKUP_PAGE_BYTES) && table.pages.every(validHash), 'Invalid shared lookup metadata');
      stats.set(`source-${file}.bin`, await secureStat(join(directory, `source-${file}.bin`), size));
    }
    stats.set('records.bin', await secureStat(join(directory, 'records.bin'), header.totalPoints * recordBytes));
    const pageStat = await secureStat(join(directory, 'pages.bin'), header.pageCount * PAGE_METADATA_BYTES); stats.set('pages.bin', pageStat);
    const pages: SemanticDiskPage[] = [], sums = Array<number>(9).fill(0), checksum = createHash('sha256');
    const perRead = Math.floor(SEMANTIC_LIMITS.readBytes / PAGE_METADATA_BYTES);
    for (let start = 0; start < header.pageCount; start += perRead) {
      await checkpoint(signal);
      const bytes = await boundedRead(join(directory, 'pages.bin'), start * PAGE_METADATA_BYTES,
        Math.min(perRead, header.pageCount - start) * PAGE_METADATA_BYTES, pageStat, signal); checksum.update(bytes);
      for (let at = 0; at < bytes.length; at += PAGE_METADATA_BYTES) {
        const number = start + at / PAGE_METADATA_BYTES, count = Math.min(pagePoints, header.totalPoints - number * pagePoints);
        requireData(bytes.readUInt32LE(at) === number * pagePoints && bytes.readUInt32LE(at + 4) === count, 'Incomplete semantic page coverage');
        const labels: (SemanticPageLabel | null)[] = []; let total = 0;
        for (let label = 0; label < 9; label++) {
          const p = at + 40 + label * 52, n = bytes.readUInt32LE(p);
          const min: Vec3 = [bytes.readDoubleLE(p + 4), bytes.readDoubleLE(p + 12), bytes.readDoubleLE(p + 20)];
          const max: Vec3 = [bytes.readDoubleLE(p + 28), bytes.readDoubleLE(p + 36), bytes.readDoubleLE(p + 44)];
          requireData(n <= count && [...min, ...max].every(Number.isFinite) && min.every((v, axis) => v <= max[axis]) &&
            (n > 0 || [...min, ...max].every(v => v === 0)) && (n === 0 || min.every((v, axis) => v >= snapshot.layout.bounds.min[axis] - .002 && max[axis] <= snapshot.layout.bounds.max[axis] + .002)), 'Invalid semantic page bounds');
          labels.push(n ? Object.freeze({ count: n, min: Object.freeze(min), max: Object.freeze(max) }) : null); sums[label] += n; total += n;
        }
        requireData(total === count, 'Invalid semantic page count');
        pages.push(Object.freeze({ start: number * pagePoints, count, hash: bytes.subarray(at + 8, at + 40).toString('hex'), labels: Object.freeze(labels) }));
      }
    }
    requireData(checksum.digest('hex') === header.pageMetadataHash && sums.every((n, i) => n === header.counts[i]), 'Semantic metadata checksum/count mismatch');
    const index = new SemanticDiskIndex(directory, header, pages, stats); await index.check(signal); return index;
  }
  async check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    requireData(await realpath(this.directory) === this.directory, 'Semantic cache directory changed');
    for (const [name, stat] of this.stats) { signal?.throwIfAborted(); requireData(sameStat(stat, await secureStat(join(this.directory, name), stat.size)), 'Active semantic cache changed'); }
    signal?.throwIfAborted();
  }
  async readPage(page: SemanticDiskPage, signal?: AbortSignal): Promise<Buffer> {
    requireData(this.pages[page.start / pagePoints] === page, 'Unknown semantic page');
    const bytes = await boundedRead(join(this.directory, 'records.bin'), page.start * recordBytes, page.count * recordBytes, this.stats.get('records.bin')!, signal);
    requireData(digest(bytes) === page.hash, 'Semantic record page checksum mismatch'); return bytes;
  }
  async resolvePhysical(key: PointWitness['key'], signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    const { sourceFileId: file, sourceRow: row } = key;
    if (!Number.isInteger(file) || file < 1 || file > 4 || !Number.isInteger(row) || row < 0 || row >= this.lookup[file - 1].bytes / 4) throw new SemanticFailure('unknown-point', 'Unknown source point');
    const table = this.lookup[file - 1], offset = Math.floor(row / pagePoints) * LOOKUP_PAGE_BYTES;
    const bytes = await boundedRead(join(this.directory, `source-${file}.bin`), offset, Math.min(LOOKUP_PAGE_BYTES, table.bytes - offset), this.stats.get(`source-${file}.bin`)!, signal);
    requireData(digest(bytes) === table.pages[Math.floor(row / pagePoints)], 'Shared lookup checksum mismatch');
    const physical = bytes.readUInt32LE(row * 4 - offset); requireData(physical < this.totalPoints, 'Invalid physical source reference'); return physical;
  }
}

/** Validate every hierarchy record and full nonoverlapping payload coverage before reading data. */
async function validateHierarchy(snapshot: SemanticArtifact, signal?: AbortSignal) {
  requireData(snapshot.hierarchySize % 22 === 0, 'Invalid hierarchy size');
  if (snapshot.hierarchySize / 22 > MAX_HIERARCHY_RECORDS) throw new RangeError('Hierarchy metadata budget exceeded');
  const chunks: [number, number][] = [], payloads: [number, number][] = [], seen = new Set<number>();
  const pending = [{ name: 'r', offset: 0, size: snapshot.first.length, expected: undefined as number[] | undefined }];
  while (pending.length) {
    await checkpoint(signal); const chunk = pending.pop()!;
    requireData(chunk.size > 0 && chunk.size % 22 === 0 && chunk.size <= SEMANTIC_LIMITS.hierarchyBytes && !seen.has(chunk.offset), 'Invalid/cyclic hierarchy chunk');
    seen.add(chunk.offset); chunks.push([chunk.offset, chunk.offset + chunk.size]);
    requireData(chunks.length + pending.length <= MAX_HIERARCHY_RECORDS, 'Hierarchy metadata budget exceeded');
    const bytes = chunk.offset === 0 ? snapshot.first : await snapshot.read('hierarchy', chunk.offset, chunk.size, signal), queue = [chunk.name];
    for (let i = 0; i < bytes.length / 22; i++) {
      const name = queue[i], at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
      const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
      requireData(name && name.length <= SEMANTIC_LIMITS.depth + 1 && type <= 2 && Number.isSafeInteger(offset) && Number.isSafeInteger(size), 'Invalid hierarchy record');
      if (i === 0 && chunk.expected) requireData(type !== 2 && mask === chunk.expected[0] && count === chunk.expected[1], 'Hierarchy proxy mismatch');
      if (type === 2) {
        requireData(offset >= 0 && size > 0 && offset <= snapshot.hierarchySize - size, 'Invalid hierarchy proxy range');
        pending.push({ name, offset, size, expected: [mask, count] });
      } else {
        requireData(size === count * snapshot.layout.stride && offset % snapshot.layout.stride === 0 && offset >= 0 && offset <= snapshot.payloadSize - size && (type === 1 ? mask === 0 : mask !== 0), 'Invalid hierarchy payload range');
        if (size) payloads.push([offset, offset + size]);
        for (let child = 0; child < 8; child++) if (mask & (1 << child)) queue.push(name + child);
        requireData(queue.length <= bytes.length / 22, 'Missing hierarchy children');
      }
    }
    requireData(queue.length === bytes.length / 22, 'Unreachable hierarchy records');
  }
  for (const [ranges, size] of [[chunks, snapshot.hierarchySize], [payloads, snapshot.payloadSize]] as const) {
    ranges.sort((a, b) => a[0] - b[0]); let cursor = 0;
    for (const [start, end] of ranges) { requireData(start === cursor, 'Incomplete/overlapping hierarchy coverage'); cursor = end; }
    requireData(cursor === size, 'Incomplete hierarchy coverage');
  }
}
interface Partition { file: number; start: number; rows: number; path: string; buffer: Buffer; used: number; tuples: number }
async function flush(part: Partition, signal?: AbortSignal) {
  if (!part.used) return; signal?.throwIfAborted();
  const output = await open(part.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { await writeAll(output, part.buffer.subarray(0, part.used)); } finally { await output.close(); }
  part.used = 0; signal?.throwIfAborted();
}
async function build(directory: string, identity: string, snapshot: SemanticArtifact, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  const { layout } = snapshot, { stride, fields, scale, offset, bounds } = layout;
  requireData(snapshot.payloadSize === layout.points * stride && layout.points < 0xffffffff, 'Invalid semantic payload size');
  if (weight(layout.points) > MAX_METADATA_WEIGHT) throw new RangeError('Semantic index metadata budget exceeded');
  const partitionsCount = snapshot.sourceCounts.slice(1).reduce((sum, n) => sum + Math.ceil(n / PARTITION_ROWS), 0);
  if (partitionsCount * TUPLE_BUFFER > MAX_SPOOL_BUFFERS) throw new RangeError('Shared provenance buffer budget exceeded');
  await validateHierarchy(snapshot, signal);
  const staging = await mkdtemp(join(await cacheBase(), '.building-'));
  try {
    const partitions: Partition[][] = snapshot.sourceCounts.slice(1).map((count, i) => Array.from({ length: Math.ceil(count / PARTITION_ROWS) }, (_, n) => ({
      file: i + 1, start: n * PARTITION_ROWS, rows: Math.min(PARTITION_ROWS, count - n * PARTITION_ROWS),
      path: join(staging, `partition-${i + 1}-${n}.bin`), buffer: Buffer.alloc(TUPLE_BUFFER), used: 0, tuples: 0 })));
    const records = await open(join(staging, 'records.bin'), 'wx', 0o600);
    let metadata: FileHandle;
    try { metadata = await open(join(staging, 'pages.bin'), 'wx', 0o600); } catch (error) { await records.close(); throw error; }
    const sourceHash = createHash('sha256'), metadataHash = createHash('sha256'), counts = Array<number>(9).fill(0);
    let page = Buffer.alloc(pagePoints * recordBytes), inPage = 0, pageStart = 0;
    let labels: { count: number; min: number[]; max: number[] }[] = Array.from({ length: 9 }, () => ({ count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    const emitPage = async () => {
      if (!inPage) return;
      const bytes = page.subarray(0, inPage * recordBytes), meta = Buffer.alloc(PAGE_METADATA_BYTES);
      meta.writeUInt32LE(pageStart, 0); meta.writeUInt32LE(inPage, 4); Buffer.from(digest(bytes), 'hex').copy(meta, 8);
      for (let label = 0; label < 9; label++) {
        const summary = labels[label], at = 40 + label * 52; meta.writeUInt32LE(summary.count, at);
        for (let axis = 0; axis < 3; axis++) { meta.writeDoubleLE(summary.count ? summary.min[axis] : 0, at + 4 + axis * 8); meta.writeDoubleLE(summary.count ? summary.max[axis] : 0, at + 28 + axis * 8); }
      }
      await writeAll(records, bytes); await writeAll(metadata, meta); metadataHash.update(meta);
      pageStart += inPage; inPage = 0;
      labels = Array.from({ length: 9 }, () => ({ count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    };
    try {
      const perRead = Math.floor(SEMANTIC_LIMITS.readBytes / stride);
      for (let base = 0; base < layout.points; base += perRead) {
        const count = Math.min(perRead, layout.points - base), bytes = await snapshot.read('payload', base * stride, count * stride, signal); sourceHash.update(bytes);
        for (let block = 0; block < count; block += SEMANTIC_LIMITS.checkpointPoints) {
          await checkpoint(signal);
          for (let j = block; j < Math.min(count, block + SEMANTIC_LIMITS.checkpointPoints); j++) {
            const at = j * stride, x = bytes.readInt32LE(at + fields.position) * scale[0] + offset[0], y = bytes.readInt32LE(at + fields.position + 4) * scale[1] + offset[1], z = bytes.readInt32LE(at + fields.position + 8) * scale[2] + offset[2];
            const file = bytes.readUInt16LE(at + fields['point source id']), row = bytes.readUInt32LE(at + fields.source_row), label = bytes.readFloatLE(at + fields.scalar_Label);
            requireData(file >= 1 && file <= 4 && row < snapshot.sourceCounts[file] && Number.isInteger(label) && label >= 0 && label <= 8 &&
              Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && x >= bounds.min[0] - .002 && x <= bounds.max[0] + .002 &&
              y >= bounds.min[1] - .002 && y <= bounds.max[1] + .002 && z >= bounds.min[2] - .002 && z <= bounds.max[2] + .002, 'Invalid source record');
            const partition = partitions[file - 1][Math.floor(row / PARTITION_ROWS)];
            partition.buffer.writeUInt32LE(row - partition.start, partition.used); partition.buffer.writeUInt32LE(base + j, partition.used + 4); partition.used += 8; partition.tuples++;
            if (partition.used === TUPLE_BUFFER) await flush(partition, signal);
            const dest = inPage * recordBytes; page.writeDoubleLE(x, dest); page.writeDoubleLE(y, dest + 8); page.writeDoubleLE(z, dest + 16);
            page.writeUInt32LE(file, dest + 24); page.writeUInt32LE(row, dest + 28); page.writeUInt32LE(base + j, dest + 32); page.writeUInt32LE(label, dest + 36);
            const summary = labels[label]; summary.count++; counts[label]++;
            summary.min[0] = Math.min(summary.min[0], x); summary.max[0] = Math.max(summary.max[0], x);
            summary.min[1] = Math.min(summary.min[1], y); summary.max[1] = Math.max(summary.max[1], y);
            summary.min[2] = Math.min(summary.min[2], z); summary.max[2] = Math.max(summary.max[2], z);
            if (++inPage === pagePoints) await emitPage();
          }
          progress?.({ phase: 'index', scannedPoints: base + Math.min(count, block + SEMANTIC_LIMITS.checkpointPoints), payloadBytes: snapshot.sourceReads.payloadBytes }); signal?.throwIfAborted();
        }
      }
      await emitPage(); await records.sync(); await metadata.sync();
    } finally { await records.close(); await metadata.close(); }
    const lookup: SemanticLookup[] = [];
    for (let file = 1; file <= 4; file++) {
      const output = await open(join(staging, `source-${file}.bin`), 'wx', 0o600), hashes: string[] = [];
      try {
        for (const part of partitions[file - 1]) {
          await checkpoint(signal); await flush(part, signal);
          requireData(part.tuples === part.rows, 'Incomplete source provenance partition');
          const stat = await secureStat(part.path, part.rows * 8), table = Buffer.alloc(part.rows * 4, 0xff);
          for (let at = 0; at < stat.size; at += SEMANTIC_LIMITS.readBytes) {
            await checkpoint(signal);
            const bytes = await boundedRead(part.path, at, Math.min(SEMANTIC_LIMITS.readBytes, stat.size - at), stat, signal);
            for (let n = 0; n < bytes.length; n += 8) {
              const row = bytes.readUInt32LE(n), physical = bytes.readUInt32LE(n + 4);
              requireData(row < part.rows && physical < layout.points && table.readUInt32LE(row * 4) === 0xffffffff, 'Duplicate source provenance'); table.writeUInt32LE(physical, row * 4);
            }
          }
          // rows unique, in range, and tuple count == rows proves complete coverage.
          for (let at = 0; at < table.length; at += LOOKUP_PAGE_BYTES) {
            signal?.throwIfAborted(); const bytes = table.subarray(at, Math.min(table.length, at + LOOKUP_PAGE_BYTES)); hashes.push(digest(bytes)); await writeAll(output, bytes);
          }
          await rm(part.path); part.buffer = Buffer.alloc(0);
        }
        await output.sync();
      } finally { await output.close(); }
      lookup.push({ bytes: snapshot.sourceCounts[file] * 4, pages: hashes });
    }
    const body: HeaderBody = { version: VERSION, config: CONFIG, identity, revision: snapshot.dataset.revision, totalPoints: layout.points,
      counts, sourceHash: sourceHash.digest('hex'), pageCount: Math.ceil(layout.points / pagePoints), pageMetadataHash: metadataHash.digest('hex'), lookup };
    const header: Header = { ...body, hash: digest(JSON.stringify(body)) }, encoded = Buffer.from(JSON.stringify(header));
    requireData(encoded.length <= HEADER_BYTES, 'Semantic manifest budget exceeded');
    const manifest = await open(join(staging, 'index.json'), 'wx', 0o600);
    try { await writeAll(manifest, encoded); await manifest.sync(); } finally { await manifest.close(); }
    await snapshot.check(signal); requireData(await binding(snapshot, signal) === identity, 'Semantic binding changed'); signal?.throwIfAborted();
    try { await rename(staging, directory); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    signal?.throwIfAborted();
  } finally { await rm(staging, { recursive: true, force: true }); }
}
/** Preserve incomplete publications in place. Never rename/delete a directory another reader may own.
 * Cooperating processes pick the same bounded generation and use build's atomic publication race.
 * A manifest that exists but fails validation is still corruption, not a recoverable cache miss. */
async function locateCache(base: string, identity: string, snapshot: SemanticArtifact, signal?: AbortSignal): Promise<{ directory: string; index: SemanticDiskIndex | undefined }> {
  requireData(validHash(identity), 'Invalid semantic cache identity');
  const names = new Set(['records.bin', 'pages.bin', 'source-1.bin', 'source-2.bin', 'source-3.bin', 'source-4.bin']);
  let available: string | undefined;
  for (let generation = 0; generation < 8; generation++) {
    signal?.throwIfAborted();
    const directory = join(base, generation === 0 ? identity : `${identity}-recovery-${generation}`);
    try {
      const index = await SemanticDiskIndex.load(directory, identity, snapshot, signal);
      if (index) return { directory, index };
      // Temp cleanup may remove an earlier generation while a valid recovery survives.
      // Discover existing publications before selecting the first absent build slot.
      available ??= directory;
    }
    catch (error) {
      if (!(error instanceof IncompleteSemanticCache)) throw error;
      // Only expected regular disposable files qualify. Inspect incrementally (bounded entries),
      // reject symlinks/unknown files/locks, and leave every existing byte untouched.
      const before = await lstat(directory);
      requireData(before.isDirectory() && await realpath(directory) === directory, 'Unsafe semantic cache recovery directory');
      const entries = await opendir(directory); let hasManifest = false;
      for await (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.name === 'index.json') { hasManifest = true; continue; }
        requireData(names.has(entry.name), 'Unexpected file in incomplete semantic cache; recovery refused');
        const path = join(directory, entry.name), stat = await lstat(path);
        requireData(stat.isFile() && !stat.isSymbolicLink() && await realpath(path) === path, 'Unsafe incomplete semantic cache file');
      }
      // A competing atomic publication may have completed since load's missing-manifest check.
      if (hasManifest) return { directory, index: await SemanticDiskIndex.load(directory, identity, snapshot, signal) };
      requireData(sameStat(before, await lstat(directory)) && await realpath(directory) === directory, 'Incomplete semantic cache changed during recovery');
    }
  }
  if (available) return { directory: available, index: undefined };
  throw new SemanticFailure('corrupt-data', 'Semantic cache recovery generations exhausted; operator inspection required');
}
let cached: SemanticDiskIndex | undefined;
let gate: Promise<void> = Promise.resolve();
export function dropSemanticDiskIndexMemoryCache() { cached = undefined; }
/** Selection metadata must never start whole-cloud preparation on a click. */
export async function loadPreparedSemanticDiskIndex(snapshot: SemanticArtifact, signal?: AbortSignal): Promise<SemanticDiskIndex | undefined> {
  const manifest = JSON.parse(snapshot.manifestBytes.toString());
  requireData(Object.entries(TORONTO_SEMANTIC_LABELS).every(([label, name]) => manifest.semantic_classes?.[label] === name), 'Unsupported semantic schema');
  const identity = await binding(snapshot, signal);
  const resident = cached;
  const index = resident?.identity === identity ? resident : (await locateCache(await cacheBase(), identity, snapshot, signal)).index;
  if (index) { await index.check(signal); await snapshot.check(signal); }
  return index;
}
/** Serialize preparation only. Waiting cancellation never poisons another build. */
export async function getSemanticDiskIndex(snapshot: SemanticArtifact, signal?: AbortSignal, progress?: SemanticProgressHandler): Promise<{ index: SemanticDiskIndex; cache: 'memory' | 'loaded' | 'built' }> {
  signal?.throwIfAborted();
  const manifest = JSON.parse(snapshot.manifestBytes.toString());
  requireData(Object.entries(TORONTO_SEMANTIC_LABELS).every(([label, name]) => manifest.semantic_classes?.[label] === name), 'Unsupported semantic schema');
  const previous = gate; let release!: () => void;
  const own = new Promise<void>(resolve => { release = resolve; }); gate = previous.then(() => own);
  let onAbort: (() => void) | undefined;
  try {
    if (signal) await Promise.race([previous, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort();
    })]); else await previous;
    signal?.throwIfAborted(); const identity = await binding(snapshot, signal), base = await cacheBase();
    if (cached?.identity === identity) { await cached.check(signal); await snapshot.check(signal); return { index: cached, cache: 'memory' }; }
    // One resident manifest only, including during another snapshot's load/build.
    cached = undefined;
    const located = await locateCache(base, identity, snapshot, signal), directory = located.directory;
    let index = located.index, cache: 'loaded' | 'built' = 'loaded';
    if (!index) { await build(directory, identity, snapshot, signal, progress); cache = 'built'; index = await SemanticDiskIndex.load(directory, identity, snapshot, signal); }
    requireData(index, 'Semantic cache publication missing'); await snapshot.check(signal); await index.check(signal); cached = index;
    return { index, cache };
  } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); release(); }
}
