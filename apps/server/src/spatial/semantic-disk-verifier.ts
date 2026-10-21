import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { NearestPoleRequest, PointWitness, Vec3 } from '@spatial/contracts';
import { SemanticArtifact, digest, requireData } from './semantic-artifact';
import type { SemanticProgressHandler } from './semantic-query';
import type { SemanticDiskIndex } from './semantic-disk-index';

const VERIFIER = 'semantic-disk-page-verifier-v1';

/** Independent original-record decoder, including independent input re-resolution.
 * No production decoder, winner, ordering, distance bound or reducer is used. */
async function sourceRecord(snapshot: SemanticArtifact, physical: number, key: PointWitness['key'], signal?: AbortSignal) {
  const metadata = JSON.parse(snapshot.metadataBytes.toString());
  let stride = 0;
  const fields = new Map<string, number>();
  for (const attribute of metadata.attributes) { fields.set(attribute.name, stride); stride += attribute.size; }
  requireData(Number.isInteger(physical) && physical >= 0 && physical < snapshot.dataset.totalPoints && stride === snapshot.layout.stride, 'Verifier invalid physical reference');
  const bytes = await snapshot.read('payload', physical * stride, stride, signal);
  const start = fields.get('position')!;
  const position: Vec3 = [bytes.readInt32LE(start) * metadata.scale[0] + metadata.offset[0],
    bytes.readInt32LE(start + 4) * metadata.scale[1] + metadata.offset[1], bytes.readInt32LE(start + 8) * metadata.scale[2] + metadata.offset[2]];
  const label = bytes.readFloatLE(fields.get('scalar_Label')!);
  requireData(bytes.readUInt16LE(fields.get('point source id')!) === key.sourceFileId && bytes.readUInt32LE(fields.get('source_row')!) === key.sourceRow &&
    position.every(Number.isFinite) && Number.isInteger(label) && label >= 0 && label <= 8, 'Verifier original provenance mismatch');
  return { position, label };
}

/** Separately reduces pages in L-infinity order. Its radius is established solely
 * by its own records, never the production result. Strict > keeps numeric-key ties. */
