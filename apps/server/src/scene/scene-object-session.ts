import { randomUUID } from 'node:crypto';
import type { Vec3, PointOverrideSnapshot } from '@spatial/contracts';
import { SCENE_OBJECT_LIMITS, canonicalDatumPoint, canonicalSceneObjectProposalRequest, canonicalSceneObjectApprovalRequest, canonicalSceneObjectUndoRequest, type SceneObjectBinding, type SceneObjectSnapshot, type SceneObjectProposal, type SceneObjectReference, type SceneObjectErrorCode, type DatumPoint, type SourceRecordReference } from '../../../../packages/contracts/src/scene-objects';
import { SemanticArtifact, SemanticFailure } from '../spatial/semantic-artifact';
import { getSemanticDiskIndex } from '../spatial/semantic-disk-index';
import { PointOverrideSession, PointOverrideError } from './point-overrides';

export class SceneObjectError extends Error { constructor(readonly code: SceneObjectErrorCode) { super(code); } }
const copy = <T>(value: T): T => structuredClone(value);
const same = (a: Vec3, b: Vec3) => a.every((n, i) => n === b[i]);
/** Bounded volatile datum authority. References are creation evidence, not live dependencies. */
export class SceneObjectSession {
  private readonly sessionId = randomUUID();
  private revision = 0;
  private artifact?: SemanticArtifact;
  private objects = new Map<string, DatumPoint>();
  private proposals = new Map<string, SceneObjectProposal>();
  private references = new Map<string, { reference: SceneObjectReference; position: Vec3 }>();
  private history: { transactionId: string; objectId: string }[] = [];
  private decisions = new Map<string, 'accepted' | 'declined'>();
  private active = false;
  private closed = false;
  private invalid = false;
  constructor(private readonly directory: string, private readonly points: PointOverrideSession) {}
  proposalDecision(id: string): 'accepted' | 'declined' | undefined { return this.decisions.get(id); }
  private recordDecision(id: string, decision: 'accepted' | 'declined') { this.decisions.set(id, decision); if (this.decisions.size > SCENE_OBJECT_LIMITS.receipts) this.decisions.delete(this.decisions.keys().next().value!); }
  private ready(signal?: AbortSignal) { signal?.throwIfAborted(); if (this.closed || this.invalid) throw new SceneObjectError('unavailable'); }
  private binding(): SceneObjectBinding { return { sessionId: this.sessionId, revision: this.revision, artifactRevision: this.artifact!.dataset.revision, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm' }; }
  private snapshot(): SceneObjectSnapshot { return copy({ ...this.binding(), schemaVersion: 1, objects: [...this.objects.values()], proposals: [...this.proposals.values()], nextUndoTransactionId: this.history.at(-1)?.transactionId ?? null }); }
  private checkBinding(request: { sessionId: string; revision: number; artifactRevision: string }) {
    if (request.sessionId !== this.sessionId) throw new SceneObjectError('stale-session');
    if (request.revision !== this.revision) throw new SceneObjectError('stale-revision');
    if (request.artifactRevision !== this.artifact!.dataset.revision) throw new SceneObjectError('stale-artifact');
  }
  private async overrides(reference: SourceRecordReference, signal?: AbortSignal): Promise<PointOverrideSnapshot> {
    const snapshot = await this.points.execute('snapshot', undefined, signal) as PointOverrideSnapshot;
    if (snapshot.sessionId !== reference.overrideSessionId || snapshot.revision !== reference.overrideRevision || snapshot.artifactRevision !== reference.artifactRevision || snapshot.frameId !== reference.frameId || snapshot.units !== reference.units) throw new SceneObjectError('stale-reference');
    return snapshot;
  }
  /** Resolve physical address through checked index, then reread provenance and original coordinates. */
  private async source(reference: SourceRecordReference, signal?: AbortSignal): Promise<Vec3> {
    const artifact = this.artifact!;
    if (reference.artifactRevision !== artifact.dataset.revision) throw new SceneObjectError('stale-artifact');
    const { index } = await getSemanticDiskIndex(artifact, signal);
    const physical = await index.resolvePhysical(reference.key, signal);
    const metadata = JSON.parse(artifact.metadataBytes.toString());
    const offsets = new Map<string, number>(); let stride = 0;
    for (const field of metadata.attributes) { offsets.set(field.name, stride); stride += field.size; }
    if (stride !== artifact.layout.stride || !Number.isSafeInteger(physical) || physical < 0 || physical >= artifact.dataset.totalPoints) throw new SceneObjectError('unavailable');
    const bytes = await artifact.read('payload', physical * stride, stride, signal);
    if (bytes.readUInt16LE(offsets.get('point source id')!) !== reference.key.sourceFileId || bytes.readUInt32LE(offsets.get('source_row')!) !== reference.key.sourceRow) throw new SceneObjectError('unknown-point');
    const start = offsets.get('position')!;
    const original = [0, 1, 2].map(axis => bytes.readInt32LE(start + axis * 4) * metadata.scale[axis] + metadata.offset[axis]) as unknown as Vec3;
    if (!original.every(Number.isFinite)) throw new SceneObjectError('unavailable');
    await index.check(signal);
    const snapshot = await this.overrides(reference, signal);
    const entry = snapshot.entries.find(e => e.key.sourceFileId === reference.key.sourceFileId && e.key.sourceRow === reference.key.sourceRow);
    if (entry && !same(entry.originalPosition, original)) throw new SceneObjectError('stale-artifact');
    return reference.domain === 'effective' ? entry?.position ?? original : original;
  }
  private async resolve(reference: SceneObjectReference, signal?: AbortSignal): Promise<Vec3> {
    if (reference.kind === 'source-record') return this.source(reference, signal);
    if (reference.sessionId !== this.sessionId || reference.revision !== this.revision) throw new SceneObjectError('stale-reference');
    const object = this.objects.get(reference.objectId);
    if (!object) throw new SceneObjectError('unknown-object');
    if (object.objectRevision !== reference.objectRevision) throw new SceneObjectError('stale-reference');
    return object.position;
  }
  async execute(operation: 'snapshot' | 'propose' | 'approve' | 'decline' | 'undo', value?: unknown, signal?: AbortSignal): Promise<SceneObjectSnapshot | SceneObjectProposal> {
    if (this.active) throw new SceneObjectError('busy');
    this.ready(signal); this.active = true;
    let approvingId: string | undefined;
    try {
      this.artifact ??= await SemanticArtifact.open(this.directory, signal);
      await this.artifact.check(signal); this.ready(signal);
      if (operation === 'snapshot') return this.snapshot();
      if (operation === 'propose') {
        const request = canonicalSceneObjectProposalRequest(value); this.checkBinding(request);
        if (this.proposals.size >= SCENE_OBJECT_LIMITS.proposals || this.objects.size >= SCENE_OBJECT_LIMITS.objects || this.revision >= Number.MAX_SAFE_INTEGER) throw new SceneObjectError('resource-limit');
        const base = request.input.kind === 'reference' ? await this.resolve(request.input.reference, signal) : request.input.position;
        // Keep arithmetic and exact retained absolute position separate from reference metadata.
        const offset = request.input.kind === 'reference' ? request.input.offset : undefined;
        const absolute = offset ? base.map((n, i) => n + offset[i]!) as unknown as Vec3 : base;
        const object = canonicalDatumPoint({ id: randomUUID(), name: request.name, kind: 'datum-point', parentId: null, frameId: request.frameId, units: request.units, objectRevision: 1, position: absolute });
        await this.artifact.check(signal);
        if (request.input.kind === 'reference' && request.input.reference.kind === 'source-record') await this.overrides(request.input.reference, signal);
        this.ready(signal);
        const proposal: SceneObjectProposal = { ...this.binding(), schemaVersion: 1, proposalId: randomUUID(), object };
        this.proposals.set(proposal.proposalId, copy(proposal));
        if (request.input.kind === 'reference') this.references.set(proposal.proposalId, { reference: copy(request.input.reference), position: copy(base) });
        return copy(proposal);
      }
      const request = operation === 'undo' ? canonicalSceneObjectUndoRequest(value) : canonicalSceneObjectApprovalRequest(value);
      this.checkBinding(request);
      if (operation === 'undo') {
        const latest = this.history.at(-1);
        if (!latest || latest.transactionId !== (request as ReturnType<typeof canonicalSceneObjectUndoRequest>).transactionId) throw new SceneObjectError('nothing-to-undo');
        if (this.revision >= Number.MAX_SAFE_INTEGER) throw new SceneObjectError('resource-limit');
        this.ready(signal); this.objects.delete(latest.objectId); this.history.pop(); this.revision++; this.proposals.clear(); this.references.clear();
      } else {
        const proposalId = (request as ReturnType<typeof canonicalSceneObjectApprovalRequest>).proposalId;
        const held = this.proposals.get(proposalId);
        if (!held) throw new SceneObjectError('unknown-proposal');
        if (operation === 'decline') { this.proposals.delete(proposalId); this.references.delete(proposalId); this.recordDecision(proposalId, 'declined'); }
        else {
          if (this.objects.size >= SCENE_OBJECT_LIMITS.objects || this.history.length >= SCENE_OBJECT_LIMITS.transactions || this.revision >= Number.MAX_SAFE_INTEGER) throw new SceneObjectError('resource-limit');
          approvingId = proposalId;
          const evidence = this.references.get(proposalId);
          if (evidence && !same(await this.resolve(evidence.reference, signal), evidence.position)) throw new SceneObjectError('stale-reference');
          await this.artifact.check(signal);
          // Final asynchronous precondition: no override mutation can slip between this observation and synchronous publication.
          if (evidence?.reference.kind === 'source-record') await this.overrides(evidence.reference, signal);
          this.ready(signal); this.objects.set(held.object.id, copy(held.object)); this.history.push({ transactionId: randomUUID(), objectId: held.object.id });
          this.revision++; this.proposals.clear(); this.references.clear(); this.recordDecision(proposalId, 'accepted');
        }
      }
      return this.snapshot();
    } catch (error) {
      if (error instanceof SceneObjectError) {
        if (approvingId && ['stale-reference', 'unknown-object', 'unknown-point'].includes(error.code)) {
          this.proposals.delete(approvingId); this.references.delete(approvingId);
        }
        throw error;
      }
      if (error instanceof SemanticFailure) { if (error.code === 'stale-revision') this.invalid = true; throw new SceneObjectError(error.code === 'stale-revision' ? 'stale-artifact' : error.code === 'unknown-point' ? 'unknown-point' : 'unavailable'); }
      if (error instanceof PointOverrideError) throw new SceneObjectError(error.code === 'busy' ? 'busy' : error.code === 'stale-artifact' ? 'stale-artifact' : 'unavailable');
      if (error instanceof TypeError) throw new SceneObjectError('invalid-request');
      throw new SceneObjectError('unavailable');
    } finally { this.active = false; if (this.closed) { await this.artifact?.close(); this.artifact = undefined; } }
  }
  async close() { this.closed = true; this.decisions.clear(); if (!this.active) { await this.artifact?.close(); this.artifact = undefined; } }
}
