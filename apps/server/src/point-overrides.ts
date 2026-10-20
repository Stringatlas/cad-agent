import { randomUUID } from 'node:crypto';
import { POINT_OVERRIDE_LIMITS, canonicalPointMoveProposalRequest, canonicalPointMoveApprovalRequest, canonicalPointMoveUndoRequest,
  assertVec3, type PointOverrideSnapshot, type PointMoveProposal, type PointOverrideEntry, type PointOverrideErrorCode, type PointKey, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact, SemanticFailure } from './semantic-artifact';
import { getSemanticDiskIndex } from './semantic-disk-index';

export class PointOverrideError extends Error {
  constructor(readonly code: PointOverrideErrorCode) { super(code); }
}
const id = (key: PointKey) => `${key.sourceFileId}:${key.sourceRow}`;
const same = (a: Vec3, b: Vec3) => a.every((n, axis) => n === b[axis]);
const detached = <T>(value: T): T => structuredClone(value);

/** Separate volatile authority; never writes prepared data or changes semantic queries. */
export class PointOverrideSession {
  private readonly sessionId = randomUUID();
  private revision = 0;
  private entries = new Map<string, PointOverrideEntry>();
  private proposals = new Map<string, PointMoveProposal>();
  private history: { transactionId: string; moves: PointMoveProposal['moves'] }[] = [];
  private artifact?: SemanticArtifact;
  private active = false;
  private closed = false;
  private readonly decisions = new Map<string, 'accepted' | 'declined'>();
  /** Observational receipts only; pending/invalidation never imply a decision. */
  proposalDecision(id: string): 'accepted' | 'declined' | undefined { return this.decisions.get(id); }
  private recordDecision(id: string, decision: 'accepted' | 'declined'): void {
    this.decisions.set(id, decision);
    if (this.decisions.size > 256) this.decisions.delete(this.decisions.keys().next().value!);
  }
  constructor(private readonly directory: string) {}

