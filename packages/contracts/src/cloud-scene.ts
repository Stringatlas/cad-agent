import type { Vec3 } from './index';
import { canonicalScenePointName, type ScenePointName } from './scene-points';
import { protocolRecord, protocolKeys, protocolHash, protocolInteger } from './tool-protocol';

export interface ModelCloudPoint { readonly name: ScenePointName; readonly key: { readonly sourceFileId: number; readonly sourceRow: number }; readonly position: Vec3 }
export interface ModelCloudScene {
  readonly id: string; readonly revision: string; readonly frameId: string; readonly localOrigin: Vec3;
  readonly points: readonly ModelCloudPoint[];
}
export function canonicalModelCloudScene(value: unknown): ModelCloudScene {
  const c = protocolRecord(value); protocolKeys(c, ['id', 'revision', 'frameId', 'localOrigin', 'points']);
  if (typeof c.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(c.id) ||
    typeof c.frameId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(c.frameId)) throw new TypeError('Invalid cloud identity');
  protocolHash(c.revision);
  const vector = (v: unknown): Vec3 => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e10)) throw new TypeError('Invalid cloud position');
    return [...v] as unknown as Vec3;
  };
  if (!Array.isArray(c.points) || c.points.length > 32) throw new TypeError('Invalid cloud references');
  const points = c.points.map(value => {
    const p = protocolRecord(value); protocolKeys(p, ['name', 'key', 'position']);
    const k = protocolRecord(p.key); protocolKeys(k, ['sourceFileId', 'sourceRow']);
    protocolInteger(k.sourceFileId, 65535); protocolInteger(k.sourceRow, 0xffffffff);
    return { name: canonicalScenePointName(p.name), key: { sourceFileId: Number(k.sourceFileId), sourceRow: Number(k.sourceRow) }, position: vector(p.position) };
  });
  if (new Set(points.map(p => p.name)).size !== points.length) throw new TypeError('Duplicate cloud reference name');
  return { id: c.id, revision: String(c.revision), frameId: c.frameId, localOrigin: vector(c.localOrigin), points };
}
