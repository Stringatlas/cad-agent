import { canonicalSceneEvidenceLookup, canonicalEvidenceRetention } from './exploration-evidence';
import { PolygonTopologyError } from './polygon-topology';
import { assertVec3, type Vec3 } from './index';
import { canonicalSceneObjectReference, type AuthoredObjectReference } from './scene-objects';
import { canonicalModelVisualObservation } from './model-visual';
import type { ModelVisualObservation } from './model-visual';
import { SCENE_POINT_LIMIT, canonicalScenePointName, type ScenePointName } from './scene-points';
import { protocolRecord, protocolKeys, protocolToken, protocolHash, protocolInteger, canonicalProtocolJson } from './tool-protocol';
import { canonicalModelCloudScene, type ModelCloudScene } from './cloud-scene';
import { canonicalSceneRegion, canonicalSceneSourceBinding } from './spatial-region';
import { canonicalBrowserCaptureRequest, canonicalRelativeAdjustment, CaptureViewError, type BrowserCaptureRequest, type FrameTarget, type RelativeViewAdjustment } from './agent-view';

export const MODEL_CHAT_LIMITS = Object.freeze({ requestBytes: 65536, textChars: 12000, conversations: 8,
  conversationTtlMs: 30 * 60 * 1000, turns: 16, historyBytes: 512 * 1024, imageHistoryBytes: 12 * 1024 * 1024, providerBytes: 4 * 1024 * 1024, streamBytes: 16 * 1024 * 1024,
  outputChars: 32000, frameBytes: 128 * 1024, deadlineMs: 15 * 60 * 1000, models: 128, toolCalls: 64, skillCalls: 16, requestsPerMinute: 30 });
export interface ModelTorontoPoint {
  readonly name: ScenePointName; readonly datasetId: 'toronto3d'; readonly artifactRevision: string;
  readonly key: { readonly sourceFileId: number; readonly sourceRow: number }; readonly position: Vec3;
  readonly frameId: 'toronto3d-local-v1'; readonly units: 'm'; readonly handedness: 'right'; readonly upAxis: 'Z';
  readonly localOrigin: readonly [627285, 4841948, 0];
}
export interface ModelAreaOfInterest {
  readonly datasetId: 'toronto3d'; readonly artifactRevision: string;
  readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
  readonly localOrigin: readonly [627285, 4841948, 0];
  /** Ordered rectangle corners on a reference XY plane; all elevations are of interest. */
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
}
export interface ModelScene {
  readonly mode: 'toronto' | 'pole' | 'cloud';
  readonly toronto: readonly ModelTorontoPoint[];
  readonly cloud?: ModelCloudScene;
  readonly areaOfInterest?: ModelAreaOfInterest;
  readonly objects?: readonly AuthoredObjectReference[];
}
export interface ModelCatalog {
  readonly mode: 'disabled' | 'api-key' | 'chatgpt'; readonly ready: boolean; readonly code: string;
  readonly generation: string; readonly models: readonly { readonly id: string; readonly label: string }[];
}
export interface ModelTurnRequest {
  readonly requestId: string; readonly conversationId: string | null; readonly generation: string;
  readonly model: string; readonly text: string; readonly scene: ModelScene; readonly visualObservation?: ModelVisualObservation;
}
export const MODEL_INSPECTION_LIMITS = Object.freeze({ rounds: 81, snapshotBytes: 49152, textChars: 12000, inputItems: 128 });
export type ModelInspectionOmission = 'credentials-and-headers' | 'opaque-reasoning' | 'unrecognized-fields' | 'truncated' | 'image-bytes';
export interface ModelRequestInspection {
  readonly round: number; readonly mode: 'api-key' | 'chatgpt'; readonly continuation: boolean;
  readonly bodyJson: string; readonly omissions: readonly ModelInspectionOmission[];
}
export type ModelRequestPhase = 'dispatched' | 'completed' | 'failed' | 'cancelled';
export type ModelCaptureColorMode = 'rgb' | 'type' | 'semantic' | 'instance';
export type LegacyCaptureRequest = { readonly kind: 'current'; readonly colorMode?: ModelCaptureColorMode } | { readonly kind: 'top-down'; readonly colorMode?: ModelCaptureColorMode } |
  { readonly kind: 'camera'; readonly position: Vec3; readonly target: Vec3; readonly up?: Vec3; readonly colorMode?: ModelCaptureColorMode };
