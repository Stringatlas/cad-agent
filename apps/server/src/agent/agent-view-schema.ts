import type { SceneCaptureCapabilities } from './agent-view-source';
const vec = { type: 'array', items: { type: 'number', minimum: -1e7, maximum: 1e7 }, minItems: 3, maxItems: 3 };
const closed = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export function captureRequestSchema(capabilities?: SceneCaptureCapabilities, preview = false): Record<string, unknown> {
  const colors = capabilities?.colorModes ?? ['rgb', 'type', 'semantic', 'instance'];
  const colorMode = { type: 'string', enum: colors };
  const legacy = [closed({ kind: { enum: ['current', 'top-down'] }, colorMode }, ['kind']), closed({ kind: { enum: ['camera'] }, position: vec, target: vec, up: vec, colorMode }, ['kind', 'position', 'target'])];
  const kinds = ['current', 'top-down', 'camera'];
  if (!capabilities && !preview) return { ...closed({ kind: { type: 'string', enum: kinds }, position: vec, target: vec, up: vec, colorMode }, ['kind']), anyOf: legacy };
  kinds.push('frame', 'relative');
  const b = capabilities?.binding, torontoSource = capabilities?.referenceKind === 'toronto-point';
  const token = { type: 'string', minLength: 1, maxLength: 128 };
  const binding = closed({ sourceId: b ? { enum: [b.sourceId] } : token, sourceRevision: b ? { enum: [b.sourceRevision] } : { type: 'string', pattern: '^[a-f0-9]{64}$' }, frameId: b ? { enum: [b.frameId] } : token, units: { enum: ['m'] }, origin: b ? { enum: [[...b.origin]] } : vec });
  const key = closed({ sourceFileId: { type: 'integer', minimum: torontoSource ? 1 : 0, maximum: torontoSource ? 4 : 65535 }, sourceRow: { type: 'integer', minimum: 0, maximum: 0xffffffff } });
  const toronto = closed({ kind: { enum: ['toronto-point'] }, key });
  const cloud = closed({ kind: { enum: ['cloud-point'] }, cloudId: b ? { enum: [b.sourceId] } : token, revision: b ? { enum: [b.sourceRevision] } : token, key });
  const reference = b ? torontoSource ? toronto : cloud : { anyOf: [toronto, cloud] };
  const region = closed({ binding, shape: { anyOf: [
    closed({ kind: { enum: ['box'] }, bounds: closed({ min: vec, max: vec }) }),
    closed({ kind: { enum: ['polygon-prism'] }, polygon: { type: 'array', minItems: 3, maxItems: 64, items: { type: 'array', items: { type: 'number', minimum: -1e7, maximum: 1e7 }, minItems: 2, maxItems: 2 } }, z: closed({ min: { type: 'number', minimum: -1e7, maximum: 1e7 }, max: { type: 'number', minimum: -1e7, maximum: 1e7 } }) }),
  ] } });
  const target = { anyOf: [closed({ kind: { enum: ['reference'] }, reference, spanMeters: { type: 'number', minimum: .2, maximum: 100000 } }), closed({ kind: { enum: ['region'] }, region })] };
  const relative = { observationId: token, azimuthDeltaDegrees: { type: 'number', minimum: -180, maximum: 180 }, elevationDeltaDegrees: { type: 'number', minimum: -85, maximum: 85 }, distanceScale: { type: 'number', minimum: .25, maximum: 4 } };
  return { ...closed({ kind: { type: 'string', enum: kinds }, position: vec, target: { anyOf: [vec, target] }, up: vec, colorMode, orientation: { enum: ['top', 'oblique'] }, ...relative }, ['kind']),
    anyOf: [...legacy, closed({ kind: { enum: ['frame'] }, target, orientation: { enum: ['top', 'oblique'] }, colorMode }, ['kind', 'target', 'orientation']), closed({ kind: { enum: ['relative'] }, ...relative, colorMode }, ['kind', ...Object.keys(relative)])] };
}
