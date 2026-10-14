import { TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalToolRequest, assertPreparedArtifactIdentity, canonicalProtocolJson,
  detachedProtocolValue, protocolRecord, protocolKeys, protocolHash, protocolToken, protocolInteger,
  type PreparedArtifactIdentity, type ToolOutcome } from '@spatial/contracts';
import { ReadonlyToolRuntime, canonicalToolConfiguration, semanticToolOutcome, type ToolConfiguration, type ToolRecord, type ProtocolHasher } from './tool-protocol';

export const EVIDENCE_VERSION = 'redacted-run-evidence-v1' as const;
export interface RunEvidence {
  readonly evidenceVersion: typeof EVIDENCE_VERSION;
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION; readonly toolVersion: typeof TOOL_VERSION;
  readonly codeVersion: string; readonly configHash: string; readonly configuration: ToolConfiguration;
  readonly artifact: PreparedArtifactIdentity; readonly runId: string; readonly records: readonly ToolRecord[];
}
export type EvidenceFailureCode = 'malformed-evidence' | 'schema-mismatch' | 'tool-mismatch' | 'export-budget';
export class EvidenceFailure extends Error {
  constructor(readonly code: EvidenceFailureCode) { super(code); }
}
function bytes(text: string) { return new TextEncoder().encode(text).byteLength; }
function checkArtifact(identity: PreparedArtifactIdentity, hash: ProtocolHasher) {
  assertPreparedArtifactIdentity(identity);
  if (hash(canonicalProtocolJson(identity.assets)) !== identity.digest) throw new TypeError('Artifact digest mismatch');
}
/** Bounded default trace: no raw arrays, observation buffers, adapter reasons or exception text. */
export function exportRunEvidence(runtime: ReadonlyToolRuntime, codeVersion: string, artifact: PreparedArtifactIdentity): string {
  protocolToken(codeVersion); checkArtifact(artifact, runtime.hash);
  if (runtime.binding.artifactRevision !== artifact.revision || runtime.binding.artifactDigest !== artifact.digest) throw new TypeError('Artifact binding mismatch');
  const evidence: RunEvidence = { evidenceVersion: EVIDENCE_VERSION, schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION,
    codeVersion, configuration: runtime.configuration, configHash: runtime.configHash, artifact, runId: runtime.runId, records: runtime.traceRecords() };
  const text = canonicalProtocolJson(evidence);
  if (text.length > runtime.configuration.budgets.maxEvidenceBytes || bytes(text) > runtime.configuration.budgets.maxEvidenceBytes) throw new EvidenceFailure('export-budget');
  return text;
}
export function parseRunEvidence(text: string, hash: ProtocolHasher, maxBytes = 4 * 1024 * 1024): RunEvidence {
  try {
    protocolInteger(maxBytes, 4 * 1024 * 1024);
    if (typeof text !== 'string' || text.length > maxBytes || bytes(text) > maxBytes) throw new TypeError('Oversized evidence');
    const e = protocolRecord(JSON.parse(text));
    protocolKeys(e, ['evidenceVersion', 'schemaVersion', 'toolVersion', 'codeVersion', 'configHash', 'configuration', 'artifact', 'runId', 'records']);
    if (e.evidenceVersion !== EVIDENCE_VERSION || e.schemaVersion !== TOOL_SCHEMA_VERSION) throw new EvidenceFailure('schema-mismatch');
    if (e.toolVersion !== TOOL_VERSION) throw new EvidenceFailure('tool-mismatch');
    protocolToken(e.codeVersion); protocolToken(e.runId); protocolHash(e.configHash);
    const configuration = canonicalToolConfiguration(e.configuration);
    if (e.configHash !== hash(canonicalProtocolJson(configuration))) throw new TypeError('Invalid config hash');
    assertPreparedArtifactIdentity(e.artifact); checkArtifact(e.artifact, hash);
    if (!Array.isArray(e.records) || e.records.length > configuration.budgets.maxCalls || bytes(text) > configuration.budgets.maxEvidenceBytes) throw new TypeError('Invalid evidence count/budget');
    const ids = new Set<string>();
    for (const value of e.records) {
      const r = protocolRecord(value); protocolKeys(r, ['call', 'status', 'semanticHash', 'metrics']);
      const call = canonicalToolRequest(r.call);
      if (call.runId !== e.runId || call.binding.artifactRevision !== e.artifact.revision || call.binding.artifactDigest !== e.artifact.digest || ids.has(call.requestId)) throw new TypeError('Evidence call mismatch');
      ids.add(call.requestId); protocolHash(r.semanticHash);
      if (!['observed', 'verified-found', 'verified-none', 'verification-rejected', 'incomplete', 'error'].includes(r.status as string)) throw new TypeError('Invalid outcome status');
      const m = protocolRecord(r.metrics); protocolKeys(m, ['durationMs'], ['readBytes']);
      if (typeof m.durationMs !== 'number' || !Number.isFinite(m.durationMs) || m.durationMs < 0) throw new TypeError('Invalid duration');
      if (m.readBytes !== undefined) protocolInteger(m.readBytes);
    }
    return detachedProtocolValue(e as unknown as RunEvidence);
  } catch (error) {
    if (error instanceof EvidenceFailure) throw error;
    throw new EvidenceFailure('malformed-evidence');
  }
}
export type ArtifactVerification = 'matched' | 'missing' | 'mismatch' | 'cancelled';
export interface ReplayEnvironment {
  readonly codeVersion: string; readonly configuration: ToolConfiguration; readonly hash: ProtocolHasher;
  /** Must verify fixed assets before any call execution, not trust a stat revision or saved status. */
  verifyArtifact(artifact: PreparedArtifactIdentity, signal?: AbortSignal): Promise<ArtifactVerification>;
  createRuntime(runId: string): ReadonlyToolRuntime;
}
export type ReplayResult = { readonly status: 'matched'; readonly outcomes: readonly ToolOutcome['status'][] } |
  { readonly status: 'malformed-evidence' | 'schema-mismatch' | 'tool-mismatch' | 'code-mismatch' | 'config-mismatch' |
    'artifact-missing' | 'artifact-mismatch' | 'cancelled' | 'outcome-mismatch' | 'execution-error'; readonly record?: number };
