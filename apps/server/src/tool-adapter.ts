import { detachedProtocolValue, freezeProtocolValue, protocolToken, type ToolBinding } from '@spatial/contracts';
import { ReadonlyToolRuntime, canonicalToolConfiguration, exportRunEvidence, replayRunEvidence,
  type ToolBudgets, type ReplayEnvironment } from '@spatial/agent-harness';
import { PotreeDataset } from './potree';
import { queryIndexedClosestPole } from './pole-index';
import { recordBytes, pagePoints } from './semantic-disk-index';
import { prepareArtifactEvidence, verifyArtifactEvidence, sha256Protocol } from './tool-evidence';

const DEFAULT_BUDGETS: ToolBudgets = { maxCalls: 64, maxConcurrency: 2, deadlineMs: 60000, maxEvidenceBytes: 256 * 1024 };
/** Explicit trusted preparation; no HTTP route, model, filesystem argument or mutation tool is exposed. */
export async function prepareReadonlyTools(directory: string, options: { readonly codeVersion: string; readonly budgets?: ToolBudgets }, signal?: AbortSignal) {
  const codeVersion = options.codeVersion; protocolToken(codeVersion);
  const configuration = canonicalToolConfiguration({ budgets: options.budgets ?? DEFAULT_BUDGETS, nearest: {
    algorithm: 'semantic-disk-page-index-v1', verifier: 'semantic-disk-page-verifier-v1',
    configHashes: Array.from({ length: 9 }, (_, label) => sha256Protocol(JSON.stringify({ version: 'semantic-disk-page-index-v1', recordBytes,
      pagePoints, bound: 'euclidean-aabb-squared', arithmetic: 'xyz-binary64-v1', tie: 'numeric-source-key', label }))) } });
  const artifact = freezeProtocolValue(detachedProtocolValue(await prepareArtifactEvidence(directory, signal)));
  const binding: ToolBinding = { datasetId: 'toronto3d', artifactRevision: artifact.revision, artifactDigest: artifact.digest, units: 'm', frameId: 'toronto3d-local-v1' };
  const dataset = new PotreeDataset(directory);
  const environment: ReplayEnvironment = {
    codeVersion, configuration, hash: sha256Protocol,
    verifyArtifact: (expected, signal) => verifyArtifactEvidence(directory, expected, signal),
    createRuntime: runId => new ReadonlyToolRuntime(runId, binding, configuration, {
      metadata: async signal => { signal.throwIfAborted(); const info = await dataset.info(); signal.throwIfAborted(); return info; },
      observe: (lod, signal) => dataset.observe(lod, signal),
      nearest: (request, signal) => queryIndexedClosestPole(directory, request, signal),
    }, sha256Protocol),
  };
  return { ...environment, artifact, binding: freezeProtocolValue(binding),
    exportEvidence: (runtime: ReadonlyToolRuntime) => exportRunEvidence(runtime, codeVersion, artifact),
    replay: (text: string, signal?: AbortSignal) => replayRunEvidence(text, environment, signal) };
}
