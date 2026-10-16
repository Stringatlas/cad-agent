import { assertProjectState, assertVec3, type BoxEntity, type CoordinateMetadata, type ProjectState, type Vec3 } from './index';
import { PROJECT_FRAME_ID, type ProjectSnapshot } from './chat';
import { protocolRecord, protocolKeys, protocolToken, protocolInteger, protocolHash, canonicalProtocolJson } from './tool-protocol';

export const PROJECT_LIMITS = Object.freeze({ requestBytes: 16 * 1024, snapshotBytes: 2 * 1024 * 1024, maxEntities: 256,
  maxPoints: 10000, maxReferences: 32, maxProposals: 32, maxHistory: 32, proposalLifetimeMs: 300000,
  requestsPerMinute: 120, bodyTimeoutMs: 5000, maxCoordinate: 1000000 });
export interface ProjectBinding {
  readonly sessionId: string; readonly projectRevision: number; readonly frameId: typeof PROJECT_FRAME_ID; readonly units: 'm';
}
export interface ScenePointReference {
  readonly name: 'A' | 'B'; readonly entityId: string; readonly pointIndex: number; readonly position: Vec3;
}
export interface SceneContextRequest extends ProjectBinding {
  readonly entityIds: readonly string[]; readonly points: readonly ScenePointReference[];
}
export interface SceneContext extends SceneContextRequest {
  readonly coordinates: CoordinateMetadata; readonly entities: readonly { readonly id: string; readonly kind: 'box' | 'point-cloud' }[];
  readonly coverage: 'explicit-project-selections'; readonly source: 'synthetic-project';
}
export interface BoxEdit {
  readonly kind: 'create-box' | 'update-box'; readonly entityId: string; readonly center: Vec3; readonly dimensions: Vec3;
}
export interface BoxProposalRequest extends ProjectBinding { readonly edit: BoxEdit }
export interface BoxProposal extends BoxProposalRequest {
  readonly proposalId: string; readonly digest: string; readonly expiresAt: number;
  readonly coordinates: CoordinateMetadata; readonly before: BoxEntity | null; readonly after: BoxEntity;
  readonly verification: 'parameter-postconditions-not-cad';
}
export interface BoxApprovalRequest extends ProjectBinding {
  readonly proposalId: string; readonly digest: string; readonly humanApproved: true;
}
export interface ProjectUndoRequest extends ProjectBinding { readonly transactionId: string; readonly humanApproved: true }
export interface ProjectCommitResult {
  readonly snapshot: ProjectSnapshot; readonly transactionId: string; readonly nextUndoTransactionId: string | null;
  readonly verification: 'parameter-postconditions-not-cad'; readonly operation: 'create-box' | 'update-box' | 'undo';
  readonly persisted: false;
}
export interface ProjectSessionInfo {
  readonly snapshot: ProjectSnapshot; readonly nextUndoTransactionId: string | null; readonly persistence: 'explicit-save';
  readonly savedRevision: number | null; readonly dirty: boolean; readonly limits: typeof PROJECT_LIMITS;
}
export interface ProjectSaveResult { readonly snapshot: ProjectSnapshot; readonly savedRevision: number; readonly persisted: true }
export interface ProjectLoadResult { readonly snapshot: ProjectSnapshot; readonly nextUndoTransactionId: null; readonly persisted: true }
export type ProjectErrorCode = 'invalid-request' | 'stale-project' | 'unknown-entity' | 'invalid-point' | 'unknown-proposal' |
  'approval-mismatch' | 'expired-proposal' | 'nothing-to-undo' | 'resource-limit' | 'busy' | 'local-only' |
  'snapshot-missing' | 'snapshot-corrupt' | 'storage-unavailable' | 'postcondition-failed';
export type ProjectReply<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: { readonly code: ProjectErrorCode; readonly message: string } };

