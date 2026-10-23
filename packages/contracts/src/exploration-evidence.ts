import { assertVec3, type Vec3 } from './index';
import { canonicalProtocolJson, freezeProtocolValue, protocolHash, protocolInteger, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';
import { canonicalSceneSourceBinding, type SceneSourceBinding } from './spatial-region';
import { canonicalModelCaptureRequest, canonicalModelReferenceSelection, type ModelCaptureRequest, type ModelReferenceSelection } from './model-chat';
import { canonicalAgentViewReceipt, canonicalBrowserCaptureRequest, canonicalCaptureReason, type AgentViewReceipt, type BrowserCaptureRequest } from './agent-view';
import type { ModelVisualObservation } from './model-visual';

export const EXPLORATION_EVIDENCE_LIMITS = Object.freeze({ records: 128, recordBytes: 16384, checkpointBytes: 262144, witnesses: 16, catalogueItems: 16, catalogueBytes: 4096 });
export const EVIDENCE_TOOL_NAMES = ['query_points', 'capture_scene', 'resolve_visual_pixel'] as const;
export type EvidenceToolName = typeof EVIDENCE_TOOL_NAMES[number];
export type EvidenceRetention = { readonly status: 'retained'; readonly evidenceId: string } | { readonly status: 'unavailable'; readonly reason: 'unsupported-result' | 'record-too-large' | 'retention-limit' };
export interface EvidencePointRequest { readonly operation: 'nearest' | 'radius' | 'box'; readonly position?: Vec3; readonly radiusMeters?: number; readonly bounds?: { readonly min: Vec3; readonly max: Vec3 }; readonly label?: number | null; readonly maxResults: number }
export interface EvidenceWitness { readonly key: { readonly sourceFileId: number; readonly sourceRow: number }; readonly position: Vec3; readonly reference: ModelReferenceSelection; readonly label?: number; readonly instanceId?: number; readonly distanceMeters?: number }
export interface EvidenceQueryResult {
  readonly status: 'observed' | 'unavailable'; readonly complete: boolean;
  readonly witnesses: readonly EvidenceWitness[]; readonly returnedWitnessCount: number; readonly retainedWitnessCount: number; readonly projectionTruncated: boolean;
  readonly count?: number; readonly totalCount?: number; readonly checkedPoints?: number;
  readonly countsByLabel?: readonly number[]; readonly distanceMeters?: number | null;
  readonly truncated?: boolean; readonly selection?: 'exact-nearest-source-record' | 'deterministic-capped-subset-not-ranked'; readonly independentVerification?: false;
  readonly reason?: 'resource-unavailable';
}
export interface CaptureAuthorityPart { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly pendingProposalIds: readonly string[] }
export type CaptureAuthorityScope = { readonly status: 'unknown'; readonly reason: 'not-available' | 'changed-during-capture' } | { readonly status: 'known'; readonly points: CaptureAuthorityPart; readonly cad: CaptureAuthorityPart; readonly objects: CaptureAuthorityPart };
export interface CaptureEvidenceAdmission { readonly request: ModelCaptureRequest; readonly effective: BrowserCaptureRequest; readonly authority: CaptureAuthorityScope }
export interface EvidenceCaptureObservation {
  readonly observationId: string; readonly image: Pick<ModelVisualObservation['image'], 'mimeType' | 'sha256' | 'byteLength'>;
  readonly viewport: ModelVisualObservation['viewport']; readonly camera: ModelVisualObservation['camera']; readonly crop?: ModelVisualObservation['crop']; readonly sourceImage?: ModelVisualObservation['sourceImage'];
  readonly agentView?: AgentViewReceipt;
  readonly coverage: { readonly kind: string; readonly complete: boolean; readonly displayedPointCount: number;
    readonly captureDetail?: { readonly status: 'ready'; readonly pointBudget: number; readonly budgetLimited: boolean; readonly targetPointCount: number; readonly targetNodeCount: number };
    readonly grounding?: { readonly status: 'ready' | 'unavailable'; readonly method?: 'point-center-within-3px'; readonly bytes?: number; readonly expiresInMs?: number } };
}
export type EvidenceCaptureResult = { readonly status: 'captured'; readonly observation: EvidenceCaptureObservation } | { readonly status: 'unavailable'; readonly reason: string };
export type EvidencePixelResult = { readonly status: 'resolved'; readonly key: EvidenceWitness['key']; readonly position: Vec3; readonly reference: ModelReferenceSelection; readonly recordValidation: 'server-verified-original-record'; readonly visibility: 'browser-observed-capture-time' } | { readonly status: 'unavailable' | 'ambiguous' | 'no-hit' | 'invalid' | 'stale'; readonly reason: 'browser-unavailable' };
export type SceneEvidenceProjection =
  { readonly tool: 'query_points'; readonly request: EvidencePointRequest; readonly result: EvidenceQueryResult } |
  { readonly tool: 'capture_scene'; readonly request: ModelCaptureRequest; readonly effective: BrowserCaptureRequest; readonly authority: CaptureAuthorityScope; readonly requestedScopeHash: string; readonly effectiveScopeHash: string; readonly result: EvidenceCaptureResult } |
  { readonly tool: 'resolve_visual_pixel'; readonly request: { readonly observationId: string; readonly imageSha256: string; readonly x: number; readonly y: number }; readonly result: EvidencePixelResult };
export interface SceneEvidenceReceipt { readonly schemaVersion: 1; readonly evidenceId: string; readonly sourceBinding: SceneSourceBinding; readonly adapter: 'prepared' | 'toronto'; readonly turn: number; readonly projectionHash: string; readonly projection: SceneEvidenceProjection }
export const evidenceUtf8Bytes = (value: unknown) => new TextEncoder().encode(canonicalProtocolJson(value)).length;
const finite = (v: unknown, min = -1e7, max = 1e7) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new TypeError('Invalid evidence number'); };
const bool = (v: unknown) => { if (typeof v !== 'boolean') throw new TypeError('Invalid evidence boolean'); };
function vector(v: unknown) { assertVec3(v); v.forEach(n => finite(n)); }
function reference(v: unknown, source: SceneSourceBinding, adapter: SceneEvidenceReceipt['adapter']): ModelReferenceSelection {
  const r = canonicalModelReferenceSelection(v);
  if (r.kind !== (adapter === 'prepared' ? 'cloud-point' : 'toronto-point') || r.kind === 'cloud-point' && (r.cloudId !== source.sourceId || r.revision !== source.sourceRevision)) throw new TypeError('Invalid evidence reference binding');
  return r;
}
export function canonicalCaptureAuthorityScope(value: unknown): CaptureAuthorityScope {
  const r = protocolRecord(value);
  if (r.status === 'unknown') { protocolKeys(r, ['status', 'reason']); if (!['not-available', 'changed-during-capture'].includes(String(r.reason))) throw new TypeError('Invalid authority scope'); }
  else {
    protocolKeys(r, ['status', 'points', 'cad', 'objects']); if (r.status !== 'known') throw new TypeError('Invalid authority scope');
    for (const key of ['points', 'cad', 'objects']) {
      const p = protocolRecord(r[key]); protocolKeys(p, ['sessionId', 'revision', 'artifactRevision', 'pendingProposalIds']); protocolToken(p.sessionId); protocolInteger(p.revision); protocolHash(p.artifactRevision);
      if (!Array.isArray(p.pendingProposalIds) || p.pendingProposalIds.length > 128 || new Set(p.pendingProposalIds).size !== p.pendingProposalIds.length) throw new TypeError('Invalid authority proposals');
      p.pendingProposalIds.forEach(protocolToken);
    }
  }
  return freezeProtocolValue(JSON.parse(canonicalProtocolJson(r))) as CaptureAuthorityScope;
}
function pointRequest(value: unknown) {
  const r = protocolRecord(value); protocolKeys(r, ['operation', 'maxResults'], ['position', 'radiusMeters', 'bounds', 'label']); protocolInteger(r.maxResults, 64); if (r.maxResults === 0) throw new TypeError('Invalid witness cap');
  if (r.label !== undefined && r.label !== null) protocolInteger(r.label, 65535);
  if (r.operation === 'box') {
    if (r.position !== undefined || r.radiusMeters !== undefined) throw new TypeError('Invalid box request');
    const b = protocolRecord(r.bounds); protocolKeys(b, ['min', 'max']); vector(b.min); vector(b.max); if ((b.min as Vec3).some((n, i) => n > (b.max as Vec3)[i])) throw new TypeError('Invalid query box');
  } else {
    if (!['nearest', 'radius'].includes(String(r.operation)) || r.bounds !== undefined) throw new TypeError('Invalid point request'); vector(r.position);
    if (r.operation === 'radius') finite(r.radiusMeters, 0, 1000); else if (r.radiusMeters !== undefined) throw new TypeError('Invalid nearest request');
  }
}
function captureObservation(value: unknown) {
  const r = protocolRecord(value); protocolKeys(r, ['observationId', 'image', 'viewport', 'camera', 'coverage'], ['crop', 'sourceImage', 'agentView']); protocolToken(r.observationId);
  const image = protocolRecord(r.image); protocolKeys(image, ['mimeType', 'sha256', 'byteLength']); protocolHash(image.sha256); protocolInteger(image.byteLength, 12 * 1024 * 1024); if (!['image/png', 'image/jpeg'].includes(String(image.mimeType)) || image.byteLength === 0) throw new TypeError('Invalid evidence image');
  const v = protocolRecord(r.viewport); protocolKeys(v, ['width', 'height', 'pixelRatio', 'pixelOrigin']); for (const k of ['width', 'height']) { protocolInteger(v[k], 4096); if (v[k] === 0) throw new TypeError('Invalid evidence viewport'); } finite(v.pixelRatio, Number.MIN_VALUE, 16); if (v.pixelOrigin !== 'top-left') throw new TypeError('Invalid pixel origin');
  const c = protocolRecord(r.camera); protocolKeys(c, ['position', 'quaternion', 'up', 'near', 'far', 'fov', 'aspect', 'zoom', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix']); vector(c.position); vector(c.up);
  for (const [k, n] of [['quaternion', 4], ['matrixWorld', 16], ['matrixWorldInverse', 16], ['projectionMatrix', 16]] as const) { if (!Array.isArray(c[k]) || c[k].length !== n) throw new TypeError('Invalid camera matrix'); c[k].forEach((v: unknown) => finite(v, -Number.MAX_VALUE, Number.MAX_VALUE)); }
  for (const k of ['near', 'far', 'fov', 'aspect', 'zoom']) finite(c[k], Number.MIN_VALUE, Number.MAX_VALUE); if ((c.fov as number) >= 180 || (c.far as number) <= (c.near as number)) throw new TypeError('Invalid camera projection');
  if (image.mimeType === 'image/jpeg' && r.sourceImage === undefined) throw new TypeError('Missing JPEG source metadata');
  if (r.agentView !== undefined) canonicalAgentViewReceipt(r.agentView);
  if (r.crop !== undefined) { const crop = protocolRecord(r.crop); protocolKeys(crop, ['x', 'y', 'width', 'height', 'outputWidth', 'outputHeight']); for (const k of Object.keys(crop)) protocolInteger(crop[k], 4096); if (Object.entries(crop).some(([k, n]) => !['x', 'y'].includes(k) && n === 0) || (crop.x as number) + (crop.width as number) > (v.width as number) || (crop.y as number) + (crop.height as number) > (v.height as number) || (crop.outputWidth as number) > (crop.width as number) || (crop.outputHeight as number) > (crop.height as number)) throw new TypeError('Invalid evidence crop'); }
  if (r.sourceImage !== undefined) { const si = protocolRecord(r.sourceImage); protocolKeys(si, ['mimeType', 'sha256', 'byteLength']); if (si.mimeType !== 'image/png') throw new TypeError('Invalid source image'); protocolHash(si.sha256); protocolInteger(si.byteLength, 12 * 1024 * 1024); if (si.byteLength === 0) throw new TypeError('Invalid source image bytes'); }
  const cov = protocolRecord(r.coverage); protocolKeys(cov, ['kind', 'complete', 'displayedPointCount'], ['captureDetail', 'grounding']); protocolToken(cov.kind); bool(cov.complete); protocolInteger(cov.displayedPointCount);
  if (cov.captureDetail !== undefined) { const d = protocolRecord(cov.captureDetail); protocolKeys(d, ['status', 'pointBudget', 'budgetLimited', 'targetPointCount', 'targetNodeCount']); if (d.status !== 'ready') throw new TypeError('Invalid capture detail status'); bool(d.budgetLimited); for (const k of ['pointBudget', 'targetPointCount', 'targetNodeCount']) protocolInteger(d[k]); }
  if (cov.grounding !== undefined) { const g = protocolRecord(cov.grounding); protocolKeys(g, ['status'], ['method', 'bytes', 'expiresInMs']); if (!['ready', 'unavailable'].includes(String(g.status)) || g.method !== undefined && g.method !== 'point-center-within-3px') throw new TypeError('Invalid grounding'); for (const k of ['bytes', 'expiresInMs']) if (g[k] !== undefined) protocolInteger(g[k]); }
}
export function canonicalSceneEvidenceProjection(value: unknown, source: SceneSourceBinding, adapter: SceneEvidenceReceipt['adapter']): SceneEvidenceProjection {
  const p = protocolRecord(JSON.parse(canonicalProtocolJson(value, { maxArrayLength: 128, maxNodes: 4096, maxDepth: 16, maxStringLength: 4096 })));
  const r = protocolRecord(p.result);
  if (p.tool === 'query_points') {
    protocolKeys(p, ['tool', 'request', 'result']); pointRequest(p.request);
    protocolKeys(r, ['status', 'complete', 'witnesses', 'returnedWitnessCount', 'retainedWitnessCount', 'projectionTruncated'], ['count', 'totalCount', 'checkedPoints', 'countsByLabel', 'distanceMeters', 'truncated', 'selection', 'independentVerification', 'reason']);
    if (!['observed', 'unavailable'].includes(String(r.status))) throw new TypeError('Invalid query evidence'); bool(r.complete); bool(r.projectionTruncated); protocolInteger(r.returnedWitnessCount, 64); protocolInteger(r.retainedWitnessCount, 16);
    if (!Array.isArray(r.witnesses) || r.witnesses.length !== r.retainedWitnessCount || (r.returnedWitnessCount as number) < r.witnesses.length || r.projectionTruncated !== ((r.returnedWitnessCount as number) > r.witnesses.length)) throw new TypeError('Invalid witness projection');
    for (const w of r.witnesses) { const v = protocolRecord(w); protocolKeys(v, ['key', 'position', 'reference'], ['label', 'instanceId', 'distanceMeters']); const ref = reference(v.reference, source, adapter); if (canonicalProtocolJson(ref.key) !== canonicalProtocolJson(v.key)) throw new TypeError('Invalid witness key'); vector(v.position); if (v.label !== undefined) protocolInteger(v.label, 65535); if (v.instanceId !== undefined) { finite(v.instanceId, -2147483648, 2147483647); if (!Number.isInteger(v.instanceId)) throw new TypeError('Invalid instance ID'); } if (v.distanceMeters !== undefined) finite(v.distanceMeters, 0, Number.MAX_VALUE); }
    for (const k of ['count', 'totalCount', 'checkedPoints']) if (r[k] !== undefined) protocolInteger(r[k]);
    if ((r.returnedWitnessCount as number) > (protocolRecord(p.request).maxResults as number) || ['count', 'totalCount'].some(k => r[k] !== undefined && (r[k] as number) < (r.returnedWitnessCount as number))) throw new TypeError('Inconsistent witness count');
    if (r.countsByLabel !== undefined) { if (!Array.isArray(r.countsByLabel) || r.countsByLabel.length !== 9) throw new TypeError('Invalid label counts'); r.countsByLabel.forEach(n => protocolInteger(n)); }
    if (r.distanceMeters !== undefined && r.distanceMeters !== null) finite(r.distanceMeters, 0, Number.MAX_VALUE);
    if (r.truncated !== undefined) bool(r.truncated);
    if (r.selection !== undefined && !['exact-nearest-source-record', 'deterministic-capped-subset-not-ranked'].includes(String(r.selection)) || r.independentVerification !== undefined && r.independentVerification !== false || r.reason !== undefined && r.reason !== 'resource-unavailable') throw new TypeError('Invalid query claims');
    if (adapter === 'prepared' && ['totalCount', 'countsByLabel', 'selection', 'independentVerification', 'truncated', 'distanceMeters'].some(k => r[k] !== undefined) || adapter === 'toronto' && r.count !== undefined) throw new TypeError('Invalid adapter counts');
    if (r.status === 'unavailable' && (r.complete !== false || r.witnesses.length || Object.keys(r).some(k => !['status', 'complete', 'witnesses', 'returnedWitnessCount', 'retainedWitnessCount', 'projectionTruncated', 'reason'].includes(k)))) throw new TypeError('Unavailable query cannot claim counts');
    if (r.status === 'observed' && (r.reason !== undefined || r.complete !== true || adapter === 'prepared' && (r.count === undefined || r.checkedPoints === undefined))) throw new TypeError('Missing observed query fields');
  } else if (p.tool === 'capture_scene') {
    protocolKeys(p, ['tool', 'request', 'effective', 'authority', 'requestedScopeHash', 'effectiveScopeHash', 'result']); const request = canonicalModelCaptureRequest(p.request), effective = canonicalBrowserCaptureRequest(p.effective), authority = canonicalCaptureAuthorityScope(p.authority); protocolHash(p.requestedScopeHash); protocolHash(p.effectiveScopeHash);
    if (authority.status === 'known' && [authority.points, authority.cad, authority.objects].some(part => part.artifactRevision !== source.sourceRevision)) throw new TypeError('Wrong capture authority artifact');
    if (request.kind === 'frame') {
      if (effective.kind !== 'framed') throw new TypeError('Missing normalized frame');
      if (request.target.kind === 'reference') reference(request.target.reference, source, adapter);
      else if (canonicalProtocolJson(request.target.region.binding) !== canonicalProtocolJson(source)) throw new TypeError('Wrong requested region source');
    } else if (request.kind === 'relative') {
      if (effective.kind !== 'adjust' || request.observationId !== effective.observationId || request.azimuthDeltaDegrees !== effective.adjustment.azimuthDeltaDegrees || request.elevationDeltaDegrees !== effective.adjustment.elevationDeltaDegrees || request.distanceScale !== effective.adjustment.distanceScale) throw new TypeError('Wrong normalized adjustment');
    } else if (canonicalProtocolJson(request) !== canonicalProtocolJson(effective)) throw new TypeError('Wrong legacy capture request');
    if ('binding' in effective && canonicalProtocolJson(effective.binding) !== canonicalProtocolJson(source)) throw new TypeError('Capture source drift');
    if (r.status === 'captured') { protocolKeys(r, ['status', 'observation']); captureObservation(r.observation); const view = protocolRecord(r.observation).agentView; if (view !== undefined) { const v = canonicalAgentViewReceipt(view); if (v.reference) reference(v.reference, source, adapter); if (v.region && canonicalProtocolJson(v.region.binding) !== canonicalProtocolJson(source)) throw new TypeError('Wrong captured region source'); } }
    else { protocolKeys(r, ['status', 'reason']); if (r.status !== 'unavailable') throw new TypeError('Invalid capture status'); if (r.reason !== 'unavailable') canonicalCaptureReason(r.reason); }
  } else if (p.tool === 'resolve_visual_pixel') {
    protocolKeys(p, ['tool', 'request', 'result']); const q = protocolRecord(p.request); protocolKeys(q, ['observationId', 'imageSha256', 'x', 'y']); protocolToken(q.observationId); protocolHash(q.imageSha256); protocolInteger(q.x, 4095); protocolInteger(q.y, 4095);
    if (r.status === 'resolved') { protocolKeys(r, ['status', 'key', 'position', 'reference', 'recordValidation', 'visibility']); const ref = reference(r.reference, source, adapter); if (canonicalProtocolJson(ref.key) !== canonicalProtocolJson(r.key) || r.recordValidation !== 'server-verified-original-record' || r.visibility !== 'browser-observed-capture-time') throw new TypeError('Invalid verified pixel claims'); vector(r.position); }
    else { protocolKeys(r, ['status', 'reason']); if (!['unavailable', 'ambiguous', 'no-hit', 'invalid', 'stale'].includes(String(r.status)) || r.reason !== 'browser-unavailable') throw new TypeError('Invalid pixel evidence'); }
  } else throw new TypeError('Unsupported evidence tool');
  return freezeProtocolValue(p) as unknown as SceneEvidenceProjection;
}
export function canonicalSceneEvidenceReceipt(value: unknown): SceneEvidenceReceipt {
  const r = protocolRecord(value); protocolKeys(r, ['schemaVersion', 'evidenceId', 'sourceBinding', 'adapter', 'turn', 'projectionHash', 'projection']);
  if (r.schemaVersion !== 1 || !['prepared', 'toronto'].includes(String(r.adapter))) throw new TypeError('Invalid evidence receipt'); protocolToken(r.evidenceId); protocolInteger(r.turn, 16); if (r.turn === 0) throw new TypeError('Invalid evidence turn'); protocolHash(r.projectionHash);
  const source = canonicalSceneSourceBinding(r.sourceBinding), projection = canonicalSceneEvidenceProjection(r.projection, source, r.adapter as SceneEvidenceReceipt['adapter']);
  const detached = { ...r, sourceBinding: source, projection }; if (evidenceUtf8Bytes(detached) > EXPLORATION_EVIDENCE_LIMITS.recordBytes) throw new RangeError('Evidence record byte limit');
  return freezeProtocolValue(detached) as unknown as SceneEvidenceReceipt;
}
export function canonicalEvidenceRetention(value: unknown): EvidenceRetention {
  const r = protocolRecord(value);
  if (r.status === 'retained') { protocolKeys(r, ['status', 'evidenceId']); protocolToken(r.evidenceId); }
  else { protocolKeys(r, ['status', 'reason']); if (r.status !== 'unavailable' || !['unsupported-result', 'record-too-large', 'retention-limit'].includes(String(r.reason))) throw new TypeError('Invalid evidence retention'); }
  return freezeProtocolValue({ ...r }) as EvidenceRetention;
}
export function canonicalSceneEvidenceLookup(value: unknown): { readonly status: 'available'; readonly receipt: SceneEvidenceReceipt } | { readonly status: 'unavailable'; readonly reason: 'not-retained' } {
  const r = protocolRecord(value);
  if (r.status === 'available') { protocolKeys(r, ['status', 'receipt']); return { status: 'available', receipt: canonicalSceneEvidenceReceipt(r.receipt) }; }
  protocolKeys(r, ['status', 'reason']); if (r.status !== 'unavailable' || r.reason !== 'not-retained') throw new TypeError('Invalid evidence lookup');
  return { status: 'unavailable', reason: 'not-retained' };
}
