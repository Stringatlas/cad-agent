import { canonicalModelScene, canonicalProtocolJson, freezeProtocolValue, protocolKeys, protocolRecord, type AreaCandidateResult, type ModelAreaOfInterest, type PointOverrideSnapshot, type TorontoCadSnapshot } from '@spatial/contracts';

/** Bounded, detached display evidence. Never mutation authority or source-point selection. */
export function validateAreaCandidateResult(value: unknown): AreaCandidateResult {
  const json = canonicalProtocolJson(value, { maxDepth: 10, maxNodes: 2048, maxArrayLength: 32, maxStringLength: 2000 });
  if (json.length > 32_000) throw new Error('Candidate result exceeds display budget.');
  const r = protocolRecord(JSON.parse(json));
  protocolKeys(r, ['status', 'candidates', 'area', 'settings', 'binding', 'evidence', 'limitations'], ['reason', 'assessment']);
  const fail = (): never => { throw new Error('Invalid candidate points. Ask to scan the area again.'); };
  const number = (v: unknown, min = 0, max = 1e12): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const count = (v: unknown): v is number => number(v) && Number.isSafeInteger(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(v);
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const area = canonicalModelScene({ mode: 'toronto', toronto: [], areaOfInterest: r.area }).areaOfInterest!;
  const s = protocolRecord(r.settings); protocolKeys(s, ['spacingMeters', 'clearanceRadiusMeters', 'maxGroundReliefMeters', 'minPoleDistanceMeters', 'ranking'], ['maxCandidates']);
  if (s.maxCandidates !== undefined && (!count(s.maxCandidates) || s.maxCandidates < 1 || s.maxCandidates > 20)) fail();
  if (!number(s.spacingMeters, .5, 100) || !number(s.clearanceRadiusMeters, 0, 25) || !number(s.maxGroundReliefMeters, 0, 10) || !number(s.minPoleDistanceMeters, 0, 1000) || !['flat-ground', 'near-poles', 'far-from-poles'].includes(String(s.ranking))) fail();
  const b = protocolRecord(r.binding); protocolKeys(b, ['artifactRevision', 'indexHash', 'sourceHash', 'pointAuthority', 'cadAuthority']);
  const unavailableIndex = r.status === 'incomplete' && Array.isArray(r.candidates) && r.candidates.length === 0 && b.indexHash === '' && b.sourceHash === '';
  if (!hash(b.artifactRevision) || (!unavailableIndex && ![b.indexHash, b.sourceHash].every(hash)) || b.artifactRevision !== area.artifactRevision) fail();
  for (const authority of [b.pointAuthority, b.cadAuthority]) {
    const a = protocolRecord(authority); protocolKeys(a, ['sessionId', 'revision']);
    if (typeof a.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(a.sessionId) || !count(a.revision)) fail();
  }
  const e = protocolRecord(r.evidence); protocolKeys(e, ['pagesRead', 'sourcePointsExamined', 'areaPoints', 'cellsEvaluated', 'elapsedMilliseconds', 'cellMeters']);
  if (![e.pagesRead, e.sourcePointsExamined, e.areaPoints, e.cellsEvaluated].every(count) || (e.areaPoints as number) > (e.sourcePointsExamined as number) || !number(e.elapsedMilliseconds) || !number(e.cellMeters, .01, 100)) fail();
  if (!['complete', 'incomplete'].includes(String(r.status)) || (r.reason !== undefined && !text(r.reason)) || !Array.isArray(r.limitations) || r.limitations.length > 32 || !r.limitations.every(text) || !Array.isArray(r.candidates) || r.candidates.length > (s.maxCandidates === undefined ? 5 : s.maxCandidates as number) || (r.status !== 'complete' && r.candidates.length)) fail();
  let assessed = false;
  if (r.assessment !== undefined) {
    const a = protocolRecord(r.assessment); protocolKeys(a, ['kind', 'scanId'], ['captureId', 'imageSha256', 'message']);
    const token = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
    if (!['provisional', 'model-assessed'].includes(String(a.kind)) || !token(a.scanId) || a.message !== undefined && !text(a.message)) fail();
    assessed = a.kind === 'model-assessed';
    if (assessed ? !token(a.captureId) || !hash(a.imageSha256) || r.status !== 'complete' || !(r.candidates as unknown[]).length : a.captureId !== undefined || a.imageSha256 !== undefined) fail();
  }
  const [p, q, , t] = area.corners;
  const u = [q[0] - p[0], q[1] - p[1]], v = [t[0] - p[0], t[1] - p[1]];
  const ids = new Set<string>();
  (r.candidates as unknown[]).forEach((value, i) => {
    const c = protocolRecord(value); protocolKeys(c, ['id', 'rank', 'position', 'groundPoints', 'groundReliefMeters', 'observedObstacleCells', 'poleDistanceMeters'], ['rationale', 'uncertainty']);
    if (assessed ? !text(c.rationale) || !text(c.uncertainty) : c.rationale !== undefined || c.uncertainty !== undefined) fail();
    if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(c.id) || ids.has(c.id) || c.rank !== i + 1 || !Array.isArray(c.position) || c.position.length !== 3 || !c.position.every(n => number(n, -1e7, 1e7)) || !count(c.groundPoints) || !c.groundPoints || !number(c.groundReliefMeters) || !count(c.observedObstacleCells) || (c.poleDistanceMeters !== null && !number(c.poleDistanceMeters))) fail();
    ids.add(c.id as string);
    const xyz = c.position as number[], d = [xyz[0] - p[0], xyz[1] - p[1]];
    const a = (d[0] * u[0] + d[1] * u[1]) / (u[0] ** 2 + u[1] ** 2), b = (d[0] * v[0] + d[1] * v[1]) / (v[0] ** 2 + v[1] ** 2);
    if (a < -1e-8 || a > 1 + 1e-8 || b < -1e-8 || b > 1 + 1e-8) fail();
  });
  return freezeProtocolValue({ ...r, area }) as unknown as AreaCandidateResult;
}

/** Exact AOI and live source-only authority; refresh gaps and pending edits fail closed. */
export function areaCandidatesMatchScene(result: AreaCandidateResult, area?: ModelAreaOfInterest, points?: PointOverrideSnapshot, cad?: TorontoCadSnapshot): boolean {
  const b = result.binding;
  return !!area && !!points && !!cad && canonicalProtocolJson(result.area) === canonicalProtocolJson(area) &&
    b.artifactRevision === area.artifactRevision && points.artifactRevision === area.artifactRevision && cad.artifactRevision === area.artifactRevision &&
    points.entries.length === 0 && cad.bodies.length === 0 && cad.proposals.length === 0 &&
    b.pointAuthority.sessionId === points.sessionId && b.pointAuthority.revision === points.revision &&
    b.cadAuthority.sessionId === cad.sessionId && b.cadAuthority.revision === cad.revision;
}
