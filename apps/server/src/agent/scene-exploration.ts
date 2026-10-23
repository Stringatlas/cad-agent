import { randomUUID } from 'node:crypto';
import { evidenceHash } from './exploration-evidence';
import { canonicalProtocolJson, canonicalSceneMarkSnapshot, canonicalSetSceneMarksRequest, canonicalSceneSourceBinding, canonicalSceneEvidenceProjection, canonicalSceneEvidenceReceipt, EXPLORATION_EVIDENCE_LIMITS, evidenceUtf8Bytes, protocolToken, freezeProtocolValue, type SceneEvidenceReceipt, type SceneEvidenceProjection, type EvidenceRetention, type SceneSourceBinding, type SceneMarkSnapshot } from '@spatial/contracts';

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

export const EVIDENCE_LOOKUP_TOOL = { type: 'function', name: 'get_scene_evidence', description: 'Read one actually issued historical conversation evidence receipt by ID. Metadata and capped original-source witnesses only; no image rehydration, selection, view resume, current geometry or clearance authority. Missing/evicted/stale IDs return unavailable.', parameters: { type: 'object', properties: { evidenceId: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['evidenceId'], additionalProperties: false }, strict: true };
export interface SceneExplorationSource { readonly binding: SceneSourceBinding; readonly adapter: SceneEvidenceReceipt['adapter'] }
export interface SceneExplorationCheckpoint {
  readonly kind: 'scene-exploration'; readonly marks: SceneMarkSnapshot;
  readonly source?: SceneExplorationSource; readonly receipts: readonly SceneEvidenceReceipt[];
  readonly pinnedEvidenceIds: readonly string[]; readonly resetReason?: 'source-changed';
}
/** One immutable conversation checkpoint; no geometry authority or browser buffers. */
export class SceneExploration {
  private value: SceneExplorationCheckpoint;
  private readonly limits: { records: number; recordBytes: number; checkpointBytes: number };
  constructor(binding: SceneMarkSnapshot['binding'], previous?: SceneMarkSnapshot | SceneExplorationCheckpoint, source?: SceneExplorationSource,
    limits: Partial<{ records: number; recordBytes: number; checkpointBytes: number }> = {}) {
    this.limits = { records: EXPLORATION_EVIDENCE_LIMITS.records, recordBytes: EXPLORATION_EVIDENCE_LIMITS.recordBytes, checkpointBytes: EXPLORATION_EVIDENCE_LIMITS.checkpointBytes };
    for (const k of ['records', 'recordBytes', 'checkpointBytes'] as const) if (limits[k] !== undefined) {
      if (!Number.isSafeInteger(limits[k]) || limits[k]! < 1) throw new TypeError('Invalid internal evidence budget');
      this.limits[k] = Math.min(this.limits[k], limits[k]!);
    }
    const checkpoint = previous?.kind === 'scene-exploration' ? previous : undefined;
    if (checkpoint && (!Array.isArray(checkpoint.receipts) || checkpoint.receipts.length > EXPLORATION_EVIDENCE_LIMITS.records || !Array.isArray(checkpoint.pinnedEvidenceIds) || checkpoint.pinnedEvidenceIds.length > EXPLORATION_EVIDENCE_LIMITS.records)) throw new TypeError('Invalid evidence checkpoint bounds');
    const oldMarks = checkpoint?.marks ?? (previous?.kind === 'scene-marks' ? previous : undefined);
    const marks = canonicalSceneMarkSnapshot(oldMarks && canonicalProtocolJson(oldMarks.binding) === canonicalProtocolJson(binding) ? oldMarks : { kind: 'scene-marks', annotationRevision: 0, binding, marks: [] });
    const checkedSource = source ? { binding: canonicalSceneSourceBinding(source.binding), adapter: source.adapter } : undefined;
    if (checkedSource && !['prepared', 'toronto'].includes(checkedSource.adapter)) throw new TypeError('Invalid exploration adapter');
    const sameSource = checkedSource && checkpoint?.source && canonicalProtocolJson(checkedSource) === canonicalProtocolJson(checkpoint.source);
    const receipts = sameSource ? checkpoint.receipts.map(value => {
      const receipt = canonicalSceneEvidenceReceipt(value);
      if (receipt.projectionHash !== evidenceHash(receipt.projection) || canonicalProtocolJson(receipt.sourceBinding) !== canonicalProtocolJson(checkedSource.binding) || receipt.adapter !== checkedSource.adapter) throw new TypeError('Invalid retained evidence');
      return receipt;
    }) : [];
    this.value = freezeProtocolValue({ kind: 'scene-exploration', marks, ...(checkedSource ? { source: checkedSource } : {}), receipts,
      pinnedEvidenceIds: sameSource ? [...checkpoint.pinnedEvidenceIds] : [], ...(checkpoint?.source && !sameSource ? { resetReason: 'source-changed' as const } : {}) });
    if (new Set(receipts.map(r => r.evidenceId)).size !== receipts.length || this.value.pinnedEvidenceIds.some(id => !receipts.some(r => r.evidenceId === id))) throw new TypeError('Invalid evidence checkpoint IDs');
    const bounded = this.fit(this.value); if (!bounded) throw new RangeError('Exploration checkpoint limit'); this.value = freezeProtocolValue(bounded);
  }
  snapshot(): SceneMarkSnapshot { return this.value.marks; }
  checkpoint(): SceneExplorationCheckpoint { return this.value; }
  matchesSource(source: SceneExplorationSource | undefined): boolean { return !!source && canonicalProtocolJson(source) === canonicalProtocolJson(this.value.source ?? null); }
  private fit(candidate: SceneExplorationCheckpoint): SceneExplorationCheckpoint | undefined {
    const receipts = [...candidate.receipts], pins = new Set(candidate.pinnedEvidenceIds);
    while (receipts.length > this.limits.records || evidenceUtf8Bytes({ ...candidate, receipts }) > this.limits.checkpointBytes) {
      const index = receipts.findIndex(r => !pins.has(r.evidenceId)); if (index < 0) return undefined; receipts.splice(index, 1);
    }
    return { ...candidate, receipts };
  }
  /** Internal future-link primitive only; no model tool/mark links in4b1a. */
  setEvidencePins(ids: readonly string[]): boolean {
    if (new Set(ids).size !== ids.length || ids.length > EXPLORATION_EVIDENCE_LIMITS.records || ids.some(id => !this.value.receipts.some(r => r.evidenceId === id))) return false;
    const candidate = this.fit({ ...this.value, pinnedEvidenceIds: [...ids] }); if (!candidate) return false;
    this.value = freezeProtocolValue(candidate); return true;
  }
  admit(projection: SceneEvidenceProjection | undefined, turn: number): EvidenceRetention {
    const source = this.value.source; if (!source || !projection) return { status: 'unavailable', reason: 'unsupported-result' };
    let receipt: SceneEvidenceReceipt;
    try {
      const checked = canonicalSceneEvidenceProjection(projection, source.binding, source.adapter);
      if (checked.tool === 'capture_scene' && (checked.requestedScopeHash !== evidenceHash({ binding: source.binding, request: checked.request }) || checked.effectiveScopeHash !== evidenceHash({ binding: source.binding, effective: checked.effective, authority: checked.authority, ...(checked.result.status === 'captured' ? { observation: checked.result.observation } : {}) }))) throw new TypeError('Invalid capture scope hashes');
      receipt = canonicalSceneEvidenceReceipt({ schemaVersion: 1, evidenceId: '00000000-0000-0000-0000-000000000000', sourceBinding: source.binding, adapter: source.adapter, turn, projectionHash: evidenceHash(checked), projection: checked });
    } catch (error) { return { status: 'unavailable', reason: error instanceof RangeError ? 'record-too-large' : 'unsupported-result' }; }
    if (evidenceUtf8Bytes(receipt) > this.limits.recordBytes) return { status: 'unavailable', reason: 'record-too-large' };
    const candidate = this.fit({ ...this.value, receipts: [...this.value.receipts, receipt] });
    // The new record is never silently evicted to make its own admission succeed.
    if (!candidate || !candidate.receipts.includes(receipt)) return { status: 'unavailable', reason: 'retention-limit' };
    const evidenceId = randomUUID();
    this.value = freezeProtocolValue({ ...candidate, receipts: candidate.receipts.map(r => r === receipt ? { ...r, evidenceId } : r) });
    return { status: 'retained', evidenceId };
  }
  evidence(id: string) {
    protocolToken(id); const receipt = this.value.receipts.find(r => r.evidenceId === id);
    return receipt ? { status: 'available' as const, receipt } : { status: 'unavailable' as const, reason: 'not-retained' as const };
  }
  catalogue() {
    const latest = this.value.receipts.slice(-EXPLORATION_EVIDENCE_LIMITS.catalogueItems).reverse().map(r => ({ evidenceId: r.evidenceId, tool: r.projection.tool, status: r.projection.result.status, turn: r.turn }));
    const catalogue = { receiptTypes: ['query_points', 'capture_scene', 'resolve_visual_pixel'], count: this.value.receipts.length, latest, ...(this.value.resetReason ? { resetReason: this.value.resetReason } : {}) };
    while (evidenceUtf8Bytes(catalogue) > EXPLORATION_EVIDENCE_LIMITS.catalogueBytes && latest.length) latest.pop();
    return catalogue;
  }
  replace(args: unknown, observationId?: string): SceneMarkSnapshot | { kind: 'scene-marks-conflict'; current: SceneMarkSnapshot; recovery: string } {
    const request = canonicalSetSceneMarksRequest(args), current = this.value.marks;
    if (request.expectedRevision !== current.annotationRevision || request.marks.some(m => m.id && !current.marks.some(old => old.id === m.id))) {
      return { kind: 'scene-marks-conflict', current, recovery: 'Read current marks, preserve known IDs only, and retry with current annotationRevision. Nothing changed.' };
    }
    const marks = canonicalSceneMarkSnapshot({ ...current, annotationRevision: current.annotationRevision + 1,
      marks: request.marks.map((mark, i) => ({ ...mark, id: mark.id ?? randomUUID(), rank: i + 1, ...(observationId ? { observationId } : {}) })) });
    const candidate = this.fit({ ...this.value, marks }); if (!candidate) throw new RangeError('Exploration checkpoint limit');
    this.value = freezeProtocolValue(candidate); return marks;
  }
}
