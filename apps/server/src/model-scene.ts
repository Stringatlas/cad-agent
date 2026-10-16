import { canonicalPoleRequest, type ModelScene, type ModelVisualObservation } from '@spatial/contracts';
import { randomUUID } from 'node:crypto';
import { queryIndexedClosestPole } from './pole-index';
import { ProjectSession } from './project-session';
import { SemanticArtifact } from './semantic-artifact';
import { ModelError, type BoundModelScene } from './provider-model';

/** Attachment metadata remains unverified; nearestLabel separately resolves original records and independently verifies its indexed result. */
export async function bindModelScene(scene: ModelScene, authority: ProjectSession, directory: string, signal: AbortSignal, visual?: ModelVisualObservation): Promise<BoundModelScene> {
  signal.throwIfAborted();
  const project = scene.project === null ? null : authority.context(scene.project);
  const selectedGeometry = project === null ? [] : authority.snapshot().project.entities.filter(e => project.entityIds.includes(e.id)).map(e =>
    e.kind === 'box' ? { ...e } : { id: e.id, kind: e.kind, pointCount: e.points.length });
  let artifact: SemanticArtifact | undefined;
  try {
    if (visual && scene.mode === 'demo' && JSON.stringify(visual.binding.origin) !== JSON.stringify(authority.snapshot().project.coordinates.localOrigin)) throw new ModelError('stale-scene');
    if (scene.toronto.length || visual && scene.mode === 'toronto') {
      artifact = await SemanticArtifact.open(directory, signal);
      if (visual && visual.binding.sourceRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
      for (const point of scene.toronto) {
        if (point.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
        if (point.key.sourceRow >= artifact.sourceCounts[point.key.sourceFileId] || point.position.some((v, i) =>
          v < artifact!.dataset.bounds.min[i] - .002 || v > artifact!.dataset.bounds.max[i] + .002)) throw new ModelError('invalid-scene');
      }
      await artifact.check(signal);
    }
    const retained = artifact;
    return {
      context: { mode: scene.mode, project, selectedGeometry, toronto: scene.toronto.map(point => ({ ...point,
        source: 'user-attached-toronto-record-reference', artifactValidation: 'revision-and-metadata-checked',
        recordValidation: 'unverified', mapping: 'unmapped-to-project' })),
      capabilities: { inspectScene: true, nearestLabel: scene.mode === 'toronto' && scene.toronto.length > 0 && !!retained, geometryMutation: false, cadVerification: false },
      nearestLabelSearchGeometry: 'original-prepared-dataset',
      limitations: ['Toronto original point record/position is not independently verified by this chat attachment boundary.',
        'Toronto and synthetic project frames are separate; no mapping exists.', 'Model CAD creation and publication are not connected.'] },
      ...(scene.mode === 'toronto' && scene.toronto.length > 0 && retained ? {
        async nearestLabel(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (scene.project) authority.context(scene.project);
          await retained.check(combined);
          const point = scene.toronto.find(point => point.name === args.pointName);
          if (!point || !Number.isInteger(args.label) || args.label < 0 || args.label > 8) throw new ModelError('invalid-nearest-label');
          // Never trust attachment coordinates or accept model-supplied keys. The index and
          // independent verifier both resolve this bound original source record themselves.
          const request = canonicalPoleRequest({ requestId: randomUUID(), datasetId: 'toronto3d',
            expectedArtifactRevision: point.artifactRevision, units: 'm', frameId: 'toronto3d-local-v1',
            input: { kind: 'point-ref', key: point.key },
            filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: args.label },
            metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } });
          const outcome = await queryIndexedClosestPole(directory, request, combined);
          combined.throwIfAborted(); await retained.check(combined);
          if (scene.project) authority.context(scene.project);
          return { searchGeometry: 'original-prepared-dataset' as const, pointName: point.name, request, outcome };
        },
      } satisfies Pick<BoundModelScene, 'nearestLabel'> : {}),
      async check() { signal.throwIfAborted(); if (scene.project) authority.context(scene.project); await retained?.check(signal); signal.throwIfAborted(); },
      async close() { await retained?.close(); },
    };
  } catch (error) { await artifact?.close(); throw error; }
}
