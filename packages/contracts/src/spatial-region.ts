import { assertSimplePolygon } from './polygon-topology';
import { assertVec3, type Vec3 } from './index';
import { protocolHash, protocolKeys, protocolRecord, protocolToken } from './tool-protocol';
/** A declared investigation region, never geometry/occupancy or edit authority. */
export interface SceneSourceBinding { readonly sourceId: string; readonly sourceRevision: string; readonly frameId: string; readonly units: 'm'; readonly origin: Vec3 }
export interface SceneBox { readonly min: Vec3; readonly max: Vec3 }
export type SceneRegionShape = { readonly kind: 'box'; readonly bounds: SceneBox } | { readonly kind: 'polygon-prism'; readonly polygon: readonly (readonly [number, number])[]; readonly z: { readonly min: number; readonly max: number } };
export interface SceneRegion { readonly binding: SceneSourceBinding; readonly shape: SceneRegionShape }
export function canonicalSceneSourceBinding(value: unknown): SceneSourceBinding {
  const r = protocolRecord(value); protocolKeys(r, ['sourceId', 'sourceRevision', 'frameId', 'units', 'origin']);
  protocolToken(r.sourceId); protocolHash(r.sourceRevision); protocolToken(r.frameId); assertVec3(r.origin);
  if (r.units !== 'm' || r.origin.some(n => Math.abs(n) > 1e7)) throw new TypeError('Invalid source binding');
  return JSON.parse(JSON.stringify(r)) as SceneSourceBinding;
}
export function canonicalSceneBox(value: unknown): SceneBox {
  const r = protocolRecord(value); protocolKeys(r, ['min', 'max']); assertVec3(r.min); assertVec3(r.max);
  if ([...r.min, ...r.max].some(n => Math.abs(n) > 1e7) || r.min.some((n, i) => n > (r.max as Vec3)[i])) throw new TypeError('Invalid declared box');
  return { min: [...r.min] as Vec3, max: [...r.max] as Vec3 };
}
export function canonicalSceneRegion(value: unknown): SceneRegion {
  const r = protocolRecord(value); protocolKeys(r, ['binding', 'shape']);
  const binding = canonicalSceneSourceBinding(r.binding), s = protocolRecord(r.shape);
  if (s.kind === 'box') {
    protocolKeys(s, ['kind', 'bounds']);
    return { binding, shape: { kind: 'box', bounds: canonicalSceneBox(s.bounds) } };
  }
  if (s.kind !== 'polygon-prism') throw new TypeError('Unsupported region shape');
  protocolKeys(s, ['kind', 'polygon', 'z']);
  if (!Array.isArray(s.polygon) || s.polygon.length < 3 || s.polygon.length > 64) throw new TypeError('Invalid polygon vertex count');
  const polygon = s.polygon.map(value => {
    if (!Array.isArray(value) || value.length !== 2 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new TypeError('Invalid polygon vertex');
    return [value[0], value[1]] as const;
  });
  const z = protocolRecord(s.z); protocolKeys(z, ['min', 'max']);
  if (typeof z.min !== 'number' || typeof z.max !== 'number' || !Number.isFinite(z.min) || !Number.isFinite(z.max) || Math.abs(z.min) > 1e7 || Math.abs(z.max) > 1e7 || z.min > z.max) throw new TypeError('Invalid polygon Z bounds');
  assertSimplePolygon(polygon);
  return { binding, shape: { kind: 'polygon-prism', polygon, z: { min: z.min, max: z.max } } };
}
/** Bounds used for framing only; the declared polygon is preserved separately. */
export function sceneRegionBounds(region: SceneRegion): SceneBox {
  if (region.shape.kind === 'box') return canonicalSceneBox(region.shape.bounds);
  const { polygon, z } = region.shape;
  return { min: [Math.min(...polygon.map(p => p[0])), Math.min(...polygon.map(p => p[1])), z.min], max: [Math.max(...polygon.map(p => p[0])), Math.max(...polygon.map(p => p[1])), z.max] };
}
