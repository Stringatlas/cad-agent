import type { DatasetInfo, Vec3 } from './index';

export interface PointKey { readonly sourceFileId: number; readonly sourceRow: number }
export type QueryInput = { readonly kind: 'point-ref'; readonly key: PointKey } |
  { readonly kind: 'coordinate'; readonly position: Vec3 };
export type SearchDomain = { readonly kind: 'whole-dataset' } |
  { readonly kind: 'aabb'; readonly min: Vec3; readonly max: Vec3 };
export interface NearestPoleRequest {
  readonly requestId: string;
  readonly datasetId: 'toronto3d';
  readonly expectedArtifactRevision: string;
  readonly units: 'm';
  readonly frameId: 'toronto3d-local-v1';
  readonly input: QueryInput;
  readonly filter: { readonly schema: 'toronto3d-scalar-label-v1'; readonly attribute: 'scalar_Label'; readonly value: 6 };
  readonly metric: 'euclidean-3d';
  readonly domain: SearchDomain;
}
export interface PointWitness {
  readonly key: PointKey;
  readonly position: Vec3;
  readonly label: 6;
  readonly distanceSquared: number;
  readonly distanceMeters: number;
}
export interface ScanStats {
  readonly scannedPoints: number;
  readonly matchingPoints: number;
  readonly hierarchyChunks: number;
  readonly payloadNodes: number;
  readonly hierarchyBytes: number;
  readonly payloadBytes: number;
  readonly metadataBytes: number;
  readonly maxReadBytes: number;
  readonly resolutionPoints: number;
  readonly resolutionPayloadBytes: number;
}
export interface SearchEvidence extends ScanStats {
  readonly artifactRevision: string;
  readonly algorithm: 'potree-semantic-full-scan-v1' | 'pole-category-index-v1';
  /** Complete category index binding; absent for exhaustive source-record evidence. */
  readonly index?: { readonly points: number; readonly hash: string };
  readonly arithmetic: 'xyz-binary64-v1';
  readonly configHash: string;
  readonly requestHash: string;
  readonly traversalHash: string;
  readonly completion: 'exhausted' | 'indexed';
}
export type QueryErrorCode = 'invalid-input' | 'unknown-dataset' | 'unknown-point' | 'stale-revision' |
  'corrupt-data' | 'busy' | 'unavailable';
export type QueryFailure = { readonly status: 'error'; readonly code: QueryErrorCode } |
  { readonly status: 'incomplete'; readonly complete: false; readonly reason: 'cancelled' | 'resource' | 'transport' };
export interface CompleteQuery {
  readonly status: 'complete';
  readonly queryPosition: Vec3;
  readonly nearest: PointWitness | null;
  readonly evidence: SearchEvidence;
}
export type QueryOutcome = CompleteQuery | QueryFailure;
export interface VerificationEvidence extends ScanStats {
  readonly verifier: 'linear-record-oracle-v1' | 'pole-category-linear-v1';
  readonly index?: { readonly points: number; readonly hash: string };
  readonly artifactRevision: string;
  readonly requestHash: string;
  readonly transcriptHash: string;
}
export interface ArtifactReadStats {
  readonly metadataBytes: number;
  readonly hierarchyBytes: number;
  readonly payloadBytes: number;
  readonly maxReadBytes: number;
}
export type VerificationOutcome = { readonly status: 'verified'; readonly evidence: VerificationEvidence } |
  { readonly status: 'rejected'; readonly reason: string } | QueryFailure;
export type NearestPoleToolOutcome = QueryFailure | { readonly status: 'verification-rejected'; readonly reason: string } |
  { readonly status: 'verified-found' | 'verified-none'; readonly complete: true;
    readonly request: NearestPoleRequest; readonly dataset: DatasetInfo; readonly queryPosition: Vec3;
    readonly nearest: PointWitness | null; readonly search: SearchEvidence; readonly verification: VerificationEvidence;
    /** Concrete composition may attach total physical reads, including fingerprint rechecks. */
    readonly sourceReads?: ArtifactReadStats };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new TypeError('Unexpected fields');
}
function position(value: unknown): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7)) throw new TypeError('Expected bounded local-meter triple');
}
export function assertNearestPoleRequest(value: unknown): asserts value is NearestPoleRequest {
  const r = object(value);
  keys(r, ['requestId', 'datasetId', 'expectedArtifactRevision', 'units', 'frameId', 'input', 'filter', 'metric', 'domain']);
  if (typeof r.requestId !== 'string' || !r.requestId.length || r.requestId.length > 128 ||
    typeof r.expectedArtifactRevision !== 'string' || !/^[a-f0-9]{64}$/.test(r.expectedArtifactRevision) ||
    r.datasetId !== 'toronto3d' || r.units !== 'm' || r.frameId !== 'toronto3d-local-v1' || r.metric !== 'euclidean-3d') throw new TypeError('Invalid query binding');
  const filter = object(r.filter);
  keys(filter, ['schema', 'attribute', 'value']);
  if (filter.schema !== 'toronto3d-scalar-label-v1' || filter.attribute !== 'scalar_Label' || filter.value !== 6) throw new TypeError('Expected Toronto Pole filter');
  const input = object(r.input);
  if (input.kind === 'coordinate') { keys(input, ['kind', 'position']); position(input.position); }
  else if (input.kind === 'point-ref') {
    keys(input, ['kind', 'key']); const key = object(input.key); keys(key, ['sourceFileId', 'sourceRow']);
    if (!Number.isSafeInteger(key.sourceFileId) || (key.sourceFileId as number) < 1 || (key.sourceFileId as number) > 4 ||
      !Number.isSafeInteger(key.sourceRow) || (key.sourceRow as number) < 0 || (key.sourceRow as number) > 0xffffffff) throw new TypeError('Invalid point key');
  } else throw new TypeError('Unknown input kind');
  const domain = object(r.domain);
  if (domain.kind === 'whole-dataset') keys(domain, ['kind']);
  else if (domain.kind === 'aabb') {
    keys(domain, ['kind', 'min', 'max']); position(domain.min); position(domain.max);
    if (domain.min.some((n, i) => n >= (domain.max as Vec3)[i])) throw new TypeError('Expected min < max');
  } else throw new TypeError('Unknown search domain');
}

/** Fixed order also defines request hashing without depending on caller property order. */
export function canonicalPoleRequest(value: unknown): NearestPoleRequest {
  assertNearestPoleRequest(value);
  return { requestId: value.requestId, datasetId: value.datasetId, expectedArtifactRevision: value.expectedArtifactRevision,
    units: value.units, frameId: value.frameId, input: value.input.kind === 'coordinate' ?
      { kind: 'coordinate', position: [...value.input.position] as unknown as Vec3 } :
      { kind: 'point-ref', key: { sourceFileId: value.input.key.sourceFileId, sourceRow: value.input.key.sourceRow } },
    filter: { schema: value.filter.schema, attribute: value.filter.attribute, value: 6 }, metric: value.metric,
    domain: value.domain.kind === 'whole-dataset' ? { kind: 'whole-dataset' } :
      { kind: 'aabb', min: [...value.domain.min] as unknown as Vec3, max: [...value.domain.max] as unknown as Vec3 } };
}
