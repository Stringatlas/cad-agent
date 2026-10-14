import { canonicalPoleRequest, type NearestPoleRequest } from './semantic-query';
import type { DatasetInfo, PointLod, PointObservation } from './observation';
import type { NearestPoleToolOutcome } from './semantic-query';

export const TOOL_SCHEMA_VERSION = 'spatial-readonly-v1' as const;
export const TOOL_VERSION = 'readonly-tools-v1' as const;
export const PREPARED_ASSETS = ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin'] as const;
export type ToolName = 'dataset.metadata' | 'dataset.observe' | 'dataset.nearest-label';
export interface ToolBinding {
  readonly datasetId: 'toronto3d'; readonly artifactRevision: string; readonly artifactDigest: string;
  readonly units: 'm'; readonly frameId: 'toronto3d-local-v1';
}
export interface PreparedArtifactIdentity {
  readonly revision: string; readonly digest: string;
  readonly assets: readonly { readonly name: typeof PREPARED_ASSETS[number]; readonly size: number; readonly sha256: string }[];
}
export type ToolArguments = { readonly tool: 'dataset.metadata'; readonly args: Record<string, never> } |
  { readonly tool: 'dataset.observe'; readonly args: { readonly lod: PointLod } } |
  { readonly tool: 'dataset.nearest-label'; readonly args: Pick<NearestPoleRequest, 'input' | 'filter' | 'metric' | 'domain'> };
export type ToolRequest = ToolArguments & {
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION; readonly toolVersion: typeof TOOL_VERSION;
  readonly runId: string; readonly requestId: string; readonly binding: ToolBinding;
};
export type ProtocolFailure = { readonly status: 'error'; readonly code: 'invalid-input' | 'stale-binding' | 'budget' | 'busy' | 'corrupt-data' | 'unavailable' | 'unknown-dataset' | 'unknown-point' | 'stale-revision' } |
  { readonly status: 'incomplete'; readonly complete: false; readonly reason: 'cancelled' | 'deadline' | 'resource' | 'transport' } |
  { readonly status: 'verification-rejected'; readonly reason: 'adapter-rejected' | 'evidence-binding' };
export type ToolOutcome = ProtocolFailure |
  { readonly status: 'observed'; readonly kind: 'metadata'; readonly coverage: 'metadata-only'; readonly data: DatasetInfo } |
  { readonly status: 'observed'; readonly kind: 'observation'; readonly coverage: 'bounded-first-chunk-sample'; readonly data: PointObservation } |
  Extract<NearestPoleToolOutcome, { readonly complete: true }>;
export interface ToolReply {
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION; readonly toolVersion: typeof TOOL_VERSION;
  /** Invalid input is not echoed: it may contain paths, credentials or arbitrary strings. */
  readonly request: ToolRequest | null; readonly outcome: ToolOutcome;
}

