import type { Vec3 } from './index';
import { canonicalProtocolJson, freezeProtocolValue, protocolHash, protocolInteger, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';

/** Model-authored annotation hypotheses, never geometry, source points or verified evidence. */
export interface SceneMark {
  readonly id: string; readonly rank: number; readonly position: Vec3;
  readonly rationale: string; readonly uncertainty: string; readonly observationId?: string;
}
export interface SceneMarkSnapshot {
  readonly kind: 'scene-marks'; readonly annotationRevision: number;
  readonly binding: {
    readonly artifactRevision: string; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
    readonly localOrigin: readonly [627285, 4841948, 0];
    readonly points?: { readonly sessionId: string; readonly revision: number };
    readonly cad?: { readonly sessionId: string; readonly revision: number };
    readonly objects?: { readonly sessionId: string; readonly revision: number };
  };
  readonly marks: readonly SceneMark[];
}
export interface SetSceneMarksRequest {
  readonly expectedRevision: number;
  readonly marks: readonly { readonly id?: string; readonly position: Vec3; readonly rationale: string; readonly uncertainty: string }[];
}
function copy(value: unknown): Record<string, unknown> {
  return protocolRecord(JSON.parse(canonicalProtocolJson(value, { maxArrayLength: 20, maxNodes: 512, maxDepth: 8, maxStringLength: 400, maxObjectKeys: 10 })));
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 400 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Invalid annotation text');
}
function position(value: unknown): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)) throw new TypeError('Invalid annotation position');
}
function marks(value: unknown, snapshot: boolean): void {
  if (!Array.isArray(value) || value.length > 20) throw new TypeError('Invalid annotation list');
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const mark = protocolRecord(entry);
    protocolKeys(mark, snapshot ? ['id', 'rank', 'position', 'rationale', 'uncertainty'] : ['position', 'rationale', 'uncertainty'], snapshot ? ['observationId'] : ['id']);
    position(mark.position); text(mark.rationale); text(mark.uncertainty);
    if (mark.id !== undefined) { protocolToken(mark.id); if (ids.has(mark.id)) throw new TypeError('Duplicate annotation'); ids.add(mark.id); }
    if (snapshot && mark.rank !== index + 1) throw new TypeError('Invalid annotation order');
    if (mark.observationId !== undefined) protocolToken(mark.observationId);
  });
}
export function canonicalSetSceneMarksRequest(value: unknown): SetSceneMarksRequest {
  const r = copy(value); protocolKeys(r, ['expectedRevision', 'marks']); protocolInteger(r.expectedRevision); marks(r.marks, false);
  return freezeProtocolValue(r) as unknown as SetSceneMarksRequest;
}
export function canonicalSceneMarkSnapshot(value: unknown): SceneMarkSnapshot {
  const r = copy(value); protocolKeys(r, ['kind', 'annotationRevision', 'binding', 'marks']);
  if (r.kind !== 'scene-marks') throw new TypeError('Invalid annotation snapshot');
  protocolInteger(r.annotationRevision); marks(r.marks, true);
  const b = protocolRecord(r.binding); protocolKeys(b, ['artifactRevision', 'frameId', 'units', 'localOrigin'], ['points', 'cad', 'objects']);
  protocolHash(b.artifactRevision);
  if (b.frameId !== 'toronto3d-local-v1' || b.units !== 'm' || !Array.isArray(b.localOrigin) || b.localOrigin.length !== 3 || b.localOrigin.some((n, i) => n !== [627285, 4841948, 0][i])) throw new TypeError('Invalid annotation frame');
  for (const key of ['points', 'cad', 'objects']) if (b[key] !== undefined) {
    const a = protocolRecord(b[key]); protocolKeys(a, ['sessionId', 'revision']); protocolToken(a.sessionId); protocolInteger(a.revision);
  }
  return freezeProtocolValue(r) as unknown as SceneMarkSnapshot;
}
