import { canonicalPoleRequest, type NearestPoleRequest, type NearestPoleToolOutcome, type Vec3, type TorontoSemanticLabel, TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import type { PoleSelection } from './pole-picking';

export interface PoleProgress { phase: 'index' | 'resolve' | 'search' | 'verify-resolve' | 'verify'; scannedPoints: number; payloadBytes: number }
export type PoleLoader = (request: NearestPoleRequest, signal: AbortSignal, progress: (value: PoleProgress) => void) => Promise<NearestPoleToolOutcome>;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid query response');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Invalid response fields');
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const triple = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7);
const statsFields = ['scannedPoints', 'matchingPoints', 'hierarchyChunks', 'payloadNodes', 'hierarchyBytes', 'payloadBytes', 'metadataBytes', 'maxReadBytes', 'resolutionPoints', 'resolutionPayloadBytes'];
export function validatePoleResult(value: unknown, request: NearestPoleRequest): NearestPoleToolOutcome {
  const r = record(value);
  if (r.status === 'error') {
    fields(r, ['status', 'code']);
    if (!['invalid-input', 'unknown-dataset', 'unknown-point', 'stale-revision', 'corrupt-data', 'busy', 'unavailable'].includes(String(r.code))) throw new Error('Unknown failure');
  } else if (r.status === 'incomplete') {
    fields(r, ['status', 'complete', 'reason']);
    if (r.complete !== false || !['cancelled', 'resource', 'transport'].includes(String(r.reason))) throw new Error('Invalid incomplete result');
  } else if (r.status === 'verification-rejected') {
    fields(r, ['status', 'reason']); if (typeof r.reason !== 'string' || r.reason.length > 1024) throw new Error('Invalid verification rejection');
  } else {
    fields(r, ['status', 'complete', 'request', 'dataset', 'queryPosition', 'nearest', 'search', 'verification'], ['sourceReads']);
    if (!['verified-found', 'verified-none'].includes(String(r.status)) || r.complete !== true ||
        JSON.stringify(canonicalPoleRequest(r.request)) !== JSON.stringify(request) || !triple(r.queryPosition)) throw new Error('Invalid complete binding');
    const dataset = record(r.dataset), coordinates = record(dataset.coordinates), bounds = record(dataset.bounds);
    fields(dataset, ['id', 'revision', 'totalPoints', 'bounds', 'coordinates']); fields(bounds, ['min', 'max']); fields(coordinates, ['units', 'handedness', 'upAxis', 'localOrigin']);
    if (dataset.id !== request.datasetId || dataset.revision !== request.expectedArtifactRevision || !integer(dataset.totalPoints) ||
        !triple(bounds.min) || !triple(bounds.max) || bounds.min.some((n, i) => n > (bounds.max as Vec3)[i]) ||
        coordinates.units !== 'm' || coordinates.handedness !== 'right' || coordinates.upAxis !== 'Z' || JSON.stringify(coordinates.localOrigin) !== '[627285,4841948,0]') throw new Error('Stale or invalid dataset');
    const search = record(r.search), verification = record(r.verification);
    fields(search, [...statsFields, 'artifactRevision', 'algorithm', 'arithmetic', 'configHash', 'requestHash', 'traversalHash', 'completion'], ['index', 'disk']);
    fields(verification, [...statsFields, 'verifier', 'artifactRevision', 'requestHash', 'transcriptHash'], ['index', 'disk']);
    const paged = search.algorithm === 'semantic-disk-page-index-v1';
    const indexed = paged || search.algorithm === 'pole-category-index-v1';
    for (const stats of [search, verification]) {
      if (!statsFields.every(key => integer(stats[key])) || (stats.matchingPoints as number) > dataset.totalPoints ||
          stats.artifactRevision !== request.expectedArtifactRevision || !hash(stats.requestHash) ||
          (stats.maxReadBytes as number) > 4 * 1024 * 1024 ||
          stats.resolutionPoints !== (request.input.kind === 'point-ref' ? indexed ? 1 : dataset.totalPoints : 0)) throw new Error('Invalid scan evidence');
    }
    if (search.arithmetic !== 'xyz-binary64-v1' || !hash(search.configHash) || !hash(search.traversalHash) || !hash(verification.transcriptHash) ||
        search.requestHash !== verification.requestHash || search.matchingPoints !== verification.matchingPoints) throw new Error('Invalid verification evidence');
    if (indexed) {
      const index = record(search.index), verifiedIndex = record(verification.index);
      fields(index, ['points', 'hash']); fields(verifiedIndex, ['points', 'hash']);
      if (!integer(index.points) || index.points > dataset.totalPoints || !hash(index.hash) ||
          verifiedIndex.points !== index.points || verifiedIndex.hash !== index.hash ||
          search.completion !== 'indexed' || verification.verifier !== (paged ? 'semantic-disk-page-verifier-v1' : 'pole-category-linear-v1') ||
          (paged ? [search, verification].some(s => (s.scannedPoints as number) > (dataset.totalPoints as number)) :
            (search.scannedPoints as number) > index.points || verification.scannedPoints !== index.points) ||
          (search.matchingPoints as number) > index.points || (request.domain.kind === 'whole-dataset' && search.matchingPoints !== index.points) ||
          (paged ? search.payloadBytes !== verification.payloadBytes || (search.payloadBytes as number) > 256 : search.payloadBytes !== 0) || (verification.payloadBytes as number) > 256 ||
          search.resolutionPayloadBytes !== verification.resolutionPayloadBytes ||
          (request.input.kind === 'coordinate' ? search.resolutionPayloadBytes !== 0 :
            (search.resolutionPayloadBytes as number) < 1 || (search.resolutionPayloadBytes as number) > 256) ||
          [search, verification].some(s => s.hierarchyChunks !== 0 || s.payloadNodes !== 0 || s.hierarchyBytes !== 0)) throw new Error('Invalid category-index evidence');
      if (paged) {
        for (const phase of [search, verification]) {
          const disk = record(phase.disk);
          fields(disk, ['totalPages', 'visitedPages', 'excludedPages', 'prunedPages', 'coveredPoints', 'cacheBytes', 'maxCacheReadBytes']);
          const scanned = phase.scannedPoints as number, visited = disk.visitedPages as number;
          const fullPages = visited * 4096, withTail = (visited - 1) * 4096 + (dataset.totalPoints % 4096 || 4096);
          const expectedMax = visited === 0 ? 0 : visited === 1 ? scanned * 40 : 163840;
          if (!Object.values(disk).every(integer) || disk.totalPages !== Math.ceil(dataset.totalPoints / 4096) ||
              visited + (disk.excludedPages as number) + (disk.prunedPages as number) !== disk.totalPages ||
              disk.coveredPoints !== dataset.totalPoints || disk.cacheBytes !== scanned * 40 ||
              (visited === 0 ? scanned !== 0 : scanned !== withTail && (scanned !== fullPages || fullPages > dataset.totalPoints)) ||
              disk.maxCacheReadBytes !== expectedMax ||
              (r.status === 'verified-none' && disk.prunedPages !== 0) ||
              (r.status === 'verified-found' ? visited === 0 || (phase.payloadBytes as number) < 1 : phase.payloadBytes !== 0)) throw new Error('Invalid disk coverage evidence');
        }
      } else if (search.disk !== undefined || verification.disk !== undefined) throw new Error('Unexpected disk evidence');
    } else if (search.algorithm !== 'potree-semantic-full-scan-v1' || search.completion !== 'exhausted' ||
        verification.verifier !== 'linear-record-oracle-v1' || search.index !== undefined || verification.index !== undefined ||
        search.disk !== undefined || verification.disk !== undefined ||
        search.scannedPoints !== dataset.totalPoints || verification.scannedPoints !== dataset.totalPoints ||
        search.payloadBytes !== verification.payloadBytes) throw new Error('Invalid exhaustive evidence');
    if (request.input.kind === 'coordinate' && request.input.position.some((n, i) => n !== (r.queryPosition as Vec3)[i])) throw new Error('Query position mismatch');
    if (r.status === 'verified-none') {
      if (r.nearest !== null || search.matchingPoints !== 0) throw new Error('Invalid empty result');
    } else {
      const n = record(r.nearest), key = record(n.key); fields(n, ['key', 'position', 'label', 'distanceSquared', 'distanceMeters']); fields(key, ['sourceFileId', 'sourceRow']);
      if (!integer(key.sourceFileId) || key.sourceFileId < 1 || key.sourceFileId > 4 || !integer(key.sourceRow) || key.sourceRow > 0xffffffff ||
          n.label !== request.filter.value || !triple(n.position) || search.matchingPoints === 0 || typeof n.distanceSquared !== 'number' || !Number.isFinite(n.distanceSquared) || n.distanceSquared < 0 ||
          n.distanceMeters !== Math.sqrt(n.distanceSquared)) throw new Error('Invalid category witness');
      const domain = request.domain;
      if (domain.kind === 'aabb' && n.position.some((p, i) => p < domain.min[i] || p > domain.max[i])) throw new Error('Witness outside domain');
      const [dx, dy, dz] = n.position.map((p, i) => p - (r.queryPosition as Vec3)[i]);
      if ((dx * dx + dy * dy) + dz * dz !== n.distanceSquared) throw new Error('Distance mismatch');
    }
    if (r.sourceReads !== undefined) {
      const reads = record(r.sourceReads); fields(reads, ['metadataBytes', 'hierarchyBytes', 'payloadBytes', 'maxReadBytes']);
      if (!Object.values(reads).every(integer) || (reads.maxReadBytes as number) > 4 * 1024 * 1024) throw new Error('Invalid read evidence');
    }
  }
  return value as NearestPoleToolOutcome;
}

