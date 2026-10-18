import { assertVec3, type Vec3 } from './index';
import { canonicalModelVisualObservation } from './model-visual';
import type { ModelVisualObservation } from './model-visual';
import { SCENE_POINT_LIMIT, canonicalScenePointName, canonicalSceneContextRequest, type ScenePointName, type SceneContextRequest } from './project-edit';
import { protocolRecord, protocolKeys, protocolToken, protocolHash, protocolInteger, canonicalProtocolJson } from './tool-protocol';

export const MODEL_CHAT_LIMITS = Object.freeze({ requestBytes: 65536, textChars: 12000, conversations: 8,
  conversationTtlMs: 30 * 60 * 1000, turns: 16, historyBytes: 256 * 1024, providerBytes: 1024 * 1024,
  outputChars: 32000, frameBytes: 128 * 1024, deadlineMs: 90000, models: 128, toolCalls: 2, requestsPerMinute: 30 });
export interface ModelTorontoPoint {
  readonly name: ScenePointName; readonly datasetId: 'toronto3d'; readonly artifactRevision: string;
  readonly key: { readonly sourceFileId: number; readonly sourceRow: number }; readonly position: Vec3;
  readonly frameId: 'toronto3d-local-v1'; readonly units: 'm'; readonly handedness: 'right'; readonly upAxis: 'Z';
  readonly localOrigin: readonly [627285, 4841948, 0];
}
export interface ModelScene {
  readonly mode: 'toronto' | 'demo' | 'pole'; readonly project: SceneContextRequest | null;
  readonly toronto: readonly ModelTorontoPoint[];
}
export interface ModelCatalog {
  readonly mode: 'disabled' | 'api-key' | 'chatgpt'; readonly ready: boolean; readonly code: string;
  readonly generation: string; readonly models: readonly { readonly id: string; readonly label: string }[];
}
export interface ModelTurnRequest {
  readonly requestId: string; readonly conversationId: string | null; readonly generation: string;
  readonly model: string; readonly text: string; readonly scene: ModelScene; readonly visualObservation?: ModelVisualObservation;
}
export const MODEL_INSPECTION_LIMITS = Object.freeze({ rounds: 3, snapshotBytes: 49152, textChars: 12000, inputItems: 128 });
export type ModelInspectionOmission = 'credentials-and-headers' | 'opaque-reasoning' | 'unrecognized-fields' | 'truncated' | 'image-bytes';
export interface ModelRequestInspection {
  readonly round: number; readonly mode: 'api-key' | 'chatgpt'; readonly continuation: boolean;
  readonly bodyJson: string; readonly omissions: readonly ModelInspectionOmission[];
}
export type ModelRequestPhase = 'dispatched' | 'completed' | 'failed' | 'cancelled';
export type ModelChatEvent =
  | { readonly kind: 'request-inspection'; readonly requestId: string; readonly inspection: ModelRequestInspection }
  | { readonly kind: 'request-phase'; readonly requestId: string; readonly round: number; readonly phase: ModelRequestPhase }
  | { readonly kind: 'start'; readonly requestId: string; readonly conversationId: string; readonly model: string }
  | { readonly kind: 'delta'; readonly requestId: string; readonly text: string }
  | { readonly kind: 'tool'; readonly requestId: string; readonly name: 'inspect_scene' | 'resolve_visual_pixel' | 'nearest_label' | 'propose_box_create' | 'propose_box_update' | 'propose_point_move' | 'propose_point_move_to_nearest_label' | 'propose_cad_box' | 'propose_cad_cylinder' | 'assess_utility_box' | 'propose_utility_box'; readonly context: unknown }
  | { readonly kind: 'tool-request'; readonly requestId: string; readonly toolCallId: string; readonly nonce: string; readonly observationId: string; readonly x: number; readonly y: number }
  | { readonly kind: 'done'; readonly requestId: string; readonly conversationId: string }
  | { readonly kind: 'error'; readonly requestId: string; readonly code: string };
function boundedText(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid bounded text');
}
export function canonicalModelScene(value: unknown): ModelScene {
  const r = protocolRecord(value); protocolKeys(r, ['mode', 'project', 'toronto']);
  if (typeof r.mode !== 'string' || !['demo', 'toronto', 'pole'].includes(r.mode) || !Array.isArray(r.toronto) || r.toronto.length > SCENE_POINT_LIMIT) throw new TypeError('Invalid scene');
  const project = r.project === null ? null : canonicalSceneContextRequest(r.project);
  // Non-demo scenes may carry an empty authoritative revision binding, never hidden synthetic selections.
  if ((r.mode === 'demo' && r.toronto.length !== 0) ||
    (r.mode !== 'demo' && project !== null && (project.entityIds.length !== 0 || project.points.length !== 0)) ||
    (r.mode === 'pole' && r.toronto.length !== 0)) throw new TypeError('Unmapped scene frames');
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
  return { mode: r.mode as ModelScene['mode'], project, toronto };
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
    case 'start': protocolKeys(r, ['kind', 'requestId', 'conversationId', 'model']); protocolToken(r.conversationId); boundedText(r.model, 256); break;
    case 'delta': protocolKeys(r, ['kind', 'requestId', 'text']); boundedText(r.text, MODEL_CHAT_LIMITS.outputChars); break;
    case 'tool': protocolKeys(r, ['kind', 'requestId', 'name', 'context']); if (!['inspect_scene', 'resolve_visual_pixel', 'nearest_label', 'propose_box_create', 'propose_box_update', 'propose_point_move', 'propose_point_move_to_nearest_label', 'propose_cad_box', 'propose_cad_cylinder', 'assess_utility_box', 'propose_utility_box'].includes(String(r.name)) || canonicalProtocolJson(r.context).length > MODEL_CHAT_LIMITS.frameBytes / 2) throw new TypeError('Invalid tool context'); break;
    case 'tool-request': protocolKeys(r, ['kind', 'requestId', 'toolCallId', 'nonce', 'observationId', 'x', 'y']);
      if (typeof r.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(r.toolCallId)) throw new TypeError('Invalid tool call ID');
      protocolToken(r.nonce); protocolToken(r.observationId); protocolInteger(r.x, 4095); protocolInteger(r.y, 4095); break;
    case 'done': protocolKeys(r, ['kind', 'requestId', 'conversationId']); protocolToken(r.conversationId); break;
    case 'error': protocolKeys(r, ['kind', 'requestId', 'code']); protocolToken(r.code); break;
    default: throw new TypeError('Unknown model event');
  }
  return r as unknown as ModelChatEvent;
}
