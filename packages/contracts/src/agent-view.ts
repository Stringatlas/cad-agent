import { assertVec3, type Vec3 } from './index';
import { canonicalProtocolJson, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';
import { canonicalSceneBox, sceneRegionBounds, canonicalSceneRegion, canonicalSceneSourceBinding, type SceneBox, type SceneRegion, type SceneSourceBinding } from './spatial-region';
import { canonicalModelCaptureRequest, canonicalModelReferenceSelection, type LegacyCaptureRequest, type ModelCaptureColorMode, type ModelReferenceSelection } from './model-chat';
export const CAPTURE_UNAVAILABLE_REASONS = ['invalid-region', 'outside-source-bounds', 'invalid-view-adjustment', 'numerical-range', 'unsupported', 'view-unavailable', 'detail-unavailable', 'cancelled'] as const;
export type CaptureUnavailableReason = typeof CAPTURE_UNAVAILABLE_REASONS[number];
export class CaptureViewError extends Error { constructor(readonly code: CaptureUnavailableReason) { super(code); this.name = 'CaptureViewError'; } }
export function canonicalCaptureReason(value: unknown): CaptureUnavailableReason {
  if (!CAPTURE_UNAVAILABLE_REASONS.includes(value as CaptureUnavailableReason)) throw new TypeError('Invalid capture reason'); return value as CaptureUnavailableReason;
}
export interface RelativeViewAdjustment { readonly azimuthDeltaDegrees: number; readonly elevationDeltaDegrees: number; readonly distanceScale: number }
export function canonicalRelativeAdjustment(value: unknown): RelativeViewAdjustment {
  const r = protocolRecord(value); protocolKeys(r, ['azimuthDeltaDegrees', 'elevationDeltaDegrees', 'distanceScale']);
  if (typeof r.azimuthDeltaDegrees !== 'number' || !Number.isFinite(r.azimuthDeltaDegrees) || Math.abs(r.azimuthDeltaDegrees) > 180 || typeof r.elevationDeltaDegrees !== 'number' || !Number.isFinite(r.elevationDeltaDegrees) || Math.abs(r.elevationDeltaDegrees) > 85 || typeof r.distanceScale !== 'number' || !Number.isFinite(r.distanceScale) || r.distanceScale < .25 || r.distanceScale > 4) throw new CaptureViewError('invalid-view-adjustment');
  return { azimuthDeltaDegrees: r.azimuthDeltaDegrees, elevationDeltaDegrees: r.elevationDeltaDegrees, distanceScale: r.distanceScale };
}
export type FrameTarget = { readonly kind: 'reference'; readonly reference: ModelReferenceSelection; readonly spanMeters: number } | { readonly kind: 'region'; readonly region: SceneRegion };
export interface AgentViewState { readonly pivot: Vec3; readonly bounds: SceneBox; readonly azimuthDegrees: number; readonly elevationDegrees: number; readonly distance: number; readonly fov: number; readonly zoom: number; readonly expanded: boolean; readonly fitGuaranteed: boolean; readonly targetBehind: boolean }
export interface AgentViewReceipt extends AgentViewState { readonly schemaVersion: 1; readonly scope: 'current-turn'; readonly targetKind: 'original-source-reference' | 'declared-box' | 'declared-polygon-prism' | 'browser-focus' | 'explicit-camera'; readonly layer: string; readonly colorMode: ModelCaptureColorMode; readonly fitMethod?: 'enclosing-box'; readonly requested?: RelativeViewAdjustment; readonly reference?: ModelReferenceSelection; readonly region?: SceneRegion }
export type BrowserCaptureRequest = LegacyCaptureRequest | { readonly kind: 'framed'; readonly binding: SceneSourceBinding; readonly bounds: SceneBox; readonly pivot: Vec3; readonly orientation: 'top' | 'oblique'; readonly targetKind: 'original-source-reference' | 'declared-box' | 'declared-polygon-prism'; readonly reference?: ModelReferenceSelection; readonly region?: SceneRegion; readonly colorMode?: ModelCaptureColorMode } | { readonly kind: 'adjust'; readonly binding: SceneSourceBinding; readonly observationId: string; readonly base: AgentViewReceipt; readonly adjustment: RelativeViewAdjustment; readonly colorMode?: ModelCaptureColorMode };
export function canonicalAgentViewReceipt(value: unknown): AgentViewReceipt {
  const r = protocolRecord(value); protocolKeys(r, ['schemaVersion', 'scope', 'targetKind', 'pivot', 'bounds', 'azimuthDegrees', 'elevationDegrees', 'distance', 'fov', 'zoom', 'expanded', 'fitGuaranteed', 'targetBehind', 'layer', 'colorMode'], ['requested', 'reference', 'region', 'fitMethod']);
  assertVec3(r.pivot); if (r.pivot.some(n => Math.abs(n) > 1e7)) throw new TypeError('Invalid view pivot');
  if (r.schemaVersion !== 1 || r.scope !== 'current-turn' || !['original-source-reference', 'declared-box', 'declared-polygon-prism', 'browser-focus', 'explicit-camera'].includes(String(r.targetKind)) || !['rgb', 'semantic', 'type', 'instance'].includes(String(r.colorMode)) || typeof r.layer !== 'string' || r.layer.length > 128 || !r.layer.length) throw new TypeError('Invalid view receipt');
  if ((r.targetKind === 'original-source-reference') !== (r.reference !== undefined) || (['declared-box', 'declared-polygon-prism'].includes(String(r.targetKind))) !== (r.region !== undefined)) throw new TypeError('Invalid view target provenance');
  for (const k of ['azimuthDegrees', 'elevationDegrees', 'distance', 'fov', 'zoom']) if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) throw new TypeError('Invalid view number');
  if (Math.abs(r.azimuthDegrees as number) > 180 || (r.elevationDegrees as number) < -90 || (r.elevationDegrees as number) > 90 || (r.distance as number) < .2 || (r.distance as number) > 1e7 || (r.fov as number) <= 0 || (r.fov as number) >= 180 || (r.zoom as number) <= 0) throw new TypeError('Invalid view limits');
  for (const k of ['expanded', 'fitGuaranteed', 'targetBehind']) if (typeof r[k] !== 'boolean') throw new TypeError('Invalid view flags');
  const out = { ...r, bounds: canonicalSceneBox(r.bounds), ...(r.requested === undefined ? {} : { requested: canonicalRelativeAdjustment(r.requested) }), ...(r.reference === undefined ? {} : { reference: canonicalModelReferenceSelection(r.reference) }), ...(r.region === undefined ? {} : { region: canonicalSceneRegion(r.region) }) };
  if ((r.targetKind === 'declared-polygon-prism') !== (r.fitMethod === 'enclosing-box') || (r.fitMethod !== undefined && r.fitMethod !== 'enclosing-box')) throw new TypeError('Invalid region fit method');
  if (out.region && ((r.targetKind === 'declared-box') !== (out.region.shape.kind === 'box'))) throw new TypeError('Invalid region target kind');
  if (out.region?.shape.kind === 'polygon-prism' && canonicalProtocolJson(out.bounds) !== canonicalProtocolJson(sceneRegionBounds(out.region))) throw new TypeError('Invalid polygon framing bounds');
  if (canonicalProtocolJson(out).length > 16384) throw new TypeError('View receipt limit'); return JSON.parse(JSON.stringify(out)) as AgentViewReceipt;
}
export function canonicalBrowserCaptureRequest(value: unknown): BrowserCaptureRequest {
  const r = protocolRecord(value);
  if (r.kind !== 'framed' && r.kind !== 'adjust') {
    const legacy = canonicalModelCaptureRequest(value); if (legacy.kind === 'frame' || legacy.kind === 'relative') throw new TypeError('Unresolved model target in browser request'); return legacy;
  }
  if (r.colorMode !== undefined && !['rgb', 'type', 'semantic', 'instance'].includes(String(r.colorMode))) throw new TypeError('Invalid view color');
  const color = r.colorMode === undefined ? {} : { colorMode: r.colorMode as ModelCaptureColorMode };
  if (r.kind === 'adjust') {
    protocolKeys(r, ['kind', 'binding', 'observationId', 'base', 'adjustment'], ['colorMode']); protocolToken(r.observationId);
    return { kind: 'adjust', binding: canonicalSceneSourceBinding(r.binding), observationId: r.observationId, base: canonicalAgentViewReceipt(r.base), adjustment: canonicalRelativeAdjustment(r.adjustment), ...color };
  }
  protocolKeys(r, ['kind', 'binding', 'bounds', 'pivot', 'orientation', 'targetKind'], ['reference', 'region', 'colorMode']);
  assertVec3(r.pivot); if (r.pivot.some(n => Math.abs(n) > 1e7)) throw new TypeError('Invalid frame pivot');
  if (!['top', 'oblique'].includes(String(r.orientation)) || !['original-source-reference', 'declared-box', 'declared-polygon-prism'].includes(String(r.targetKind))) throw new TypeError('Invalid framed view');
  if ((r.targetKind === 'original-source-reference') !== (r.reference !== undefined) || (['declared-box', 'declared-polygon-prism'].includes(String(r.targetKind))) !== (r.region !== undefined)) throw new TypeError('Invalid frame target receipt');
  const region = r.region === undefined ? undefined : canonicalSceneRegion(r.region);
  if (region && ((r.targetKind === 'declared-box') !== (region.shape.kind === 'box'))) throw new TypeError('Invalid region target kind');
  if (region?.shape.kind === 'polygon-prism' && (canonicalProtocolJson(canonicalSceneBox(r.bounds)) !== canonicalProtocolJson(sceneRegionBounds(region)) || canonicalProtocolJson(canonicalSceneSourceBinding(r.binding)) !== canonicalProtocolJson(region.binding))) throw new TypeError('Invalid polygon frame');
  return { kind: 'framed', binding: canonicalSceneSourceBinding(r.binding), bounds: canonicalSceneBox(r.bounds), pivot: [...r.pivot] as Vec3, orientation: r.orientation as 'top' | 'oblique', targetKind: r.targetKind as 'original-source-reference' | 'declared-box' | 'declared-polygon-prism', ...(r.reference === undefined ? {} : { reference: canonicalModelReferenceSelection(r.reference) }), ...(r.region === undefined ? {} : { region: canonicalSceneRegion(r.region) }), ...color };
}