export type ModelCaptureRequest = LegacyCaptureRequest | { readonly kind: 'frame'; readonly target: FrameTarget; readonly orientation: 'top' | 'oblique'; readonly colorMode?: ModelCaptureColorMode } |
  ({ readonly kind: 'relative'; readonly observationId: string; readonly colorMode?: ModelCaptureColorMode } & RelativeViewAdjustment);
export type ModelReferenceSelection = { readonly kind: 'toronto-point'; readonly key: { readonly sourceFileId: number; readonly sourceRow: number } } |
  { readonly kind: 'cloud-point'; readonly cloudId: string; readonly revision: string; readonly key: { readonly sourceFileId: number; readonly sourceRow: number } };
export type ModelBrowserAction = { readonly kind: 'capture'; readonly request: BrowserCaptureRequest } | { readonly kind: 'select-reference'; readonly reference: ModelReferenceSelection };
export type ModelProposalAuthority = 'points' | 'cad' | 'objects';
export function canonicalModelCaptureRequest(value: unknown): ModelCaptureRequest {
  const r = protocolRecord(value);
  if (r.colorMode !== undefined && !['rgb', 'type', 'semantic', 'instance'].includes(String(r.colorMode))) throw new TypeError('Invalid capture color mode');
  if (r.kind === 'current' || r.kind === 'top-down') {
    protocolKeys(r, ['kind'], ['colorMode']);
    return { kind: r.kind, ...(r.colorMode === undefined ? {} : { colorMode: r.colorMode as ModelCaptureColorMode }) };
  }
  if (r.kind === 'relative') {
    protocolKeys(r, ['kind', 'observationId', 'azimuthDeltaDegrees', 'elevationDeltaDegrees', 'distanceScale'], ['colorMode']); protocolToken(r.observationId);
    return { kind: 'relative', observationId: r.observationId, ...canonicalRelativeAdjustment({ azimuthDeltaDegrees: r.azimuthDeltaDegrees, elevationDeltaDegrees: r.elevationDeltaDegrees, distanceScale: r.distanceScale }), ...(r.colorMode === undefined ? {} : { colorMode: r.colorMode as ModelCaptureColorMode }) };
  }
  if (r.kind === 'frame') {
    protocolKeys(r, ['kind', 'target', 'orientation'], ['colorMode']); if (r.orientation !== 'top' && r.orientation !== 'oblique') throw new TypeError('Invalid frame orientation');
    const t = protocolRecord(r.target); let target: FrameTarget;
    if (t.kind === 'reference') {
      protocolKeys(t, ['kind', 'reference', 'spanMeters']);
      if (typeof t.spanMeters !== 'number' || !Number.isFinite(t.spanMeters) || t.spanMeters < .2 || t.spanMeters > 100000) throw new CaptureViewError('invalid-region');
      target = { kind: 'reference', reference: canonicalModelReferenceSelection(t.reference), spanMeters: t.spanMeters };
    } else {
      protocolKeys(t, ['kind', 'region']); if (t.kind !== 'region') throw new TypeError('Invalid frame target');
      // Binding/protocol identity remains a hard failure. Malformed declared
      // topology is safe to revise and still consumes the previous capture base.
      canonicalSceneSourceBinding(protocolRecord(t.region).binding);
      try { target = { kind: 'region', region: canonicalSceneRegion(t.region) }; }
      catch (error) { if (error instanceof PolygonTopologyError) throw new CaptureViewError('invalid-region'); throw error; }
    }
    return { kind: 'frame', target, orientation: r.orientation, ...(r.colorMode === undefined ? {} : { colorMode: r.colorMode as ModelCaptureColorMode }) };
  }
  protocolKeys(r, ['kind', 'position', 'target'], ['up', 'colorMode']);
  if (r.kind !== 'camera') throw new TypeError('Invalid camera kind');
  assertVec3(r.position); assertVec3(r.target); if (r.up !== undefined) assertVec3(r.up);
  if ([...r.position, ...r.target, ...(r.up as Vec3 | undefined ?? [])].some(n => Math.abs(n) > 1e7) ||
    r.position.every((n, i) => n === (r.target as Vec3)[i])) throw new TypeError('Invalid camera');
  if (r.up !== undefined) {
    const up = r.up as Vec3, d = r.target.map((n, i) => n - (r.position as Vec3)[i]);
    if (Math.hypot(up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]) < 1e-9) throw new TypeError('Degenerate camera up');
  }
  return JSON.parse(JSON.stringify(r)) as ModelCaptureRequest;
}
export function canonicalModelReferenceSelection(value: unknown): ModelReferenceSelection {
  const r = protocolRecord(value);
  if (r.kind === 'cloud-point') {
    protocolKeys(r, ['kind', 'cloudId', 'revision', 'key']);
    if (typeof r.cloudId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(r.cloudId)) throw new TypeError('Invalid cloud ID');
    protocolHash(r.revision);
    const k = protocolRecord(r.key); protocolKeys(k, ['sourceFileId', 'sourceRow']);
    protocolInteger(k.sourceFileId, 65535); protocolInteger(k.sourceRow, 0xffffffff);
    return { kind: 'cloud-point', cloudId: r.cloudId, revision: String(r.revision), key: { sourceFileId: Number(k.sourceFileId), sourceRow: Number(k.sourceRow) } };
  }
  protocolKeys(r, ['kind', 'key']); if (r.kind !== 'toronto-point') throw new TypeError('Invalid reference');
  const key = protocolRecord(r.key); protocolKeys(key, ['sourceFileId', 'sourceRow']);
  protocolInteger(key.sourceFileId, 4); protocolInteger(key.sourceRow, 0xffffffff); if (key.sourceFileId < 1) throw new TypeError('Invalid source');
  return JSON.parse(JSON.stringify(r)) as ModelReferenceSelection;
}
export function canonicalModelBrowserAction(value: unknown): ModelBrowserAction {
  const r = protocolRecord(value);
  if (r.kind === 'capture') { protocolKeys(r, ['kind', 'request']); return { kind: r.kind, request: canonicalBrowserCaptureRequest(r.request) }; }
  protocolKeys(r, ['kind', 'reference']); if (r.kind !== 'select-reference') throw new TypeError('Invalid action');
  return { kind: r.kind, reference: canonicalModelReferenceSelection(r.reference) };
}
export type ModelChatEvent =
  | { readonly kind: 'request-inspection'; readonly requestId: string; readonly inspection: ModelRequestInspection }
  | { readonly kind: 'request-phase'; readonly requestId: string; readonly round: number; readonly phase: ModelRequestPhase }
  | { readonly kind: 'browser-request'; readonly requestId: string; readonly toolCallId: string; readonly nonce: string; readonly action: ModelBrowserAction }
  | { readonly kind: 'approval-wait'; readonly requestId: string; readonly proposalId: string; readonly authority: ModelProposalAuthority }
  | { readonly kind: 'approval-result'; readonly requestId: string; readonly proposalId: string; readonly authority: ModelProposalAuthority; readonly outcome: 'accepted' | 'declined' | 'invalidated'; readonly scene: ModelScene }
  | { readonly kind: 'start'; readonly requestId: string; readonly conversationId: string; readonly model: string }
  | { readonly kind: 'delta'; readonly requestId: string; readonly text: string }
  | { readonly kind: 'tool'; readonly requestId: string; readonly name: 'query_points' | 'get_scene_evidence' | 'query_elevation' | 'query_terrain_region' | 'terrain_profile' | 'filter_terrain_regions' | 'terrain_image' | 'ground_elevation' | 'set_scene_marks' | 'get_scene_marks' | 'list_skills' | 'load_skill' | 'finalize_area_candidates' | 'scan_area_candidates' | 'search_placement_sites' | 'propose_placement_site' | 'query_aoi_points' | 'list_objects' | 'get_object' | 'propose_point_create' | 'inspect_scene' | 'capture_scene' | 'select_reference' | 'resolve_visual_pixel' | 'nearest_label' | 'propose_point_move' | 'propose_point_move_to_nearest_label' | 'propose_cad_box' | 'propose_cad_cylinder' | 'assess_utility_box' | 'propose_utility_box'; readonly context: unknown }
  | { readonly kind: 'tool-request'; readonly requestId: string; readonly toolCallId: string; readonly nonce: string; readonly observationId: string; readonly x: number; readonly y: number }
  | { readonly kind: 'done'; readonly requestId: string; readonly conversationId: string }
  | { readonly kind: 'error'; readonly requestId: string; readonly code: string };
