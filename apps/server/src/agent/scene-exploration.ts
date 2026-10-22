import { randomUUID } from 'node:crypto';
import { canonicalProtocolJson, canonicalSceneMarkSnapshot, canonicalSetSceneMarksRequest, type SceneMarkSnapshot } from '@spatial/contracts';

const vector = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
export const PERCEPTION_TOOLS = [
  { type: 'function', name: 'query_points', description: 'Measure ORIGINAL source points at your chosen local-meter position or inclusive box, independently of AOI or candidate pools. Nearest returns one point; radius/box return exact counts and capped witnesses, not nearest-k or recommendations. Accepted edits/ghosts are excluded. Zero observations is not free-space certification.',
    parameters: { type: 'object', properties: { operation: { type: 'string', enum: ['nearest', 'radius', 'box'] }, position: vector, radiusMeters: { type: 'number', minimum: 0, maximum: 1000 }, bounds: { type: 'object', properties: { min: vector, max: vector }, required: ['min', 'max'], additionalProperties: false }, label: { type: ['integer', 'null'], minimum: 0, maximum: 65535 }, maxResults: { type: 'integer', minimum: 1, maximum: 64 } }, required: ['operation', 'maxResults'], additionalProperties: false }, strict: false },
  { type: 'function', name: 'ground_elevation', description: 'Inspect observed original-source ground elevation at your chosen local-meter x,y. Returns cell/interpolation support or unavailable. No extrapolation, foundation or clearance certification; does not move your marks.',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false }, strict: true },
];
export const MARK_TOOLS = [
  { type: 'function', name: 'get_scene_marks', description: 'Read current lightweight model hypotheses and annotation revision. These are disposable scene annotations, not authored geometry or verified source points.', parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
  { type: 'function', name: 'set_scene_marks', description: 'Replace your scene hypotheses at arbitrary local-meter positions. Array order becomes C1–Cn; omit an existing ID to remove it, omit id on a new mark, empty marks clears. Preserve returned IDs to revise/reorder. expectedRevision prevents stale replacement. Explain rationale and unknowns; no scan prerequisite, automatic snapping, geometry mutation or suitability certification. Server attaches only an observation receipt, not proof of assessment.',
    parameters: { type: 'object', properties: { expectedRevision: { type: 'integer', minimum: 0 }, marks: { type: 'array', maxItems: 20, items: { type: 'object', properties: { id: { type: 'string' }, position: vector, rationale: { type: 'string', maxLength: 400 }, uncertainty: { type: 'string', maxLength: 400 } }, required: ['position', 'rationale', 'uncertainty'], additionalProperties: false } } }, required: ['expectedRevision', 'marks'], additionalProperties: false }, strict: false },
];

/** Annotation-only state; no geometry authority, source identity or measurement claims. */
export class SceneExploration {
  private value: SceneMarkSnapshot;
  constructor(binding: SceneMarkSnapshot['binding'], previous?: SceneMarkSnapshot) {
    this.value = canonicalSceneMarkSnapshot(previous && canonicalProtocolJson(previous.binding) === canonicalProtocolJson(binding) ? previous :
      { kind: 'scene-marks', annotationRevision: 0, binding, marks: [] });
  }
  snapshot(): SceneMarkSnapshot { return this.value; }
  replace(args: unknown, observationId?: string): SceneMarkSnapshot | { kind: 'scene-marks-conflict'; current: SceneMarkSnapshot; recovery: string } {
    const request = canonicalSetSceneMarksRequest(args);
    if (request.expectedRevision !== this.value.annotationRevision || request.marks.some(m => m.id && !this.value.marks.some(old => old.id === m.id))) {
      return { kind: 'scene-marks-conflict', current: this.value, recovery: 'Read current marks, preserve known IDs only, and retry with current annotationRevision. Nothing changed.' };
    }
    this.value = canonicalSceneMarkSnapshot({ ...this.value, annotationRevision: this.value.annotationRevision + 1,
      marks: request.marks.map((mark, i) => ({ ...mark, id: mark.id ?? randomUUID(), rank: i + 1, ...(observationId ? { observationId } : {}) })) });
    return this.value;
  }
}
