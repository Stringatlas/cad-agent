import type { Vec3 } from './index';
import { protocolHash, protocolInteger, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';

/** Intent only: this contract neither searches nor authorizes geometry changes. */
export interface PlacementBinding {
  readonly datasetId: 'toronto3d';
  readonly artifactRevision: string;
  readonly terrainRevision: string;
  readonly frameId: 'toronto3d-local-v1';
  readonly units: 'm';
  readonly localOrigin: Vec3;
  readonly pointAuthority: { readonly sessionId: string; readonly revision: number };
  readonly cadAuthority: { readonly sessionId: string; readonly revision: number };
}
export interface PlacementArea {
  /** Ordered adjacent corners of an XY rectangle; Z is reference elevation only. */
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
}
export type PlacementRankingMetric = 'pole-separation' | 'ground-slope' | 'ground-relief' | 'body-conflicts' | 'access-conflicts';
export interface PlacementValues {
  readonly binding: PlacementBinding;
  readonly area: PlacementArea;
  /** Width X, depth Y, height Z before yaw. Front is local +Y. */
  readonly dimensions: Vec3;
  /** Full-width front-face extension, base-aligned. Zero depth disables access. */
  readonly frontAccessDepth: number;
  readonly frontAccessHeight: number;
  /** Inclusive minimum; distance to original observed pole points, not fitted poles. */
  readonly poleSeparation: number;
  readonly poleDistance: { readonly from: 'box-center' | 'box-boundary'; readonly metric: 'horizontal' | '3d'; readonly to: 'observed-pole-points' };
  readonly maxGroundSlopeDegrees: number;
  readonly maxGroundRelief: number;
  /** LS plane slope and max(Z)-min(Z) over footprint ground samples; not continuous support. */
  readonly groundMeasurement: 'sampled-plane-slope-and-height-range';
  /** Degrees CCW about +Z; local +Y front rotates with the box. */
  readonly allowedYawDegrees: readonly number[];
  /** Inclusive XY containment; reference Z does not bound vertical extent. */
  readonly containment: 'footprint' | 'footprint-and-access';
  readonly maxBodyConflicts: number;
  readonly maxAccessConflicts: number;
  /** Lexicographic, first metric highest priority; [] explicitly means no preference. */
  readonly ranking: readonly { readonly metric: PlacementRankingMetric; readonly direction: 'minimize' | 'maximize' }[];
}
export type PlacementField = keyof PlacementValues;
export interface PlacementAssumption { readonly field: PlacementField; readonly reason: string }
export interface PlacementIntent {
  readonly schemaVersion: 1;
  readonly parameters: { readonly [K in PlacementField]: PlacementValues[K] | null };
  readonly assumptions: readonly PlacementAssumption[];
}
export interface ResolvedPlacementSpecification extends PlacementIntent {
  readonly parameters: PlacementValues;
}
const fields = ['binding', 'area', 'dimensions', 'frontAccessDepth', 'frontAccessHeight', 'poleSeparation', 'poleDistance', 'maxGroundSlopeDegrees', 'maxGroundRelief', 'groundMeasurement', 'allowedYawDegrees', 'containment', 'maxBodyConflicts', 'maxAccessConflicts', 'ranking'] as const satisfies readonly PlacementField[];
const metrics = ['pole-separation', 'ground-slope', 'ground-relief', 'body-conflicts', 'access-conflicts'] as const;
const fail = (): never => { throw new TypeError('Invalid placement specification'); };
function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const r = protocolRecord(value); protocolKeys(r, required, optional); return r;
}
function number(value: unknown, min: number, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail();
  return Object.is(value, -0) ? 0 : value;
}
function vector(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return fail();
  return [number(value[0], -1e7, 1e7), number(value[1], -1e7, 1e7), number(value[2], -1e7, 1e7)];
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : fail();
}
function authority(value: unknown): PlacementBinding['pointAuthority'] {
  const r = record(value, ['sessionId', 'revision']); protocolToken(r.sessionId); protocolInteger(r.revision);
  return { sessionId: r.sessionId, revision: r.revision };
}
function binding(value: unknown): PlacementBinding {
  const r = record(value, ['datasetId', 'artifactRevision', 'terrainRevision', 'frameId', 'units', 'localOrigin', 'pointAuthority', 'cadAuthority']);
  if (r.datasetId !== 'toronto3d' || r.frameId !== 'toronto3d-local-v1' || r.units !== 'm') return fail();
  protocolHash(r.artifactRevision); protocolHash(r.terrainRevision);
  const localOrigin = vector(r.localOrigin);
  if (localOrigin[0] !== 627285 || localOrigin[1] !== 4841948 || localOrigin[2] !== 0) return fail();
  return { datasetId: r.datasetId, artifactRevision: r.artifactRevision, terrainRevision: r.terrainRevision, frameId: r.frameId, units: r.units, localOrigin, pointAuthority: authority(r.pointAuthority), cadAuthority: authority(r.cadAuthority) };
}
function area(value: unknown): PlacementArea {
  const r = record(value, ['corners']);
  if (!Array.isArray(r.corners) || r.corners.length !== 4) return fail();
  const corners = [vector(r.corners[0]), vector(r.corners[1]), vector(r.corners[2]), vector(r.corners[3])] as const;
  const [p, q, s, t] = corners, u = [q[0] - p[0], q[1] - p[1]], v = [t[0] - p[0], t[1] - p[1]];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  if (lu < .01 || lv < .01 || corners.some(c => Math.abs(c[2] - p[2]) > 1e-6) ||
      Math.abs(u[0] * v[0] + u[1] * v[1]) > lu * lv * 1e-6 ||
      Math.hypot(s[0] - q[0] - t[0] + p[0], s[1] - q[1] - t[1] + p[1]) > 1e-5) return fail();
  return { corners };
}
function parameter<K extends PlacementField>(field: K, value: unknown): PlacementValues[K] {
  let result: unknown;
  switch (field) {
    case 'binding': result = binding(value); break;
    case 'area': result = area(value); break;
    case 'dimensions': {
      const dims = vector(value); if (dims.some(n => n <= 0)) return fail(); result = dims; break;
    }
    case 'poleDistance': {
      const r = record(value, ['from', 'metric', 'to']);
      result = { from: choice(r.from, ['box-center', 'box-boundary']), metric: choice(r.metric, ['horizontal', '3d']), to: choice(r.to, ['observed-pole-points']) }; break;
    }
    case 'groundMeasurement': result = choice(value, ['sampled-plane-slope-and-height-range']); break;
    case 'containment': result = choice(value, ['footprint', 'footprint-and-access']); break;
    case 'allowedYawDegrees': {
      if (!Array.isArray(value) || value.length === 0 || value.length > 360) return fail();
      // Bounded one-turn input avoids loss of precision for enormous angles.
      const angles = Array.from(value, a => { const angle = number(a, -360, 360) % 360; const positive = angle < 0 ? angle + 360 : angle; return positive === 360 || Object.is(positive, -0) ? 0 : positive; });
      result = [...new Set(angles)].sort((a, b) => a - b); break;
    }
    case 'ranking': {
      if (!Array.isArray(value) || value.length > metrics.length) return fail();
      const ranking = Array.from(value, item => { const r = record(item, ['metric', 'direction']); return { metric: choice(r.metric, metrics), direction: choice(r.direction, ['minimize', 'maximize']) }; });
      if (new Set(ranking.map(p => p.metric)).size !== ranking.length) return fail(); result = ranking; break;
    }
    case 'maxBodyConflicts': case 'maxAccessConflicts': protocolInteger(value); result = value; break;
    case 'maxGroundSlopeDegrees': result = number(value, 0, 90); if (result === 90) return fail(); break;
    case 'frontAccessHeight': result = number(value, Number.MIN_VALUE); break;
    default: result = number(value, 0);
  }
  return result as PlacementValues[K];
}
/** Missing fields normalize to null; never interprets natural language or fills presets. */
export function canonicalPlacementIntent(value: unknown): PlacementIntent {
  const r = record(value, ['schemaVersion', 'parameters'], ['assumptions']);
  if (r.schemaVersion !== 1) return fail();
  const p = record(r.parameters, [], fields);
  const parameters = Object.fromEntries(fields.map(field => [field, !Object.hasOwn(p, field) || p[field] === null ? null : parameter(field, p[field])])) as PlacementIntent['parameters'];
  const input = r.assumptions === undefined ? [] : r.assumptions;
  if (!Array.isArray(input) || input.length > fields.length) return fail();
  const assumptions = Array.from(input, item => {
    const a = record(item, ['field', 'reason']), field = choice(a.field, fields);
    if (parameters[field] === null || typeof a.reason !== 'string' || a.reason.length > 500 || a.reason.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(a.reason)) return fail();
    return { field, reason: a.reason };
  });
  if (new Set(assumptions.map(a => a.field)).size !== assumptions.length) return fail();
  return { schemaVersion: 1, parameters, assumptions };
}
/** Stable field order for clarification; valid shape alone is not executable intent. */
export function unresolvedPlacementFields(intent: PlacementIntent): readonly PlacementField[] {
  const checked = canonicalPlacementIntent(intent);
  return fields.filter(field => checked.parameters[field] === null);
}
/** Fully resolved semantics only. Does not check current revisions, support or feasibility. */
export function canonicalResolvedPlacementSpecification(value: unknown): ResolvedPlacementSpecification {
  const intent = canonicalPlacementIntent(value);
  if (fields.some(field => intent.parameters[field] === null)) throw new TypeError('Unresolved placement requirements');
  return intent as ResolvedPlacementSpecification;
}
