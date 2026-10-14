import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { canonicalPoleRequest, type NearestPoleRequest, type NearestPoleToolOutcome, type PointWitness, type Vec3,
  type ScanStats, type SearchEvidence, type VerificationEvidence, type TorontoSemanticLabel } from '@spatial/contracts';
import { SemanticArtifact, SemanticFailure, requireData, digest, semanticFailure } from './semantic-artifact';
import type { SemanticProgressHandler } from './semantic-query';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache, recordBytes, pagePoints, type SemanticDiskIndex } from './semantic-disk-index';
import { verifySemanticDisk } from './semantic-disk-verifier';

const VERSION = 'semantic-disk-page-index-v1';
const CONFIG = { version: VERSION, recordBytes, pagePoints, bound: 'euclidean-aabb-squared', arithmetic: 'xyz-binary64-v1', tie: 'numeric-source-key' };

/** Retained public API: the common all-label manifest is the only resident cache. */
export function dropPoleIndexMemoryCache() { dropSemanticDiskIndexMemoryCache(); }
function stats(): { -readonly [K in keyof ScanStats]: ScanStats[K] } {
  return { scannedPoints: 0, matchingPoints: 0, hierarchyChunks: 0, payloadNodes: 0, hierarchyBytes: 0,
    payloadBytes: 0, metadataBytes: 0, maxReadBytes: 0, resolutionPoints: 0, resolutionPayloadBytes: 0 };
}
async function checkpoint(signal?: AbortSignal) { signal?.throwIfAborted(); await yieldTurn(); signal?.throwIfAborted(); }

/** Explicit offline preparation. All labels share one complete disk index/lookup. */
export async function preparePoleIndex(directory: string, signal?: AbortSignal, progress?: SemanticProgressHandler, label: TorontoSemanticLabel = 6) {
  if (!Number.isInteger(label) || label < 0 || label > 8) throw new TypeError('Expected Toronto semantic label 0..8');
  const snapshot = await SemanticArtifact.open(directory, signal);
  try {
    const { index, cache } = await getSemanticDiskIndex(snapshot, signal, progress);
    await index.check(signal); await snapshot.check(signal);
    return { directory: index.directory, indexHash: index.hash, indexedPoints: index.counts[label],
      totalPoints: snapshot.dataset.totalPoints, cache, sourceReads: { ...snapshot.sourceReads } };
  } finally { await snapshot.close(); }
}
async function original(snapshot: SemanticArtifact, physical: number, key: PointWitness['key'], signal?: AbortSignal) {
  requireData(Number.isInteger(physical) && physical >= 0 && physical < snapshot.dataset.totalPoints, 'Invalid physical reference');
  const bytes = await snapshot.read('payload', physical * snapshot.layout.stride, snapshot.layout.stride, signal);
  const { fields, scale, offset } = snapshot.layout;
  const position: Vec3 = [bytes.readInt32LE(fields.position) * scale[0] + offset[0], bytes.readInt32LE(fields.position + 4) * scale[1] + offset[1], bytes.readInt32LE(fields.position + 8) * scale[2] + offset[2]];
  const label = bytes.readFloatLE(fields.scalar_Label);
  requireData(bytes.readUInt16LE(fields['point source id']) === key.sourceFileId && bytes.readUInt32LE(fields.source_row) === key.sourceRow &&
    position.every(Number.isFinite) && Number.isInteger(label) && label >= 0 && label <= 8, 'Original provenance mismatch');
  return { position, label };
}
async function resolve(snapshot: SemanticArtifact, index: SemanticDiskIndex, request: NearestPoleRequest, signal?: AbortSignal): Promise<Vec3> {
  signal?.throwIfAborted();
  if (request.input.kind === 'coordinate') return request.input.position;
  return (await original(snapshot, await index.resolvePhysical(request.input.key, signal), request.input.key, signal)).position;
}
function inside(position: Vec3, domain: NearestPoleRequest['domain']) {
  return domain.kind === 'whole-dataset' || position.every((n, i) => n >= domain.min[i] && n <= domain.max[i]);
}
function better(a: PointWitness, b: PointWitness | null) {
  return !b || a.distanceSquared < b.distanceSquared || (a.distanceSquared === b.distanceSquared &&
    (a.key.sourceFileId < b.key.sourceFileId || (a.key.sourceFileId === b.key.sourceFileId && a.key.sourceRow < b.key.sourceRow)));
}