/** Small shared validators; no framework, Node or concrete adapter dependencies. */
export function protocolRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid protocol object');
  return value as Record<string, unknown>;
}
export function protocolKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const names = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length || names.some(k => { const d = Object.getOwnPropertyDescriptor(value, k)!; return !('value' in d) || !d.enumerable; }) ||
    required.some(k => !Object.hasOwn(value, k)) || names.some(k => !required.includes(k) && !optional.includes(k))) throw new TypeError('Unexpected protocol fields');
}
export function protocolToken(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) throw new TypeError('Invalid protocol identifier');
}
export function protocolHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Invalid digest');
}
export function protocolInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new TypeError('Invalid protocol integer');
}
export function assertToolBinding(value: unknown): asserts value is ToolBinding {
  const b = protocolRecord(value); protocolKeys(b, ['datasetId', 'artifactRevision', 'artifactDigest', 'units', 'frameId']);
  if (b.datasetId !== 'toronto3d' || b.units !== 'm' || b.frameId !== 'toronto3d-local-v1') throw new TypeError('Invalid dataset frame');
  protocolHash(b.artifactRevision); protocolHash(b.artifactDigest);
}
/** Only dense, ordinary data arrays. Descriptors are inspected before values; no iterator/getter hooks. */
function protocolArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Invalid protocol array');
  const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as unknown;
  protocolInteger(length, maxLength);
  // Check the bound before enumerating indices or allocating a detached copy.
  if (Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== length + 1) throw new TypeError('Unexpected array fields');
  const copy: unknown[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw new TypeError('Invalid array element');
    copy[i] = d.value;
  }
  return copy;
}
export function assertPreparedArtifactIdentity(value: unknown): asserts value is PreparedArtifactIdentity {
  const a = protocolRecord(value); protocolKeys(a, ['revision', 'digest', 'assets']); protocolHash(a.revision); protocolHash(a.digest);
  const assets = protocolArray(a.assets, PREPARED_ASSETS.length);
  if (assets.length !== PREPARED_ASSETS.length) throw new TypeError('Invalid prepared assets');
  assets.forEach((value, i) => {
    const asset = protocolRecord(value); protocolKeys(asset, ['name', 'size', 'sha256']);
    if (asset.name !== PREPARED_ASSETS[i]) throw new TypeError('Invalid asset name/order');
    protocolInteger(asset.size); protocolHash(asset.sha256);
  });
}
export function nearestRequestForTool(request: Extract<ToolRequest, { tool: 'dataset.nearest-label' }>): NearestPoleRequest {
  return canonicalPoleRequest({ requestId: request.requestId, datasetId: request.binding.datasetId,
    expectedArtifactRevision: request.binding.artifactRevision, units: request.binding.units, frameId: request.binding.frameId, ...request.args });
}
export function canonicalToolRequest(value: unknown): ToolRequest {
  const r = protocolRecord(value); protocolKeys(r, ['schemaVersion', 'toolVersion', 'runId', 'requestId', 'binding', 'tool', 'args']);
  if (r.schemaVersion !== TOOL_SCHEMA_VERSION || r.toolVersion !== TOOL_VERSION) throw new TypeError('Unsupported tool version');
  protocolToken(r.runId); protocolToken(r.requestId); assertToolBinding(r.binding);
  const args = protocolRecord(r.args);
  const common = { schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION, runId: r.runId, requestId: r.requestId, binding: { ...r.binding } };
  if (r.tool === 'dataset.metadata') { protocolKeys(args, []); return { ...common, tool: r.tool, args: {} }; }
  if (r.tool === 'dataset.observe') {
    protocolKeys(args, ['lod']); const lod = protocolRecord(args.lod); protocolKeys(lod, ['budget', 'depth']);
    protocolInteger(lod.budget, 4096); protocolInteger(lod.depth, 3);
    if (!lod.budget) throw new TypeError('Empty observation budget');
    return { ...common, tool: r.tool, args: { lod: { budget: lod.budget, depth: lod.depth } } };
  }
  if (r.tool === 'dataset.nearest-label') {
    protocolKeys(args, ['input', 'filter', 'metric', 'domain']);
    const input = protocolRecord(args.input), filter = protocolRecord(args.filter), domain = protocolRecord(args.domain);
    protocolKeys(input, input.kind === 'coordinate' ? ['kind', 'position'] : ['kind', 'key']);
    if (input.kind === 'point-ref') protocolKeys(protocolRecord(input.key), ['sourceFileId', 'sourceRow']);
    protocolKeys(filter, ['schema', 'attribute', 'value']);
    protocolKeys(domain, domain.kind === 'whole-dataset' ? ['kind'] : ['kind', 'min', 'max']);
    // The existing query canonicalizer uses iteration. Feed it only inert, descriptor-copied triples.
    const safeInput = input.kind === 'coordinate' ? { ...input, position: protocolArray(input.position, 3) } : input;
    const safeDomain = domain.kind === 'aabb' ? { ...domain, min: protocolArray(domain.min, 3), max: protocolArray(domain.max, 3) } : domain;
    const q = canonicalPoleRequest({ requestId: r.requestId, datasetId: r.binding.datasetId,
      expectedArtifactRevision: r.binding.artifactRevision, units: r.binding.units, frameId: r.binding.frameId,
      input: safeInput, filter, metric: args.metric, domain: safeDomain });
    return { ...common, tool: r.tool, args: { input: q.input, filter: q.filter, metric: q.metric, domain: q.domain } };
  }
  throw new TypeError('Unknown tool');
}

interface ProtocolCopyLimits {
  readonly maxArrayLength?: number; readonly maxNodes?: number; readonly maxDepth?: number;
  readonly maxObjectKeys?: number; readonly maxStringLength?: number;
}
/** Sorted keys and normalized -0; rejects behavior-bearing objects/arrays before reading values.
 * Optional limits bound unvalidated adapter snapshots, not just their eventual validated output.
 * Like other JS structural checks, this is not a safety guarantee for arbitrary Proxy traps.
 */
export function canonicalProtocolJson(value: unknown, limits: ProtocolCopyLimits = {}): string {
  let nodes = 0;
  function order(v: unknown, depth: number): unknown {
    if (++nodes > (limits.maxNodes ?? 250000) || depth > (limits.maxDepth ?? 64)) throw new TypeError('Protocol copy budget');
    if (typeof v === 'string') {
      if (v.length > (limits.maxStringLength ?? Number.MAX_SAFE_INTEGER)) throw new TypeError('Protocol string budget');
      return v;
    }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
    if (Array.isArray(v)) {
      const array = protocolArray(v, limits.maxArrayLength ?? 50000);
      for (let i = 0; i < array.length; i++) array[i] = order(array[i], depth + 1);
      return array;
    }
    const object = protocolRecord(v), names = Object.getOwnPropertyNames(object);
    if (names.length > (limits.maxObjectKeys ?? 128)) throw new TypeError('Protocol object budget');
    protocolKeys(object, names);
    return Object.fromEntries(names.sort().map(key => [key, order(Object.getOwnPropertyDescriptor(object, key)!.value, depth + 1)]));
  }
  return JSON.stringify(order(value, 0));
}
export function detachedProtocolValue<T>(value: T, limits?: ProtocolCopyLimits): T { return JSON.parse(canonicalProtocolJson(value, limits)) as T; }
export function freezeProtocolValue<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeProtocolValue); Object.freeze(value); }
  return value;
}
