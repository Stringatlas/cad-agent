import type { PointKey } from '@spatial/contracts';
import { decodePoint } from './potree';
import { SemanticArtifact, SemanticFailure, requireData } from '../spatial/semantic-artifact';
import { loadPreparedSemanticDiskIndex } from '../spatial/semantic-disk-index';

export interface SourcePointRequest { readonly revision: string; readonly key: PointKey }
export function parseSourcePointRequest(params: URLSearchParams): SourcePointRequest {
  const keys = [...params.keys()];
  if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(key => !['revision', 'sourceFileId', 'sourceRow'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(params.get('revision') ?? '') || !/^[1-4]$/.test(params.get('sourceFileId') ?? '') || !/^(0|[1-9]\d{0,9})$/.test(params.get('sourceRow') ?? '')) throw new TypeError('Invalid source point request');
  const sourceRow = Number(params.get('sourceRow'));
  if (sourceRow > 0xffffffff) throw new TypeError('Invalid source row');
  return { revision: params.get('revision')!, key: { sourceFileId: Number(params.get('sourceFileId')), sourceRow } };
}

/** Exact original record metadata, not effective override geometry or a nearest search.
 * Uses only an already-prepared canonical source-row lookup and one bounded source read. */
export async function readSourcePoint(directory: string, request: SourcePointRequest, signal?: AbortSignal) {
  const artifact = await SemanticArtifact.open(directory, signal);
  try {
    if (artifact.dataset.revision !== request.revision) throw new SemanticFailure('stale-revision', 'Source changed');
    const index = await loadPreparedSemanticDiskIndex(artifact, signal);
    if (!index) throw new SemanticFailure('unavailable', 'Prepared source lookup unavailable');
    const physical = await index.resolvePhysical(request.key, signal);
    const bytes = await artifact.read('payload', physical * artifact.layout.stride, artifact.layout.stride, signal);
    const point = decodePoint(bytes, 0, artifact.layout);
    requireData(point.sourceIds[0] === request.key.sourceFileId && point.sourceIds[1] === request.key.sourceRow, 'Original record provenance mismatch');
    await index.check(signal); await artifact.check(signal);
    return { datasetId: 'toronto3d' as const, artifactRevision: artifact.dataset.revision, frameId: 'toronto3d-local-v1' as const,
      ...artifact.dataset.coordinates, key: { ...request.key }, position: point.positions, semanticLabel: point.label };
  } finally { await artifact.close(); }
}
