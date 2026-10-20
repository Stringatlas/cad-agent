import { randomUUID } from 'node:crypto';
import { canonicalProtocolJson, protocolKeys, protocolRecord, type AreaCandidateResult, type ModelCaptureRequest, type ModelVisualObservation } from '@spatial/contracts';

/** Turn-local evidence retention. No geometry authority and no historical image receipts. */
export class AreaCandidateJudgement {
  private pool?: AreaCandidateResult;
  get active(): boolean { return !!this.pool; }
  private receipt?: { id: string; hash: string; round: number; ids: Set<string> };
  retain(result: AreaCandidateResult): AreaCandidateResult {
    this.receipt = undefined;
    this.pool = structuredClone({ ...result, assessment: { kind: 'provisional', scanId: randomUUID(), message: 'Numerical evidence only; awaiting model visual judgement.' } });
    return structuredClone(this.pool!);
  }
  captureRequest(): ModelCaptureRequest | undefined {
    const points = this.pool?.candidates;
    if (!points?.length) return;
    const min = [0, 1, 2].map(i => Math.min(...points.map(c => c.position[i])));
    const max = [0, 1, 2].map(i => Math.max(...points.map(c => c.position[i])));
    const target = min.map((n, i) => (n + max[i]) / 2) as [number, number, number];
    // Conservative plan view including context around the entire evidence pool,
    // independent of the user's current orbit focus. Projection is checked below.
    return { kind: 'camera', position: [target[0], target[1], max[2] + Math.max(25, (max[0] - min[0] + 12) * 4, (max[1] - min[1] + 12) * 2)], target, up: [0, 1, 0], colorMode: 'rgb' };
  }
  capture(request: ModelCaptureRequest, image: ModelVisualObservation | undefined, round: number): string | undefined {
    this.receipt = undefined;
    const pool = this.pool, expected = this.captureRequest();
    if (!pool || !image || !expected || canonicalProtocolJson(request) !== canonicalProtocolJson(expected) ||
      image.binding.sourceId !== pool.area.datasetId || image.binding.sourceRevision !== pool.binding.artifactRevision || image.binding.frameId !== pool.area.frameId || image.binding.units !== 'm' ||
      canonicalProtocolJson(image.binding.origin) !== canonicalProtocolJson(pool.area.localOrigin) ||
      expected.kind !== 'camera' || image.camera.position.some((n, i) => Math.abs(n - expected.position[i]) > 1e-6) ||
      image.crop && (image.crop.x !== 0 || image.crop.y !== 0 || image.crop.width !== image.viewport.width || image.crop.height !== image.viewport.height)) return;
    const evidence = image.coverage.areaCandidateEvidence as unknown as { scanId?: string; nearby?: { id: string; count: number }[] } | undefined;
    if (evidence?.scanId !== pool.assessment!.scanId || !Array.isArray(evidence.nearby)) return;
    const multiply = (m: readonly number[], v: number[]) => [0, 1, 2, 3].map(i => m[i] * v[0] + m[i + 4] * v[1] + m[i + 8] * v[2] + m[i + 12] * v[3]);
    const ids = new Set(pool.candidates.filter(c => {
      const p = multiply(image.camera.projectionMatrix, multiply(image.camera.matrixWorldInverse, [...c.position, 1]));
      return p.every(Number.isFinite) && p[3] > 0 && p.slice(0, 2).every(n => Math.abs(n / p[3]) < .95) && Math.abs(p[2] / p[3]) <= 1 &&
        evidence.nearby!.some(n => n.id === c.id && Number.isSafeInteger(n.count) && n.count >= 3);
    }).map(c => c.id));
    if (!ids.size) return;
    const id = randomUUID(); this.receipt = { id, hash: image.image.sha256, round, ids }; return id;
  }
  finalize(value: unknown, round: number): AreaCandidateResult {
    const a = protocolRecord(value); protocolKeys(a, ['scanId', 'captureId', 'selections']);
    const pool = this.pool, receipt = this.receipt;
    if (!pool || pool.status !== 'complete' || !receipt || receipt.round >= round || a.scanId !== pool.assessment!.scanId || a.captureId !== receipt.id ||
      !Array.isArray(a.selections) || a.selections.length < 1 || a.selections.length > (pool.settings.maxCandidates ?? 5)) throw new Error('Candidate judgement requires this turn’s scan and a delivered relevant image.');
    const ids = new Set<string>();
    const candidates = a.selections.map((value, i) => {
      const s = protocolRecord(value); protocolKeys(s, ['candidateId', 'rationale', 'uncertainty']);
      const candidate = pool.candidates.find(c => c.id === s.candidateId);
      const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 400 && !/[\u0000-\u001f\u007f]/u.test(v);
      if (!candidate || ids.has(candidate.id) || !receipt.ids.has(candidate.id) || !text(s.rationale) || !text(s.uncertainty)) throw new Error('Invalid or visually unsupported candidate judgement.');
      ids.add(candidate.id);
      return { ...candidate, rank: i + 1, rationale: s.rationale.trim(), uncertainty: s.uncertainty.trim() };
    });
    return { ...structuredClone(pool), candidates, assessment: { kind: 'model-assessed', scanId: pool.assessment!.scanId, captureId: receipt.id, imageSha256: receipt.hash } };
  }
}