export const fetchClosestPole: PoleLoader = async (value, signal, publish) => {
  const request = canonicalPoleRequest(value);
  const response = await fetch(`/datasets/toronto3d/closest-label?${new URLSearchParams({ request: JSON.stringify(request) })}`, { signal });
  if (!response.ok) throw new Error(response.status === 429 ? 'Dataset busy — retry the same selection.' : `Query HTTP ${response.status} — check local server/prepared data and retry.`);
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) throw new Error('Missing query stream');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', started = false, terminal: NearestPoleToolOutcome | undefined, last: PoleProgress | undefined;
  const phases = ['index', 'resolve', 'search', 'verify-resolve', 'verify'];
  const line = (text: string) => {
    const event = record(JSON.parse(text));
    if (event.requestId !== request.requestId || event.artifactRevision !== request.expectedArtifactRevision || terminal) throw new Error('Stale or extra query frame');
    if (event.type === 'start') {
      fields(event, ['type', 'requestId', 'artifactRevision', 'request']);
      if (started || JSON.stringify(canonicalPoleRequest(event.request)) !== JSON.stringify(request)) throw new Error('Invalid query start'); started = true;
    } else if (event.type === 'progress') {
      fields(event, ['type', 'requestId', 'artifactRevision', 'progress']); const p = record(event.progress); fields(p, ['phase', 'scannedPoints', 'payloadBytes']);
      const phase = phases.indexOf(String(p.phase));
      if (!started || phase < 0 || !integer(p.scannedPoints) || !integer(p.payloadBytes) ||
          (request.input.kind === 'coordinate' && ['resolve', 'verify-resolve'].includes(String(p.phase))) ||
          (last && (phase < phases.indexOf(last.phase) || (p.phase === last.phase && (p.scannedPoints < last.scannedPoints || p.payloadBytes < last.payloadBytes))))) throw new Error('Invalid query progress');
      last = p as unknown as PoleProgress; signal.throwIfAborted(); publish(last);
    } else if (event.type === 'result') {
      fields(event, ['type', 'requestId', 'artifactRevision', 'result']); if (!started) throw new Error('Missing query start');
      terminal = validatePoleResult(event.result, request);
    } else throw new Error('Unknown query frame');
  };
  try {
    while (true) {
      signal.throwIfAborted(); const { value: bytes, done } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        pending += decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true });
        let at: number;
        while ((at = pending.indexOf('\n')) >= 0) {
          if (at > 65536) throw new Error('Oversized query frame'); line(pending.slice(0, at)); pending = pending.slice(at + 1);
        }
        if (pending.length > 65536) throw new Error('Oversized query frame');
      }
    }
    pending += decoder.decode();
    if (pending.length || !started || !terminal) throw new Error('Interrupted query — incomplete transport');
    if (terminal.status === 'verified-found' || terminal.status === 'verified-none') {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)));
      const requestHash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      if (terminal.search.requestHash !== requestHash) throw new Error('Request evidence hash mismatch');
    }
    signal.throwIfAborted(); return terminal;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
};

