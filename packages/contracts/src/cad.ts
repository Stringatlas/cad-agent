import type { Vec3 } from './index';

/** Local ephemeral CAD sandbox, NOT an editable ProjectState or approval/publish API. */
export const CAD_OPERATIONS = ['box', 'cylinder', 'boolean', 'inspect', 'tessellate', 'export-step', 'delete'] as const;
export const CAD_LIMITS = Object.freeze({
  maxRequestBytes: 8192, maxResponseBytes: 4 * 1024 * 1024,
  maxBodies: 32, maxBooleanComplexity: 16, maxFaces: 256, maxEdges: 512, maxVertices: 1024,
  minDimension: 0.001, maxDimension: 100, maxCoordinate: 1000,
  maxMeshVertices: 50000, maxMeshTriangles: 100000, maxStepBytes: 2 * 1024 * 1024,
  meshTolerance: 0.01, meshAngularTolerance: 0.2,
  operationTimeoutMs: 15000, requestTimeoutMs: 10000, maxConcurrency: 1,
});
export interface CadSource { readonly sessionId: string; readonly projectRevision: number; readonly frameId: string }
export interface CadBodyRef { readonly bodyId: string; readonly bodyRevision: 1 }
export type CadOperation =
  | { readonly kind: 'box'; readonly center: Vec3; readonly dimensions: Vec3 }
  | { readonly kind: 'cylinder'; readonly center: Vec3; readonly radius: number; readonly height: number }
  | { readonly kind: 'boolean'; readonly operator: 'union' | 'subtract' | 'intersect'; readonly left: CadBodyRef; readonly right: CadBodyRef }
  | { readonly kind: 'inspect' | 'tessellate' | 'export-step' | 'delete'; readonly body: CadBodyRef };
export interface CadRequest extends CadSource { readonly operation: CadOperation }
export interface CadValidation {
  readonly valid: true;
  readonly volume: number;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly topology: { readonly solids: 1; readonly faces: number; readonly edges: number; readonly vertices: number };
  readonly kernel: { readonly name: 'OpenCascade'; readonly package: 'replicad-opencascadejs'; readonly version: '1.1.0'; readonly validation: 'BRepCheck_Analyzer' };
}
export interface CadBodyResult extends CadValidation {
  readonly body: CadBodyRef; readonly source: CadSource; readonly units: 'm'; readonly complexity: number;
}
export type CadResult = CadBodyResult
  | { readonly body: CadBodyRef; readonly units: 'm'; readonly vertices: readonly number[]; readonly normals: readonly number[]; readonly triangles: readonly number[] }
  | { readonly body: CadBodyRef; readonly units: 'm'; readonly step: string }
  | { readonly deleted: true };
export type CadErrorCode = 'invalid-request' | 'stale-source' | 'unknown-body' | 'stale-body' | 'invalid-solid' |
  'resource-limit' | 'busy' | 'timeout' | 'kernel-failure' | 'closed' | 'method-not-allowed' | 'unsupported-media-type' | 'local-only';
export class CadError extends Error {
  constructor(readonly code: CadErrorCode, message: string) { super(message); this.name = 'CadError'; }
}
export type CadReply = { readonly ok: true; readonly result: CadResult } | { readonly ok: false; readonly error: { readonly code: CadErrorCode; readonly message: string } };
export interface CadCapabilities {
  readonly source: CadSource; readonly units: 'm'; readonly handedness: 'right'; readonly upAxis: 'Z';
  readonly operations: typeof CAD_OPERATIONS; readonly limits: typeof CAD_LIMITS;
  readonly sandbox: 'ephemeral'; readonly publishesProject: false;
  readonly resetInvalidatesBodies: true;
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CadError('invalid-request', 'Expected an object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new CadError('invalid-request', 'Unexpected or missing keys');
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new CadError('invalid-request', 'Invalid identifier');
  return value;
}
function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CadError('invalid-request', 'Expected a finite dimension');
  if (value < CAD_LIMITS.minDimension || value > CAD_LIMITS.maxDimension) throw new CadError('resource-limit', 'Dimension outside sandbox limits');
  return value;
}
function center(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || [value[0], value[1], value[2]].some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new CadError('invalid-request', 'Expected three finite coordinates');
  if (value.some(x => Math.abs(x) > CAD_LIMITS.maxCoordinate)) throw new CadError('resource-limit', 'Coordinate outside sandbox limits');
  return [value[0], value[1], value[2]];
}
export function canonicalCadBodyRef(value: unknown): CadBodyRef {
  const v = record(value); keys(v, ['bodyId', 'bodyRevision']);
  const bodyId = token(v.bodyId);
  if (typeof v.bodyRevision !== 'number' || !Number.isSafeInteger(v.bodyRevision) || v.bodyRevision < 1) throw new CadError('invalid-request', 'Invalid body revision');
  if (v.bodyRevision !== 1) throw new CadError('stale-body', 'Body revision is stale');
  return { bodyId, bodyRevision: 1 };
}
export function canonicalCadOperation(value: unknown): CadOperation {
  const v = record(value);
  switch (v.kind) {
    case 'box': {
      keys(v, ['kind', 'center', 'dimensions']);
      if (!Array.isArray(v.dimensions) || v.dimensions.length !== 3) throw new CadError('invalid-request', 'Expected three dimensions');
      return { kind: 'box', center: center(v.center), dimensions: [dimension(v.dimensions[0]), dimension(v.dimensions[1]), dimension(v.dimensions[2])] };
    }
    case 'cylinder': keys(v, ['kind', 'center', 'radius', 'height']); return { kind: 'cylinder', center: center(v.center), radius: dimension(v.radius), height: dimension(v.height) };
    case 'boolean':
      keys(v, ['kind', 'operator', 'left', 'right']);
      if (v.operator !== 'union' && v.operator !== 'subtract' && v.operator !== 'intersect') throw new CadError('invalid-request', 'Unsupported boolean operator');
      return { kind: 'boolean', operator: v.operator, left: canonicalCadBodyRef(v.left), right: canonicalCadBodyRef(v.right) };
    case 'inspect': case 'tessellate': case 'export-step': case 'delete':
      keys(v, ['kind', 'body']); return { kind: v.kind, body: canonicalCadBodyRef(v.body) };
    default: throw new CadError('invalid-request', 'Unsupported CAD operation');
  }
}
export function canonicalCadRequest(value: unknown): CadRequest {
  const v = record(value); keys(v, ['sessionId', 'projectRevision', 'frameId', 'operation']);
  if (typeof v.projectRevision !== 'number' || !Number.isSafeInteger(v.projectRevision) || v.projectRevision < 0) throw new CadError('invalid-request', 'Invalid project revision');
  return { sessionId: token(v.sessionId), projectRevision: v.projectRevision, frameId: token(v.frameId), operation: canonicalCadOperation(v.operation) };
}
