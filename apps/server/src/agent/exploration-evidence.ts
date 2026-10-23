import { createHash } from 'node:crypto';
import { canonicalProtocolJson, canonicalSceneEvidenceProjection, canonicalModelReferenceSelection, canonicalCaptureAuthorityScope, type CaptureEvidenceAdmission, type CaptureAuthorityScope, type SceneEvidenceProjection, type SceneSourceBinding, type EvidenceToolName, type EvidenceWitness } from '@spatial/contracts';
import type { BoundModelScene } from './provider-model';
import type { ModelScene } from '@spatial/contracts';
import type { ModelEditingAuthorities } from './model-scene';

export const evidenceHash = (value: unknown) => createHash('sha256').update(canonicalProtocolJson(value)).digest('hex');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Unsupported evidence result'); return value as Record<string, unknown>; };
const pick = (value: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
/** Exact server-state scope or explicit unknown; never infer empty authorities. */
export async function captureAuthorityScope(editing: ModelEditingAuthorities | undefined, signal: AbortSignal): Promise<CaptureAuthorityScope> {
  if (!editing?.objects) return { status: 'unknown', reason: 'not-available' };
  try {
    const snapshots = await Promise.all([editing.points, editing.cad, editing.objects].map(owner => owner.execute('snapshot', undefined, signal)));
    const pointProposals = await editing.points.execute('pending', undefined, signal);
    signal.throwIfAborted();
    const parts = snapshots.map((value, index) => { const s = record(value), proposals = index === 0 ? pointProposals : s.proposals; if (!Array.isArray(proposals)) throw new TypeError('Missing proposal state'); return { ...pick(s, ['sessionId', 'revision', 'artifactRevision']), pendingProposalIds: proposals.map(p => record(p).proposalId).sort() }; });
    return canonicalCaptureAuthorityScope({ status: 'known', points: parts[0], cad: parts[1], objects: parts[2] });
  } catch { signal.throwIfAborted(); return { status: 'unknown', reason: 'not-available' }; }
}
/** Capture inspection metadata is internal, separate from browser image authority. */
export function captureAdmission(request: CaptureEvidenceAdmission['request'], effective: CaptureEvidenceAdmission['effective'], before: CaptureAuthorityScope, after: CaptureAuthorityScope): CaptureEvidenceAdmission {
  const authority = canonicalProtocolJson(before) === canonicalProtocolJson(after) ? before : { status: 'unknown' as const, reason: 'changed-during-capture' as const };
  return { request, effective, authority };
}
function witness(value: unknown, binding: SceneSourceBinding, adapter: 'prepared' | 'toronto'): EvidenceWitness {
  const w = record(value), key = record(w.key);
  const reference = canonicalModelReferenceSelection(adapter === 'prepared' ? { kind: 'cloud-point', cloudId: binding.sourceId, revision: binding.sourceRevision, key } : { kind: 'toronto-point', key });
  // These fields are original-record values already returned by the checked adapter.
  return { ...pick(w, ['position', 'label', 'instanceId', 'distanceMeters']), key, reference } as unknown as EvidenceWitness;
}
function queryProjection(args: unknown, value: unknown, binding: SceneSourceBinding, adapter: 'prepared' | 'toronto'): unknown {
  const r = record(value);
  if (r.status === 'unavailable' && r.complete !== false) throw new TypeError('Unsupported unavailable coverage');
  if (r.status === 'unavailable') return { tool: 'query_points', request: args, result: { status: 'unavailable', complete: false, witnesses: [], returnedWitnessCount: 0, retainedWitnessCount: 0, projectionTruncated: false, reason: 'resource-unavailable' } };
  if (r.complete !== true || !Array.isArray(r.points) || r.points.length > 64) throw new TypeError('Unsupported point result');
  if (adapter === 'prepared') {
    if (r.datasetId !== binding.sourceId || r.artifactRevision !== binding.sourceRevision || r.frameId !== binding.frameId || r.units !== 'm') throw new TypeError('Wrong prepared source');
  } else {
    const b = record(r.binding);
    if (b.artifactRevision !== binding.sourceRevision || b.frameId !== binding.frameId || b.units !== 'm' || canonicalProtocolJson(record(b.coordinates).localOrigin) !== canonicalProtocolJson(binding.origin) || r.independentVerification !== false) throw new TypeError('Wrong Toronto source');
  }
  const retained = r.points.slice(0, 16).map(p => witness(p, binding, adapter));
  const fields = adapter === 'prepared' ? pick(r, ['count', 'checkedPoints']) : { ...pick(r, ['totalCount', 'countsByLabel', 'distanceMeters', 'truncated', 'selection', 'independentVerification']), ...pick(r.statistics ? record(r.statistics) : {}, ['checkedPoints']) };
  return { tool: 'query_points', request: args, result: { status: 'observed', complete: true, ...fields, witnesses: retained, returnedWitnessCount: r.points.length, retainedWitnessCount: retained.length, projectionTruncated: r.points.length > retained.length } };
}
function capturedObservation(value: unknown, binding: SceneSourceBinding): Record<string, unknown> {
  const o = record(value), b = record(o.binding);
  if (b.sourceId !== binding.sourceId || b.sourceRevision !== binding.sourceRevision || b.frameId !== binding.frameId || b.units !== 'm' || canonicalProtocolJson(b.origin) !== canonicalProtocolJson(binding.origin)) throw new TypeError('Wrong image source');
  const cov = record(o.coverage);
  const coverage: Record<string, unknown> = pick(cov, ['kind', 'complete', 'displayedPointCount']);
  if (cov.captureDetail !== undefined) coverage.captureDetail = pick(record(cov.captureDetail), ['status', 'pointBudget', 'budgetLimited', 'targetPointCount', 'targetNodeCount']);
  if (cov.grounding !== undefined) coverage.grounding = pick(record(cov.grounding), ['status', 'method', 'bytes', 'expiresInMs']);
  return { ...pick(o, ['observationId', 'viewport', 'camera', 'crop', 'sourceImage']), image: pick(record(o.image), ['mimeType', 'sha256', 'byteLength']), coverage, ...(cov.agentView === undefined ? {} : { agentView: cov.agentView }) };
}
function captureProjection(value: unknown, admission: CaptureEvidenceAdmission | undefined, binding: SceneSourceBinding): unknown {
  if (!admission) throw new TypeError('No admitted capture request');
  const r = record(value), result = r.status === 'captured' ? { status: 'captured', observation: capturedObservation(r.observation, binding) } : r.status === 'unavailable' ? { status: 'unavailable', reason: r.reason ?? 'unavailable' } : undefined;
  if (!result) throw new TypeError('Unsupported capture result');
  return { tool: 'capture_scene', ...admission, requestedScopeHash: evidenceHash({ binding, request: admission.request }), effectiveScopeHash: evidenceHash({ binding, effective: admission.effective, authority: admission.authority, ...(result.observation ? { observation: result.observation } : {}) }), result };
}
function pixelProjection(args: unknown, value: unknown, binding: SceneSourceBinding): unknown {
  const r = record(value), result = record(r.result), a = record(args), observed = record(r.binding);
  if (observed.sourceId !== binding.sourceId || observed.sourceRevision !== binding.sourceRevision || observed.frameId !== binding.frameId || observed.units !== 'm' || canonicalProtocolJson(observed.origin) !== canonicalProtocolJson(binding.origin)) throw new TypeError('Pixel image source mismatch');
  const request = { observationId: a.observationId, x: a.x, y: a.y, imageSha256: r.imageSha256 };
  if (result.observationId !== a.observationId || result.x !== a.x || result.y !== a.y) throw new TypeError('Wrong pixel identity');
  if (result.status !== 'resolved') return { tool: 'resolve_visual_pixel', request, result: { status: result.status, reason: 'browser-unavailable' } };
  const p = record(result.provenance);
  if (p.datasetId !== binding.sourceId || p.artifactRevision !== binding.sourceRevision || p.frameId !== binding.frameId || p.units !== 'm' || canonicalProtocolJson(p.origin) !== canonicalProtocolJson(binding.origin)) throw new TypeError('Wrong original pixel source');
  return { tool: 'resolve_visual_pixel', request, result: { status: 'resolved', ...pick(p, ['key', 'position', 'recordValidation', 'visibility']), reference: p.selectReference } };
}
/** Closed allowlisted projections only. Retention failure never replaces a successful operation. */
export function projectSceneEvidence(tool: EvidenceToolName, args: unknown, context: unknown, scene: ModelScene, bound: BoundModelScene): SceneEvidenceProjection | undefined {
  const source = bound.captureCapabilities;
  if (!source || scene.mode === 'pole') return;
  const adapter = scene.mode === 'cloud' ? 'prepared' : 'toronto';
  try {
    const projection = tool === 'query_points' ? queryProjection(args, context, source.binding, adapter) : tool === 'capture_scene' ? captureProjection(context, bound.captureEvidenceAdmission, source.binding) : pixelProjection(args, context, source.binding);
    return canonicalSceneEvidenceProjection(projection, source.binding, adapter);
  } catch { return undefined; }
}
