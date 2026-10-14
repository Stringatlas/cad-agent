import { TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalToolRequest, nearestRequestForTool, canonicalPoleRequest,
  canonicalProtocolJson, detachedProtocolValue, freezeProtocolValue, assertToolBinding, protocolRecord, protocolKeys,
  protocolHash, protocolInteger, protocolToken, type ToolBinding, type ToolRequest, type ToolReply, type ToolOutcome,
  type DatasetInfo, type PointLod, type NearestPoleRequest, type SearchEvidence, type VerificationEvidence,
  type PointObservation, type Vec3 } from '@spatial/contracts';

export interface ToolBudgets {
  readonly maxCalls: number; readonly maxConcurrency: number; readonly deadlineMs: number;
  readonly maxEvidenceBytes: number;
}
export interface ToolConfiguration {
  readonly budgets: ToolBudgets;
  readonly nearest: { readonly algorithm: SearchEvidence['algorithm']; readonly verifier: VerificationEvidence['verifier'];
    readonly configHashes: readonly string[] };
}
/** Injected trusted composition, not public tool arguments. Hash is SHA-256 over UTF-8. */
export interface ReadonlyToolAdapter {
  metadata(signal: AbortSignal): Promise<unknown>;
  observe(lod: PointLod, signal: AbortSignal): Promise<unknown>;
  nearest(request: NearestPoleRequest, signal: AbortSignal): Promise<unknown>;
}
export type ProtocolHasher = (text: string) => string;
export interface ToolRecord {
  readonly call: ToolRequest; readonly status: ToolOutcome['status']; readonly semanticHash: string;
  readonly metrics: { readonly durationMs: number; readonly readBytes?: number };
}
export function canonicalToolConfiguration(value: unknown): ToolConfiguration {
  const c = protocolRecord(detachedProtocolValue(value, { maxArrayLength: 9, maxNodes: 64, maxDepth: 4, maxObjectKeys: 4, maxStringLength: 128 }));
  protocolKeys(c, ['budgets', 'nearest']);
  const b = protocolRecord(c.budgets); protocolKeys(b, ['maxCalls', 'maxConcurrency', 'deadlineMs', 'maxEvidenceBytes']);
  for (const [key, max] of [['maxCalls', 1000], ['maxConcurrency', 32], ['deadlineMs', 300000], ['maxEvidenceBytes', 4 * 1024 * 1024]] as const) {
    protocolInteger(b[key], max); if (!(b[key] as number)) throw new TypeError('Empty tool budget');
  }
  const n = protocolRecord(c.nearest); protocolKeys(n, ['algorithm', 'verifier', 'configHashes']);
  const pairs = { 'potree-semantic-full-scan-v1': 'linear-record-oracle-v1', 'pole-category-index-v1': 'pole-category-linear-v1',
    'semantic-disk-page-index-v1': 'semantic-disk-page-verifier-v1' };
  if (!(typeof n.algorithm === 'string' && Object.hasOwn(pairs, n.algorithm)) ||
    pairs[n.algorithm as keyof typeof pairs] !== n.verifier || !Array.isArray(n.configHashes) || n.configHashes.length !== 9) throw new TypeError('Invalid verifier configuration');
  Array.from(n.configHashes).forEach(protocolHash);
  return freezeProtocolValue(c as unknown as ToolConfiguration);
}
function triple(value: unknown): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7)) throw new TypeError('Invalid coordinate');
}
function dataset(value: unknown, binding: ToolBinding): asserts value is DatasetInfo {
  const d = protocolRecord(value); protocolKeys(d, ['id', 'revision', 'coordinates', 'bounds', 'totalPoints']);
  if (d.id !== binding.datasetId || d.revision !== binding.artifactRevision) throw new TypeError('Dataset binding mismatch');
  const c = protocolRecord(d.coordinates); protocolKeys(c, ['units', 'handedness', 'upAxis', 'localOrigin']); triple(c.localOrigin);
  if (c.units !== 'm' || c.handedness !== 'right' || c.upAxis !== 'Z' || canonicalProtocolJson(c.localOrigin) !== '[627285,4841948,0]') throw new TypeError('Frame mismatch');
  const box = protocolRecord(d.bounds); protocolKeys(box, ['min', 'max']); triple(box.min); triple(box.max);
  if (box.min.some((n, i) => n > (box.max as Vec3)[i])) throw new TypeError('Invalid bounds');
  protocolInteger(d.totalPoints, 1e9); if (!d.totalPoints) throw new TypeError('Empty dataset');
}
function numericArray(value: unknown, length: number, max: number, integer: boolean, min = 0): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== length || !Array.from(value).every(n => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isSafeInteger(n)))) throw new TypeError('Invalid observation array');
}
function observation(value: unknown, request: Extract<ToolRequest, { tool: 'dataset.observe' }>, hash: ProtocolHasher): asserts value is PointObservation {
  const o = protocolRecord(value); protocolKeys(o, ['dataset', 'purpose', 'lod', 'algorithm', 'candidatePoints', 'count', 'bytesRead', 'nodes', 'sampleHash', 'positions', 'colors', 'sourceIds', 'labels']);
  dataset(o.dataset, request.binding);
  const lod = protocolRecord(o.lod); protocolKeys(lod, ['budget', 'depth']); protocolInteger(lod.budget, 4096); protocolInteger(lod.depth, 3);
  if (o.purpose !== 'harness' || o.algorithm !== 'potree-bfs-even-v1' || canonicalProtocolJson(o.lod) !== canonicalProtocolJson(request.args.lod)) throw new TypeError('Observation binding mismatch');
  protocolInteger(o.count, request.args.lod.budget); protocolInteger(o.candidatePoints, 1000000); protocolInteger(o.bytesRead, 17 * 1024 * 1024);
  if (o.count !== Math.min(o.candidatePoints, request.args.lod.budget) || o.candidatePoints > o.dataset.totalPoints) throw new TypeError('Observation coverage mismatch');
  if (!Array.isArray(o.nodes) || o.nodes.length > 3000 || !Array.from(o.nodes).every(n => typeof n === 'string' && /^r[0-7]{0,3}$/.test(n)) || new Set(o.nodes).size !== o.nodes.length) throw new TypeError('Invalid observation nodes');
  protocolHash(o.sampleHash);
  numericArray(o.positions, o.count * 3, 1e7, false, -1e7); numericArray(o.colors, o.count * 3, 255, true);
  numericArray(o.sourceIds, o.count * 2, 0xffffffff, true); numericArray(o.labels, o.count, 8, true);
  const observedDataset = o.dataset;
  if (o.sourceIds.some((n, i) => i % 2 === 0 && (n < 1 || n > 4)) || o.positions.some((n, i) => n < observedDataset.bounds.min[i % 3] - .002 || n > observedDataset.bounds.max[i % 3] + .002) ||
    hash(JSON.stringify({ positions: o.positions, colors: o.colors, sourceIds: o.sourceIds, labels: o.labels })) !== o.sampleHash) throw new TypeError('Observation content mismatch');
}
const scanFields = ['scannedPoints', 'matchingPoints', 'hierarchyChunks', 'payloadNodes', 'hierarchyBytes', 'payloadBytes', 'metadataBytes', 'maxReadBytes', 'resolutionPoints', 'resolutionPayloadBytes'];
function evidence(value: unknown, search: boolean, request: NearestPoleRequest, config: ToolConfiguration, total: number, hash: ProtocolHasher) {
  const e = protocolRecord(value);
  protocolKeys(e, [...scanFields, 'artifactRevision', 'requestHash', ...(search ? ['algorithm', 'arithmetic', 'configHash', 'traversalHash', 'completion'] : ['verifier', 'transcriptHash'])], ['index', 'disk']);
  scanFields.forEach(k => protocolInteger(e[k]));
  if (e.artifactRevision !== request.expectedArtifactRevision || e.requestHash !== hash(JSON.stringify(request)) ||
    (e.scannedPoints as number) > total || (e.matchingPoints as number) > total ||
    e.resolutionPoints !== (request.input.kind === 'point-ref' ? 1 : 0)) throw new TypeError('Evidence binding mismatch');
  if (search) {
    if (e.algorithm !== config.nearest.algorithm || e.arithmetic !== 'xyz-binary64-v1' || e.configHash !== config.nearest.configHashes[request.filter.value] ||
      e.completion !== (config.nearest.algorithm === 'potree-semantic-full-scan-v1' ? 'exhausted' : 'indexed')) throw new TypeError('Search configuration mismatch');
    protocolHash(e.traversalHash);
  } else { if (e.verifier !== config.nearest.verifier) throw new TypeError('Verifier mismatch'); protocolHash(e.transcriptHash); }
  const indexed = config.nearest.algorithm !== 'potree-semantic-full-scan-v1';
  if (!indexed && e.scannedPoints !== total) throw new TypeError('Incomplete source scan');
  if (indexed !== Object.hasOwn(e, 'index') || (config.nearest.algorithm === 'semantic-disk-page-index-v1') !== Object.hasOwn(e, 'disk')) throw new TypeError('Missing coverage');
  if (e.index !== undefined) {
    const index = protocolRecord(e.index); protocolKeys(index, ['points', 'hash']); protocolInteger(index.points, total); protocolHash(index.hash);
    if ((e.matchingPoints as number) > index.points ||
      (request.domain.kind === 'whole-dataset' && e.matchingPoints !== index.points)) throw new TypeError('Invalid category coverage');
  }
  if (e.disk !== undefined) {
    const d = protocolRecord(e.disk); protocolKeys(d, ['totalPages', 'visitedPages', 'excludedPages', 'prunedPages', 'coveredPoints', 'cacheBytes', 'maxCacheReadBytes']);
    Object.values(d).forEach(n => protocolInteger(n));
    if ((d.visitedPages as number) + (d.excludedPages as number) + (d.prunedPages as number) !== d.totalPages || d.coveredPoints !== total ||
      d.totalPages !== Math.ceil(total / 4096) || d.cacheBytes !== (e.scannedPoints as number) * 40 ||
      (e.scannedPoints as number) > (d.visitedPages as number) * 4096 ||
      (e.scannedPoints as number) < Math.max(0, (d.visitedPages as number) * 4096 - (4096 - total % 4096) % 4096) ||
      (d.maxCacheReadBytes as number) > 4096 * 40) throw new TypeError('Incomplete page coverage');
  }
}
function nearest(value: unknown, call: Extract<ToolRequest, { tool: 'dataset.nearest-label' }>, config: ToolConfiguration, hash: ProtocolHasher): ToolOutcome {
  const o = protocolRecord(value);
  if (!['verified-found', 'verified-none'].includes(o.status as string)) return failure(value);
  protocolKeys(o, ['status', 'complete', 'request', 'dataset', 'queryPosition', 'nearest', 'search', 'verification'], ['sourceReads']);
  const request = nearestRequestForTool(call);
  if (o.complete !== true || canonicalProtocolJson(canonicalPoleRequest(o.request)) !== canonicalProtocolJson(request)) throw new TypeError('Returned request mismatch');
  dataset(o.dataset, call.binding); triple(o.queryPosition);
  if (request.input.kind === 'coordinate' && canonicalProtocolJson(request.input.position) !== canonicalProtocolJson(o.queryPosition)) throw new TypeError('Origin mismatch');
  evidence(o.search, true, request, config, o.dataset.totalPoints, hash); evidence(o.verification, false, request, config, o.dataset.totalPoints, hash);
  const s = o.search as unknown as SearchEvidence, v = o.verification as unknown as VerificationEvidence;
  if (s.matchingPoints !== v.matchingPoints || canonicalProtocolJson(s.index ?? null) !== canonicalProtocolJson(v.index ?? null)) throw new TypeError('Proof disagreement');
  if ((o.status === 'verified-none') !== (o.nearest === null) || (o.nearest === null) !== (s.matchingPoints === 0)) throw new TypeError('Witness/status mismatch');
  if (o.nearest !== null) {
    const w = protocolRecord(o.nearest); protocolKeys(w, ['key', 'position', 'label', 'distanceSquared', 'distanceMeters']);
    const key = protocolRecord(w.key); protocolKeys(key, ['sourceFileId', 'sourceRow']); protocolInteger(key.sourceFileId, 4); protocolInteger(key.sourceRow, 0xffffffff);
    triple(w.position);
    const origin = o.queryPosition, sourceDataset = o.dataset;
    const deltas = w.position.map((n, i) => n - origin[i]); const square = (deltas[0] * deltas[0] + deltas[1] * deltas[1]) + deltas[2] * deltas[2];
    if (!key.sourceFileId || w.label !== request.filter.value || w.distanceSquared !== square || w.distanceMeters !== Math.sqrt(square) ||
      w.position.some((n, i) => n < sourceDataset.bounds.min[i] - .002 || n > sourceDataset.bounds.max[i] + .002 ||
        (request.domain.kind === 'aabb' && (n < request.domain.min[i] || n > request.domain.max[i])))) throw new TypeError('Invalid witness');
  }
  if (o.sourceReads !== undefined) {
    const r = protocolRecord(o.sourceReads); protocolKeys(r, ['metadataBytes', 'hierarchyBytes', 'payloadBytes', 'maxReadBytes']); Object.values(r).forEach(n => protocolInteger(n));
  }
  return detachedProtocolValue(o as unknown as ToolOutcome);
}
function failure(value: unknown): ToolOutcome {
  const o = protocolRecord(value);
  if (o.status === 'error') {
    protocolKeys(o, ['status', 'code']);
    if (!['invalid-input', 'unknown-dataset', 'unknown-point', 'stale-revision', 'corrupt-data', 'busy', 'unavailable'].includes(o.code as string)) throw new TypeError('Invalid error');
    return { status: 'error', code: o.code as 'unavailable' };
  }
  if (o.status === 'incomplete') {
    protocolKeys(o, ['status', 'complete', 'reason']);
    if (o.complete !== false || !['cancelled', 'resource', 'transport'].includes(o.reason as string)) throw new TypeError('Invalid incomplete');
    return { status: 'incomplete', complete: false, reason: o.reason as 'resource' };
  }
  if (o.status === 'verification-rejected') {
    protocolKeys(o, ['status', 'reason']); if (typeof o.reason !== 'string') throw new TypeError('Invalid rejection');
    return { status: 'verification-rejected', reason: 'adapter-rejected' };
  }
  throw new TypeError('Untrusted status');
}
/** Canonical semantics deliberately exclude elapsed time, cache identity, traversal and physical read work. */
export function semanticToolOutcome(outcome: ToolOutcome): unknown {
  if (outcome.status === 'observed') {
    if (outcome.kind === 'metadata') return outcome;
    const o = outcome.data;
    return { status: outcome.status, kind: outcome.kind, coverage: outcome.coverage, dataset: o.dataset, lod: o.lod,
      algorithm: o.algorithm, candidatePoints: o.candidatePoints, count: o.count, sampleHash: o.sampleHash };
  }
  if (outcome.status === 'verified-found' || outcome.status === 'verified-none') {
    return { status: outcome.status, complete: true, request: outcome.request, dataset: outcome.dataset,
      queryPosition: outcome.queryPosition, nearest: outcome.nearest,
      search: { algorithm: outcome.search.algorithm, arithmetic: outcome.search.arithmetic, configHash: outcome.search.configHash,
        completion: outcome.search.completion, matchingPoints: outcome.search.matchingPoints, categoryPoints: outcome.search.index?.points ?? null,
        coveredPoints: outcome.search.disk?.coveredPoints ?? null },
      verification: { verifier: outcome.verification.verifier, matchingPoints: outcome.verification.matchingPoints,
        categoryPoints: outcome.verification.index?.points ?? null, coveredPoints: outcome.verification.disk?.coveredPoints ?? null } };
  }
  return outcome;
}