function binding(r: Record<string, unknown>): ProjectBinding {
  protocolToken(r.sessionId); protocolInteger(r.projectRevision);
  if (r.frameId !== PROJECT_FRAME_ID || r.units !== 'm') throw new TypeError('Expected project meter frame');
  return { sessionId: r.sessionId, projectRevision: r.projectRevision, frameId: PROJECT_FRAME_ID, units: 'm' };
}
const BINDING_KEYS = ['sessionId', 'projectRevision', 'frameId', 'units'];
export function canonicalProjectBinding(value: unknown): ProjectBinding {
  const r = protocolRecord(value); protocolKeys(r, BINDING_KEYS); return binding(r);
}
export function canonicalBoxProposalRequest(value: unknown): BoxProposalRequest {
  const r = protocolRecord(value); protocolKeys(r, [...BINDING_KEYS, 'edit']);
  const e = protocolRecord(r.edit); protocolKeys(e, ['kind', 'entityId', 'center', 'dimensions']); protocolToken(e.entityId);
  if (e.kind !== 'create-box' && e.kind !== 'update-box') throw new TypeError('Unknown parameter edit');
  assertVec3(e.center); assertVec3(e.dimensions);
  if ([...e.center, ...e.dimensions].some(v => Math.abs(v) > PROJECT_LIMITS.maxCoordinate) || e.dimensions.some(v => v <= 0)) throw new RangeError('Invalid bounded box parameters');
  return { ...binding(r), edit: { kind: e.kind, entityId: e.entityId, center: [...e.center], dimensions: [...e.dimensions] } };
}
export function canonicalBoxApprovalRequest(value: unknown): BoxApprovalRequest {
  const r = protocolRecord(value); protocolKeys(r, [...BINDING_KEYS, 'proposalId', 'digest', 'humanApproved']);
  protocolToken(r.proposalId); protocolHash(r.digest); if (r.humanApproved !== true) throw new TypeError('Explicit human approval required');
  return { ...binding(r), proposalId: r.proposalId, digest: r.digest, humanApproved: true };
}
export function canonicalProjectUndoRequest(value: unknown): ProjectUndoRequest {
  const r = protocolRecord(value); protocolKeys(r, [...BINDING_KEYS, 'transactionId', 'humanApproved']);
  protocolToken(r.transactionId); if (r.humanApproved !== true) throw new TypeError('Explicit human approval required');
  return { ...binding(r), transactionId: r.transactionId, humanApproved: true };
}
export function canonicalSceneContextRequest(value: unknown): SceneContextRequest {
  const r = protocolRecord(value); protocolKeys(r, [...BINDING_KEYS, 'entityIds', 'points']);
  if (!Array.isArray(r.entityIds) || r.entityIds.length > PROJECT_LIMITS.maxReferences || !Array.isArray(r.points) || r.points.length > 2) throw new TypeError('Bounded explicit selections required');
  const entityIds = r.entityIds.map(id => { protocolToken(id); return id; });
  if (new Set(entityIds).size !== entityIds.length) throw new TypeError('Duplicate entity selection');
  const points: ScenePointReference[] = r.points.map(value => {
    const p = protocolRecord(value); protocolKeys(p, ['name', 'entityId', 'pointIndex', 'position']);
    if (p.name !== 'A' && p.name !== 'B') throw new TypeError('Expected named A/B point');
    protocolToken(p.entityId); protocolInteger(p.pointIndex, PROJECT_LIMITS.maxPoints - 1); assertVec3(p.position);
    return { name: p.name, entityId: p.entityId, pointIndex: p.pointIndex, position: [...p.position] as Vec3 };
  });
  if (new Set(points.map(p => p.name)).size !== points.length) throw new TypeError('Duplicate point name');
  return { ...binding(r), entityIds, points };
}
/** Persistence accepts geometry only, with a deliberately small strict schema. */
export function canonicalPersistentProject(value: unknown): ProjectState {
  // Copy budget is checked before trusting a persisted or operator-supplied object.
  const safe = JSON.parse(canonicalProtocolJson(value, { maxArrayLength: PROJECT_LIMITS.maxPoints, maxNodes: 50000, maxDepth: 8, maxStringLength: 64 })) as unknown;
  const p = protocolRecord(safe); protocolKeys(p, ['revision', 'coordinates', 'entities', 'selectedEntityId']);
  assertProjectState(p);
  if (p.selectedEntityId !== null || p.entities.length > PROJECT_LIMITS.maxEntities) throw new TypeError('Persistence requires bounded selection-free geometry');
  const c = protocolRecord(p.coordinates); protocolKeys(c, ['units', 'handedness', 'upAxis', 'localOrigin']);
  let pointCount = 0;
  for (const entity of p.entities) {
    const e = protocolRecord(entity); protocolToken(e.id);
    protocolKeys(e, e.kind === 'box' ? ['id', 'kind', 'center', 'dimensions'] : ['id', 'kind', 'points']);
    if (entity.kind === 'point-cloud') pointCount += entity.points.length;
    else if ([...entity.center, ...entity.dimensions].some(v => Math.abs(v) > PROJECT_LIMITS.maxCoordinate)) throw new TypeError('Box exceeds parameter limits');
  }
  if (pointCount > PROJECT_LIMITS.maxPoints) throw new TypeError('Point storage limit');
  return p;
}
