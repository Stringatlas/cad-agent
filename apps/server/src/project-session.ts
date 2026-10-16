import { randomUUID, createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createDemoProject, boxEditCandidate, undoBoxCandidate } from '@spatial/project-state';
import { PROJECT_FRAME_ID, PROJECT_LIMITS, canonicalPersistentProject, canonicalProtocolJson, freezeProtocolValue,
  canonicalProjectBinding, canonicalBoxProposalRequest, canonicalBoxApprovalRequest, canonicalProjectUndoRequest, canonicalSceneContextRequest,
  protocolRecord, protocolKeys, protocolHash, type ProjectBinding, type ProjectSnapshot, type ProjectState, type BoxProposal,
  type ProjectCommitResult, type ProjectErrorCode, type SceneContext } from '@spatial/contracts';

export const DEFAULT_PROJECT_PATH = join(homedir(), '.spatial-cad-harness', 'project.json');
const hash = (value: unknown) => createHash('sha256').update(canonicalProtocolJson(value)).digest('hex');
export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode, message: string) { super(message); }
}
interface Stored { readonly project: ProjectState; readonly digest: string }
interface Transaction { readonly id: string; readonly before: ProjectState; readonly after: ProjectState }
/** One trusted operator path, never derived from a request. No selections, camera, proposals or history persist. */
export class ProjectSession {
  private project: ProjectState;
  private sessionId = randomUUID();
  private diskDigest: string | null = null;
  private savedRevision: number | null = null;
  private proposals = new Map<string, BoxProposal>();
  private history: Transaction[] = [];
  constructor(readonly snapshotPath: string = DEFAULT_PROJECT_PATH) {
    const stored = this.readStored();
    this.project = freezeProtocolValue(stored?.project ?? canonicalPersistentProject(createDemoProject()));
    this.diskDigest = stored?.digest ?? null;
    this.savedRevision = stored?.project.revision ?? null;
  }
  snapshot(): ProjectSnapshot { return { sessionId: this.sessionId, frameId: PROJECT_FRAME_ID, project: this.project }; }
  binding(): ProjectBinding { return { sessionId: this.sessionId, projectRevision: this.project.revision, frameId: PROJECT_FRAME_ID, units: 'm' }; }
  info() { return { snapshot: this.snapshot(), nextUndoTransactionId: this.history.at(-1)?.id ?? null,
    persistence: 'explicit-save' as const, savedRevision: this.savedRevision, dirty: this.diskDigest !== hash(this.project), limits: PROJECT_LIMITS }; }
  check(binding: ProjectBinding): void {
    const current = this.binding();
    if (binding.sessionId !== current.sessionId || binding.projectRevision !== current.projectRevision || binding.frameId !== current.frameId || binding.units !== current.units)
      throw new ProjectError('stale-project', 'Project session, revision or frame is stale');
  }
  context(input: unknown): SceneContext {
    const call = canonicalSceneContextRequest(input); this.check(call);
    const entities = call.entityIds.map(id => {
      const entity = this.project.entities.find(e => e.id === id);
      if (!entity) throw new ProjectError('unknown-entity', 'Selected entity does not exist');
      return { id: entity.id, kind: entity.kind };
    });
    const points = call.points.map(point => {
      const entity = this.project.entities.find(e => e.id === point.entityId);
      if (entity?.kind !== 'point-cloud') throw new ProjectError('unknown-entity', 'Point selection requires a project point cloud');
      const original = entity.points[point.pointIndex];
      if (!original || original.some((v, i) => v !== point.position[i])) throw new ProjectError('invalid-point', 'Point index and exact original position do not match');
      return { ...point, position: original };
    });
    return freezeProtocolValue({ ...call, points, coordinates: this.project.coordinates, entities,
      coverage: 'explicit-project-selections', source: 'synthetic-project' });
  }
  propose(input: unknown): BoxProposal {
    const call = canonicalBoxProposalRequest(input); this.check(call);
    const existing = this.project.entities.find(e => e.id === call.edit.entityId);
    if (call.edit.kind === 'create-box' ? !!existing : existing?.kind !== 'box') throw new ProjectError('unknown-entity', 'Create requires a new ID; update requires an existing box');
    if (call.edit.kind === 'create-box' && this.project.entities.length >= PROJECT_LIMITS.maxEntities) throw new ProjectError('resource-limit', 'Project entity limit');
    const now = Date.now();
    for (const [id, proposal] of this.proposals) if (proposal.expiresAt <= now) this.proposals.delete(id);
    if (this.proposals.size >= PROJECT_LIMITS.maxProposals || this.history.length >= PROJECT_LIMITS.maxHistory) throw new ProjectError('resource-limit', 'Proposal or undo storage limit; load/restart clears edit history');
    const candidate = boxEditCandidate(this.project, call.edit);
    const after = candidate.entities.find(e => e.id === call.edit.entityId)!;
    if (after.kind !== 'box') throw new ProjectError('postcondition-failed', 'Expected box candidate');
    const exact = { ...call, proposalId: randomUUID(), expiresAt: now + PROJECT_LIMITS.proposalLifetimeMs,
      coordinates: this.project.coordinates, before: existing?.kind === 'box' ? existing : null, after,
      verification: 'parameter-postconditions-not-cad' as const };
    const proposal = freezeProtocolValue({ ...exact, digest: hash(exact) });
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }
  approve(input: unknown): ProjectCommitResult {
    const call = canonicalBoxApprovalRequest(input); this.check(call);
    const proposal = this.proposals.get(call.proposalId);
    if (!proposal) throw new ProjectError('unknown-proposal', 'Proposal is unknown or invalidated');
    if (proposal.expiresAt <= Date.now()) throw new ProjectError('expired-proposal', 'Proposal expired');
    if (call.digest !== proposal.digest) throw new ProjectError('approval-mismatch', 'Approval does not match the exact preview');
    this.check(proposal);
    if (this.history.length >= PROJECT_LIMITS.maxHistory) throw new ProjectError('resource-limit', 'Undo history limit');
    const before = this.project, candidate = boxEditCandidate(before, proposal.edit);
    if (canonicalProtocolJson(candidate.entities.find(e => e.id === proposal.edit.entityId)) !== canonicalProtocolJson(proposal.after)) throw new ProjectError('postcondition-failed', 'Candidate differs from preview');
    const transaction = { id: randomUUID(), before, after: freezeProtocolValue(candidate) };
    // Publication occurs only after all preconditions, validation and postconditions succeeded.
    this.history.push(transaction); this.project = transaction.after; this.proposals.clear();
    return this.commitResult(transaction.id, proposal.edit.kind);
  }
  undo(input: unknown): ProjectCommitResult {
    const call = canonicalProjectUndoRequest(input); this.check(call);
    const last = this.history.at(-1);
    if (!last || last.id !== call.transactionId) throw new ProjectError('nothing-to-undo', 'Only the most recent retained transaction may be undone');
    const candidate = freezeProtocolValue(undoBoxCandidate(this.project, last.before, last.after));
    const transactionId = randomUUID();
    this.project = candidate; this.history.pop(); this.proposals.clear();
    return this.commitResult(transactionId, 'undo');
  }
  private commitResult(transactionId: string, operation: ProjectCommitResult['operation']): ProjectCommitResult {
    return { snapshot: this.snapshot(), transactionId, nextUndoTransactionId: this.history.at(-1)?.id ?? null,
      operation, verification: 'parameter-postconditions-not-cad', persisted: false };
  }
  save(input: unknown) {
    this.check(canonicalProjectBinding(input));
    const project = canonicalPersistentProject(this.project), digest = hash(project);
    const text = canonicalProtocolJson({ schemaVersion: 'spatial-project-v1', frameId: PROJECT_FRAME_ID, digest, project });
    if (Buffer.byteLength(text) > PROJECT_LIMITS.snapshotBytes) throw new ProjectError('resource-limit', 'Snapshot storage limit');
    const temporary = `${this.snapshotPath}.${randomUUID()}.tmp`, lock = `${this.snapshotPath}.lock`;
    let fd: number | undefined, lockFd: number | undefined;
    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true, mode: 0o700 });
      lockFd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      if ((this.readStored()?.digest ?? null) !== this.diskDigest) throw new ProjectError('stale-project', 'Stored snapshot changed; load it before saving');
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const bytes = Buffer.from(text); let written = 0;
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.snapshotPath);
      this.diskDigest = digest; this.savedRevision = project.revision;
      return { snapshot: this.snapshot(), savedRevision: project.revision, persisted: true as const };
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError('storage-unavailable', 'Fixed snapshot storage unavailable');
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* No surviving temporary file on the normal path. */ }
      if (lockFd !== undefined) { closeSync(lockFd); try { unlinkSync(lock); } catch { /* Operator can remove a stale lock after a crash. */ } }
    }
  }
  load(input: unknown) {
    this.check(canonicalProjectBinding(input));
    const stored = this.readStored();
    if (!stored) throw new ProjectError('snapshot-missing', 'No saved project snapshot');
    const candidate = freezeProtocolValue(stored.project), newSession = randomUUID();
    this.project = candidate; this.sessionId = newSession; this.diskDigest = stored.digest; this.savedRevision = candidate.revision;
    this.history = []; this.proposals.clear();
    return { snapshot: this.snapshot(), nextUndoTransactionId: null, persisted: true as const };
  }
  private readStored(): Stored | null {
    let fd: number | undefined;
    try {
      try { fd = openSync(this.snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > PROJECT_LIMITS.snapshotBytes || stat.size === 0) throw new Error('Invalid bounded snapshot file');
      const bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (n === 0) throw new Error('Truncated snapshot'); offset += n; }
      const after = fstatSync(fd);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Snapshot changed during read');
      const envelope = protocolRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      protocolKeys(envelope, ['schemaVersion', 'frameId', 'digest', 'project']); protocolHash(envelope.digest);
      if (envelope.schemaVersion !== 'spatial-project-v1' || envelope.frameId !== PROJECT_FRAME_ID) throw new Error('Unsupported snapshot version');
      const project = canonicalPersistentProject(envelope.project);
      if (hash(project) !== envelope.digest) throw new Error('Snapshot integrity mismatch');
      return { project, digest: envelope.digest };
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError('snapshot-corrupt', 'Saved snapshot is invalid, changed or unreadable');
    } finally { if (fd !== undefined) closeSync(fd); }
  }
}
