import type { CadOperation, CadBodyRef, CadBodyResult } from './cad';

export type TorontoCadPrimitive = Extract<CadOperation, { kind: 'box' | 'cylinder' }>;
export interface TorontoCadMesh { readonly body: CadBodyRef; readonly units: 'm'; readonly vertices: readonly number[]; readonly normals: readonly number[]; readonly triangles: readonly number[] }
export interface TorontoCadBody { readonly bodyId: string; readonly operation: TorontoCadPrimitive; readonly validation: CadBodyResult; readonly mesh: TorontoCadMesh }
export interface TorontoCadBinding { readonly sessionId: string; readonly revision: number; readonly artifactRevision: string; readonly datasetId: 'toronto3d'; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm' }
export interface TorontoCadProposal extends TorontoCadBody, TorontoCadBinding { readonly proposalId: string }
export interface TorontoCadSnapshot extends TorontoCadBinding { readonly bodies: readonly TorontoCadBody[]; readonly proposals: readonly TorontoCadProposal[]; readonly nextUndoTransactionId: string | null }
export const TORONTO_CAD_LIMITS = Object.freeze({ proposals: 8, bodies: 16, requestsPerMinute: 60, requestBytes: 8192, bodyTimeoutMs: 10000 });
export type TorontoCadErrorCode = 'invalid-request' | 'stale-session' | 'stale-revision' | 'stale-artifact' | 'unknown-proposal' | 'nothing-to-undo' | 'resource-limit' | 'busy' | 'local-only' | 'unavailable';
