import { canonicalResolvedPlacementSpecification, type CropBox, type ModelAreaOfInterest, type ResolvedPlacementSpecification, type TorontoCadProposal, type Vec3 } from '@spatial/contracts';
import { torontoReadonlyFetch } from '../toronto-readonly-fetch';

export interface PlacementSettings {
  dimensions: Vec3; frontAccessDepth: number; poleSeparation: number;
  maxGroundSlopeDegrees: number; maxGroundRelief: number; spacingMeters: number; allowedYawDegrees: number[];
}
export interface PlacementWitness { position: Vec3; label: number; source: { sourceFileId: number; sourceRow: number; preparedRecordIndex: number } }
export interface PlacementVolumeEvidence {
  bounds: CropBox; totalCount: number; countsByLabel: readonly number[]; supportingGroundCount: number;
  obstructionCount: number; points: readonly PlacementWitness[]; truncated: boolean;
}
export interface PlacementCandidate {
  id: string; rank: number; operation: { kind: 'box'; center: Vec3; dimensions: Vec3 }; yawDegrees: number;
  groundSlopeDegrees: number; groundRelief: number; poleSeparationMeters: number | null;
  body: PlacementVolumeEvidence; access: PlacementVolumeEvidence | null;
}
export interface PlacementShortlist {
  searchId: string; specification: ResolvedPlacementSpecification; status: 'complete' | 'incomplete';
  candidates: readonly PlacementCandidate[]; evaluated: number; generated: number; reason?: string;
  limitations: readonly string[]; binding: { preprocessingHash: string; indexHash: string; sourceHash: string };
}
export function illustrationSettings(): PlacementSettings {
  return { dimensions: [1, 1, 1.2], frontAccessDepth: 1, poleSeparation: 2, maxGroundSlopeDegrees: 5,
    maxGroundRelief: .1, spacingMeters: 2, allowedYawDegrees: [0, 90, 180, 270] };
}
async function request(action: 'search' | 'propose', body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await torontoReadonlyFetch(`/datasets/toronto3d/placement/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('Placement service returned an invalid response. Retry.');
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Placement response exceeds the display budget. Retry a smaller area.');
  const reply = JSON.parse(text);
  if (!response.ok || reply.ok !== true) throw new Error(`Placement ${reply.error?.code ?? response.status}. Refresh scene authority or select a smaller area and retry.`);
  return reply.result;
}
export async function searchPlacementSites(area: ModelAreaOfInterest, settings: PlacementSettings, signal: AbortSignal): Promise<PlacementShortlist> {
  return validatePlacementShortlist(await request('search', { area, settings }, signal));
}
/** Untrusted display data, never mutation authority. Detach it from the tool/event owner. */
export function validatePlacementShortlist(value: unknown): PlacementShortlist {
  const fail = (): never => { throw new Error('Invalid placement shortlist. Find sites again.'); };
  const json = JSON.stringify(value);
  if (!json || json.length > 2_000_000) return fail();
  const result = JSON.parse(json) as PlacementShortlist;
  const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7);
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  const token = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  const text = (s: unknown): s is string => typeof s === 'string' && s.length <= 2000;
  const volume = (v: PlacementVolumeEvidence | null): boolean => !!v && vector(v.bounds?.min) && vector(v.bounds?.max) &&
    v.bounds.min.every((n, i) => n <= v.bounds.max[i]) && count(v.totalCount) && count(v.supportingGroundCount) && count(v.obstructionCount) &&
    v.supportingGroundCount + v.obstructionCount === v.totalCount && Array.isArray(v.countsByLabel) && v.countsByLabel.length === 9 &&
    v.countsByLabel.every(count) && v.countsByLabel.reduce((a, b) => a + b, 0) === v.totalCount && typeof v.truncated === 'boolean' &&
    Array.isArray(v.points) && v.points.length <= 12 && v.points.length <= v.obstructionCount && v.points.every(p => !!p && vector(p.position) &&
      count(p.label) && p.label <= 8 && !!p.source && count(p.source.sourceFileId) && count(p.source.sourceRow) && count(p.source.preparedRecordIndex));
  if (!result || !token(result.searchId) || !['complete', 'incomplete'].includes(result.status) ||
      !count(result.evaluated) || !count(result.generated) || result.evaluated > result.generated || result.generated > 100_000 ||
      !Array.isArray(result.limitations) || result.limitations.length > 32 || !result.limitations.every(text) ||
      (result.reason !== undefined && !text(result.reason)) || !result.binding ||
      ![result.binding.preprocessingHash, result.binding.indexHash, result.binding.sourceHash].every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) ||
      !Array.isArray(result.candidates) || result.candidates.length > 5 ||
      (result.status !== 'complete' && result.candidates.length > 0)) return fail();
  result.specification = canonicalResolvedPlacementSpecification(result.specification);
  const parameters = result.specification.parameters;
  if (result.candidates.some((c, i) => !c || !token(c.id) || c.rank !== i + 1 || c.operation?.kind !== 'box' ||
      !vector(c.operation.center) || !vector(c.operation.dimensions) || c.operation.dimensions.some((n: number) => n <= 0) ||
      ![0, 90, 180, 270].includes(c.yawDegrees) || !parameters.allowedYawDegrees.includes(c.yawDegrees) ||
      !Number.isFinite(c.groundSlopeDegrees) || c.groundSlopeDegrees < 0 || !Number.isFinite(c.groundRelief) || c.groundRelief < 0 ||
      (c.poleSeparationMeters !== null && (!Number.isFinite(c.poleSeparationMeters) || c.poleSeparationMeters < 0)) ||
      !volume(c.body) || (parameters.frontAccessDepth > 0 ? !volume(c.access) : c.access !== null))) return fail();
  if (new Set(result.candidates.map(c => c.id)).size !== result.candidates.length) return fail();
  return result;
}

/** Exact active AOI and point/CAD snapshots must match, including authority replacement. */
export function placementMatchesScene(result: PlacementShortlist, area: ModelAreaOfInterest,
  points?: { sessionId: string; revision: number }, cad?: { sessionId: string; revision: number }): boolean {
  const b = result.specification.parameters.binding;
  return !!points && !!cad && b.datasetId === area.datasetId && b.artifactRevision === area.artifactRevision &&
    b.frameId === area.frameId && b.units === area.units && JSON.stringify(b.localOrigin) === JSON.stringify(area.localOrigin) &&
    JSON.stringify(result.specification.parameters.area.corners) === JSON.stringify(area.corners) &&
    b.pointAuthority.sessionId === points.sessionId && b.pointAuthority.revision === points.revision &&
    b.cadAuthority.sessionId === cad.sessionId && b.cadAuthority.revision === cad.revision;
}

export async function proposePlacementSite(searchId: string, candidateId: string, signal: AbortSignal): Promise<TorontoCadProposal> {
  // Refresh the existing validated CAD controller after this call; never publish authority here.
  return await request('propose', { searchId, candidateId }, signal) as TorontoCadProposal;
}

/** Candidate operation dimensions are already cardinal-yaw adjusted by the engine. */
export function placementAccessBounds(candidate: PlacementCandidate, depth: number): CropBox | undefined {
  if (!(depth > 0)) return;
  const { center: c, dimensions: d } = candidate.operation;
  const min = c.map((v, i) => v - d[i] / 2) as unknown as [number, number, number];
  const max = c.map((v, i) => v + d[i] / 2) as unknown as [number, number, number];
  switch (candidate.yawDegrees) {
    case 0: min[1] = max[1]; max[1] += depth; break;
    case 90: max[0] = min[0]; min[0] -= depth; break;
    case 180: max[1] = min[1]; min[1] -= depth; break;
    case 270: min[0] = max[0]; max[0] += depth; break;
    default: throw new Error('Unsupported placement orientation');
  }
  return { min, max };
}
