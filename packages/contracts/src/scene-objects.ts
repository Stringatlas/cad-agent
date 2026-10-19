import type { Vec3 } from './index';
import type { PointKey } from './semantic-query';

export const SCENE_OBJECT_LIMITS = Object.freeze({ objects: 128, proposals: 16, transactions: 128, receipts: 256, nameLength: 80, requestBytes: 8192, bodyTimeoutMs: 10000, requestsPerMinute: 60 });
export interface SceneObjectBinding { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly datasetId: 'toronto3d'; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm' }
export interface DatumPoint { readonly id: string; readonly name: string; readonly kind: 'datum-point'; readonly parentId: null; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm'; readonly objectRevision: 1; readonly position: Vec3 }
export interface AuthoredObjectReference { readonly kind: 'authored-object'; readonly sessionId: string; readonly revision: number; readonly objectId: string; readonly objectRevision: 1; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm' }
export interface SourceRecordReference { readonly kind: 'source-record'; readonly datasetId: 'toronto3d'; readonly artifactRevision: string; readonly key: PointKey; readonly domain: 'original' | 'effective'; readonly overrideSessionId: string; readonly overrideRevision: number; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm' }
export type SceneObjectReference = AuthoredObjectReference | SourceRecordReference;
export type SceneObjectInput = { readonly kind: 'position'; readonly position: Vec3 } | { readonly kind: 'reference'; readonly reference: SceneObjectReference; readonly offset: Vec3 };
export interface SceneObjectProposalRequest { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm'; readonly name: string; readonly input: SceneObjectInput }
export interface SceneObjectApprovalRequest { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly proposalId: string }
export interface SceneObjectUndoRequest { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly transactionId: string }
export interface SceneObjectProposal extends SceneObjectBinding { readonly schemaVersion: 1; readonly proposalId: string; readonly object: DatumPoint }
export interface SceneObjectSnapshot extends SceneObjectBinding { readonly schemaVersion: 1; readonly objects: readonly DatumPoint[]; readonly proposals: readonly SceneObjectProposal[]; readonly nextUndoTransactionId: string | null }
export type SceneObjectErrorCode = 'invalid-request' | 'stale-session' | 'stale-revision' | 'stale-artifact' | 'stale-reference' | 'unknown-object' | 'unknown-point' | 'unknown-proposal' | 'nothing-to-undo' | 'resource-limit' | 'busy' | 'local-only' | 'unavailable';
export type SceneObjectReply<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: { readonly code: SceneObjectErrorCode; readonly message: string } };
const fail = (): never => { throw new TypeError('Invalid scene object contract'); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); const r = value as Record<string, unknown>; if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) return fail(); return r; }
function token(v: unknown): string { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v) ? v : fail(); }
function revision(v: unknown): number { return Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail(); }
function vec(v: unknown): Vec3 { return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? [...v] as unknown as Vec3 : fail(); }
function name(v: unknown): string { return typeof v === 'string' && v.length > 0 && v.length <= SCENE_OBJECT_LIMITS.nameLength && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail(); }
function spatial(r: Record<string, unknown>) { if (r.frameId !== 'toronto3d-local-v1' || r.units !== 'm') fail(); return { frameId: 'toronto3d-local-v1' as const, units: 'm' as const }; }
function binding(r: Record<string, unknown>): SceneObjectBinding { if (r.datasetId !== 'toronto3d') fail(); return { sessionId: token(r.sessionId), revision: revision(r.revision), artifactRevision: token(r.artifactRevision), datasetId: 'toronto3d', ...spatial(r) }; }
const bindingKeys = ['sessionId', 'revision', 'artifactRevision', 'datasetId', 'frameId', 'units'];
export function canonicalSceneObjectReference(value: unknown): SceneObjectReference {
  if ((value as { kind?: string })?.kind === 'authored-object') { const r = object(value, ['kind', 'sessionId', 'revision', 'objectId', 'objectRevision', 'frameId', 'units']); if (r.objectRevision !== 1) fail(); return { kind: 'authored-object', sessionId: token(r.sessionId), revision: revision(r.revision), objectId: token(r.objectId), objectRevision: 1, ...spatial(r) }; }
  const r = object(value, ['kind', 'datasetId', 'artifactRevision', 'key', 'domain', 'overrideSessionId', 'overrideRevision', 'frameId', 'units']);
  if (r.kind !== 'source-record' || r.datasetId !== 'toronto3d' || (r.domain !== 'original' && r.domain !== 'effective')) fail();
  const k = object(r.key, ['sourceFileId', 'sourceRow']); if (!Number.isInteger(k.sourceFileId) || (k.sourceFileId as number) < 1 || (k.sourceFileId as number) > 4 || !Number.isSafeInteger(k.sourceRow) || (k.sourceRow as number) < 0 || (k.sourceRow as number) > 0xffffffff) fail();
  return { kind: 'source-record', datasetId: 'toronto3d', artifactRevision: token(r.artifactRevision), key: { sourceFileId: k.sourceFileId as number, sourceRow: k.sourceRow as number }, domain: r.domain as 'original' | 'effective', overrideSessionId: token(r.overrideSessionId), overrideRevision: revision(r.overrideRevision), ...spatial(r) };
}
export function canonicalDatumPoint(value: unknown): DatumPoint { const r = object(value, ['id', 'name', 'kind', 'parentId', 'frameId', 'units', 'objectRevision', 'position']); if (r.kind !== 'datum-point' || r.parentId !== null || r.objectRevision !== 1) fail(); return { id: token(r.id), name: name(r.name), kind: 'datum-point', parentId: null, ...spatial(r), objectRevision: 1, position: vec(r.position) }; }
export function canonicalSceneObjectProposalRequest(value: unknown): SceneObjectProposalRequest {
  const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'frameId', 'units', 'name', 'input']); let input: SceneObjectInput;
  if ((r.input as { kind?: string })?.kind === 'position') { const i = object(r.input, ['kind', 'position']); input = { kind: 'position', position: vec(i.position) }; }
  else { const i = object(r.input, ['kind', 'reference', 'offset']); if (i.kind !== 'reference') fail(); input = { kind: 'reference', reference: canonicalSceneObjectReference(i.reference), offset: vec(i.offset) }; }
  return { sessionId: token(r.sessionId), revision: revision(r.revision), artifactRevision: token(r.artifactRevision), ...spatial(r), name: name(r.name), input };
}
export function canonicalSceneObjectApprovalRequest(value: unknown): SceneObjectApprovalRequest { const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'proposalId']); return { sessionId: token(r.sessionId), revision: revision(r.revision), artifactRevision: token(r.artifactRevision), proposalId: token(r.proposalId) }; }
export function canonicalSceneObjectUndoRequest(value: unknown): SceneObjectUndoRequest { const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'transactionId']); return { sessionId: token(r.sessionId), revision: revision(r.revision), artifactRevision: token(r.artifactRevision), transactionId: token(r.transactionId) }; }
export function canonicalSceneObjectProposal(value: unknown): SceneObjectProposal { const r = object(value, [...bindingKeys, 'schemaVersion', 'proposalId', 'object']); if (r.schemaVersion !== 1) fail(); return { ...binding(r), schemaVersion: 1, proposalId: token(r.proposalId), object: canonicalDatumPoint(r.object) }; }
export function canonicalSceneObjectSnapshot(value: unknown): SceneObjectSnapshot {
  const r = object(value, [...bindingKeys, 'schemaVersion', 'objects', 'proposals', 'nextUndoTransactionId']);
  if (r.schemaVersion !== 1 || !Array.isArray(r.objects) || r.objects.length > SCENE_OBJECT_LIMITS.objects || !Array.isArray(r.proposals) || r.proposals.length > SCENE_OBJECT_LIMITS.proposals) return fail();
  const b = binding(r), objects = r.objects.map(canonicalDatumPoint), proposals = r.proposals.map(canonicalSceneObjectProposal), ids = new Set<string>(), proposalIds = new Set<string>();
  for (const o of [...objects, ...proposals.map(p => p.object)]) { if (ids.has(o.id)) fail(); ids.add(o.id); }
  for (const p of proposals) { if (proposalIds.has(p.proposalId) || bindingKeys.some(k => p[k as keyof SceneObjectBinding] !== b[k as keyof SceneObjectBinding])) fail(); proposalIds.add(p.proposalId); }
  return { ...b, schemaVersion: 1, objects, proposals, nextUndoTransactionId: r.nextUndoTransactionId === null ? null : token(r.nextUndoTransactionId) };
}
