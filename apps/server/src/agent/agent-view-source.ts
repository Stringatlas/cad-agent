import { protocolRecord, canonicalModelReferenceSelection, assertVec3, canonicalSceneBox, canonicalSceneSourceBinding, canonicalProtocolJson, type SceneSourceBinding, type SceneBox, type ModelScene, type ModelCaptureColorMode, type ModelReferenceSelection, type Vec3 } from '@spatial/contracts';
import type { BoundModelScene } from './provider-model';
import { ModelError } from './provider-model';
import { readSourcePoint } from '../datasets/source-point';
export interface SceneCaptureCapabilities { readonly binding: SceneSourceBinding; readonly bounds: SceneBox; readonly colorModes: readonly ModelCaptureColorMode[]; readonly layer: 'current-browser-layer'; readonly referenceKind: 'cloud-point' | 'toronto-point'; readonly targetKinds: readonly ['original-source-point', 'box', 'polygon-prism']; readonly relativeViews: true }
export function sceneCaptureCapabilities(scene: ModelScene, bound: BoundModelScene): SceneCaptureCapabilities | undefined {
  if (scene.mode === 'pole') return;
  const context = bound.context as { dataset?: { bounds?: unknown }; sceneBounds?: unknown; spatialFrame?: { datasetId: string; artifactRevision: string; frameId: string; units: 'm'; localOrigin: Vec3 }; semanticClasses?: Record<string, string>; instanceMapping?: unknown };
  const c = scene.cloud, t = context.spatialFrame;
  if (scene.mode === 'cloud' && (!c || !context.dataset?.bounds) || scene.mode === 'toronto' && (!t || !context.sceneBounds)) return;
  const binding = canonicalSceneSourceBinding(c ? { sourceId: c.id, sourceRevision: c.revision, frameId: c.frameId, units: 'm', origin: c.localOrigin } : { sourceId: t!.datasetId, sourceRevision: t!.artifactRevision, frameId: t!.frameId, units: t!.units, origin: t!.localOrigin });
  const bounds = canonicalSceneBox(c ? context.dataset?.bounds : context.sceneBounds);
  const colorModes: ModelCaptureColorMode[] = ['rgb'];
  if (scene.mode === 'toronto' || Object.keys(context.semanticClasses ?? {}).length) colorModes.push('semantic', 'type');
  if (scene.mode === 'cloud' && context.instanceMapping) colorModes.push('instance');
  return { binding, bounds, colorModes, referenceKind: scene.mode === 'cloud' ? 'cloud-point' : 'toronto-point', layer: 'current-browser-layer', targetKinds: ['original-source-point', 'box', 'polygon-prism'], relativeViews: true };
}
export async function resolveViewSourceReference(reference: ModelReferenceSelection, scene: ModelScene, bound: BoundModelScene, directory: string, signal: AbortSignal): Promise<Vec3> {
  const source = sceneCaptureCapabilities(scene, bound); if (!source) throw new ModelError('invalid-scene');
  if (reference.kind === 'cloud-point') {
    if (scene.mode !== 'cloud' || reference.cloudId !== source.binding.sourceId || reference.revision !== source.binding.sourceRevision || !bound.resolveReference) throw new ModelError('invalid-scene');
    return bound.resolveReference(reference, signal);
  }
  if (scene.mode !== 'toronto') throw new ModelError('invalid-scene');
  const position = (await readSourcePoint(directory, { revision: source.binding.sourceRevision, key: reference.key }, signal)).position;
  assertVec3(position); return position;
}
export function sameSourceBinding(left: SceneSourceBinding, right: SceneSourceBinding): boolean { return canonicalProtocolJson(left) === canonicalProtocolJson(right); }

/** Identity must be checked before recoverable span/topology/color validation.
 * Reads only closed source identifiers; never resolves points or selects/rebinds.
 */
export function assertCaptureSourceIdentity(value: unknown, source?: SceneCaptureCapabilities): void {
  if (!source) return;
  const request = protocolRecord(value);
  if (request.kind !== 'frame') return;
  const target = protocolRecord(request.target);
  if (target.kind === 'region') {
    const binding = canonicalSceneSourceBinding(protocolRecord(target.region).binding);
    if (!sameSourceBinding(binding, source.binding)) throw new ModelError('stale-scene');
  } else if (target.kind === 'reference') {
    const reference = canonicalModelReferenceSelection(target.reference);
    if (reference.kind !== source.referenceKind || reference.kind === 'cloud-point' && (reference.cloudId !== source.binding.sourceId || reference.revision !== source.binding.sourceRevision)) throw new ModelError('stale-scene');
  }
}
