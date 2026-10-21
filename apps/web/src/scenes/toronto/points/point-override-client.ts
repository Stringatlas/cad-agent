import { canonicalPoleRequest, canonicalPointMoveProposalRequest, POINT_OVERRIDE_LIMITS, type NearestPoleRequest, type NearestPoleToolOutcome, type PointKey, type PointMoveProposal, type PointOverrideSnapshot, type Vec3 } from '@spatial/contracts';
import type { TorontoDraftPoint } from '../../../chat/draft-context';
import { validatePoleResult } from '../inspection/pole-client';
import { torontoReadonlyFetch } from '../toronto-readonly-fetch';

export const pointKey = (key: PointKey) => `${key.sourceFileId}:${key.sourceRow}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid override object');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) throw new Error('Unexpected override fields');
  return r;
}
function token(v: unknown) { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v)) throw new Error('Invalid authority identifier'); return v; }
function vector(v: unknown): Vec3 { if (!Array.isArray(v) || v.length !== 3 || !v.every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid override position'); return [...v] as unknown as Vec3; }
function key(v: unknown): PointKey {
  const k = object(v, ['sourceFileId', 'sourceRow']);
  if (!Number.isInteger(k.sourceFileId) || (k.sourceFileId as number) < 1 || (k.sourceFileId as number) > 4 || !Number.isSafeInteger(k.sourceRow) || (k.sourceRow as number) < 0 || (k.sourceRow as number) > 0xffffffff) throw new Error('Invalid source key');
  return { sourceFileId: k.sourceFileId as number, sourceRow: k.sourceRow as number };
}
function binding(r: Record<string, unknown>) {
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 0 || typeof r.artifactRevision !== 'string' || !/^[a-f0-9]{64}$/.test(r.artifactRevision) || r.datasetId !== 'toronto3d' || r.frameId !== 'toronto3d-local-v1' || r.units !== 'm') throw new Error('Invalid override binding');
  return { sessionId: token(r.sessionId), revision: r.revision as number, artifactRevision: r.artifactRevision, datasetId: 'toronto3d' as const, frameId: 'toronto3d-local-v1' as const, units: 'm' as const };
}
export function validateOverrideSnapshot(value: unknown): PointOverrideSnapshot {
  const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'datasetId', 'frameId', 'units', 'entries', 'nextUndoTransactionId']);
  const b = binding(r), seen = new Set<string>();
  if (!Array.isArray(r.entries) || r.entries.length > POINT_OVERRIDE_LIMITS.entries) throw new Error('Invalid override entries');
  const entries = r.entries.map(value => {
    const p = object(value, ['key', 'originalPosition', 'position']), k = key(p.key), id = pointKey(k);
    if (seen.has(id)) throw new Error('Duplicate override key'); seen.add(id);
    return { key: k, originalPosition: vector(p.originalPosition), position: vector(p.position) };
  });
  return { ...b, entries, nextUndoTransactionId: r.nextUndoTransactionId === null ? null : token(r.nextUndoTransactionId) };
}
export function effectivePosition(point: TorontoDraftPoint, snapshot?: PointOverrideSnapshot): Vec3 {
  if (!snapshot || snapshot.artifactRevision !== point.artifactRevision) return point.position;
  const entry = snapshot.entries.find(e => pointKey(e.key) === pointKey(point.key));
  if (entry && !same(entry.originalPosition, point.position)) throw new Error('Original source position conflicts with override authority. Refresh and select again.');
  return entry?.position ?? point.position;
}
export function validateMoveProposal(value: unknown, request: ReturnType<typeof canonicalPointMoveProposalRequest>, snapshot: PointOverrideSnapshot, references: readonly TorontoDraftPoint[]): PointMoveProposal {
  const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'datasetId', 'frameId', 'units', 'proposalId', 'moves']), b = binding(r);
  if (b.sessionId !== request.sessionId || b.revision !== request.revision || b.artifactRevision !== request.artifactRevision || !Array.isArray(r.moves) || r.moves.length !== request.points.length) throw new Error('Stale proposal');
  const seen = new Set<string>();
  const moves = r.moves.map(value => {
    const p = object(value, ['key', 'originalPosition', 'before', 'after']), k = key(p.key), id = pointKey(k);
    const selected = request.points.find(p => pointKey(p.key) === id), original = references.find(p => pointKey(p.key) === id);
    const originalPosition = vector(p.originalPosition), before = vector(p.before), after = vector(p.after);
    if (seen.has(id) || !selected || !original || !same(originalPosition, original.position) || !same(before, selected.position) || !same(before, effectivePosition(original, snapshot)) || !same(after, before.map((n, i) => n + request.translation[i]))) throw new Error('Proposal differs from exact requested translation');
    seen.add(id); return { key: k, originalPosition, before, after };
  });
  return { ...b, proposalId: token(r.proposalId), moves };
}

export interface NearestSelectionEvidence { readonly searchGeometry: 'original-prepared-dataset'; readonly pointName: string; readonly request: NearestPoleRequest; readonly outcome: NearestPoleToolOutcome }
/** Revalidate display-only model context before allowing an explicit user selection. */
export async function verifiedNearestSelection(context: unknown, points: readonly TorontoDraftPoint[]): Promise<{ evidence: NearestSelectionEvidence; point: Omit<TorontoDraftPoint, 'name'> }> {
  const r = object(context, ['searchGeometry', 'pointName', 'request', 'outcome']);
  if (r.searchGeometry !== 'original-prepared-dataset' || typeof r.pointName !== 'string') throw new Error('Not a nearest-label result');
  const request = canonicalPoleRequest(r.request), source = points.find(p => p.name === r.pointName);
  if (!source || request.input.kind !== 'point-ref' || !same(request.input.key, source.key) || request.expectedArtifactRevision !== source.artifactRevision || request.domain.kind !== 'whole-dataset') throw new Error('Result source is no longer active');
  const outcome = validatePoleResult(r.outcome, request);
  if (outcome.status !== 'verified-found' || !outcome.nearest || !same(outcome.queryPosition, source.position)) throw new Error('No verified winner bound to this original source');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== outcome.search.requestHash) throw new Error('Nearest-label request hash mismatch');
  const evidence = JSON.parse(JSON.stringify({ searchGeometry: r.searchGeometry, pointName: r.pointName, request, outcome })) as NearestSelectionEvidence;
  return { evidence, point: { datasetId: 'toronto3d', artifactRevision: source.artifactRevision, key: { ...outcome.nearest.key }, position: [...outcome.nearest.position], frameId: source.frameId, units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [...source.localOrigin], evidence } };
}

export type OverrideTransport = (action: 'refresh' | 'pending' | 'propose' | 'approve' | 'decline' | 'undo', body?: unknown, signal?: AbortSignal) => Promise<unknown>;
export const overrideTransport: OverrideTransport = async (action, body, signal) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await torontoReadonlyFetch(`/datasets/toronto3d/overrides${action === 'refresh' ? '' : `/${action}`}`, { method: action === 'refresh' || action === 'pending' ? 'GET' : 'POST', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('Invalid override response');
    const text = await response.text(); if (text.length > 4_000_000) throw new Error('Oversized override response');
    const reply = JSON.parse(text);
    if (!response.ok || reply?.ok !== true) throw new Error(typeof reply?.error?.code === 'string' ? `Override ${reply.error.code}` : `Override HTTP ${response.status}`);
    object(reply, ['ok', 'result']); return reply.result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
};
export function validatePendingMoves(value: unknown, snapshot: PointOverrideSnapshot, references: readonly TorontoDraftPoint[]): PointMoveProposal[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Invalid pending point proposals');
  const ids = new Set<string>();
  return value.map(raw => {
    const p = object(raw, ['sessionId', 'revision', 'artifactRevision', 'datasetId', 'frameId', 'units', 'proposalId', 'moves']);
    const b = binding(p);
    if (!same(b, binding(snapshot as unknown as Record<string, unknown>)) || !Array.isArray(p.moves) || !p.moves.length) throw new Error('Stale pending point proposal');
    // Bind retained moves to current effective authority, and cross-check any still-attached original records.
    // Retained authority proposals remain reviewable after source switching/reload clears local attachments.
    if (p.moves.length > POINT_OVERRIDE_LIMITS.points) throw new Error('Too many pending point moves');
    const seen = new Set<string>();
    const moves = p.moves.map(rawMove => {
      const move = object(rawMove, ['key', 'originalPosition', 'before', 'after']);
      const k = key(move.key), id = pointKey(k), originalPosition = vector(move.originalPosition), before = vector(move.before), after = vector(move.after);
      const attached = references.find(p => pointKey(p.key) === id), entry = snapshot.entries.find(e => pointKey(e.key) === id);
      if (seen.has(id) || (attached && (!same(attached.position, originalPosition) || attached.artifactRevision !== b.artifactRevision)) || (entry && !same(entry.originalPosition, originalPosition)) || !same(before, entry?.position ?? originalPosition) || same(before, after)) throw new Error('Pending move conflicts with original or effective authority');
      seen.add(id); return { key: k, originalPosition, before, after };
    });
    // Retained replies contain exact before/after values, not the original translation operand.
    // Do not reverse-subtract/re-add it: binary64 cancellation can corrupt a legitimate move.
    const proposal: PointMoveProposal = { ...b, proposalId: token(p.proposalId), moves };
    if (ids.has(proposal.proposalId)) throw new Error('Duplicate pending point proposal'); ids.add(proposal.proposalId);
    return proposal;
  });
}
export interface PointEditView { snapshot?: PointOverrideSnapshot; proposal?: PointMoveProposal; proposals?: readonly PointMoveProposal[]; busy: boolean; needsRefresh: boolean; status: string }
export class PointOverrideController {
  private state: PointEditView = { busy: false, needsRefresh: true, status: 'Refresh point authority before editing.' };
  private generation = 0; private alive = true; private selection = ''; private points: readonly TorontoDraftPoint[] = []; private artifactRevision?: string;
  private active?: AbortController;
  constructor(private publish: (view: PointEditView) => void, private transport: OverrideTransport = overrideTransport, private discoverPending = false) {}
  private emit(update: Partial<PointEditView>) { this.state = { ...this.state, ...update }; if (this.alive) this.publish(this.state); }
  bind(points: readonly TorontoDraftPoint[], artifactRevision?: string) {
    const signature = JSON.stringify([artifactRevision, points.map(p => [p.name, p.artifactRevision, p.key, p.position])]);
    if (signature === this.selection) return;
    this.selection = signature; this.points = points; this.artifactRevision = artifactRevision; this.generation++; this.active?.abort();
    this.emit({ proposal: undefined, proposals: [], ...(this.state.busy ? { needsRefresh: true, busy: false, status: 'Selection changed during request. Refresh required; no retry.' } : {}) });
    if (this.state.snapshot) {
      try {
        if ((artifactRevision && artifactRevision !== this.state.snapshot.artifactRevision) || points.some(p => p.artifactRevision !== this.state.snapshot!.artifactRevision)) throw new Error('Artifact changed');
        for (const point of points) effectivePosition(point, this.state.snapshot);
      } catch { this.emit({ snapshot: undefined, needsRefresh: true, status: 'Artifact or original record changed. Refresh and reselect required.' }); }
    }
  }
  cancel() { this.generation++; this.active?.abort(); this.emit({ proposal: undefined, ...(this.state.busy ? { busy: false, needsRefresh: true, status: 'Request monitoring cancelled. Refresh required.' } : { status: 'Preview cancelled. Nothing approved.' }) }); }
  private async run(action: 'refresh' | 'propose' | 'approve' | 'decline' | 'undo', body?: unknown, request?: ReturnType<typeof canonicalPointMoveProposalRequest>) {
    if (!this.alive || this.state.busy || (action !== 'refresh' && this.state.needsRefresh)) return;
    const previous = this.state.snapshot, references = this.points, proposal = this.state.proposal, ticket = ++this.generation;
    this.emit({ busy: true, proposal: undefined, status: `${action} pending…` });
    const abort = new AbortController(); this.active = abort;
    try {
      const value = await this.transport(action, body, abort.signal);
      if (!this.alive || ticket !== this.generation) return;
      if (action === 'propose') {
        const next = validateMoveProposal(value, request!, previous!, references);
        this.emit({ proposal: next, proposals: [...(this.state.proposals ?? []), next], status: 'Review exact before / after coordinates, then explicitly Accept.' });
      } else {
        const next = validateOverrideSnapshot(value);
        if ((this.artifactRevision && next.artifactRevision !== this.artifactRevision) || references.some(p => p.artifactRevision !== next.artifactRevision)) throw new Error('Snapshot artifact differs from active scene');
        for (const p of references) effectivePosition(p, next);
        if (action !== 'refresh' && (!previous || next.sessionId !== previous.sessionId || next.artifactRevision !== previous.artifactRevision || next.revision !== previous.revision + (action === 'decline' ? 0 : 1))) throw new Error('Mutation response authority mismatch');
        if (action === 'approve') {
          const expected = new Map(previous!.entries.map(e => [pointKey(e.key), e]));
          for (const move of proposal!.moves) {
            if (same(move.after, move.originalPosition)) expected.delete(pointKey(move.key));
            else expected.set(pointKey(move.key), { key: move.key, originalPosition: move.originalPosition, position: move.after });
          }
          if (next.entries.length !== expected.size || next.entries.some(e => !same(e, expected.get(pointKey(e.key))))) throw new Error('Approval snapshot differs from reviewed proposal');
        }
        if (action === 'decline' && !same(next.entries, previous!.entries)) throw new Error('Decline mutated point positions');
        let pending: PointMoveProposal[] = action === 'decline' ? (this.state.proposals ?? []).filter(p => p.proposalId !== proposal?.proposalId) : [];
        // Publication advances surviving disjoint proposals to the returned revision.
        // Re-read exact authority values; never reuse or locally rebase old proposals.
        if ((action === 'refresh' || action === 'approve') && this.discoverPending) pending = validatePendingMoves(await this.transport('pending', undefined, abort.signal), next, references);
        if (!this.alive || ticket !== this.generation) return;
        this.emit({ snapshot: next, proposal: pending[0], proposals: pending, needsRefresh: false, status: action === 'refresh' ? 'Authoritative volatile point state refreshed. Pending proposals refreshed.' : `${action === 'approve' ? 'Approved' : action === 'decline' ? 'Declined' : 'Undone'} · revision ${next.revision}.` });
      }
    } catch (error) { if (this.alive && ticket === this.generation) this.emit({ proposal: undefined, proposals: [], needsRefresh: true, status: `${error instanceof Error ? error.message : 'Override request failed'}. Refresh required; no automatic retry.` }); }
    finally { if (this.alive && ticket === this.generation) this.emit({ busy: false }); }
  }
  refresh() { return this.run('refresh'); }
  propose(names: readonly string[], translation: Vec3) {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.busy || this.state.needsRefresh) return;
    try {
      const selected = this.points.filter(p => names.includes(p.name));
      const request = canonicalPointMoveProposalRequest({ sessionId: snapshot.sessionId, revision: snapshot.revision, artifactRevision: snapshot.artifactRevision, points: selected.map(p => ({ key: p.key, position: effectivePosition(p, snapshot) })), translation });
      return this.run('propose', request, request);
    } catch (error) { this.emit({ proposal: undefined, status: String(error) }); }
  }
  selectProposal(id: string) { if (!this.state.busy && !this.state.needsRefresh) this.emit({ proposal: this.state.proposals?.find(p => p.proposalId === id) }); }
  decline() { const p = this.state.proposal; if (p) return this.run('decline', { sessionId: p.sessionId, revision: p.revision, proposalId: p.proposalId }); }
  approve() { const p = this.state.proposal; if (p) return this.run('approve', { sessionId: p.sessionId, revision: p.revision, proposalId: p.proposalId }); }
  undo() { const s = this.state.snapshot; if (s?.nextUndoTransactionId) return this.run('undo', { sessionId: s.sessionId, revision: s.revision, transactionId: s.nextUndoTransactionId }); }
  dispose() { this.alive = false; this.generation++; this.active?.abort(); }
}
