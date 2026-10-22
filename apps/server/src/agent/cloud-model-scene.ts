import { openPreparedElevation } from '../datasets/prepared-elevation';
import { canonicalModelScene, type ModelScene, type Vec3 } from '@spatial/contracts';
import { createPreparedCloudRegistry } from '../datasets/prepared-cloud';
import { canonicalPerceptionQuery } from './model-perception';
import { ModelError, type BoundModelScene } from './provider-model';

/** A selected cloud owns its frame, taxonomy and capabilities. Toronto is a separate adapter. */
export async function bindCloudModelScene(input: ModelScene, registrations: Readonly<Record<string, string>>, signal: AbortSignal): Promise<BoundModelScene> {
  const scene = canonicalModelScene(input), binding = scene.cloud;
  if (scene.mode !== 'cloud' || !binding || !Object.hasOwn(registrations, binding.id)) throw new ModelError('invalid-scene');
  const reader = createPreparedCloudRegistry(registrations).open(binding.id);
  const info = await reader.info(signal), descriptor = info.descriptor;
  if (info.revision !== binding.revision || descriptor.frameId !== binding.frameId || JSON.stringify(descriptor.coordinates.localOrigin) !== JSON.stringify(binding.localOrigin)) throw new ModelError('stale-scene');
  let elevation: Awaited<ReturnType<typeof openPreparedElevation>>;
  let elevationStatus = 'not-prepared';
  try { elevation = await openPreparedElevation(registrations[binding.id], info, signal); if (elevation) elevationStatus = 'ready'; }
  catch { signal.throwIfAborted(); elevationStatus = 'unavailable'; }
  let closed = false, busy = false;
  const check = async () => {
    signal.throwIfAborted();
    if (closed || (await reader.info(signal)).revision !== binding.revision) throw new ModelError('stale-scene');
  };
  for (const ref of binding.points) {
    const found = await reader.queryOriginal(binding.revision, { operation: 'key', key: ref.key, maxResults: 1 }, signal);
    if (found.count !== 1 || JSON.stringify(found.points[0].position) !== JSON.stringify(ref.position)) throw new ModelError('invalid-scene');
  }
  const labels = Object.keys(descriptor.semantics?.classes ?? {}).map(Number);
  return {
    semanticLabels: labels,
    context: { mode: 'cloud', dataset: { id: descriptor.id, artifactRevision: info.revision,
      frameId: descriptor.frameId, ...descriptor.coordinates, bounds: info.bounds, totalPoints: info.totalPoints },
      elevation: elevation ? elevation.info : { status: elevationStatus },
      semanticClasses: descriptor.semantics?.classes ?? {}, instanceMapping: descriptor.instances ?? null,
      references: binding.points, capabilities: { queryPoints: true, queryElevation: !!elevation, sourceReferences: true, geometryMutation: false, editing: false },
      evidenceScope: 'Original prepared records; displayed samples and screenshots do not establish whole-source coverage or clearance.' },
    ...(elevation ? { async queryElevation(args: { x: number; y: number }, querySignal: AbortSignal) {
      const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
      await check(); const result = await elevation!.query(args, combined); await check();
      return result;
    } } : {}),
    async queryPoints(args, querySignal) {
      const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
      if (busy) throw new ModelError('busy');
      if (closed) throw new ModelError('stale-scene');
      const request = canonicalPerceptionQuery(args, labels);
      busy = true;
      try {
        await check();
        const result = await reader.queryOriginal(binding.revision, request, combined);
        await check(); combined.throwIfAborted();
        return { kind: 'source-point-query', operation: request.operation, ...result,
          datasetId: binding.id, artifactRevision: binding.revision, frameId: binding.frameId, units: 'm',
          searchGeometry: 'original-prepared-dataset', points: result.points.map(point => ({ ...point,
            semanticType: point.label === undefined ? 'Unknown' : descriptor.semantics!.classes[String(point.label)],
            selectReference: { kind: 'cloud-point', cloudId: binding.id, revision: binding.revision, key: point.key } })) };
      } finally { busy = false; }
    },
    async resolveReference(reference, querySignal) {
      const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
      if (closed || reference.kind !== 'cloud-point' || reference.cloudId !== binding.id || reference.revision !== binding.revision) throw new ModelError('invalid-scene');
      const found = await reader.queryOriginal(binding.revision, { operation: 'key', key: reference.key, maxResults: 1 }, combined);
      if (found.count !== 1) throw new ModelError('invalid-scene');
      await check(); return found.points[0].position as Vec3;
    },
    check,
    async close() { closed = true; },
  };
}