/** Best-first Euclidean page bounds. Every page is visited, category/domain-excluded
 * or strictly distance-pruned. Partial AABB pages are read even if distance-pruned
 * so domain counts remain exact. Reads/scans include every record of visited pages. */
async function search(index: SemanticDiskIndex, origin: Vec3, request: NearestPoleRequest, signal?: AbortSignal, progress?: SemanticProgressHandler) {
  const domain = request.domain, label = request.filter.value;
  const disk = { totalPages: index.pages.length, visitedPages: 0, excludedPages: 0, prunedPages: 0, coveredPoints: 0, cacheBytes: 0, maxCacheReadBytes: 0 };
  const transcript = createHash('sha256'); transcript.update(JSON.stringify([VERSION, index.hash, request, origin]));
  const ordered = index.pages.map(page => {
    const summary = page.labels[label];
    const excluded = !summary || (domain.kind === 'aabb' && summary.min.some((n, axis) => n > domain.max[axis] || summary.max[axis] < domain.min[axis]));
    const contained = domain.kind === 'whole-dataset' || !!summary && summary.min.every((n, axis) => n >= domain.min[axis] && summary.max[axis] <= domain.max[axis]);
    const deltas = summary ? summary.min.map((n, axis) => origin[axis] < n ? n - origin[axis] : origin[axis] > summary.max[axis] ? origin[axis] - summary.max[axis] : 0) : [0, 0, 0];
    const lower = (deltas[0] * deltas[0] + deltas[1] * deltas[1]) + deltas[2] * deltas[2];
    return { page, summary, excluded, contained, lower };
  }).sort((a, b) => a.lower - b.lower || a.page.start - b.page.start);
  let winner: PointWitness | null = null, physical: number | undefined, matching = 0, scanned = 0;
  let metadataPages = 0;
  for (const { page, summary, excluded, contained, lower } of ordered) {
    // Metadata-only pruning must not schedule thousands of event-loop turns.
    // Check abort on every page; yield at bounded metadata intervals. Disk reads
    // still yield independently and each record page contains at most4096 points.
    if (metadataPages++ % 64 === 0) await checkpoint(signal);
    signal?.throwIfAborted(); disk.coveredPoints += page.count;
    if (excluded) { disk.excludedPages++; transcript.update(JSON.stringify([page.start, page.hash, 'excluded'])); continue; }
    if (contained) matching += summary!.count;
    const distant = winner !== null && lower > winner.distanceSquared;
    if (contained && distant) { disk.prunedPages++; transcript.update(JSON.stringify([page.start, page.hash, 'pruned', lower])); continue; }
    const bytes = await index.readPage(page, signal);
    disk.visitedPages++; disk.cacheBytes += bytes.length; disk.maxCacheReadBytes = Math.max(disk.maxCacheReadBytes, bytes.length); scanned += page.count;
    transcript.update(JSON.stringify([page.start, page.hash, 'visited', lower]));
    for (let at = 0; at < bytes.length; at += recordBytes) {
      if (bytes.readUInt32LE(at + 36) !== label) continue;
      const position: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
      if (!inside(position, domain)) continue;
      if (!contained) matching++;
      if (distant) continue;
      const dx = position[0] - origin[0], dy = position[1] - origin[1], dz = position[2] - origin[2];
      const square = (dx * dx + dy * dy) + dz * dz;
      const candidate: PointWitness = { key: { sourceFileId: bytes.readUInt32LE(at + 24), sourceRow: bytes.readUInt32LE(at + 28) }, position, label,
        distanceSquared: square, distanceMeters: Math.sqrt(square) };
      if (better(candidate, winner)) { winner = candidate; physical = bytes.readUInt32LE(at + 32); }
    }
    progress?.({ phase: 'search', scannedPoints: scanned, payloadBytes: 0 }); signal?.throwIfAborted();
  }
  // Empty/all-excluded queries still report a cancellable search phase.
  progress?.({ phase: 'search', scannedPoints: scanned, payloadBytes: 0 }); signal?.throwIfAborted();
  requireData(disk.coveredPoints === index.totalPoints && disk.visitedPages + disk.excludedPages + disk.prunedPages === disk.totalPages &&
    scanned <= index.totalPoints && disk.cacheBytes === scanned * recordBytes && disk.maxCacheReadBytes <= pagePoints * recordBytes &&
    (domain.kind !== 'whole-dataset' || matching === index.counts[label]), 'Incomplete disk search coverage');
  transcript.update(JSON.stringify([disk, matching, winner]));
  return { winner, physical, scanned, matching, disk, traversalHash: transcript.digest('hex') };
}

