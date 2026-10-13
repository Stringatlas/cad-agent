import { canonicalPoleRequest, type DatasetInfo, type NearestPoleRequest, type QueryOutcome,
  type CompleteQuery, type VerificationOutcome, type NearestPoleToolOutcome } from '@spatial/contracts';

export interface SemanticSpatialQuerySource {
  readonly dataset: DatasetInfo;
  nearestPole(request: NearestPoleRequest, signal?: AbortSignal): Promise<QueryOutcome>;
}
export interface NearestQueryVerifier {
  verify(request: NearestPoleRequest, answer: CompleteQuery, signal?: AbortSignal): Promise<VerificationOutcome>;
}

/** Headless tool execution; concrete adapters own snapshot integrity and file cleanup. */
export async function executeNearestPole(value: unknown, source: SemanticSpatialQuerySource,
  verifier: NearestQueryVerifier, signal?: AbortSignal): Promise<NearestPoleToolOutcome> {
  let request: NearestPoleRequest;
  try { request = canonicalPoleRequest(value); }
  catch { return { status: 'error', code: 'invalid-input' }; }
  try {
    signal?.throwIfAborted();
    if (request.datasetId !== source.dataset.id) return { status: 'error', code: 'unknown-dataset' };
    if (request.expectedArtifactRevision !== source.dataset.revision) return { status: 'error', code: 'stale-revision' };
    const answer = await source.nearestPole(request, signal);
    signal?.throwIfAborted();
    if (answer.status !== 'complete') return answer;
    const verification = await verifier.verify(request, answer, signal);
    signal?.throwIfAborted();
    if (verification.status === 'rejected') return { status: 'verification-rejected', reason: verification.reason };
    if (verification.status !== 'verified') return verification;
    if (answer.evidence.artifactRevision !== request.expectedArtifactRevision ||
      verification.evidence.artifactRevision !== request.expectedArtifactRevision ||
      verification.evidence.requestHash !== answer.evidence.requestHash) return { status: 'verification-rejected', reason: 'Evidence binding mismatch' };
    return { status: answer.nearest ? 'verified-found' : 'verified-none', complete: true,
      request, dataset: source.dataset, queryPosition: answer.queryPosition, nearest: answer.nearest,
      search: answer.evidence, verification: verification.evidence };
  } catch {
    return signal?.aborted ? { status: 'incomplete', complete: false, reason: 'cancelled' } : { status: 'error', code: 'unavailable' };
  }
}
