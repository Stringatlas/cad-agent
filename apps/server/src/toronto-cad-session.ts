import { randomUUID } from 'node:crypto';
import { canonicalCadOperation, CadError, TORONTO_CAD_LIMITS, type TorontoCadErrorCode, type TorontoCadBody, type TorontoCadPrimitive, type TorontoCadProposal, type TorontoCadSnapshot, type CadBodyResult, type TorontoCadMesh } from '@spatial/contracts';
import { CadWorkerClient } from './cad-client';
import { SemanticArtifact, SemanticFailure } from './semantic-artifact';

export class TorontoCadError extends Error { constructor(readonly code: TorontoCadErrorCode) { super(code); } }
const copy = <T>(value: T): T => structuredClone(value);
/** Volatile Toronto authority. The retained native body, never a regenerated mesh, is published. */
export class TorontoCadSession {
  private readonly sessionId = randomUUID();
  private revision = 0;
  private artifact?: SemanticArtifact;
  private readonly kernel = new CadWorkerClient({ sessionId: this.sessionId, projectRevision: 0, frameId: 'toronto3d-local-v1' });
  private bodies = new Map<string, TorontoCadBody>();
  private proposals = new Map<string, TorontoCadProposal>();
  /** Trusted retained application preconditions; never supplied through HTTP/model arguments. */
  private approvalChecks = new Map<string, (signal?: AbortSignal) => Promise<void>>();
  private history: { transactionId: string; bodyId: string }[] = [];
  private active = false;
  private closed = false;
  private invalid = false;
  constructor(private readonly directory: string) {}
  private ready(signal?: AbortSignal) { signal?.throwIfAborted(); if (this.closed || this.invalid) throw new TorontoCadError('unavailable'); }
  private binding() { return { sessionId: this.sessionId, revision: this.revision, artifactRevision: this.artifact!.dataset.revision, datasetId: 'toronto3d' as const, frameId: 'toronto3d-local-v1' as const, units: 'm' as const }; }
  private snapshot(): TorontoCadSnapshot { return copy({ ...this.binding(), bodies: [...this.bodies.values()], proposals: [...this.proposals.values()], nextUndoTransactionId: this.history.at(-1)?.transactionId ?? null }); }
  private request(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TorontoCadError('invalid-request');
    const v = value as Record<string, unknown>;
    const keys = ['sessionId', 'revision', 'artifactRevision', field];
    if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new TorontoCadError('invalid-request');
    if (typeof v.sessionId !== 'string' || !Number.isSafeInteger(v.revision) || typeof v.artifactRevision !== 'string') throw new TorontoCadError('invalid-request');
    if (v.sessionId !== this.sessionId) throw new TorontoCadError('stale-session');
    if (v.revision !== this.revision) throw new TorontoCadError('stale-revision');
    if (v.artifactRevision !== this.artifact!.dataset.revision) throw new TorontoCadError('stale-artifact');
    if (field !== 'operation' && (typeof v[field] !== 'string' || (v[field] as string).length > 100)) throw new TorontoCadError('invalid-request');
    return v;
  }
  private postconditions(operation: TorontoCadPrimitive, measured: CadBodyResult) {
    const half = operation.kind === 'box' ? operation.dimensions.map(n => n / 2) : [operation.radius, operation.radius, operation.height / 2];
    const volume = operation.kind === 'box' ? operation.dimensions.reduce((a, b) => a * b, 1) : Math.PI * operation.radius ** 2 * operation.height;
    const near = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-10);
    if (!measured.valid || measured.units !== 'm' || measured.topology.solids !== 1 || measured.volume <= 0 || !Number.isFinite(measured.volume) || Math.abs(measured.volume - volume) > Math.max(1e-15, volume * 1e-8) ||
      operation.center.some((n, i) => !near(measured.bounds.min[i]!, n - half[i]!) || !near(measured.bounds.max[i]!, n + half[i]!))) {
      this.invalid = true; throw new TorontoCadError('unavailable');
    }
  }
  private async live(signal?: AbortSignal) {
    // Inspect both accepted and pending handles: a worker reset must not leave mesh-only claims.
    for (const body of [...this.bodies.values(), ...this.proposals.values()]) {
      const measured = await this.kernel.execute({ kind: 'inspect', body: body.validation.body }, signal) as CadBodyResult;
      this.postconditions(body.operation, measured);
    }
  }
  private async discard(proposals: Iterable<TorontoCadProposal>, signal?: AbortSignal) {
    for (const proposal of proposals) await this.kernel.execute({ kind: 'delete', body: proposal.validation.body }, signal);
  }
  async execute(operation: 'snapshot' | 'propose' | 'approve' | 'decline' | 'undo', value?: unknown, signal?: AbortSignal, approvalCheck?: (signal?: AbortSignal) => Promise<void>): Promise<TorontoCadSnapshot | TorontoCadProposal> {
    if (this.active) throw new TorontoCadError('busy');
    this.ready(signal); this.active = true;
    let candidate: CadBodyResult | undefined;
    try {
      this.artifact ??= await SemanticArtifact.open(this.directory, signal);
      await this.artifact.check(signal); await this.live(signal); await this.artifact.check(signal); this.ready(signal);
      if (operation === 'snapshot') return this.snapshot();
      const field = operation === 'propose' ? 'operation' : operation === 'undo' ? 'transactionId' : 'proposalId';
      const request = this.request(value, field);
      if (this.revision >= Number.MAX_SAFE_INTEGER) throw new TorontoCadError('resource-limit');
      if (operation === 'propose') {
        if (this.proposals.size >= TORONTO_CAD_LIMITS.proposals || this.bodies.size >= TORONTO_CAD_LIMITS.bodies) throw new TorontoCadError('resource-limit');
        const primitive = canonicalCadOperation(request.operation);
        if (primitive.kind !== 'box' && primitive.kind !== 'cylinder') throw new TorontoCadError('invalid-request');
        candidate = await this.kernel.execute(primitive, signal) as CadBodyResult;
        this.postconditions(primitive, candidate);
        const mesh = await this.kernel.execute({ kind: 'tessellate', body: candidate.body }, signal) as TorontoCadMesh;
        await this.artifact.check(signal); this.ready(signal);
        const proposal: TorontoCadProposal = { ...this.binding(), proposalId: randomUUID(), bodyId: candidate.body.bodyId, operation: primitive, validation: candidate, mesh };
        this.proposals.set(proposal.proposalId, copy(proposal));
        if (approvalCheck) this.approvalChecks.set(proposal.proposalId, approvalCheck);
        candidate = undefined;
        return copy(proposal);
      }
      if (operation === 'undo') {
        const held = this.history.at(-1);
        if (!held || held.transactionId !== request.transactionId) throw new TorontoCadError('nothing-to-undo');
        const body = this.bodies.get(held.bodyId)!;
        await this.artifact.check(signal); this.ready(signal);
        await this.discard(this.proposals.values(), signal);
        await this.kernel.execute({ kind: 'delete', body: body.validation.body }, signal);
        await this.artifact.check(signal); this.ready(signal);
        this.bodies.delete(held.bodyId); this.history.pop(); this.proposals.clear(); this.approvalChecks.clear(); this.revision++;
      } else {
        const held = this.proposals.get(request.proposalId as string);
        if (!held) throw new TorontoCadError('unknown-proposal');
        if (operation === 'decline') {
          await this.discard([held], signal); await this.artifact.check(signal); this.ready(signal); this.proposals.delete(held.proposalId); this.approvalChecks.delete(held.proposalId);
        } else {
          if (this.bodies.size >= TORONTO_CAD_LIMITS.bodies) throw new TorontoCadError('resource-limit');
          await this.approvalChecks.get(held.proposalId)?.(signal);
          const others = [...this.proposals.values()].filter(p => p.proposalId !== held.proposalId);
          await this.discard(others, signal);
          // A later application-precondition rejection must not leave deleted native handles in the pending registry.
          for (const other of others) { this.proposals.delete(other.proposalId); this.approvalChecks.delete(other.proposalId); }
          await this.artifact.check(signal);
          // Last await before synchronous publication: a point edit during earlier native work cannot slip through.
          await this.approvalChecks.get(held.proposalId)?.(signal); this.ready(signal);
          const { proposalId: _id, sessionId: _s, revision: _r, artifactRevision: _a, datasetId: _d, frameId: _f, units: _u, ...body } = held;
          this.bodies.set(held.bodyId, body); this.history.push({ transactionId: randomUUID(), bodyId: held.bodyId }); this.proposals.clear(); this.approvalChecks.clear(); this.revision++;
        }
      }
      return this.snapshot();
    } catch (error) {
      if (candidate) { try { await this.kernel.execute({ kind: 'delete', body: candidate.body }); } catch { this.invalid = true; } }
      if (error instanceof TorontoCadError) throw error;
      if (error instanceof SemanticFailure) { this.invalid = true; throw new TorontoCadError(error.code === 'stale-revision' ? 'stale-artifact' : 'unavailable'); }
      if (error instanceof CadError && ['invalid-request', 'resource-limit', 'busy'].includes(error.code)) throw new TorontoCadError(error.code as TorontoCadErrorCode);
      this.invalid = true; throw new TorontoCadError('unavailable');
    } finally { this.active = false; if (this.closed) { await this.artifact?.close(); this.artifact = undefined; } }
  }
  async close() { this.closed = true; await this.kernel.close(); if (!this.active) { await this.artifact?.close(); this.artifact = undefined; } }
}