/** Exact disk search + separately implemented proof-aware verifier. Resource bounds
 * are explicit incomplete outcomes, never an interactive full-source fallback. */
export async function queryIndexedClosestPole(directory: string, value: unknown, signal?: AbortSignal,
  progress?: SemanticProgressHandler): Promise<NearestPoleToolOutcome> {
  let request: NearestPoleRequest;
  try { request = canonicalPoleRequest(value); } catch { return { status: 'error', code: 'invalid-input' }; }
  let snapshot: SemanticArtifact | undefined;
  try {
    snapshot = await SemanticArtifact.open(directory, signal);
    if (request.expectedArtifactRevision !== snapshot.dataset.revision) throw new SemanticFailure('stale-revision', 'Stale query');
    const { index } = await getSemanticDiskIndex(snapshot, signal, progress);
    const origin = await resolve(snapshot, index, request, signal);
    if (request.input.kind === 'point-ref') progress?.({ phase: 'resolve', scannedPoints: 1, payloadBytes: snapshot.layout.stride }); signal?.throwIfAborted();
    const answer = await search(index, origin, request, signal, progress);
    if (answer.winner) {
      requireData(await index.resolvePhysical(answer.winner.key, signal) === answer.physical, 'Winning lookup mismatch');
      const source = await original(snapshot, answer.physical!, answer.winner.key, signal);
      requireData(source.label === request.filter.value && source.position.every((n, i) => n === answer.winner!.position[i]), 'Original winning record mismatch');
    }
    // Verifier re-resolves source input and original winning record on its own.
    // It receives no production witness, bound, radius, traversal or decoder.
    const checked = await verifySemanticDisk(snapshot, index, request, signal, progress);
    if (JSON.stringify(answer.winner) !== JSON.stringify(checked.winner) || answer.matching !== checked.matching || origin.some((n, i) => n !== checked.origin[i])) {
      return { status: 'verification-rejected', reason: 'Independent disk winner/count mismatch' };
    }
    await index.check(signal); await snapshot.check(signal);
    const requestHash = digest(JSON.stringify(request)), indexEvidence = { points: index.counts[request.filter.value], hash: index.hash };
    const resolutionPoints = request.input.kind === 'point-ref' ? 1 : 0, resolutionPayloadBytes = resolutionPoints * snapshot.layout.stride;
    const common = { ...stats(), resolutionPoints, resolutionPayloadBytes,
      metadataBytes: snapshot.manifestBytes.length + snapshot.metadataBytes.length,
      maxReadBytes: Math.max(snapshot.manifestBytes.length, snapshot.metadataBytes.length, snapshot.layout.stride),
      artifactRevision: snapshot.dataset.revision, requestHash, index: indexEvidence };
    const searchEvidence: SearchEvidence = { ...common, scannedPoints: answer.scanned, matchingPoints: answer.matching,
      payloadBytes: answer.winner ? snapshot.layout.stride : 0, disk: answer.disk, algorithm: VERSION, arithmetic: 'xyz-binary64-v1',
      configHash: digest(JSON.stringify({ ...CONFIG, label: request.filter.value })), traversalHash: answer.traversalHash, completion: 'indexed' };
    const verification: VerificationEvidence = { ...common, scannedPoints: checked.scanned, matchingPoints: checked.matching,
      payloadBytes: checked.winner ? snapshot.layout.stride : 0, disk: checked.disk, verifier: checked.verifier, transcriptHash: checked.transcriptHash };
    return { status: checked.winner ? 'verified-found' : 'verified-none', complete: true, request, dataset: snapshot.dataset, queryPosition: origin,
      nearest: checked.winner, search: searchEvidence, verification, sourceReads: { ...snapshot.sourceReads } };
  } catch (error) {
    // A changed source can fail a bounded read before the final snapshot check.
    try { await snapshot?.check(signal); } catch (changed) { return semanticFailure(changed, signal); }
    return semanticFailure(error, signal);
  } finally { await snapshot?.close(); }
}