export async function verifySemanticDisk(snapshot: SemanticArtifact, index: SemanticDiskIndex, request: NearestPoleRequest,
  signal?: AbortSignal, progress?: SemanticProgressHandler) {
  signal?.throwIfAborted();
  let origin: Vec3;
  if (request.input.kind === 'coordinate') origin = request.input.position;
  else {
    const physical = await index.resolvePhysical(request.input.key, signal);
    origin = (await sourceRecord(snapshot, physical, request.input.key, signal)).position;
    progress?.({ phase: 'verify-resolve', scannedPoints: 1, payloadBytes: snapshot.layout.stride }); signal?.throwIfAborted();
  }
  const disk = { totalPages: index.pages.length, visitedPages: 0, excludedPages: 0, prunedPages: 0, coveredPoints: 0, cacheBytes: 0, maxCacheReadBytes: 0 };
  const transcript = createHash('sha256');
  transcript.update(JSON.stringify([VERIFIER, index.hash, request, origin]));
  let winner: PointWitness | null = null, winnerPhysical: number | undefined, matching = 0, scanned = 0;
  const domain = request.domain;
  // Classification and ordering intentionally differ from production. In particular
  // this uses max-axis squared distance, not summed Euclidean AABB distance.
  const ordered = index.pages.map(page => {
    const summary = page.labels[request.filter.value];
    let outside = summary === null, contained = domain.kind === 'whole-dataset', lower = 0;
    if (summary) {
      for (let axis = 2; axis >= 0; axis--) {
        if (domain.kind === 'aabb') {
          if (summary.max[axis] < domain.min[axis] || summary.min[axis] > domain.max[axis]) outside = true;
        }
        const delta = Math.max(summary.min[axis] - origin[axis], origin[axis] - summary.max[axis], 0);
        lower = Math.max(lower, delta * delta);
      }
      if (domain.kind === 'aabb') contained = summary.min[0] >= domain.min[0] && summary.max[0] <= domain.max[0] &&
        summary.min[1] >= domain.min[1] && summary.max[1] <= domain.max[1] && summary.min[2] >= domain.min[2] && summary.max[2] <= domain.max[2];
    }
    return { page, summary, outside, contained, lower };
  }).sort((a, b) => a.lower - b.lower || b.page.start - a.page.start);
  let metadataPages = 0;
  for (const item of ordered) {
    // Independent bounded scheduling: abort checks every metadata page; actual
    // I/O yields and every record page is bounded separately to4096 points.
    if (metadataPages++ % 128 === 0) await setImmediate();
    signal?.throwIfAborted();
    const { page, summary, outside, contained, lower } = item;
    disk.coveredPoints += page.count;
    if (outside) { disk.excludedPages++; transcript.update(JSON.stringify([page.start, page.hash, 'excluded'])); continue; }
    if (contained) matching += summary!.count;
    const distant = winner !== null && lower > winner.distanceSquared;
    if (contained && distant) { disk.prunedPages++; transcript.update(JSON.stringify([page.start, page.hash, 'pruned', lower])); continue; }
    // Partial boundary pages must be read even when distant, for exact domain counts.
    const bytes = await index.readPage(page, signal);
    disk.visitedPages++; disk.cacheBytes += bytes.length; disk.maxCacheReadBytes = Math.max(disk.maxCacheReadBytes, bytes.length);
    scanned += page.count;
    transcript.update(JSON.stringify([page.start, page.hash, 'visited', lower]));
    for (let offset = 0; offset < bytes.length; offset += 40) {
      const label = bytes.readUInt32LE(offset + 36);
      if (label !== request.filter.value) continue;
      const position: Vec3 = [bytes.readDoubleLE(offset), bytes.readDoubleLE(offset + 8), bytes.readDoubleLE(offset + 16)];
      if (domain.kind === 'aabb' && (position[0] < domain.min[0] || position[0] > domain.max[0] || position[1] < domain.min[1] || position[1] > domain.max[1] || position[2] < domain.min[2] || position[2] > domain.max[2])) continue;
      if (!contained) matching++;
      if (distant) continue;
      const file = bytes.readUInt32LE(offset + 24), row = bytes.readUInt32LE(offset + 28);
      const x = position[0] - origin[0], y = position[1] - origin[1], z = position[2] - origin[2];
      const square = (x * x + y * y) + z * z;
      if (winner && (square > winner.distanceSquared || (square === winner.distanceSquared &&
        (file > winner.key.sourceFileId || (file === winner.key.sourceFileId && row >= winner.key.sourceRow))))) continue;
      winner = { key: { sourceFileId: file, sourceRow: row }, position, label: request.filter.value, distanceSquared: square, distanceMeters: Math.sqrt(square) };
      winnerPhysical = bytes.readUInt32LE(offset + 32);
    }
    progress?.({ phase: 'verify', scannedPoints: scanned, payloadBytes: 0 }); signal?.throwIfAborted();
  }
  // Includes zero-page/zero-label queries and all-excluded/pruned traversals.
  progress?.({ phase: 'verify', scannedPoints: scanned, payloadBytes: 0 }); signal?.throwIfAborted();
  requireData(disk.coveredPoints === snapshot.dataset.totalPoints && disk.visitedPages + disk.excludedPages + disk.prunedPages === disk.totalPages &&
    scanned <= snapshot.dataset.totalPoints && disk.cacheBytes === scanned * 40 && disk.maxCacheReadBytes <= 163840 &&
    (domain.kind !== 'whole-dataset' || matching === index.counts[request.filter.value]), 'Verifier incomplete disk coverage');
  if (winner) {
    requireData(await index.resolvePhysical(winner.key, signal) === winnerPhysical, 'Verifier winning lookup mismatch');
    const source = await sourceRecord(snapshot, winnerPhysical!, winner.key, signal);
    requireData(source.label === request.filter.value && source.position.every((n, i) => n === winner!.position[i]), 'Original winning record mismatch');
  }
  await index.check(signal); await snapshot.check(signal);
  transcript.update(JSON.stringify([disk, matching, winner]));
  return { origin, winner, matching, scanned, disk, transcriptHash: transcript.digest('hex'), verifier: VERIFIER as typeof VERIFIER,
    requestHash: digest(JSON.stringify(request)) };
}
