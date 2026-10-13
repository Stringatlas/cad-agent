import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, rename, rm, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { canonicalPoleRequest, type NearestPoleRequest, type NearestPoleToolOutcome, type PointWitness, type Vec3,
  type ScanStats, type SearchEvidence, type VerificationEvidence } from '@spatial/contracts';
import { SemanticArtifact, SEMANTIC_LIMITS, SemanticFailure, requireData, digest, semanticFailure } from './semantic-artifact';
import type { SemanticProgressHandler } from './semantic-query';

// Immutable derived files live outside the source dataset. Offsets are physical record
// numbers (not byte offsets), so the >4GB payload remains addressable with Uint32.
const VERSION = 'pole-category-index-v1';
const RECORD = 36, PAGE = 4096, CELL = 8;
const MAX_POLE_BYTES = 96 * 1024 * 1024, MAX_LOOKUP_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_WEIGHT = 192 * 1024 * 1024;
const CONFIG = { version: VERSION, cellMeters: CELL, recordBytes: RECORD, lookupPageBytes: PAGE, arithmetic: 'xyz-binary64-v1', tie: 'numeric-source-key' };
interface HeaderBody {
  version: typeof VERSION; identity: string; revision: string; points: number; totalPoints: number;
  polesHash: string; sourceHash: string; lookup: { bytes: number; pages: string[] }[];
}
interface Header extends HeaderBody { hash: string }
interface Bucket { indices: number[]; min: number[]; max: number[] }
interface Index { header: Header; poles: Buffer; buckets: Bucket[]; directory: string; weight: number }
const memory = new Map<string, Index>();
let gate: Promise<void> = Promise.resolve();

