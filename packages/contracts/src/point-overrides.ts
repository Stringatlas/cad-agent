import type { Vec3 } from './index';
import type { PointKey } from './semantic-query';

export const POINT_OVERRIDE_LIMITS = Object.freeze({ points: 32, entries: 4096, proposals: 32, transactions: 128, requestBytes: 16384, bodyTimeoutMs: 5000, requestsPerMinute: 120 });
export interface PointOverrideBinding { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string }
export interface PointOverrideEntry { readonly key: PointKey; readonly originalPosition: Vec3; readonly position: Vec3 }
export interface PointOverrideSnapshot extends PointOverrideBinding {
  readonly datasetId: 'toronto3d'; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
  /** Volatile server-process lifetime. Prepared source files are never modified. */
  readonly entries: readonly PointOverrideEntry[]; readonly nextUndoTransactionId: string | null;
}
export interface PointMove { readonly key: PointKey; readonly originalPosition: Vec3; readonly before: Vec3; readonly after: Vec3 }
export interface PointMoveProposal extends PointOverrideBinding {
  readonly datasetId: 'toronto3d'; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
  readonly proposalId: string; readonly moves: readonly PointMove[];
}
export interface PointMoveProposalRequest extends PointOverrideBinding {
  /** Exact current effective positions, not GPU-rounded positions. */
  readonly points: readonly { readonly key: PointKey; readonly position: Vec3 }[]; readonly translation: Vec3;
}
export interface PointMoveApprovalRequest { readonly sessionId: string; readonly revision: number; readonly proposalId: string }
export interface PointMoveUndoRequest { readonly sessionId: string; readonly revision: number; readonly transactionId: string }
export type PointOverrideErrorCode = 'invalid-request' | 'stale-session' | 'stale-revision' | 'stale-artifact' | 'unknown-point' | 'position-mismatch' | 'unknown-proposal' | 'nothing-to-undo' | 'resource-limit' | 'busy' | 'local-only' | 'unavailable';
export type PointOverrideReply<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: { readonly code: PointOverrideErrorCode; readonly message: string } };

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== fields.length || fields.some(k => !Object.hasOwn(r, k))) throw new TypeError('Unexpected fields');
  return r;
}
function token(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new TypeError('Invalid identifier'); return value; }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError('Invalid revision'); return value as number; }
function vec(value: unknown): Vec3 { if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) throw new TypeError('Invalid vector'); return [...value] as unknown as Vec3; }
export function canonicalPointMoveProposalRequest(value: unknown): PointMoveProposalRequest {
  const r = object(value, ['sessionId', 'revision', 'artifactRevision', 'points', 'translation']);
  if (!Array.isArray(r.points) || !r.points.length || r.points.length > POINT_OVERRIDE_LIMITS.points) throw new TypeError('Expected 1..32 points');
  const seen = new Set<string>();
  const points = r.points.map(value => {
    const p = object(value, ['key', 'position']), k = object(p.key, ['sourceFileId', 'sourceRow']);
    if (!Number.isInteger(k.sourceFileId) || (k.sourceFileId as number) < 1 || (k.sourceFileId as number) > 4 || !Number.isSafeInteger(k.sourceRow) || (k.sourceRow as number) < 0 || (k.sourceRow as number) > 0xffffffff) throw new TypeError('Invalid point key');
    const key = { sourceFileId: k.sourceFileId as number, sourceRow: k.sourceRow as number }, id = `${key.sourceFileId}:${key.sourceRow}`;
    if (seen.has(id)) throw new TypeError('Repeated point'); seen.add(id);
    return { key, position: vec(p.position) };
  });
  const translation = vec(r.translation); if (translation.every(n => n === 0)) throw new TypeError('Translation must move points');
  return { sessionId: token(r.sessionId), revision: revision(r.revision), artifactRevision: token(r.artifactRevision), points, translation };
}
export function canonicalPointMoveApprovalRequest(value: unknown): PointMoveApprovalRequest {
  const r = object(value, ['sessionId', 'revision', 'proposalId']); return { sessionId: token(r.sessionId), revision: revision(r.revision), proposalId: token(r.proposalId) };
}
export function canonicalPointMoveUndoRequest(value: unknown): PointMoveUndoRequest {
  const r = object(value, ['sessionId', 'revision', 'transactionId']); return { sessionId: token(r.sessionId), revision: revision(r.revision), transactionId: token(r.transactionId) };
}
