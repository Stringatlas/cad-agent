import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { canonicalPoleRequest, type NearestPoleRequest, type PointWitness, type Vec3, type ScanStats,
  type QueryOutcome, type NearestPoleToolOutcome, TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { executeNearestPole, type SemanticSpatialQuerySource } from '@spatial/agent-harness';
import { decodePoint } from './potree';
import { SemanticArtifact, SEMANTIC_LIMITS, SEMANTIC_CONFIG, SemanticFailure, requireData, digest, semanticFailure } from './semantic-artifact';
import { LinearRecordVerifier } from './semantic-verifier';

export interface SemanticProgress { readonly phase: 'index' | 'resolve' | 'search' | 'verify-resolve' | 'verify'; readonly scannedPoints: number; readonly payloadBytes: number }
export type SemanticProgressHandler = (progress: SemanticProgress) => void;
interface SemanticPoint { position: Vec3; sourceFileId: number; sourceRow: number; label: number }
export function emptyScanStats(): ScanStats {
  return { scannedPoints: 0, matchingPoints: 0, hierarchyChunks: 0, payloadNodes: 0, hierarchyBytes: 0,
    payloadBytes: 0, metadataBytes: 0, maxReadBytes: 0, resolutionPoints: 0, resolutionPayloadBytes: 0 };
}
type MutableStats = { -readonly [K in keyof ScanStats]: ScanStats[K] };
function addRange(ranges: [number, number][], offset: number, size: number, limit: number) {
  requireData(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && offset <= limit - size, 'Invalid range');
  if (!size) return;
  let lo = 0, hi = ranges.length;
  while (lo < hi) { const middle = (lo + hi) >>> 1; if (ranges[middle][0] < offset) lo = middle + 1; else hi = middle; }
  requireData(!(lo > 0 && ranges[lo - 1][1] > offset) && !(lo < ranges.length && offset + size > ranges[lo][0]), 'Overlapping/cyclic ranges');
  ranges.splice(lo, 0, [offset, offset + size]);
}
function covered(ranges: [number, number][], size: number) {
  let cursor = 0;
  for (const range of ranges) { requireData(range[0] === cursor, 'Unaddressed bytes'); cursor = range[1]; }
  requireData(cursor === size, 'Incomplete range coverage');
}

/** Unpruned traversal; retains intervals per node/chunk, never a point-sized accumulator. */
async function scanHierarchy(snapshot: SemanticArtifact, visit: (point: SemanticPoint) => void, phase: 'resolve' | 'search',
  signal?: AbortSignal, progress?: SemanticProgressHandler) {
  const stats: MutableStats = { ...emptyScanStats(), metadataBytes: snapshot.manifestBytes.length + snapshot.metadataBytes.length };
  const hash = createHash('sha256'), chunkRanges: [number, number][] = [], payloadRanges: [number, number][] = [];
  const pending = [{ name: 'r', offset: 0, size: snapshot.first.length, expected: undefined as readonly [number, number] | undefined }];
  while (pending.length) {
    signal?.throwIfAborted(); await yieldTurn(); signal?.throwIfAborted();
    const chunk = pending.pop()!;
    requireData(chunk.size > 0 && chunk.size % 22 === 0 && chunk.size <= SEMANTIC_LIMITS.hierarchyBytes, 'Invalid hierarchy chunk');
    addRange(chunkRanges, chunk.offset, chunk.size, snapshot.hierarchySize);
    const bytes = chunk.offset === 0 ? snapshot.first : await snapshot.read('hierarchy', chunk.offset, chunk.size, signal);
    stats.hierarchyChunks++; stats.hierarchyBytes += bytes.length; stats.maxReadBytes = Math.max(stats.maxReadBytes, bytes.length);
    hash.update(bytes);
    const queue = [chunk.name], proxies: typeof pending = [];
    for (let i = 0; i < bytes.length / 22; i++) {
      const name = queue[i]; requireData(name && name.length - 1 <= SEMANTIC_LIMITS.depth, 'Missing/unsupported node');
      const at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
      const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
      requireData(type <= 2, 'Unknown node type');
      if (i === 0 && chunk.expected) requireData(type !== 2 && mask === chunk.expected[0] && count === chunk.expected[1], 'Proxy/root mismatch');
      if (type === 2) { proxies.push({ name, offset, size, expected: [mask, count] }); continue; }
      requireData(size === count * snapshot.layout.stride && offset % snapshot.layout.stride === 0 &&
        (type === 1 ? mask === 0 : mask !== 0), 'Invalid node payload');
      addRange(payloadRanges, offset, size, snapshot.payloadSize);
      if (count) stats.payloadNodes++;
      const readPoints = Math.floor(SEMANTIC_LIMITS.readBytes / snapshot.layout.stride);
      for (let start = 0; start < count; start += readPoints) {
        const length = Math.min(readPoints, count - start), payload = await snapshot.read('payload', offset + start * snapshot.layout.stride, length * snapshot.layout.stride, signal);
        stats.payloadBytes += payload.length; stats.maxReadBytes = Math.max(stats.maxReadBytes, payload.length); hash.update(payload);
        for (let block = 0; block < length; block += SEMANTIC_LIMITS.checkpointPoints) {
          await yieldTurn(); signal?.throwIfAborted();
          for (let j = block; j < Math.min(length, block + SEMANTIC_LIMITS.checkpointPoints); j++) {
            let point: ReturnType<typeof decodePoint>;
            try { point = decodePoint(payload, j, snapshot.layout); }
            catch { throw new SemanticFailure('corrupt-data', 'Invalid point'); }
            requireData(point.sourceIds[1] < snapshot.sourceCounts[point.sourceIds[0]], 'Source row out of bounds');
            visit({ position: point.positions as unknown as Vec3, sourceFileId: point.sourceIds[0], sourceRow: point.sourceIds[1], label: point.label });
            stats.scannedPoints++;
          }
          progress?.({ phase, scannedPoints: stats.scannedPoints, payloadBytes: stats.payloadBytes }); signal?.throwIfAborted();
        }
      }
      for (let child = 0; child < 8; child++) if (mask & (1 << child)) {
        requireData(queue.length < bytes.length / 22, 'Missing children'); queue.push(name + child);
      }
    }
    requireData(queue.length === bytes.length / 22, 'Unreachable children'); pending.push(...proxies.reverse());
  }
  covered(chunkRanges, snapshot.hierarchySize); covered(payloadRanges, snapshot.payloadSize);
  requireData(stats.scannedPoints === snapshot.dataset.totalPoints, 'Incomplete point coverage');
  signal?.throwIfAborted(); return { stats, hash: hash.digest('hex') };
}

export class PotreeSemanticSource implements SemanticSpatialQuerySource {
  readonly dataset;
  constructor(private readonly snapshot: SemanticArtifact, private readonly progress?: SemanticProgressHandler) { this.dataset = snapshot.dataset; }
  async nearestPole(value: NearestPoleRequest, signal?: AbortSignal): Promise<QueryOutcome> {
    let request: NearestPoleRequest;
    try { request = canonicalPoleRequest(value); } catch { return { status: 'error', code: 'invalid-input' }; }
    try {
      signal?.throwIfAborted();
      if (request.expectedArtifactRevision !== this.dataset.revision) throw new SemanticFailure('stale-revision', 'Stale input');
      await this.snapshot.check(signal);
      requireData(JSON.parse(this.snapshot.manifestBytes.toString()).semantic_classes?.[request.filter.value] ===
        TORONTO_SEMANTIC_LABELS[request.filter.value], 'Unsupported semantic category binding');
      let q: Vec3, resolution: Awaited<ReturnType<typeof scanHierarchy>> | undefined;
      if (request.input.kind === 'coordinate') q = request.input.position;
      else {
        const key = request.input.key;
        if (key.sourceRow >= this.snapshot.sourceCounts[key.sourceFileId]) throw new SemanticFailure('unknown-point', 'Unknown row');
        let selected: Vec3 | undefined;
        resolution = await scanHierarchy(this.snapshot, point => {
          if (point.sourceFileId === key.sourceFileId && point.sourceRow === key.sourceRow) {
            requireData(!selected, 'Repeated selected provenance'); selected = point.position;
          }
        }, 'resolve', signal, this.progress);
        if (!selected) throw new SemanticFailure('unknown-point', 'Missing reference'); q = selected;
      }
      let nearest: PointWitness | null = null, matchingPoints = 0;
      const domain = request.domain;
      const search = await scanHierarchy(this.snapshot, point => {
        if (point.label !== request.filter.value || (domain.kind === 'aabb' && point.position.some((n, i) => n < domain.min[i] || n > domain.max[i]))) return;
        matchingPoints++;
        const dx = point.position[0] - q[0], dy = point.position[1] - q[1], dz = point.position[2] - q[2];
        const d2 = ((dx * dx + dy * dy) + dz * dz);
        if (!nearest || d2 < nearest.distanceSquared || (d2 === nearest.distanceSquared &&
          (point.sourceFileId < nearest.key.sourceFileId || (point.sourceFileId === nearest.key.sourceFileId && point.sourceRow < nearest.key.sourceRow)))) {
          nearest = { key: { sourceFileId: point.sourceFileId, sourceRow: point.sourceRow }, position: point.position, label: request.filter.value, distanceSquared: d2, distanceMeters: Math.sqrt(d2) };
        }
      }, 'search', signal, this.progress);
      await this.snapshot.check(signal);
      return { status: 'complete', queryPosition: q, nearest, evidence: { ...search.stats, matchingPoints,
        resolutionPoints: resolution?.stats.scannedPoints ?? 0, resolutionPayloadBytes: resolution?.stats.payloadBytes ?? 0,
        hierarchyBytes: search.stats.hierarchyBytes + (resolution?.stats.hierarchyBytes ?? 0),
        hierarchyChunks: search.stats.hierarchyChunks + (resolution?.stats.hierarchyChunks ?? 0),
        artifactRevision: this.dataset.revision, algorithm: 'potree-semantic-full-scan-v1', arithmetic: 'xyz-binary64-v1',
        configHash: digest(JSON.stringify(SEMANTIC_CONFIG)), requestHash: digest(JSON.stringify(request)), traversalHash: search.hash, completion: 'exhausted' } };
    } catch (error) { return semanticFailure(error, signal); }
  }
}

/** Composition root keeps one snapshot alive through search, verification and final validation. */
export async function queryClosestPole(directory: string, value: unknown, signal?: AbortSignal,
  progress?: SemanticProgressHandler): Promise<NearestPoleToolOutcome> {
  let request: NearestPoleRequest;
  try { request = canonicalPoleRequest(value); } catch { return { status: 'error', code: 'invalid-input' }; }
  let snapshot: SemanticArtifact | undefined;
  try {
    snapshot = await SemanticArtifact.open(directory, signal);
    const result = await executeNearestPole(request, new PotreeSemanticSource(snapshot, progress), new LinearRecordVerifier(snapshot, progress), signal);
    await snapshot.check(signal);
    return result.status === 'verified-found' || result.status === 'verified-none' ? { ...result, sourceReads: { ...snapshot.sourceReads } } : result;
  } catch (error) { return semanticFailure(error, signal); }
  finally { await snapshot?.close(); }
}