export class ReadonlyToolRuntime {
  readonly binding: ToolBinding; readonly configuration: ToolConfiguration; readonly configHash: string;
  private calls = 0; private active = 0; private readonly requestIds = new Set<string>();
  private readonly records: ToolRecord[] = [];
  constructor(readonly runId: string, binding: ToolBinding, configuration: ToolConfiguration,
    private readonly adapter: ReadonlyToolAdapter, readonly hash: ProtocolHasher) {
    protocolToken(runId); assertToolBinding(binding); this.binding = freezeProtocolValue(detachedProtocolValue(binding));
    this.configuration = canonicalToolConfiguration(configuration); this.configHash = hash(canonicalProtocolJson(this.configuration)); protocolHash(this.configHash);
  }
  traceRecords(): readonly ToolRecord[] {
    if (this.records.length !== this.calls) throw new TypeError('Run has unpublished calls');
    return detachedProtocolValue(this.records);
  }
  async execute(value: unknown, signal?: AbortSignal): Promise<ToolReply> {
    let call: ToolRequest;
    try { call = freezeProtocolValue(canonicalToolRequest(value)); }
    catch { return this.reply(null, { status: 'error', code: 'invalid-input' }); }
    if (call.runId !== this.runId || canonicalProtocolJson(call.binding) !== canonicalProtocolJson(this.binding)) return this.reply(call, { status: 'error', code: 'stale-binding' });
    if (this.requestIds.has(call.requestId)) return this.reply(call, { status: 'error', code: 'invalid-input' });
    if (this.calls >= this.configuration.budgets.maxCalls) return this.reply(call, { status: 'error', code: 'budget' });
    if (this.active >= this.configuration.budgets.maxConcurrency) return this.reply(call, { status: 'error', code: 'busy' });
    this.calls++; this.requestIds.add(call.requestId);
    const start = performance.now(), expires = start + this.configuration.budgets.deadlineMs, controller = new AbortController();
    let reason: 'cancelled' | 'deadline' = 'cancelled';
    let wake!: (outcome: ToolOutcome) => void;
    const aborted = new Promise<ToolOutcome>(resolve => { wake = resolve; });
    const cancel = () => { controller.abort(); wake({ status: 'incomplete', complete: false, reason }); };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { reason = 'deadline'; cancel(); }, this.configuration.budgets.deadlineMs);
    if (signal?.aborted) cancel();
    this.active++;
    const work = (async (): Promise<ToolOutcome> => {
      let returned = false;
      try {
        controller.signal.throwIfAborted();
        const raw = await (call.tool === 'dataset.metadata' ? this.adapter.metadata(controller.signal) : call.tool === 'dataset.observe' ?
          this.adapter.observe(detachedProtocolValue(call.args.lod), controller.signal) : this.adapter.nearest(nearestRequestForTool(call), controller.signal));
        // Timers cannot fire while an adapter blocks the event loop: also enforce the monotonic deadline.
        if (!controller.signal.aborted && performance.now() >= expires) { reason = 'deadline'; cancel(); }
        controller.signal.throwIfAborted(); returned = true;
        const status = Object.getOwnPropertyDescriptor(protocolRecord(raw), 'status');
        if (status && (!('value' in status) || !status.enumerable)) throw new TypeError('Invalid status descriptor');
        // Freeform failure text is withheld, not copied. Success data is snapshotted once within
        // hard ceilings BEFORE validation/hash/publication; no original array hooks are invoked.
        if (status && !['verified-found', 'verified-none'].includes(status.value)) return failure(raw);
        const data = detachedProtocolValue(raw, { maxArrayLength: 4096 * 3, maxNodes: 50000, maxDepth: 8, maxObjectKeys: 32, maxStringLength: 128 });
        if (call.tool === 'dataset.metadata') {
          dataset(data, call.binding); return { status: 'observed', kind: 'metadata', coverage: 'metadata-only', data };
        }
        if (call.tool === 'dataset.observe') {
          observation(data, call, this.hash); return { status: 'observed', kind: 'observation', coverage: 'bounded-first-chunk-sample', data };
        }
        return nearest(data, call, this.configuration, this.hash);
      } catch {
        if (controller.signal.aborted) return { status: 'incomplete', complete: false, reason };
        if (!returned) return { status: 'error', code: 'unavailable' };
        return call.tool === 'dataset.nearest-label' ? { status: 'verification-rejected', reason: 'evidence-binding' } : { status: 'error', code: 'corrupt-data' };
      } finally { this.active--; }
    })();
    let outcome: ToolOutcome;
    try { outcome = await Promise.race([work, aborted]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    if (!controller.signal.aborted && performance.now() >= expires) { reason = 'deadline'; cancel(); }
    if (controller.signal.aborted) outcome = { status: 'incomplete', complete: false, reason };
    const semanticHash = this.hash(canonicalProtocolJson(semanticToolOutcome(outcome))); protocolHash(semanticHash);
    let readBytes: number | undefined;
    if (outcome.status === 'observed' && outcome.kind === 'observation') readBytes = outcome.data.bytesRead;
    else if ((outcome.status === 'verified-found' || outcome.status === 'verified-none') && outcome.sourceReads) {
      readBytes = outcome.sourceReads.metadataBytes + outcome.sourceReads.hierarchyBytes + outcome.sourceReads.payloadBytes;
      if (!Number.isSafeInteger(readBytes)) readBytes = undefined;
    }
    this.records.push({ call, status: outcome.status, semanticHash, metrics: { durationMs: Math.max(0, performance.now() - start), ...(readBytes === undefined ? {} : { readBytes }) } });
    return this.reply(call, outcome);
  }
  private reply(request: ToolRequest | null, outcome: ToolOutcome): ToolReply {
    return detachedProtocolValue({ schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION, request, outcome });
  }
}