/** Drop only disposable in-memory caches; active queries retain their own immutable index. */
export function dropPoleIndexMemoryCache() { memory.clear(); }
function stats(): { -readonly [K in keyof ScanStats]: ScanStats[K] } {
  return { scannedPoints: 0, matchingPoints: 0, hierarchyChunks: 0, payloadNodes: 0, hierarchyBytes: 0,
    payloadBytes: 0, metadataBytes: 0, maxReadBytes: 0, resolutionPoints: 0, resolutionPayloadBytes: 0 };
}
async function checkpoint(signal?: AbortSignal) { signal?.throwIfAborted(); await yieldTurn(); signal?.throwIfAborted(); }
async function identity(snapshot: SemanticArtifact) {
  const identities = [];
  for (const asset of ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']) {
    const s = await lstat(join(snapshot.root, asset));
    identities.push([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
  }
  await snapshot.check();
  return digest(JSON.stringify([snapshot.root, snapshot.dataset.revision, identities]));
}
async function cacheBase() {
  const base = join(await realpath(tmpdir()), 'spatial-cad-pole-index-v1');
  await mkdir(base, { recursive: true, mode: 0o700 });
  requireData(await realpath(base) === base && (await lstat(base)).isDirectory(), 'Invalid cache root');
  return base;
}
async function cacheRead(path: string, offset: number, length: number, maximum: number) {
  requireData(length >= 0 && length <= maximum && Number.isSafeInteger(offset) && offset >= 0, 'Invalid cache read');
  requireData(await realpath(path) === path, 'Symlinked cache');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await file.stat(); requireData(s.isFile() && offset <= s.size - length, 'Truncated cache');
    const bytes = Buffer.alloc(length); requireData((await file.read(bytes, 0, length, offset)).bytesRead === length, 'Truncated cache read'); return bytes;
  } finally { await file.close(); }
}
function bodyHash(header: HeaderBody) { return digest(JSON.stringify(header)); }
async function load(directory: string, binding: string, snapshot: SemanticArtifact, signal?: AbortSignal): Promise<Index | undefined> {
  let s;
  try { s = await lstat(join(directory, 'index.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  requireData(s.size > 0 && s.size <= 16 * 1024 * 1024, 'Invalid cache manifest size');
  const bytes = await cacheRead(join(directory, 'index.json'), 0, s.size, 16 * 1024 * 1024);
  let header: Header;
  try { header = JSON.parse(bytes.toString()); } catch { throw new SemanticFailure('corrupt-data', 'Invalid cache manifest'); }
  requireData(header && typeof header === 'object' && !Array.isArray(header), 'Invalid cache manifest');
  const { hash, ...body } = header;
  requireData(hash === bodyHash(body) && header.version === VERSION && header.identity === binding &&
    header.revision === snapshot.dataset.revision && header.totalPoints === snapshot.dataset.totalPoints &&
    Number.isSafeInteger(header.points) && header.points >= 0 && header.points * RECORD <= MAX_POLE_BYTES &&
    /^[a-f0-9]{64}$/.test(header.polesHash) && /^[a-f0-9]{64}$/.test(header.sourceHash) &&
    Array.isArray(header.lookup) && header.lookup.length === 4, 'Invalid cache binding');
  for (let i = 0; i < 4; i++) {
    const lookup = header.lookup[i], size = snapshot.sourceCounts[i + 1] * 4;
    requireData(lookup && typeof lookup === 'object' && lookup.bytes === size && Array.isArray(lookup.pages) && lookup.pages.length === Math.ceil(size / PAGE) &&
      lookup.pages.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)), 'Invalid lookup binding');
    const stat = await lstat(join(directory, `source-${i + 1}.bin`)); requireData(stat.isFile() && stat.size === size, 'Invalid lookup size');
  }
  const polePath = join(directory, 'poles.bin'), poleStat = await lstat(polePath);
  requireData(poleStat.isFile() && poleStat.size === header.points * RECORD, 'Invalid category size');
  const poles = Buffer.alloc(poleStat.size), checksum = createHash('sha256');
  for (let at = 0; at < poles.length; at += SEMANTIC_LIMITS.readBytes) {
    await checkpoint(signal);
    const bytes = await cacheRead(polePath, at, Math.min(SEMANTIC_LIMITS.readBytes, poles.length - at), SEMANTIC_LIMITS.readBytes);
    checksum.update(bytes); bytes.copy(poles, at);
  }
  requireData(checksum.digest('hex') === header.polesHash, 'Category checksum mismatch');
  return spatialIndex(header, poles, directory, signal);
}
async function spatialIndex(header: Header, poles: Buffer, directory: string, signal?: AbortSignal): Promise<Index> {
  const groups = new Map<string, Bucket>();
  for (let i = 0; i < header.points; i++) {
    if (i % SEMANTIC_LIMITS.checkpointPoints === 0) await checkpoint(signal);
    const at = i * RECORD, p = [poles.readDoubleLE(at), poles.readDoubleLE(at + 8), poles.readDoubleLE(at + 16)];
    const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
    let bucket = groups.get(key);
    if (!bucket) {
      if (poles.length * 2 + (groups.size + 1) * 512 > MAX_CACHE_WEIGHT) throw new RangeError('Spatial index resource bound');
      bucket = { indices: [], min: [...p], max: [...p] }; groups.set(key, bucket);
    }
    bucket.indices.push(i);
    for (let axis = 0; axis < 3; axis++) { bucket.min[axis] = Math.min(bucket.min[axis], p[axis]); bucket.max[axis] = Math.max(bucket.max[axis], p[axis]); }
  }
  const buckets = [...groups.values()];
  return { header, poles, buckets, directory, weight: poles.length * 2 + buckets.length * 512 };
}

/** Validate hierarchy graph and full non-overlapping payload coverage once, not per click. */
async function validateHierarchy(snapshot: SemanticArtifact, signal?: AbortSignal) {
  const chunks: [number, number][] = [], payloads: [number, number][] = [];
  const pending = [{ name: 'r', offset: 0, size: snapshot.first.length, expected: undefined as number[] | undefined }];
  while (pending.length) {
    await checkpoint(signal); const chunk = pending.pop()!;
    requireData(chunk.size > 0 && chunk.size % 22 === 0 && chunk.size <= SEMANTIC_LIMITS.hierarchyBytes, 'Invalid hierarchy chunk');
    chunks.push([chunk.offset, chunk.offset + chunk.size]);
    // Detect cycles before following them; number of chunks cannot exceed file records.
    requireData(chunks.length <= snapshot.hierarchySize / 22 && !pending.some(c => c.offset === chunk.offset) &&
      !chunks.slice(0, -1).some(c => c[0] === chunk.offset), 'Cyclic hierarchy');
    const bytes = chunk.offset === 0 ? snapshot.first : await snapshot.read('hierarchy', chunk.offset, chunk.size, signal);
    const queue = [chunk.name];
    for (let i = 0; i < bytes.length / 22; i++) {
      const name = queue[i], at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
      const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
      requireData(name && name.length <= SEMANTIC_LIMITS.depth + 1 && type <= 2 && Number.isSafeInteger(offset) && Number.isSafeInteger(size), 'Invalid hierarchy record');
      if (i === 0 && chunk.expected) requireData(type !== 2 && mask === chunk.expected[0] && count === chunk.expected[1], 'Proxy mismatch');
      if (type === 2) {
        requireData(offset >= 0 && size > 0 && offset <= snapshot.hierarchySize - size, 'Invalid proxy range');
        pending.push({ name, offset, size, expected: [mask, count] }); continue;
      }
      requireData(size === count * snapshot.layout.stride && offset % snapshot.layout.stride === 0 && offset >= 0 &&
        offset <= snapshot.payloadSize - size && (type === 1 ? mask === 0 : mask !== 0), 'Invalid payload range');
      if (size) payloads.push([offset, offset + size]);
      for (let child = 0; child < 8; child++) if (mask & (1 << child)) queue.push(name + child);
      requireData(queue.length <= bytes.length / 22, 'Missing hierarchy children');
    }
    requireData(queue.length === bytes.length / 22, 'Unreachable hierarchy records');
  }
  for (const [ranges, size] of [[chunks, snapshot.hierarchySize], [payloads, snapshot.payloadSize]] as const) {
    ranges.sort((a, b) => a[0] - b[0]); let cursor = 0;
    for (const [start, end] of ranges) { requireData(start === cursor, 'Incomplete/overlapping hierarchy coverage'); cursor = end; }
    requireData(cursor === size, 'Incomplete hierarchy coverage');
  }
}
async function build(directory: string, binding: string, snapshot: SemanticArtifact, signal?: AbortSignal, progress?: SemanticProgressHandler): Promise<Index> {
  const { layout } = snapshot, { stride, fields, scale, offset, bounds } = layout;
  requireData(snapshot.payloadSize === layout.points * stride && layout.points < 0xffffffff, 'Invalid payload size');
  if (layout.points * 4 > MAX_LOOKUP_BYTES) throw new RangeError('Lookup index resource bound');
  await validateHierarchy(snapshot, signal);
  const lookup = snapshot.sourceCounts.slice(1).map(n => new Uint32Array(n).fill(0xffffffff));
  const buffers: Buffer[] = [], blockPoints = 16384;
  let poles = Buffer.alloc(blockPoints * RECORD), poleCount = 0, inBlock = 0;
  const sourceHash = createHash('sha256'), perRead = Math.floor(SEMANTIC_LIMITS.readBytes / stride);
  for (let base = 0; base < layout.points; base += perRead) {
    const count = Math.min(perRead, layout.points - base), bytes = await snapshot.read('payload', base * stride, count * stride, signal); sourceHash.update(bytes);
    for (let block = 0; block < count; block += SEMANTIC_LIMITS.checkpointPoints) {
      await checkpoint(signal);
      for (let j = block; j < Math.min(count, block + SEMANTIC_LIMITS.checkpointPoints); j++) {
        const at = j * stride, x = bytes.readInt32LE(at + fields.position) * scale[0] + offset[0],
          y = bytes.readInt32LE(at + fields.position + 4) * scale[1] + offset[1], z = bytes.readInt32LE(at + fields.position + 8) * scale[2] + offset[2];
        const file = bytes.readUInt16LE(at + fields['point source id']), row = bytes.readUInt32LE(at + fields.source_row), label = bytes.readFloatLE(at + fields.scalar_Label);
        requireData(file >= 1 && file <= 4 && row < lookup[file - 1].length && lookup[file - 1][row] === 0xffffffff &&
          Number.isInteger(label) && label >= 0 && label <= 8 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
          x >= bounds.min[0] - 0.002 && x <= bounds.max[0] + 0.002 && y >= bounds.min[1] - 0.002 && y <= bounds.max[1] + 0.002 &&
          z >= bounds.min[2] - 0.002 && z <= bounds.max[2] + 0.002, 'Invalid/duplicate source record');
        lookup[file - 1][row] = base + j;
        if (label !== 6) continue;
        if ((poleCount + 1) * RECORD > MAX_POLE_BYTES) throw new RangeError('Category index resource bound');
        const dest = inBlock * RECORD; poles.writeDoubleLE(x, dest); poles.writeDoubleLE(y, dest + 8); poles.writeDoubleLE(z, dest + 16);
        poles.writeUInt32LE(file, dest + 24); poles.writeUInt32LE(row, dest + 28); poles.writeUInt32LE(base + j, dest + 32); poleCount++; inBlock++;
        if (inBlock === blockPoints) { buffers.push(poles); poles = Buffer.alloc(blockPoints * RECORD); inBlock = 0; }
      }
      progress?.({ phase: 'index', scannedPoints: base + Math.min(count, block + SEMANTIC_LIMITS.checkpointPoints), payloadBytes: snapshot.sourceReads.payloadBytes }); signal?.throwIfAborted();
    }
  }
  // Valid unique rows bounded by sourceCounts, and exactly totalPoints records, imply
  // every source row exists. No per-query global provenance scan is needed.
  buffers.push(poles.subarray(0, inBlock * RECORD)); const allPoles = Buffer.concat(buffers, poleCount * RECORD);
  const staging = await mkdtemp(join(await cacheBase(), '.building-'));
  try {
    const tables: HeaderBody['lookup'] = [];
    for (let file = 1; file <= 4; file++) {
      const byteLength = lookup[file - 1].byteLength, pages: string[] = [];
      const output = await open(join(staging, `source-${file}.bin`), 'wx', 0o600);
      try {
        for (let at = 0; at < byteLength; at += SEMANTIC_LIMITS.readBytes) {
          await checkpoint(signal); const chunk = Buffer.alloc(Math.min(byteLength - at, SEMANTIC_LIMITS.readBytes));
          // Encode little-endian explicitly rather than assuming host byte order.
          for (let j = 0; j < chunk.length; j += 4) chunk.writeUInt32LE(lookup[file - 1][(at + j) / 4], j);
          await output.writeFile(chunk);
          for (let page = 0; page < chunk.length; page += PAGE) pages.push(digest(chunk.subarray(page, Math.min(chunk.length, page + PAGE))));
        }
        await output.sync();
      } finally { await output.close(); }
      tables.push({ bytes: byteLength, pages });
    }
    const output = await open(join(staging, 'poles.bin'), 'wx', 0o600);
    try {
      for (let at = 0; at < allPoles.length; at += SEMANTIC_LIMITS.readBytes) { await checkpoint(signal); await output.writeFile(allPoles.subarray(at, at + SEMANTIC_LIMITS.readBytes)); }
      await output.sync();
    } finally { await output.close(); }
    const body: HeaderBody = { version: VERSION, identity: binding, revision: snapshot.dataset.revision, points: poleCount,
      totalPoints: layout.points, polesHash: digest(allPoles), sourceHash: sourceHash.digest('hex'), lookup: tables };
    const header: Header = { ...body, hash: bodyHash(body) };
    await writeFile(join(staging, 'index.json'), JSON.stringify(header), { flag: 'wx', mode: 0o600 });
    const index = await spatialIndex(header, allPoles, directory, signal);
    await snapshot.check(signal); requireData(await identity(snapshot) === binding, 'Index binding changed'); signal?.throwIfAborted();
    try { await rename(staging, directory); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    // Publication is awaited, never detached. The caller checks its snapshot again.
    return index;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
async function getIndex(snapshot: SemanticArtifact, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  // Queue build/load, not the queries. An aborted waiting caller drains its own gate
  // without poisoning another caller's build or starting unchecked background work.
  const previous = gate; let release!: () => void;
  const own = new Promise<void>(resolve => { release = resolve; }); gate = previous.then(() => own);
  let onAbort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    if (signal) await Promise.race([previous, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
    else await previous;
    signal?.throwIfAborted();
    const binding = await identity(snapshot), directory = join(await cacheBase(), binding);
    const cached = memory.get(binding);
    if (cached) { memory.delete(binding); memory.set(binding, cached); return { index: cached, cache: 'memory' as const }; }
    let index = await load(directory, binding, snapshot, signal), cache: 'loaded' | 'built' = 'loaded';
    if (!index) { index = await build(directory, binding, snapshot, signal, progress); cache = 'built'; }
    await snapshot.check(signal);
    while (memory.size >= 2 || [...memory.values()].reduce((n, entry) => n + entry.weight, 0) + index.weight > MAX_CACHE_WEIGHT) {
      const first = memory.keys().next().value; if (!first) break; memory.delete(first);
    }
    if (index.weight <= MAX_CACHE_WEIGHT) memory.set(binding, index);
    return { index, cache };
  } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); release(); }
}

/** Explicit offline preparation; errors/cancellation throw and never publish partial files. */
export async function preparePoleIndex(directory: string, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  const snapshot = await SemanticArtifact.open(directory, signal);
  try {
    const { index, cache } = await getIndex(snapshot, signal, progress); await snapshot.check(signal);
    return { directory: index.directory, indexHash: index.header.hash, indexedPoints: index.header.points,
      totalPoints: snapshot.dataset.totalPoints, cache, sourceReads: { ...snapshot.sourceReads } };
  } finally { await snapshot.close(); }
}
function indexedWitness(index: Index, record: number, origin: Vec3): PointWitness {
  const at = record * RECORD, bytes = index.poles;
  const position: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
  const dx = position[0] - origin[0], dy = position[1] - origin[1], dz = position[2] - origin[2], square = (dx * dx + dy * dy) + dz * dz;
  return { key: { sourceFileId: bytes.readUInt32LE(at + 24), sourceRow: bytes.readUInt32LE(at + 28) }, position, label: 6,
    distanceSquared: square, distanceMeters: Math.sqrt(square) };
}
function inside(position: Vec3, domain: NearestPoleRequest['domain']) {
  return domain.kind === 'whole-dataset' || position.every((n, i) => n >= domain.min[i] && n <= domain.max[i]);
}
function better(a: PointWitness, b: PointWitness | null) {
  return !b || a.distanceSquared < b.distanceSquared || (a.distanceSquared === b.distanceSquared &&
    (a.key.sourceFileId < b.key.sourceFileId || (a.key.sourceFileId === b.key.sourceFileId && a.key.sourceRow < b.key.sourceRow)));
}
async function original(snapshot: SemanticArtifact, physical: number, key: PointWitness['key'], signal?: AbortSignal) {
  requireData(physical < snapshot.dataset.totalPoints, 'Invalid physical reference');
  const bytes = await snapshot.read('payload', physical * snapshot.layout.stride, snapshot.layout.stride, signal);
  const { fields, scale, offset } = snapshot.layout;
  const position: Vec3 = [bytes.readInt32LE(fields.position) * scale[0] + offset[0], bytes.readInt32LE(fields.position + 4) * scale[1] + offset[1], bytes.readInt32LE(fields.position + 8) * scale[2] + offset[2]];
  const label = bytes.readFloatLE(fields.scalar_Label);
  requireData(bytes.readUInt16LE(fields['point source id']) === key.sourceFileId && bytes.readUInt32LE(fields.source_row) === key.sourceRow &&
    position.every(Number.isFinite) && Number.isInteger(label) && label >= 0 && label <= 8, 'Original provenance mismatch');
  return { position, label };
}
async function resolve(snapshot: SemanticArtifact, index: Index, request: NearestPoleRequest, signal?: AbortSignal) {
  if (request.input.kind === 'coordinate') return request.input.position;
  const key = request.input.key;
  if (key.sourceRow >= snapshot.sourceCounts[key.sourceFileId]) throw new SemanticFailure('unknown-point', 'Unknown source row');
  const lookup = index.header.lookup[key.sourceFileId - 1], page = Math.floor(key.sourceRow * 4 / PAGE), start = page * PAGE;
  const bytes = await cacheRead(join(index.directory, `source-${key.sourceFileId}.bin`), start, Math.min(PAGE, lookup.bytes - start), PAGE);
  requireData(digest(bytes) === lookup.pages[page], 'Lookup checksum mismatch'); signal?.throwIfAborted();
  return (await original(snapshot, bytes.readUInt32LE(key.sourceRow * 4 - start), key, signal)).position;
}
async function search(index: Index, origin: Vec3, request: NearestPoleRequest, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  const domain = request.domain;
  const buckets = index.buckets.filter(b => domain.kind !== 'aabb' || b.min.every((n, i) => n <= domain.max[i] && b.max[i] >= domain.min[i])).map(bucket => {
    const distances = bucket.min.map((n, i) => origin[i] < n ? n - origin[i] : origin[i] > bucket.max[i] ? origin[i] - bucket.max[i] : 0);
    return { bucket, lower: (distances[0] * distances[0] + distances[1] * distances[1]) + distances[2] * distances[2] };
  }).sort((a, b) => a.lower - b.lower);
  let winner: PointWitness | null = null, visited = 0;
  for (const { bucket, lower } of buckets) {
    if (winner && lower > winner.distanceSquared) break;
    for (const record of bucket.indices) {
      if (visited % SEMANTIC_LIMITS.checkpointPoints === 0) { await checkpoint(signal); progress?.({ phase: 'search', scannedPoints: visited, payloadBytes: 0 }); signal?.throwIfAborted(); }
      visited++; const point = indexedWitness(index, record, origin);
      if (inside(point.position, domain) && better(point, winner)) winner = point;
    }
  }
  progress?.({ phase: 'search', scannedPoints: visited, payloadBytes: 0 }); signal?.throwIfAborted();
  return { winner, visited };
}
/** Independent category-linear reduction: no buckets, spatial pruning or production
 * witness/reduction helpers. Exact over every validated, persisted Pole record. */
async function verify(index: Index, origin: Vec3, request: NearestPoleRequest, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  let winner: PointWitness | null = null, matching = 0, physical: number | undefined;
  const domain = request.domain;
  for (let i = 0; i < index.header.points; i++) {
    if (i % SEMANTIC_LIMITS.checkpointPoints === 0) { await checkpoint(signal); progress?.({ phase: 'verify', scannedPoints: i, payloadBytes: 0 }); signal?.throwIfAborted(); }
    const at = i * RECORD, bytes = index.poles, position: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
    if (domain.kind === 'aabb' && (position[0] < domain.min[0] || position[0] > domain.max[0] || position[1] < domain.min[1] || position[1] > domain.max[1] || position[2] < domain.min[2] || position[2] > domain.max[2])) continue;
    matching++; const file = bytes.readUInt32LE(at + 24), row = bytes.readUInt32LE(at + 28);
    const x = position[0] - origin[0], y = position[1] - origin[1], z = position[2] - origin[2], square = (x * x + y * y) + z * z;
    if (winner && (square > winner.distanceSquared || (square === winner.distanceSquared && (file > winner.key.sourceFileId || (file === winner.key.sourceFileId && row >= winner.key.sourceRow))))) continue;
    winner = { key: { sourceFileId: file, sourceRow: row }, position, label: 6, distanceSquared: square, distanceMeters: Math.sqrt(square) };
    physical = bytes.readUInt32LE(at + 32);
  }
  progress?.({ phase: 'verify', scannedPoints: index.header.points, payloadBytes: 0 }); signal?.throwIfAborted();
  return { winner, matching, physical };
}

/** Exact category-index search + independent all-Pole verification + original-record
 * witnesses. The exhaustive full-dataset oracle remains available separately. */
export async function queryIndexedClosestPole(directory: string, value: unknown, signal?: AbortSignal,
  progress?: SemanticProgressHandler): Promise<NearestPoleToolOutcome> {
  let request: NearestPoleRequest;
  try { request = canonicalPoleRequest(value); } catch { return { status: 'error', code: 'invalid-input' }; }
  let snapshot: SemanticArtifact | undefined;
  try {
    snapshot = await SemanticArtifact.open(directory, signal);
    if (request.expectedArtifactRevision !== snapshot.dataset.revision) throw new SemanticFailure('stale-revision', 'Stale query');
    const { index } = await getIndex(snapshot, signal, progress);
    const origin = await resolve(snapshot, index, request, signal);
    if (request.input.kind === 'point-ref') progress?.({ phase: 'resolve', scannedPoints: 1, payloadBytes: snapshot.layout.stride }); signal?.throwIfAborted();
    const answer = await search(index, origin, request, signal, progress);
    const verifiedOrigin = await resolve(snapshot, index, request, signal);
    if (request.input.kind === 'point-ref') progress?.({ phase: 'verify-resolve', scannedPoints: 1, payloadBytes: snapshot.layout.stride }); signal?.throwIfAborted();
    const checked = await verify(index, verifiedOrigin, request, signal, progress);
    if (JSON.stringify(answer.winner) !== JSON.stringify(checked.winner) || origin.some((n, i) => n !== verifiedOrigin[i])) return { status: 'verification-rejected', reason: 'Independent category winner mismatch' };
    if (checked.winner) {
      const source = await original(snapshot, checked.physical!, checked.winner.key, signal);
      requireData(source.label === 6 && source.position.every((n, i) => n === checked.winner!.position[i]), 'Original winning record mismatch');
    }
    await snapshot.check(signal);
    const requestHash = digest(JSON.stringify(request)), indexEvidence = { points: index.header.points, hash: index.header.hash };
    const resolutionPoints = request.input.kind === 'point-ref' ? 1 : 0, resolutionPayloadBytes = resolutionPoints * snapshot.layout.stride;
    const common = { ...stats(), matchingPoints: checked.matching, resolutionPoints, resolutionPayloadBytes,
      metadataBytes: snapshot.manifestBytes.length + snapshot.metadataBytes.length,
      maxReadBytes: Math.max(snapshot.manifestBytes.length, snapshot.metadataBytes.length, snapshot.layout.stride),
      artifactRevision: snapshot.dataset.revision, requestHash, index: indexEvidence };
    const searchEvidence: SearchEvidence = { ...common, scannedPoints: answer.visited, algorithm: VERSION, arithmetic: 'xyz-binary64-v1',
      configHash: digest(JSON.stringify(CONFIG)), traversalHash: digest(JSON.stringify([index.header.hash, requestHash, answer.visited, answer.winner])), completion: 'indexed' };
    const verification: VerificationEvidence = { ...common, scannedPoints: index.header.points, payloadBytes: checked.winner ? snapshot.layout.stride : 0,
      verifier: 'pole-category-linear-v1', transcriptHash: digest(JSON.stringify([index.header.hash, requestHash, checked.matching, checked.winner])) };
    return { status: checked.winner ? 'verified-found' : 'verified-none', complete: true, request, dataset: snapshot.dataset, queryPosition: origin,
      nearest: checked.winner, search: searchEvidence, verification, sourceReads: { ...snapshot.sourceReads } };
  } catch (error) {
    // A concurrently truncated/replaced file can fail a bounded read before the
    // final check. Prefer stale-revision over misclassifying that as corruption.
    try { await snapshot?.check(signal); } catch (changed) { return semanticFailure(changed, signal); }
    return semanticFailure(error, signal);
  }
  finally { await snapshot?.close(); }
}