export async function replayRunEvidence(text: string, environment: ReplayEnvironment, signal?: AbortSignal): Promise<ReplayResult> {
  let evidence: RunEvidence;
  try { evidence = parseRunEvidence(text, environment.hash); }
  catch (error) { return { status: error instanceof EvidenceFailure && error.code !== 'export-budget' ? error.code : 'malformed-evidence' }; }
  if (evidence.codeVersion !== environment.codeVersion) return { status: 'code-mismatch' };
  let configHash: string;
  try { configHash = environment.hash(canonicalProtocolJson(canonicalToolConfiguration(environment.configuration))); }
  catch { return { status: 'config-mismatch' }; }
  if (evidence.configHash !== configHash) return { status: 'config-mismatch' };
  if (signal?.aborted) return { status: 'cancelled' };
  let verified: ArtifactVerification;
  try { verified = await environment.verifyArtifact(evidence.artifact, signal); }
  catch { return { status: signal?.aborted ? 'cancelled' : 'artifact-mismatch' }; }
  if (signal?.aborted || verified === 'cancelled') return { status: 'cancelled' };
  if (verified !== 'matched') return { status: verified === 'missing' ? 'artifact-missing' : 'artifact-mismatch' };
  const outcomes: ToolOutcome['status'][] = [];
  try {
    const runtime = environment.createRuntime(evidence.runId);
    if (runtime.configHash !== evidence.configHash) return { status: 'config-mismatch' };
    if (runtime.binding.artifactRevision !== evidence.artifact.revision || runtime.binding.artifactDigest !== evidence.artifact.digest) return { status: 'artifact-mismatch' };
    for (let i = 0; i < evidence.records.length; i++) {
      if (signal?.aborted) return { status: 'cancelled', record: i };
      const record = evidence.records[i], result = await runtime.execute(record.call, signal);
      if (signal?.aborted) return { status: 'cancelled', record: i };
      if (result.outcome.status !== record.status || environment.hash(canonicalProtocolJson(semanticToolOutcome(result.outcome))) !== record.semanticHash) return { status: 'outcome-mismatch', record: i };
      outcomes.push(result.outcome.status);
    }
    return { status: 'matched', outcomes };
  } catch { return { status: signal?.aborted ? 'cancelled' : 'execution-error' }; }
}
