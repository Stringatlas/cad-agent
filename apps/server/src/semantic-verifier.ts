import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { canonicalPoleRequest, type CompleteQuery, type NearestPoleRequest, type PointWitness, type Vec3,
  type VerificationOutcome, type ScanStats, TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import type { NearestQueryVerifier } from '@spatial/agent-harness';
import { SemanticArtifact, SEMANTIC_LIMITS, SEMANTIC_CONFIG, SemanticFailure, digest, semanticFailure } from './semantic-artifact';
import type { SemanticProgressHandler } from './semantic-query';

/** Deliberately independent layout/record decoder and reduction, without production helpers. */
export class LinearRecordVerifier implements NearestQueryVerifier {
  constructor(private readonly snapshot: SemanticArtifact, private readonly progress?: SemanticProgressHandler) {}
  async verify(value: NearestPoleRequest, answer: CompleteQuery, signal?: AbortSignal): Promise<VerificationOutcome> {
    try {
      const request = canonicalPoleRequest(value); signal?.throwIfAborted(); await this.snapshot.check(signal);
      if (request.expectedArtifactRevision !== this.snapshot.dataset.revision) throw new SemanticFailure('stale-revision', 'Verifier revision mismatch');
      const check = (ok: unknown) => { if (!ok) throw new SemanticFailure('corrupt-data', 'Independent record validation failed'); };
      const metadata = JSON.parse(this.snapshot.metadataBytes.toString()), manifest = JSON.parse(this.snapshot.manifestBytes.toString());
      check(metadata.version === '2.0' && metadata.encoding === 'UNCOMPRESSED' && Array.isArray(metadata.attributes) && metadata.attributes.length <= 64);
      const fields = new Map<string, number>(), expected = new Map<string, [string, number]>([
        ['position', ['int32', 12]], ['point source id', ['uint16', 2]], ['source_row', ['uint32', 4]], ['scalar_Label', ['float', 4]],
      ]);
      let stride = 0, bounds: { min: number[]; max: number[] } | undefined;
      for (const a of metadata.attributes) {
        check(a && typeof a.name === 'string' && !fields.has(a.name) && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 256);
        const specification = expected.get(a.name);
        if (specification) check(a.type === specification[0] && a.size === specification[1]);
        fields.set(a.name, stride); stride += a.size;
        if (a.name === 'position') bounds = { min: a.min, max: a.max };
      }
      const triple = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7);
      check(stride <= 256 && [...expected.keys()].every(key => fields.has(key)) && bounds && triple(bounds.min) && triple(bounds.max));
      check(triple(metadata.scale) && metadata.scale.every((n: number) => n > 0 && n <= 1) && triple(metadata.offset) &&
        Number.isSafeInteger(metadata.points) && metadata.points > 0 && this.snapshot.payloadSize === metadata.points * stride);
      check(manifest.semantic_attribute === 'scalar_Label' && manifest.semantic_classes?.[request.filter.value] === TORONTO_SEMANTIC_LABELS[request.filter.value] &&
        manifest.units === 'm' && manifest.frame === 'right-handed Z-up' && JSON.stringify(manifest.local_origin_world) === '[627285,4841948,0]' &&
        JSON.stringify(manifest.potree_scale_m) === JSON.stringify(metadata.scale) && Array.isArray(manifest.sources) && manifest.sources.length === 4);
      const counts = new Map<number, number>();
      for (const source of manifest.sources) {
        check(source && Number.isSafeInteger(source.source_file_id) && source.source_file_id >= 1 && source.source_file_id <= 4 && !counts.has(source.source_file_id) &&
          Number.isSafeInteger(source.points) && source.points >= 0 && source.points <= 0x100000000 && source.file === `L${String(source.source_file_id).padStart(3, '0')}.ply`);
        counts.set(source.source_file_id, source.points);
      }
      check([...counts.values()].reduce((sum, n) => sum + n, 0) === metadata.points);
      const stats = { scannedPoints: 0, matchingPoints: 0, hierarchyChunks: 0, payloadNodes: 0, hierarchyBytes: 0,
        payloadBytes: 0, metadataBytes: this.snapshot.metadataBytes.length + this.snapshot.manifestBytes.length,
        maxReadBytes: 0, resolutionPoints: 0, resolutionPayloadBytes: 0 };
      // Physical record counting is independent of the production hierarchy walk.
      // It checks claimed hierarchy evidence; nearest minimality still comes from the full linear payload scan.
      check(this.snapshot.hierarchySize % 22 === 0);
      let proxies = 0;
      const hierarchyRead = Math.floor(SEMANTIC_LIMITS.hierarchyBytes / 22) * 22;
      for (let base = 0; base < this.snapshot.hierarchySize; base += hierarchyRead) {
        const bytes = await this.snapshot.read('hierarchy', base, Math.min(hierarchyRead, this.snapshot.hierarchySize - base), signal);
        stats.hierarchyBytes += bytes.length; stats.maxReadBytes = Math.max(stats.maxReadBytes, bytes.length);
        for (let at = 0; at < bytes.length; at += 22) {
          check(bytes[at] <= 2);
          if (bytes[at] === 2) proxies++;
          else if (bytes.readUInt32LE(at + 2) > 0) stats.payloadNodes++;
        }
        await setImmediate(); signal?.throwIfAborted();
      }
      stats.hierarchyChunks = proxies + 1;
      const scan = async (consume: (position: Vec3, file: number, row: number, label: number) => void, resolving: boolean) => {
        const transcript = createHash('sha256'); let readPoints = 0, readBytes = 0;
        const recordsPerRead = Math.floor(SEMANTIC_LIMITS.readBytes / stride);
        for (let base = 0; base < metadata.points; base += recordsPerRead) {
          const size = Math.min(recordsPerRead, metadata.points - base) * stride;
          const bytes = await this.snapshot.read('payload', base * stride, size, signal);
          readBytes += size; stats.maxReadBytes = Math.max(stats.maxReadBytes, size); transcript.update(bytes);
          for (let block = 0; block < size / stride; block += SEMANTIC_LIMITS.checkpointPoints) {
            await setImmediate(); signal?.throwIfAborted();
            for (let index = block; index < Math.min(size / stride, block + SEMANTIC_LIMITS.checkpointPoints); index++) {
              const start = index * stride + fields.get('position')!;
              const position: Vec3 = [bytes.readInt32LE(start) * metadata.scale[0] + metadata.offset[0],
                bytes.readInt32LE(start + 4) * metadata.scale[1] + metadata.offset[1], bytes.readInt32LE(start + 8) * metadata.scale[2] + metadata.offset[2]];
              const file = bytes.readUInt16LE(index * stride + fields.get('point source id')!);
              const row = bytes.readUInt32LE(index * stride + fields.get('source_row')!);
              const label = bytes.readFloatLE(index * stride + fields.get('scalar_Label')!);
              check(counts.has(file) && row < counts.get(file)! && Number.isInteger(label) && label >= 0 && label <= 8 &&
                position.every((n, i) => Number.isFinite(n) && n >= bounds!.min[i] - 0.002 && n <= bounds!.max[i] + 0.002));
              consume(position, file, row, label); readPoints++;
            }
            this.progress?.({ phase: resolving ? 'verify-resolve' : 'verify', scannedPoints: readPoints, payloadBytes: readBytes }); signal?.throwIfAborted();
          }
        }
        if (resolving) { stats.resolutionPoints = readPoints; stats.resolutionPayloadBytes = readBytes; }
        else { stats.scannedPoints = readPoints; stats.payloadBytes = readBytes; }
        return transcript.digest('hex');
      };
      let origin: Vec3;
      if (request.input.kind === 'coordinate') origin = request.input.position;
      else {
        const selectedKey = request.input.key;
        if (selectedKey.sourceRow >= counts.get(selectedKey.sourceFileId)!) throw new SemanticFailure('unknown-point', 'Verifier unknown row');
        let selected: Vec3 | undefined;
        await scan((position, file, row) => {
          if (file === selectedKey.sourceFileId && row === selectedKey.sourceRow) { check(!selected); selected = position; }
        }, true);
        if (!selected) throw new SemanticFailure('unknown-point', 'Verifier missing reference'); origin = selected;
      }
      let winner: PointWitness | null = null;
      const domain = request.domain;
      const transcriptHash = await scan((position, file, row, label) => {
        if (label !== request.filter.value) return;
        if (domain.kind === 'aabb') for (let axis = 0; axis < 3; axis++) if (position[axis] < domain.min[axis] || position[axis] > domain.max[axis]) return;
        stats.matchingPoints++;
        const x = position[0] - origin[0], y = position[1] - origin[1], z = position[2] - origin[2];
        const square = (x * x + y * y) + z * z;
        if (winner !== null) {
          if (square > winner.distanceSquared) return;
          if (square === winner.distanceSquared && (file > winner.key.sourceFileId || (file === winner.key.sourceFileId && row >= winner.key.sourceRow))) return;
        }
        winner = { key: { sourceFileId: file, sourceRow: row }, position, label: request.filter.value, distanceSquared: square, distanceMeters: Math.sqrt(square) };
      }, false);
      await this.snapshot.check(signal);
      const evidence = answer.evidence, requestHash = digest(JSON.stringify(request));
      const witnessEqual = (a: PointWitness | null, b: PointWitness | null) => a === null || b === null ? a === b :
        a.label === b.label && a.key.sourceFileId === b.key.sourceFileId && a.key.sourceRow === b.key.sourceRow &&
        a.distanceSquared === b.distanceSquared && a.distanceMeters === b.distanceMeters && a.position.length === 3 && a.position.every((n, i) => n === b.position[i]);
      const finiteStats = evidence && Object.keys(stats).every(key => typeof evidence[key as keyof ScanStats] === 'number' && Number.isSafeInteger(evidence[key as keyof ScanStats]) && evidence[key as keyof ScanStats] >= 0);
      if (!finiteStats || answer.status !== 'complete' || evidence.completion !== 'exhausted' || evidence.artifactRevision !== request.expectedArtifactRevision ||
        evidence.requestHash !== requestHash || evidence.algorithm !== 'potree-semantic-full-scan-v1' || evidence.arithmetic !== 'xyz-binary64-v1' ||
        evidence.configHash !== digest(JSON.stringify(SEMANTIC_CONFIG)) || !/^[a-f0-9]{64}$/.test(evidence.traversalHash) ||
        evidence.scannedPoints !== stats.scannedPoints || evidence.matchingPoints !== stats.matchingPoints ||
        evidence.payloadBytes !== stats.payloadBytes || evidence.resolutionPoints !== stats.resolutionPoints || evidence.resolutionPayloadBytes !== stats.resolutionPayloadBytes ||
        evidence.hierarchyBytes !== stats.hierarchyBytes * (request.input.kind === 'point-ref' ? 2 : 1) ||
        evidence.hierarchyChunks !== stats.hierarchyChunks * (request.input.kind === 'point-ref' ? 2 : 1) || evidence.payloadNodes !== stats.payloadNodes ||
        evidence.metadataBytes !== stats.metadataBytes || evidence.maxReadBytes > SEMANTIC_LIMITS.readBytes ||
        answer.queryPosition.length !== 3 || answer.queryPosition.some((n, i) => n !== origin[i]) || !witnessEqual(answer.nearest, winner)) {
        return { status: 'rejected', reason: 'Independent winner, coverage or binding mismatch' };
      }
      return { status: 'verified', evidence: { ...stats, verifier: 'linear-record-oracle-v1', artifactRevision: this.snapshot.dataset.revision, requestHash, transcriptHash } };
    } catch (error) { return semanticFailure(error, signal); }
  }
}
