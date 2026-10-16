import { PROJECT_FRAME_ID, PROJECT_LIMITS, canonicalPersistentProject, canonicalProjectBinding,
  canonicalBoxProposalRequest, canonicalBoxApprovalRequest, canonicalProjectUndoRequest, canonicalSceneContextRequest,
  canonicalProtocolJson, freezeProtocolValue, protocolRecord, protocolKeys, protocolToken, protocolHash, protocolInteger,
  type ProjectSnapshot, type ProjectBinding, type ProjectState, type ProjectSessionInfo, type BoxEdit, type BoxProposal,
  type SceneContextRequest, type SceneContext, type ScenePointReference, type ProjectCommitResult } from '@spatial/contracts';

const equal = (a: unknown, b: unknown) => canonicalProtocolJson(a) === canonicalProtocolJson(b);
export const projectBinding = (snapshot: ProjectSnapshot): ProjectBinding => ({ sessionId: snapshot.sessionId,
  projectRevision: snapshot.project.revision, frameId: snapshot.frameId, units: 'm' });
function tokenOrNull(value: unknown) { if (value !== null) protocolToken(value); }
export function validateSnapshot(value: unknown): ProjectSnapshot {
  const r = protocolRecord(value); protocolKeys(r, ['sessionId', 'frameId', 'project']); protocolToken(r.sessionId);
  if (r.frameId !== PROJECT_FRAME_ID) throw new Error('Unknown project frame');
  return freezeProtocolValue({ sessionId: r.sessionId, frameId: PROJECT_FRAME_ID, project: canonicalPersistentProject(r.project) });
}
export function validateSession(value: unknown): ProjectSessionInfo {
  const r = protocolRecord(value); protocolKeys(r, ['snapshot', 'nextUndoTransactionId', 'persistence', 'savedRevision', 'dirty', 'limits']);
  const snapshot = validateSnapshot(r.snapshot); tokenOrNull(r.nextUndoTransactionId);
  if (r.savedRevision !== null) protocolInteger(r.savedRevision);
  if (r.persistence !== 'explicit-save' || typeof r.dirty !== 'boolean' || !equal(r.limits, PROJECT_LIMITS) ||
    (r.savedRevision !== null && (r.savedRevision as number) > snapshot.project.revision) || (!r.dirty && r.savedRevision !== snapshot.project.revision)) throw new Error('Invalid session');
  return freezeProtocolValue({ ...r, snapshot }) as unknown as ProjectSessionInfo;
}
export function validateContext(value: unknown, request: SceneContextRequest, snapshot: ProjectSnapshot): SceneContext {
  const r = protocolRecord(value); protocolKeys(r, ['sessionId', 'projectRevision', 'frameId', 'units', 'entityIds', 'points', 'coordinates', 'entities', 'coverage', 'source']);
  const selection = canonicalSceneContextRequest(Object.fromEntries(['sessionId', 'projectRevision', 'frameId', 'units', 'entityIds', 'points'].map(k => [k, r[k]])));
  const entities = request.entityIds.map(id => { const entity = snapshot.project.entities.find(e => e.id === id); if (!entity) throw new Error('Unknown selection'); return { id, kind: entity.kind }; });
  for (const point of selection.points) {
    const entity = snapshot.project.entities.find(e => e.id === point.entityId);
    if (entity?.kind !== 'point-cloud' || !equal(entity.points[point.pointIndex], point.position)) throw new Error('Invalid original point');
  }
  if (!equal(selection, request) || !equal(r.coordinates, snapshot.project.coordinates) || !equal(r.entities, entities) ||
    r.coverage !== 'explicit-project-selections' || r.source !== 'synthetic-project') throw new Error('Wrong bound scene context');
  return freezeProtocolValue(r) as unknown as SceneContext;
}
export async function validateProposal(value: unknown, request: ReturnType<typeof canonicalBoxProposalRequest>, snapshot: ProjectSnapshot): Promise<BoxProposal> {
  const r = protocolRecord(value); protocolKeys(r, ['sessionId', 'projectRevision', 'frameId', 'units', 'edit', 'proposalId', 'digest', 'expiresAt', 'coordinates', 'before', 'after', 'verification']);
  const actual = canonicalBoxProposalRequest(Object.fromEntries(['sessionId', 'projectRevision', 'frameId', 'units', 'edit'].map(k => [k, r[k]])));
  protocolToken(r.proposalId); protocolHash(r.digest); protocolInteger(r.expiresAt);
  const before = snapshot.project.entities.find(e => e.id === request.edit.entityId) ?? null;
  if (request.edit.kind === 'create-box' ? before !== null : before?.kind !== 'box') throw new Error('Wrong proposal target');
  const after = { id: request.edit.entityId, kind: 'box', center: request.edit.center, dimensions: request.edit.dimensions };
  if (!equal(actual, request) || !equal(r.before, before) || !equal(r.after, after) || !equal(r.coordinates, snapshot.project.coordinates) ||
    r.verification !== 'parameter-postconditions-not-cad' || (r.expiresAt as number) <= Date.now() || (r.expiresAt as number) > Date.now() + PROJECT_LIMITS.proposalLifetimeMs + 1000) throw new Error('Wrong exact proposal');
  const { digest, ...exact } = r;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalProtocolJson(exact)));
  if ([...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('') !== digest) throw new Error('Proposal digest mismatch');
  return freezeProtocolValue(r) as unknown as BoxProposal;
}
function expectedBoxProject(before: ProjectState, proposal: BoxProposal): ProjectState {
  return { ...before, revision: before.revision + 1, entities: proposal.edit.kind === 'create-box'
    ? [...before.entities, proposal.after] : before.entities.map(e => e.id === proposal.after.id ? proposal.after : e) };
}
export function validateCommit(value: unknown, before: ProjectSnapshot, expected: ProjectState, operation: ProjectCommitResult['operation']): ProjectCommitResult {
  const r = protocolRecord(value); protocolKeys(r, ['snapshot', 'transactionId', 'nextUndoTransactionId', 'verification', 'operation', 'persisted']);
  protocolToken(r.transactionId); tokenOrNull(r.nextUndoTransactionId); const snapshot = validateSnapshot(r.snapshot);
  if (snapshot.sessionId !== before.sessionId || snapshot.frameId !== before.frameId || !equal(snapshot.project, expected) ||
    snapshot.project.revision !== before.project.revision + 1 || r.operation !== operation || r.persisted !== false || r.verification !== 'parameter-postconditions-not-cad' ||
    (operation !== 'undo' && r.nextUndoTransactionId !== r.transactionId)) throw new Error('Commit differs from exact approved mutation');
  return freezeProtocolValue({ ...r, snapshot }) as unknown as ProjectCommitResult;
}
export class ProjectRejection extends Error { constructor(readonly code: string, message: string) { super(message); } }
export type ProjectTransport = (path: string, body: unknown | undefined, signal: AbortSignal) => Promise<unknown>;
/** Bounded reads, including error envelopes. No unbounded Response.json(). */
export const projectTransport: ProjectTransport = async (path, body, signal) => {
  const response = await fetch(path, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.body) throw new Error('Missing response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abortRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abortRead, { once: true });
  try {
    while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > PROJECT_LIMITS.snapshotBytes + 16384) throw new Error('Project response budget'); chunks.push(value); }
    signal.throwIfAborted(); const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const r = protocolRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (r.ok === false) {
      protocolKeys(r, ['ok', 'error']); const e = protocolRecord(r.error); protocolKeys(e, ['code', 'message']);
      const codes = ['invalid-request','stale-project','unknown-entity','invalid-point','unknown-proposal','approval-mismatch','expired-proposal','nothing-to-undo','resource-limit','busy','local-only','snapshot-missing','snapshot-corrupt','storage-unavailable','postcondition-failed'];
      if (response.ok || !codes.includes(String(e.code)) || typeof e.message !== 'string' || e.message.length > 256) throw new Error('Invalid rejection');
      throw new ProjectRejection(e.code as string, e.message);
    }
    protocolKeys(r, ['ok', 'result']); if (!response.ok || r.ok !== true) throw new Error('Invalid project reply'); return r.result;
  } finally { signal.removeEventListener('abort', abortRead); await reader.cancel().catch(() => {}); reader.releaseLock(); }
};
export interface ProjectView {
  readonly session?: ProjectSessionInfo; readonly snapshot?: ProjectSnapshot; readonly proposal?: BoxProposal; readonly context?: SceneContext;
  readonly selectedId: string | null; readonly points: readonly ScenePointReference[];
  readonly pending?: string; readonly needsRefresh: boolean; readonly status: string; readonly undoAvailable: boolean;
}
/** No automatic retries. An ambiguous mutation (including cancellation) blocks edits until explicit refresh. */
export class ProjectController {
  private state: ProjectView = { selectedId: null, points: [], needsRefresh: false, status: 'Loading authoritative project…', undoAvailable: false };
  private generation = 0; private active?: AbortController; private disposed = false; private mutation = false;
  private undoReceipts = new Map<string, ProjectState>();
  // Receipt ownership outlives the transient displayed snapshot during Refresh/failure.
  private undoReceiptSessionId?: string;
  constructor(private readonly publish: (state: ProjectView) => void, private readonly transport: ProjectTransport = projectTransport) {}
  get view() { return this.state; }
  private emit(patch: Partial<ProjectView>) { this.state = freezeProtocolValue({ ...this.state, ...patch }); if (!this.disposed) this.publish(this.state); }
  private invalidate() { this.generation++; this.active?.abort(); this.active = undefined; }
  cancel() {
    if (!this.active) { this.clearProposal(); return; }
    const ambiguous = this.mutation; this.invalidate(); this.mutation = false;
    this.emit({ pending: undefined, proposal: undefined, context: undefined, needsRefresh: this.state.needsRefresh || ambiguous,
      status: ambiguous ? 'Mutation outcome unknown. Explicit Refresh required; do not retry.' : 'Cancelled; late replies suppressed.' });
  }
  dispose() { this.disposed = true; this.invalidate(); }
  clearProposal() {
    if (this.state.pending === 'proposal' || this.state.pending === 'context') this.cancel();
    this.emit({ proposal: undefined });
  }
  select(id: string | null) {
    if (this.state.pending && this.mutation) return;
    if (id !== null && !this.state.snapshot?.project.entities.some(e => e.id === id)) return;
    if (this.active) this.cancel();
    this.emit({ selectedId: id, context: undefined, proposal: undefined });
  }
  pin(point: ScenePointReference) {
    if (this.state.pending && this.mutation) return;
    const entity = this.state.snapshot?.project.entities.find(e => e.id === point.entityId);
    if (entity?.kind !== 'point-cloud' || !equal(entity.points[point.pointIndex], point.position)) return;
    if (this.active) this.cancel();
    this.emit({ points: [...this.state.points.filter(p => p.name !== point.name), point], context: undefined, proposal: undefined });
  }
  clearPoints() { if (this.mutation) return; if (this.active) this.cancel(); this.emit({ points: [], context: undefined, proposal: undefined }); }
  private async run(name: string, mutation: boolean, work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (this.disposed || this.active || (mutation && this.state.needsRefresh)) return;
    const generation = ++this.generation, controller = this.active = new AbortController(); this.mutation = mutation;
    const current = () => !this.disposed && !controller.signal.aborted && generation === this.generation;
    this.emit({ pending: name, status: `${name} pending…` });
    try { await work(controller.signal, current); }
    catch (cause) { if (current()) this.emit({ proposal: undefined, context: undefined, needsRefresh: this.state.needsRefresh || (mutation && !(cause instanceof ProjectRejection)) || (cause instanceof ProjectRejection && cause.code === 'stale-project'),
      status: cause instanceof ProjectRejection ? `Rejected: ${cause.code} — ${cause.message}` : mutation ? 'Mutation outcome unknown. Explicit Refresh required; do not retry.' : 'Server unavailable or invalid response. No local fallback.' }); }
    finally { if (current()) { this.active = undefined; this.mutation = false; this.emit({ pending: undefined }); } }
  }
  async refresh() {
    if (this.active) this.cancel();
    this.emit({ snapshot: undefined, session: undefined, proposal: undefined, context: undefined, selectedId: null, points: [] });
    await this.run('refresh', false, async (signal, current) => {
      const session = validateSession(await this.transport('/project/session', undefined, signal));
      if (!current()) return;
      if (this.undoReceiptSessionId !== session.snapshot.sessionId) this.undoReceipts.clear();
      this.undoReceiptSessionId = session.snapshot.sessionId;
      this.emit({ snapshot: session.snapshot, session, needsRefresh: false, undoAvailable: session.nextUndoTransactionId !== null && this.undoReceipts.has(session.nextUndoTransactionId), status: 'Refreshed server authority.' });
    });
  }
  async context() {
    const snapshot = this.state.snapshot; if (!snapshot || this.state.needsRefresh) return;
    const request = canonicalSceneContextRequest({ ...projectBinding(snapshot), entityIds: this.state.selectedId ? [this.state.selectedId] : [], points: this.state.points });
    this.emit({ context: undefined });
    await this.run('context', false, async (signal, current) => {
      const context = validateContext(await this.transport('/project/context', request, signal), request, snapshot);
      if (current()) this.emit({ context, status: 'Bound scene context returned. No model answer generated.' });
    });
  }
  async propose(edit: BoxEdit) {
    const snapshot = this.state.snapshot; if (!snapshot || this.state.needsRefresh) return;
    this.clearProposal();
    let request: ReturnType<typeof canonicalBoxProposalRequest>;
    try { request = canonicalBoxProposalRequest({ ...projectBinding(snapshot), edit }); }
    catch { this.emit({ status: 'Invalid box parameters. No proposal or mutation.' }); return; }
    await this.run('proposal', false, async (signal, current) => {
      const proposal = await validateProposal(await this.transport('/project/proposals', request, signal), request, snapshot);
      if (current()) this.emit({ proposal, status: 'Preview only — authority unchanged. Review exact digest and parameters before approval.' });
    });
  }
  private async finishCommit(result: ProjectCommitResult, signal: AbortSignal, current: () => boolean) {
    if (!current()) return;
    this.emit({ snapshot: result.snapshot, session: undefined, selectedId: null, points: [], proposal: undefined, context: undefined,
      undoAvailable: result.nextUndoTransactionId !== null && this.undoReceipts.has(result.nextUndoTransactionId), status: `Committed ${result.operation}, revision ${result.snapshot.project.revision}. Parameter postconditions checked, not CAD. Not persisted.` });
    // Persistence dirtiness comes from server truth, not revision arithmetic.
    try {
      const session = validateSession(await this.transport('/project/session', undefined, signal));
      if (!equal(session.snapshot, result.snapshot) || session.nextUndoTransactionId !== result.nextUndoTransactionId) throw new Error('Authority changed');
      if (current()) this.emit({ session });
    } catch { if (current()) this.emit({ needsRefresh: true, status: `Committed ${result.operation}, revision ${result.snapshot.project.revision}; persistence status unavailable. Explicit Refresh required.` }); }
  }
  async approve() {
    const snapshot = this.state.snapshot, proposal = this.state.proposal;
    if (!snapshot || !proposal || this.state.needsRefresh) return;
    if (proposal.expiresAt <= Date.now()) { this.clearProposal(); this.emit({ status: 'Proposal expired. Request a fresh exact preview; no commit.' }); return; }
    const request = canonicalBoxApprovalRequest({ ...projectBinding(snapshot), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
    await this.run('approve', true, async (signal, current) => {
      const result = validateCommit(await this.transport('/project/approve', request, signal), snapshot, expectedBoxProject(snapshot.project, proposal), proposal.edit.kind);
      if (!current()) return; this.undoReceipts.set(result.transactionId, snapshot.project);
      await this.finishCommit(result, signal, current);
    });
  }
  async undo() {
    const snapshot = this.state.snapshot, id = this.state.session?.nextUndoTransactionId, before = id ? this.undoReceipts.get(id) : undefined;
    if (!snapshot || !id || !before || this.state.needsRefresh) return;
    const request = canonicalProjectUndoRequest({ ...projectBinding(snapshot), transactionId: id, humanApproved: true });
    await this.run('undo', true, async (signal, current) => {
      const result = validateCommit(await this.transport('/project/undo', request, signal), snapshot, { ...before, revision: snapshot.project.revision + 1 }, 'undo');
      if (current()) { this.undoReceipts.delete(id); await this.finishCommit(result, signal, current); }
    });
  }
  async save() {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    await this.run('save', true, async (signal, current) => {
      const r = protocolRecord(await this.transport('/project/save', canonicalProjectBinding(projectBinding(snapshot)), signal));
      protocolKeys(r, ['snapshot', 'savedRevision', 'persisted']); const saved = validateSnapshot(r.snapshot);
      if (!equal(saved, snapshot) || r.savedRevision !== snapshot.project.revision || r.persisted !== true) throw new Error('Invalid saved snapshot');
      if (!current()) return;
      const session = validateSession(await this.transport('/project/session', undefined, signal));
      if (!equal(session.snapshot, snapshot) || session.savedRevision !== r.savedRevision || session.dirty) throw new Error('Invalid saved session');
      if (current()) this.emit({ session, status: `Saved revision ${r.savedRevision} atomically.` });
    });
  }
  async load() {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    this.emit({ proposal: undefined, context: undefined });
    await this.run('load', true, async (signal, current) => {
      const r = protocolRecord(await this.transport('/project/load', canonicalProjectBinding(projectBinding(snapshot)), signal));
      protocolKeys(r, ['snapshot', 'nextUndoTransactionId', 'persisted']); const loaded = validateSnapshot(r.snapshot);
      if (loaded.sessionId === snapshot.sessionId || r.nextUndoTransactionId !== null || r.persisted !== true) throw new Error('Load did not rotate session');
      if (!current()) return;
      this.undoReceipts.clear(); this.undoReceiptSessionId = loaded.sessionId;
      this.emit({ snapshot: loaded, session: undefined, selectedId: null, points: [], proposal: undefined, context: undefined, undoAvailable: false, status: 'Loaded saved geometry; session rotated; selections/history invalidated.' });
      const session = validateSession(await this.transport('/project/session', undefined, signal));
      if (!equal(session.snapshot, loaded) || session.nextUndoTransactionId !== null || session.dirty) throw new Error('Invalid loaded session');
      if (current()) this.emit({ session, needsRefresh: false });
    });
  }
}