export interface PoleState { phase: 'idle' | 'indexing' | 'resolving' | 'searching' | 'verifying' | 'verified-found' | 'verified-none' | 'cancelled-incomplete' | 'error-stale' | 'error'; selection?: PoleSelection; progress?: PoleProgress; result?: NearestPoleToolOutcome; error?: string }
export function createPoleChannel(publish: (state: PoleState) => void, loader: PoleLoader = fetchClosestPole) {
  let generation = 0, disposed = false, controller: AbortController | undefined, selection: PoleSelection | undefined;
  const cancel = () => { generation++; controller?.abort(); controller = undefined; };
  return {
    async select(value: PoleSelection, label: TorontoSemanticLabel = 6) {
      if (disposed) return;
      if (!Number.isInteger(label) || !Object.hasOwn(TORONTO_SEMANTIC_LABELS, label)) throw new TypeError('Invalid semantic category');
      cancel();
      // Retry can receive a reactive proxy; detach only primitive provenance fields.
      selection = { datasetId: value.datasetId, artifactRevision: value.artifactRevision,
        key: { sourceFileId: value.key.sourceFileId, sourceRow: value.key.sourceRow },
        position: [value.position[0], value.position[1], value.position[2]] };
      const captured = selection, token = generation;
      const current = new AbortController(); controller = current;
      const request: NearestPoleRequest = { requestId: crypto.randomUUID(), datasetId: captured.datasetId, expectedArtifactRevision: captured.artifactRevision,
        units: 'm', frameId: 'toronto3d-local-v1', input: { kind: 'point-ref', key: captured.key },
        filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: label }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } };
      const live = () => !disposed && generation === token && !current.signal.aborted;
      publish({ phase: 'resolving', selection: captured });
      try {
        const result = validatePoleResult(await loader(request, current.signal, progress => {
          if (live()) publish({ phase: progress.phase === 'index' ? 'indexing' : progress.phase === 'resolve' ? 'resolving' : progress.phase === 'search' ? 'searching' : 'verifying', selection: captured, progress });
        }), request);
        if (!live()) return;
        if ((result.status === 'verified-found' || result.status === 'verified-none') && JSON.stringify(result.queryPosition) !== JSON.stringify(captured.position)) throw new Error('Resolved point differs from captured observation; stale selection');
        publish({ phase: result.status === 'verified-found' || result.status === 'verified-none' ? result.status :
          result.status === 'error' && result.code === 'stale-revision' ? 'error-stale' : result.status === 'incomplete' && result.reason === 'cancelled' ? 'cancelled-incomplete' : 'error', selection: captured, result });
      } catch (error) { if (live()) publish({ phase: 'error', selection: captured, error: String(error) }); }
      finally { if (generation === token) controller = undefined; }
    },
    cancel() { if (disposed) return; cancel(); publish({ phase: 'cancelled-incomplete', selection }); },
    clear() { if (disposed) return; cancel(); selection = undefined; publish({ phase: 'idle' }); },
    revision(revision: string) { if (!disposed && selection && selection.artifactRevision !== revision) { cancel(); selection = undefined; publish({ phase: 'error-stale', error: 'Dataset revision changed — select a new point.' }); } },
    dispose() { disposed = true; cancel(); selection = undefined; },
  };
}