function boundedText(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid bounded text');
}
export function canonicalModelScene(value: unknown): ModelScene {
  const r = protocolRecord(value);
  if (r.mode === 'cloud') {
    protocolKeys(r, ['mode', 'toronto', 'cloud']);
    if (!Array.isArray(r.toronto) || r.toronto.length) throw new TypeError('Unmapped scene frames');
    return { mode: 'cloud', toronto: [], cloud: canonicalModelCloudScene(r.cloud) };
  }
  protocolKeys(r, ['mode', 'toronto'], ['areaOfInterest', 'objects']);
  if (typeof r.mode !== 'string' || !['toronto', 'pole'].includes(r.mode) || !Array.isArray(r.toronto) || r.toronto.length > SCENE_POINT_LIMIT) throw new TypeError('Invalid scene');
  if (r.mode === 'pole' && r.toronto.length !== 0) throw new TypeError('Unmapped scene frames');
  const toronto = r.toronto.map(value => {
    const p = protocolRecord(value); protocolKeys(p, ['name', 'datasetId', 'artifactRevision', 'key', 'position', 'frameId', 'units', 'handedness', 'upAxis', 'localOrigin']);
    const name = canonicalScenePointName(p.name);
    if (p.datasetId !== 'toronto3d' || p.frameId !== 'toronto3d-local-v1' || p.units !== 'm' || p.handedness !== 'right' || p.upAxis !== 'Z' || JSON.stringify(p.localOrigin) !== '[627285,4841948,0]') throw new TypeError('Invalid Toronto binding');
    protocolHash(p.artifactRevision); assertVec3(p.position);
    if (p.position.some(n => Math.abs(n) > 1e7)) throw new TypeError('Position limit');
    const key = protocolRecord(p.key); protocolKeys(key, ['sourceFileId', 'sourceRow']);
    protocolInteger(key.sourceFileId, 4); protocolInteger(key.sourceRow, 0xffffffff);
    if (key.sourceFileId < 1) throw new TypeError('Unknown source');
    return { name, datasetId: 'toronto3d', artifactRevision: p.artifactRevision,
      key: { sourceFileId: key.sourceFileId, sourceRow: key.sourceRow }, position: [...p.position] as Vec3,
      frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] } as const;
  });
  if (new Set(toronto.map(p => p.name)).size !== toronto.length || new Set(toronto.map(p => p.artifactRevision)).size > 1) throw new TypeError('Conflicting Toronto selections');
  let objects: AuthoredObjectReference[] | undefined;
  if (r.objects !== undefined) {
    if (r.mode !== 'toronto' || !Array.isArray(r.objects) || r.objects.length > SCENE_POINT_LIMIT) throw new TypeError('Invalid authored selections');
    objects = r.objects.map(value => { const ref = canonicalSceneObjectReference(value); if (ref.kind !== 'authored-object') throw new TypeError('Expected authored reference'); return ref; });
    if (new Set(objects.map(ref => ref.objectId)).size !== objects.length || new Set(objects.map(ref => `${ref.sessionId}:${ref.revision}`)).size > 1) throw new TypeError('Conflicting authored selections');
  }
  let areaOfInterest: ModelAreaOfInterest | undefined;
  if (r.areaOfInterest !== undefined) {
    const a = protocolRecord(r.areaOfInterest);
    protocolKeys(a, ['datasetId', 'artifactRevision', 'frameId', 'units', 'localOrigin', 'corners']);
    if (r.mode !== 'toronto' || a.datasetId !== 'toronto3d' || a.frameId !== 'toronto3d-local-v1' || a.units !== 'm' ||
      JSON.stringify(a.localOrigin) !== '[627285,4841948,0]' || !Array.isArray(a.corners) || a.corners.length !== 4) throw new TypeError('Invalid area binding');
    protocolHash(a.artifactRevision);
    const corners = a.corners.map(p => { assertVec3(p); if (p.some(n => Math.abs(n) > 1e7)) throw new TypeError('Area position limit'); return [...p] as Vec3; });
    const [p, q, s, t] = corners;
    const u = [q[0] - p[0], q[1] - p[1]], v = [t[0] - p[0], t[1] - p[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (lu < .01 || lv < .01 || corners.some(c => Math.abs(c[2] - p[2]) > 1e-6) ||
      Math.abs(u[0] * v[0] + u[1] * v[1]) > lu * lv * 1e-6 ||
      Math.hypot(s[0] - q[0] - t[0] + p[0], s[1] - q[1] - t[1] + p[1]) > 1e-5 ||
      toronto.some(point => point.artifactRevision !== a.artifactRevision)) throw new TypeError('Invalid XY rectangle');
    areaOfInterest = { datasetId: 'toronto3d', artifactRevision: a.artifactRevision, frameId: 'toronto3d-local-v1', units: 'm',
      localOrigin: [627285, 4841948, 0], corners: corners as unknown as ModelAreaOfInterest['corners'] };
  }
  return { mode: r.mode as ModelScene['mode'], toronto, ...(areaOfInterest ? { areaOfInterest } : {}), ...(objects ? { objects } : {}) };
}
export function canonicalModelTurnRequest(value: unknown): ModelTurnRequest {
  const r = protocolRecord(value); protocolKeys(r, ['requestId', 'conversationId', 'generation', 'model', 'text', 'scene'], ['visualObservation']);
  protocolToken(r.requestId); protocolToken(r.generation); if (r.conversationId !== null) protocolToken(r.conversationId);
  boundedText(r.model, 256); if (!/^[A-Za-z0-9._:/-]+$/u.test(r.model)) throw new TypeError('Invalid model');
  boundedText(r.text, MODEL_CHAT_LIMITS.textChars); if (!r.text.trim()) throw new TypeError('Empty message');
  return { requestId: r.requestId, conversationId: r.conversationId, generation: r.generation, model: r.model, text: r.text, scene: canonicalModelScene(r.scene),
    ...(r.visualObservation === undefined ? {} : { visualObservation: canonicalModelVisualObservation(r.visualObservation) }) };
}
export function canonicalModelCatalog(value: unknown): ModelCatalog {
  const r = protocolRecord(value); protocolKeys(r, ['mode', 'ready', 'code', 'generation', 'models']);
  if (typeof r.mode !== 'string' || !['disabled', 'api-key', 'chatgpt'].includes(r.mode) || typeof r.ready !== 'boolean' || !Array.isArray(r.models) || r.models.length > MODEL_CHAT_LIMITS.models) throw new TypeError('Invalid catalog');
  protocolToken(r.generation); protocolToken(r.code);
  const models = r.models.map(value => { const m = protocolRecord(value); protocolKeys(m, ['id', 'label']); boundedText(m.id, 256); boundedText(m.label, 256); return { id: m.id, label: m.label }; });
  if (new Set(models.map(m => m.id)).size !== models.length || (!r.ready && models.length) || (r.mode === 'disabled' && r.ready)) throw new TypeError('Invalid models');
  return { mode: r.mode as ModelCatalog['mode'], ready: r.ready, code: r.code, generation: r.generation, models };
}
export function canonicalModelChatEvent(value: unknown): ModelChatEvent {
  const r = protocolRecord(value); protocolToken(r.requestId);
  switch (r.kind) {
    case 'request-inspection': {
      protocolKeys(r, ['kind', 'requestId', 'inspection']);
      const s = protocolRecord(r.inspection); protocolKeys(s, ['round', 'mode', 'continuation', 'bodyJson', 'omissions']);
      protocolInteger(s.round, MODEL_INSPECTION_LIMITS.rounds); if (s.round < 1) throw new TypeError('Invalid inspection round');
      if ((s.mode !== 'api-key' && s.mode !== 'chatgpt') || typeof s.continuation !== 'boolean' || typeof s.bodyJson !== 'string' ||
        new TextEncoder().encode(s.bodyJson).byteLength > MODEL_INSPECTION_LIMITS.snapshotBytes ||
        !Array.isArray(s.omissions) || s.omissions.length > 5 || new Set(s.omissions).size !== s.omissions.length ||
        !s.omissions.includes('credentials-and-headers') || s.omissions.some(v => !['credentials-and-headers', 'opaque-reasoning', 'unrecognized-fields', 'truncated', 'image-bytes'].includes(v))) throw new TypeError('Invalid inspection');
      const body = JSON.parse(s.bodyJson); protocolRecord(body);
      canonicalProtocolJson(body, { maxArrayLength: 256, maxNodes: 10000, maxDepth: 24, maxStringLength: MODEL_INSPECTION_LIMITS.snapshotBytes });
      break;
    }
    case 'request-phase': protocolKeys(r, ['kind', 'requestId', 'round', 'phase']); protocolInteger(r.round, MODEL_INSPECTION_LIMITS.rounds);
      if (r.round < 1 || typeof r.phase !== 'string' || !['dispatched', 'completed', 'failed', 'cancelled'].includes(r.phase)) throw new TypeError('Invalid inspection phase'); break;
    case 'browser-request':
      protocolKeys(r, ['kind', 'requestId', 'toolCallId', 'nonce', 'action']);
      if (typeof r.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(r.toolCallId)) throw new TypeError('Invalid tool call ID');
      protocolToken(r.nonce); canonicalModelBrowserAction(r.action); break;
    case 'approval-wait': case 'approval-result':
      protocolKeys(r, ['kind', 'requestId', 'proposalId', 'authority', ...(r.kind === 'approval-result' ? ['outcome', 'scene'] : [])]);
      protocolToken(r.proposalId); if (typeof r.authority !== 'string' || !['points', 'cad', 'objects'].includes(r.authority)) throw new TypeError('Invalid authority');
      if (r.kind === 'approval-result') { if (typeof r.outcome !== 'string' || !['accepted', 'declined', 'invalidated'].includes(r.outcome)) throw new TypeError('Invalid approval outcome'); canonicalModelScene(r.scene); } break;
    case 'start': protocolKeys(r, ['kind', 'requestId', 'conversationId', 'model']); protocolToken(r.conversationId); boundedText(r.model, 256); break;
    case 'delta': protocolKeys(r, ['kind', 'requestId', 'text']); boundedText(r.text, MODEL_CHAT_LIMITS.outputChars); break;
    case 'tool': protocolKeys(r, ['kind', 'requestId', 'name', 'context']); if (typeof r.name !== 'string' || !['query_points', 'get_scene_evidence', 'query_elevation', 'query_terrain_region', 'terrain_profile', 'filter_terrain_regions', 'terrain_image', 'ground_elevation', 'set_scene_marks', 'get_scene_marks', 'list_skills', 'load_skill', 'finalize_area_candidates', 'scan_area_candidates', 'search_placement_sites', 'propose_placement_site', 'query_aoi_points', 'list_objects', 'get_object', 'propose_point_create', 'inspect_scene', 'capture_scene', 'select_reference', 'resolve_visual_pixel', 'nearest_label', 'propose_point_move', 'propose_point_move_to_nearest_label', 'propose_cad_box', 'propose_cad_cylinder', 'assess_utility_box', 'propose_utility_box'].includes(String(r.name)) || canonicalProtocolJson(r.context).length > MODEL_CHAT_LIMITS.frameBytes / 2) throw new TypeError('Invalid tool context');
      if (r.name === 'get_scene_evidence') canonicalSceneEvidenceLookup(r.context);
      if (['query_points', 'capture_scene', 'resolve_visual_pixel'].includes(String(r.name)) && protocolRecord(r.context).explorationEvidence !== undefined) canonicalEvidenceRetention(protocolRecord(r.context).explorationEvidence);
      break;
    case 'tool-request': protocolKeys(r, ['kind', 'requestId', 'toolCallId', 'nonce', 'observationId', 'x', 'y']);
      if (typeof r.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(r.toolCallId)) throw new TypeError('Invalid tool call ID');
      protocolToken(r.nonce); protocolToken(r.observationId); protocolInteger(r.x, 4095); protocolInteger(r.y, 4095); break;
    case 'done': protocolKeys(r, ['kind', 'requestId', 'conversationId']); protocolToken(r.conversationId); break;
    case 'error': protocolKeys(r, ['kind', 'requestId', 'code']); protocolToken(r.code); break;
    default: throw new TypeError('Unknown model event');
  }
  return r as unknown as ModelChatEvent;
}