  /** Composition-only synchronous barrier, after async source validation; performs no I/O. */
  assertOriginalBinding(expected: { sessionId: string; revision: number; artifactRevision: string }, rejectPending = false): void {
    this.ready();
    if (!this.artifact) throw new PointOverrideError('unavailable');
    if (this.active) throw new PointOverrideError('busy');
    if (rejectPending && this.proposals.size) throw new PointOverrideError('stale-revision');
    this.binding(expected);
    if (this.entries.size) throw new PointOverrideError('stale-revision');
    if (this.artifact.dataset.revision !== expected.artifactRevision) throw new PointOverrideError('stale-artifact');
  }
  private binding(value: { sessionId: string; revision: number }) {
    if (value.sessionId !== this.sessionId) throw new PointOverrideError('stale-session');
    if (value.revision !== this.revision) throw new PointOverrideError('stale-revision');
  }
  private snapshot(artifact: SemanticArtifact): PointOverrideSnapshot {
    return detached({ sessionId: this.sessionId, revision: this.revision, artifactRevision: artifact.dataset.revision,
      datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', entries: [...this.entries.values()],
      nextUndoTransactionId: this.history.at(-1)?.transactionId ?? null });
  }
  /** Disk index resolves physical offset only. Read and decode the ORIGINAL record
   * independently, checking provenance rather than trusting cached positions. */
  private async original(artifact: SemanticArtifact, key: PointKey, signal?: AbortSignal): Promise<Vec3> {
    const { index } = await getSemanticDiskIndex(artifact, signal);
    const physical = await index.resolvePhysical(key, signal);
    const metadata = JSON.parse(artifact.metadataBytes.toString());
    const offsets = new Map<string, number>(); let stride = 0;
    for (const field of metadata.attributes) { offsets.set(field.name, stride); stride += field.size; }
    if (stride !== artifact.layout.stride || !Number.isSafeInteger(physical) || physical < 0 || physical >= artifact.dataset.totalPoints) throw new PointOverrideError('unavailable');
    const bytes = await artifact.read('payload', physical * stride, stride, signal);
    if (bytes.readUInt16LE(offsets.get('point source id')!) !== key.sourceFileId || bytes.readUInt32LE(offsets.get('source_row')!) !== key.sourceRow) throw new PointOverrideError('unknown-point');
    const start = offsets.get('position')!;
    const position = [0, 1, 2].map(axis => bytes.readInt32LE(start + axis * 4) * metadata.scale[axis] + metadata.offset[axis]) as unknown as Vec3;
    if (!position.every(Number.isFinite)) throw new PointOverrideError('unavailable');
    await index.check(signal);
    return position;
  }
  /** Admission protects all await-to-publication intervals, including direct callers. */
  async execute(operation: 'snapshot' | 'pending' | 'propose' | 'approve' | 'decline' | 'undo', value?: unknown, signal?: AbortSignal, verifiedDestination?: Vec3): Promise<PointOverrideSnapshot | PointMoveProposal | PointMoveProposal[]> {
    if (this.active) throw new PointOverrideError('busy');
    if (this.closed) throw new PointOverrideError('unavailable');
    this.active = true;
    try {
      this.artifact ??= await SemanticArtifact.open(this.directory, signal);
      const artifact = this.artifact; await artifact.check(signal);
      if (operation === 'snapshot') return this.snapshot(artifact);
      if (operation === 'pending') return detached([...this.proposals.values()]);
      if (operation === 'decline') {
        const request = canonicalPointMoveApprovalRequest(value); this.binding(request);
        if (!this.proposals.has(request.proposalId)) throw new PointOverrideError('unknown-proposal');
        this.ready(signal); this.proposals.delete(request.proposalId);
        this.recordDecision(request.proposalId, 'declined'); return this.snapshot(artifact);
      }
      if (this.revision >= Number.MAX_SAFE_INTEGER) throw new PointOverrideError('resource-limit');
      if (operation === 'propose') {
        const request = canonicalPointMoveProposalRequest(value); this.binding(request);
        // Trusted composition-only argument; HTTP/model arguments cannot set this.
        // Avoid floating-point reconstruction of an independently verified destination.
        if (verifiedDestination) { assertVec3(verifiedDestination); if (request.points.length !== 1) throw new PointOverrideError('invalid-request'); }
        if (request.artifactRevision !== artifact.dataset.revision) throw new PointOverrideError('stale-artifact');
        if (this.proposals.size >= POINT_OVERRIDE_LIMITS.proposals) throw new PointOverrideError('resource-limit');
        const moves: PointMoveProposal['moves'][number][] = [];
        for (const point of request.points) {
          const originalPosition = await this.original(artifact, point.key, signal);
          const existing = this.entries.get(id(point.key));
          if (existing && !same(existing.originalPosition, originalPosition)) throw new PointOverrideError('stale-artifact');
          const before = existing?.position ?? originalPosition;
          if (!same(point.position, before)) throw new PointOverrideError('position-mismatch');
          const after = verifiedDestination ? [...verifiedDestination] as unknown as Vec3 : before.map((n, axis) => n + request.translation[axis]) as unknown as Vec3;
          if (!after.every(Number.isFinite) || same(before, after)) throw new PointOverrideError('invalid-request');
          moves.push({ key: point.key, originalPosition, before, after });
        }
        await artifact.check(signal); this.ready(signal);
        const proposal: PointMoveProposal = { sessionId: this.sessionId, revision: this.revision, artifactRevision: artifact.dataset.revision,
          datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', proposalId: randomUUID(), moves };
        this.proposals.set(proposal.proposalId, detached(proposal)); return detached(proposal);
      }
      const request = operation === 'approve' ? canonicalPointMoveApprovalRequest(value) : canonicalPointMoveUndoRequest(value);
      this.binding(request);
      const held = operation === 'approve' ? this.proposals.get((request as ReturnType<typeof canonicalPointMoveApprovalRequest>).proposalId) : this.history.at(-1);
      if (!held) throw new PointOverrideError(operation === 'approve' ? 'unknown-proposal' : 'nothing-to-undo');
      if (operation === 'undo' && ('transactionId' in held && held.transactionId !== (request as ReturnType<typeof canonicalPointMoveUndoRequest>).transactionId)) throw new PointOverrideError('nothing-to-undo');
      if (operation === 'approve' && this.history.length >= POINT_OVERRIDE_LIMITS.transactions) throw new PointOverrideError('resource-limit');
      const next = new Map(this.entries);
      for (const move of held.moves) {
        const original = await this.original(artifact, move.key, signal);
        if (!same(original, move.originalPosition)) throw new PointOverrideError('stale-artifact');
        const before = operation === 'approve' ? move.before : move.after;
        if (!same(next.get(id(move.key))?.position ?? original, before)) throw new PointOverrideError('position-mismatch');
        const position = operation === 'approve' ? move.after : move.before;
        if (same(position, original)) next.delete(id(move.key));
        else next.set(id(move.key), { key: move.key, originalPosition: original, position });
      }
      if (next.size > POINT_OVERRIDE_LIMITS.entries) throw new PointOverrideError('resource-limit');
      // Approval may preserve unrelated pending edits, never rebase their geometry.
      // Re-read originals and compare exact effective before positions before any write.
      const remaining = new Map<string, PointMoveProposal>();
      if (operation === 'approve') {
        const changed = new Set(held.moves.map(move => id(move.key)));
        for (const proposal of this.proposals.values()) {
          if (proposal.proposalId === (request as ReturnType<typeof canonicalPointMoveApprovalRequest>).proposalId || proposal.moves.some(move => changed.has(id(move.key)))) continue;
          let valid = true;
          for (const move of proposal.moves) {
            const original = await this.original(artifact, move.key, signal);
            if (!same(original, move.originalPosition) || !same(next.get(id(move.key))?.position ?? original, move.before)) { valid = false; break; }
          }
          if (valid) remaining.set(proposal.proposalId, { ...proposal, revision: this.revision + 1 });
        }
      }
      await artifact.check(signal); this.ready(signal);
      this.entries = next; this.revision++; this.proposals = remaining;
      if (operation === 'approve') {
        this.history.push({ transactionId: randomUUID(), moves: detached(held.moves) });
        this.recordDecision((request as ReturnType<typeof canonicalPointMoveApprovalRequest>).proposalId, 'accepted');
      } else this.history.pop();
      return this.snapshot(artifact);
    } catch (error) {
      if (error instanceof PointOverrideError) throw error;
      if (error instanceof SemanticFailure) throw new PointOverrideError(error.code === 'stale-revision' ? 'stale-artifact' : error.code === 'unknown-point' ? 'unknown-point' : 'unavailable');
      if (error instanceof TypeError) throw new PointOverrideError('invalid-request');
      throw new PointOverrideError('unavailable');
    } finally {
      this.active = false;
      if (this.closed) { await this.artifact?.close(); this.artifact = undefined; }
    }
  }
  private ready(signal?: AbortSignal) { signal?.throwIfAborted(); if (this.closed) throw new PointOverrideError('unavailable'); }
  async close() { this.closed = true; this.decisions.clear(); if (!this.active) { await this.artifact?.close(); this.artifact = undefined; } }
}
