import { CAD_LIMITS, canonicalCadOperation, type TorontoCadSnapshot, type TorontoCadProposal, type TorontoCadBody, type TorontoCadPrimitive } from '@spatial/contracts';

import { torontoAuthorityRequest } from './toronto-authority-transport';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function record(v: unknown): Record<string, any> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid CAD object'); return v as Record<string, any>; }
function token(v: unknown): string { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v)) throw new Error('Invalid CAD identifier'); return v; }
function bind(v: Record<string, any>) {
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !/^[a-f0-9]{64}$/.test(v.artifactRevision) || v.datasetId !== 'toronto3d' || v.frameId !== 'toronto3d-local-v1' || v.units !== 'm') throw new Error('Invalid CAD binding');
  return { sessionId: token(v.sessionId), revision: v.revision, artifactRevision: v.artifactRevision, datasetId: 'toronto3d' as const, frameId: 'toronto3d-local-v1' as const, units: 'm' as const };
}
function body(value: unknown, sessionId: string): TorontoCadBody {
  const v = record(value), op = canonicalCadOperation(v.operation), mesh = record(v.mesh), validation = record(v.validation);
  if (op.kind !== 'box' && op.kind !== 'cylinder') throw new Error('Unsupported Toronto primitive');
  const bodyId = token(v.bodyId);
  if (mesh.body?.bodyId !== bodyId || mesh.body.bodyRevision !== 1 || mesh.units !== 'm' || validation.body?.bodyId !== bodyId || validation.body.bodyRevision !== 1 || validation.units !== 'm' || validation.source?.sessionId !== sessionId || validation.source?.frameId !== 'toronto3d-local-v1' || validation.valid !== true || validation.topology?.solids !== 1 || validation.kernel?.name !== 'OpenCascade' || !Number.isFinite(validation.volume) || validation.volume <= 0) throw new Error('Invalid native body result');
  const vector = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every(n => typeof n === 'number' && Number.isFinite(n));
  if (!vector(validation.bounds?.min) || !vector(validation.bounds?.max)) throw new Error('Invalid measured bounds');
  if (!Array.isArray(mesh.vertices) || !mesh.vertices.length || mesh.vertices.length % 3 || mesh.vertices.length > CAD_LIMITS.maxMeshVertices * 3 || !mesh.vertices.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) || !Array.isArray(mesh.normals) || mesh.normals.length !== mesh.vertices.length || !mesh.normals.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) || !Array.isArray(mesh.triangles) || !mesh.triangles.length || mesh.triangles.length % 3 || mesh.triangles.length > CAD_LIMITS.maxMeshTriangles * 3 || !mesh.triangles.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < mesh.vertices.length / 3)) throw new Error('Invalid native tessellation');
  return structuredClone({ bodyId, operation: op, validation, mesh }) as TorontoCadBody;
}
export function validateTorontoCadSnapshot(value: unknown, artifactRevision: string): TorontoCadSnapshot {
  const v = record(value), b = bind(v);
  if (b.artifactRevision !== artifactRevision || !Array.isArray(v.bodies) || !Array.isArray(v.proposals) || v.bodies.length + v.proposals.length > CAD_LIMITS.maxBodies) throw new Error('CAD artifact or resource mismatch');
  const bodies = v.bodies.map((x: unknown) => body(x, b.sessionId));
  const proposals = v.proposals.map((x: unknown) => { const p = record(x), binding = bind(p); if (!same(binding, b)) throw new Error('Stale retained CAD candidate'); return { ...body(p, b.sessionId), ...binding, proposalId: token(p.proposalId) }; });
  if (new Set([...bodies, ...proposals].map(x => x.bodyId)).size !== bodies.length + proposals.length || new Set(proposals.map(p => p.proposalId)).size !== proposals.length) throw new Error('Duplicate CAD handles');
  return { ...b, bodies, proposals, nextUndoTransactionId: v.nextUndoTransactionId === null ? null : token(v.nextUndoTransactionId) };
}
export type TorontoCadAction = 'refresh' | 'propose' | 'approve' | 'decline' | 'undo';
export type TorontoCadTransport = (action: TorontoCadAction, body: unknown, signal: AbortSignal) => Promise<unknown>;
export const torontoCadTransport: TorontoCadTransport = (action, body, signal) => torontoAuthorityRequest({
  endpoint: '/datasets/toronto3d/cad', maxResponseLength: 16_000_000,
  responseName: 'CAD', errorPrefix: 'CAD ',
}, action, body, signal);
export interface TorontoCadView { snapshot?: TorontoCadSnapshot; busy: boolean; needsRefresh: boolean; status: string }
export class TorontoCadController {
  private state: TorontoCadView = { busy: false, needsRefresh: true, status: 'Refresh Toronto CAD authority.' };
  private artifact?: string; private alive = true; private generation = 0; private active?: AbortController;
  constructor(private publish: (view: TorontoCadView) => void, private transport: TorontoCadTransport = torontoCadTransport) {}
  private emit(update: Partial<TorontoCadView>) { this.state = { ...this.state, ...update }; if (this.alive) this.publish(this.state); }
  bind(artifact?: string) { if (this.artifact === artifact) return; this.artifact = artifact; this.generation++; this.active?.abort(); this.emit({ snapshot: undefined, busy: false, needsRefresh: true, status: 'Artifact changed. Refresh CAD authority.' }); }
  private async run(action: TorontoCadAction, value?: TorontoCadPrimitive | string) {
    if (!this.alive || !this.artifact || this.state.busy || (action !== 'refresh' && this.state.needsRefresh)) return;
    const before = this.state.snapshot, ticket = ++this.generation, abort = new AbortController(); this.active = abort;
    const timer = setTimeout(() => abort.abort(), 30_000);
    const binding = before && { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision };
    const request = action === 'refresh' ? undefined : { ...binding, ...(action === 'propose' ? { operation: value } : action === 'undo' ? { transactionId: value } : { proposalId: value }) };
    this.emit({ busy: true, status: `${action} pending…` });
    try {
      const reply = await this.transport(action, request, abort.signal);
      if (!this.alive || ticket !== this.generation) return;
      if (action === 'propose') {
        const p = record(reply), b = bind(p);
        if (!before || !same(b, bind(before)) || !same(p.operation, value)) throw new Error('CAD proposal reply mismatch');
        const proposal = { ...body(p, b.sessionId), ...b, proposalId: token(p.proposalId) } as TorontoCadProposal;
        if (before.proposals.some(x => x.proposalId === proposal.proposalId || x.bodyId === proposal.bodyId)) throw new Error('Duplicate CAD proposal');
        this.emit({ snapshot: { ...before, proposals: [...before.proposals, proposal] }, status: 'Native solid validated and tessellated. Ghost only — Accept or Decline each change.' });
      } else {
        const next = validateTorontoCadSnapshot(reply, this.artifact);
        if (action !== 'refresh') {
          if (!before || next.sessionId !== before.sessionId || next.revision !== before.revision + (action === 'decline' ? 0 : 1)) throw new Error('CAD mutation reply mismatch');
          if (action === 'decline' && (!same(next.bodies, before.bodies) || !same(next.proposals, before.proposals.filter(p => p.proposalId !== value)))) throw new Error('Decline changed unrelated CAD');
          if (action === 'approve') {
            const proposal = before.proposals.find(p => p.proposalId === value); if (!proposal) throw new Error('Unknown reviewed candidate');
            const { proposalId: _id, sessionId: _s, revision: _r, artifactRevision: _a, datasetId: _d, frameId: _f, units: _u, ...candidate } = proposal;
            if (!same(next.bodies, [...before.bodies, candidate]) || next.proposals.length) throw new Error('CAD publication differs from exact reviewed candidate');
          }
          if (action === 'undo' && (!same(next.bodies, before.bodies.slice(0, -1)) || next.proposals.length)) throw new Error('CAD Undo differs from latest-first removal');
        }
        this.emit({ snapshot: next, needsRefresh: false, status: action === 'refresh' ? 'Volatile native CAD authority refreshed.' : `${action} complete · revision ${next.revision}.` });
      }
    } catch (error) { if (this.alive && ticket === this.generation) this.emit({ snapshot: undefined, needsRefresh: true, status: `${String(error)}. Refresh required; no automatic mutation retry.` }); }
    finally { clearTimeout(timer); if (this.alive && ticket === this.generation) { this.active = undefined; this.emit({ busy: false }); } }
  }
  refresh() { return this.run('refresh'); }
  propose(operation: TorontoCadPrimitive) { try { const op = canonicalCadOperation(operation); if (op.kind === 'box' || op.kind === 'cylinder') return this.run('propose', op); } catch (error) { this.emit({ status: String(error) }); } }
  approve(id: string) { if (this.state.snapshot?.proposals.some(p => p.proposalId === id)) return this.run('approve', id); }
  decline(id: string) { if (this.state.snapshot?.proposals.some(p => p.proposalId === id)) return this.run('decline', id); }
  undo() { const id = this.state.snapshot?.nextUndoTransactionId; if (id) return this.run('undo', id); }
  dispose() { this.alive = false; this.generation++; this.active?.abort(); }
}
