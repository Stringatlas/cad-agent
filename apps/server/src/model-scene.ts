import type { ModelScene } from '@spatial/contracts';
import { ProjectSession } from './project-session';
import { SemanticArtifact } from './semantic-artifact';
import { ModelError, type BoundModelScene } from './provider-model';

/** Does not build/search a semantic index or pretend metadata proves an original point record. */
export async function bindModelScene(scene: ModelScene, authority: ProjectSession, directory: string, signal: AbortSignal): Promise<BoundModelScene> {
  signal.throwIfAborted();
  const project = scene.project === null ? null : authority.context(scene.project);
  const selectedGeometry = project === null ? [] : authority.snapshot().project.entities.filter(e => project.entityIds.includes(e.id)).map(e =>
    e.kind === 'box' ? { ...e } : { id: e.id, kind: e.kind, pointCount: e.points.length });
  let artifact: SemanticArtifact | undefined;
  try {
    if (scene.toronto.length) {
      artifact = await SemanticArtifact.open(directory, signal);
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
      capabilities: { inspectScene: true, geometryMutation: false, cadVerification: false },
      limitations: ['Toronto original point record/position is not independently verified by this chat attachment boundary.',
        'Toronto and synthetic project frames are separate; no mapping exists.', 'Model CAD creation and publication are not connected.'] },
      async check() { signal.throwIfAborted(); if (scene.project) authority.context(scene.project); await retained?.check(signal); signal.throwIfAborted(); },
      async close() { await retained?.close(); },
    };
  } catch (error) { await artifact?.close(); throw error; }
}
