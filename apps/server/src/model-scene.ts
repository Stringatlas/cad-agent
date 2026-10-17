import { canonicalBoxProposalRequest, canonicalPoleRequest, canonicalPointMoveProposalRequest, type PointOverrideSnapshot, type PointMoveProposal,
  type TorontoCadSnapshot, type TorontoCadProposal, type ModelScene, type ModelVisualObservation, type Vec3 } from '@spatial/contracts';
import type { PointOverrideSession } from './point-overrides';
import type { TorontoCadSession } from './toronto-cad-session';
import { randomUUID } from 'node:crypto';
import { queryIndexedClosestPole } from './pole-index';
import { ProjectSession } from './project-session';
import { SemanticArtifact } from './semantic-artifact';
import { ModelError, type BoundModelScene } from './provider-model';

export interface ModelEditingAuthorities { readonly points: PointOverrideSession; readonly cad: TorontoCadSession }

/** Attachment metadata remains unverified; nearestLabel separately resolves original records and independently verifies its indexed result. */
export async function bindModelScene(scene: ModelScene, authority: ProjectSession, directory: string, signal: AbortSignal, visual?: ModelVisualObservation, editing?: ModelEditingAuthorities): Promise<BoundModelScene> {
  signal.throwIfAborted();
  const project = scene.project === null ? null : authority.context(scene.project);
  const selectedGeometry = project === null ? [] : authority.snapshot().project.entities.filter(e => project.entityIds.includes(e.id)).map(e =>
    e.kind === 'box' ? { ...e } : { id: e.id, kind: e.kind, pointCount: e.points.length });
  const canPropose = scene.mode === 'demo' && project !== null;
  const availableProjectBoxes = canPropose ? authority.snapshot().project.entities.filter(e => e.kind === 'box') : [];
  let closed = false;
  let artifact: SemanticArtifact | undefined;
  try {
    if (visual && scene.mode === 'demo' && JSON.stringify(visual.binding.origin) !== JSON.stringify(authority.snapshot().project.coordinates.localOrigin)) throw new ModelError('stale-scene');
    const torontoEditing = scene.mode === 'toronto' ? editing : undefined;
    const pointState = torontoEditing ? await torontoEditing.points.execute('snapshot', undefined, signal) as PointOverrideSnapshot : undefined;
    const cadState = torontoEditing ? await torontoEditing.cad.execute('snapshot', undefined, signal) as TorontoCadSnapshot : undefined;
    if (visual && torontoEditing && (pointState!.entries.length || cadState!.bodies.length || cadState!.proposals.length ||
      (await torontoEditing.points.execute('pending', undefined, signal) as PointMoveProposal[]).length)) throw new ModelError('edited-scene-capture-unavailable');
    if (scene.toronto.length || visual && scene.mode === 'toronto' || torontoEditing) {
      artifact = await SemanticArtifact.open(directory, signal);
      if (visual && visual.binding.sourceRevision !== artifact.dataset.revision ||
        pointState && pointState.artifactRevision !== artifact.dataset.revision || cadState && cadState.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
      for (const point of scene.toronto) {
        if (point.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
        if (point.key.sourceRow >= artifact.sourceCounts[point.key.sourceFileId] || point.position.some((v, i) =>
          v < artifact!.dataset.bounds.min[i] - .002 || v > artifact!.dataset.bounds.max[i] + .002)) throw new ModelError('invalid-scene');
      }
      await artifact.check(signal);
    }
    const retained = artifact;
    const checkEditing = async (querySignal: AbortSignal) => {
      if (!torontoEditing || !pointState || !cadState) return;
      const points = await torontoEditing.points.execute('snapshot', undefined, querySignal) as PointOverrideSnapshot;
      const cad = await torontoEditing.cad.execute('snapshot', undefined, querySignal) as TorontoCadSnapshot;
      if (points.sessionId !== pointState.sessionId || points.revision !== pointState.revision || points.artifactRevision !== pointState.artifactRevision ||
        cad.sessionId !== cadState.sessionId || cad.revision !== cadState.revision || cad.artifactRevision !== cadState.artifactRevision) throw new ModelError('stale-scene');
      // The admitted image is a fixed clean observation. Creating a pending
      // candidate does not retroactively edit those pixels; browser view-generation
      // gates separately invalidate pixel resolution when ghosts are actually rendered.
    };
    const nearestLabel: NonNullable<BoundModelScene['nearestLabel']> = async (args, querySignal) => {
      const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
      if (closed || !retained) throw new ModelError('stale-scene');
      if (scene.project) authority.context(scene.project);
      await retained.check(combined);
      const point = scene.toronto.find(point => point.name === args.pointName);
      if (!point || !Number.isInteger(args.label) || args.label < 0 || args.label > 8) throw new ModelError('invalid-nearest-label');
      // Index and independent verifier both resolve the ORIGINAL record themselves.
      const request = canonicalPoleRequest({ requestId: randomUUID(), datasetId: 'toronto3d',
        expectedArtifactRevision: point.artifactRevision, units: 'm', frameId: 'toronto3d-local-v1',
        input: { kind: 'point-ref', key: point.key },
        filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: args.label },
        metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } });
      const outcome = await queryIndexedClosestPole(directory, request, combined);
      combined.throwIfAborted(); await retained.check(combined);
      if (scene.project) authority.context(scene.project);
      return { searchGeometry: 'original-prepared-dataset', pointName: point.name, request, outcome };
    };
    return {
      context: { mode: scene.mode, project, selectedGeometry, availableProjectBoxes, toronto: scene.toronto.map(point => ({ ...point,
        source: 'user-attached-toronto-record-reference', artifactValidation: 'revision-and-metadata-checked',
        recordValidation: 'unverified', mapping: 'unmapped-to-project' })),
      ...(torontoEditing ? { torontoEditing: { points: { sessionId: pointState!.sessionId, revision: pointState!.revision, artifactRevision: pointState!.artifactRevision, overrideCount: pointState!.entries.length,
          attachedOverrides: pointState!.entries.filter(e => scene.toronto.some(p => p.key.sourceFileId === e.key.sourceFileId && p.key.sourceRow === e.key.sourceRow)) },
        cad: { sessionId: cadState!.sessionId, revision: cadState!.revision, artifactRevision: cadState!.artifactRevision,
          bodies: cadState!.bodies.map(({ bodyId, operation }) => ({ bodyId, operation })),
          proposals: cadState!.proposals.map(({ proposalId, operation }) => ({ proposalId, operation })) }, volatile: true } } : {}),
      capabilities: { inspectScene: true, nearestLabel: scene.mode === 'toronto' && scene.toronto.length > 0 && !!retained, boxParameterProposals: canPropose,
        pointMoveProposals: !!torontoEditing && scene.toronto.length > 0, cadSolidProposals: !!torontoEditing, geometryMutation: false, cadVerification: !!torontoEditing },
      nearestLabelSearchGeometry: 'original-prepared-dataset',
      limitations: ['Toronto original point record/position is not independently verified by this chat attachment boundary.',
        'Toronto and synthetic project frames are separate; no mapping exists.',
        'Synthetic box proposals are parameter-postconditions-not-cad candidates only. Toronto CAD tools, when available, retain kernel-validated pending solids, never publish. Human acceptance of each change is required.',
        'Toronto point proposals independently reread original records and check effective-position preconditions. Overrides do not change original-source nearest-label searches. All Toronto edits are volatile; restart clears them.',
        'Images with edits or ghosts are blocked; rendering and publication are distinct from kernel validation. No model approval, decline or Undo tools exist.'] },
      ...(torontoEditing && pointState && cadState ? {
        async proposePointMove(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined); await retained!.check(combined);
          const points = args.pointNames.map(name => {
            const point = scene.toronto.find(p => p.name === name);
            if (!point) throw new ModelError('invalid-point-proposal');
            const entry = pointState.entries.find(e => e.key.sourceFileId === point.key.sourceFileId && e.key.sourceRow === point.key.sourceRow);
            // Attached original references are not rebased blindly. An existing override
            // must prove the same original position before its effective position is used.
            if (entry && !entry.originalPosition.every((v, i) => v === point.position[i])) throw new ModelError('invalid-point-proposal');
            return { key: point.key, position: entry?.position ?? point.position };
          });
          const request = canonicalPointMoveProposalRequest({ sessionId: pointState.sessionId, revision: pointState.revision,
            artifactRevision: pointState.artifactRevision, points, translation: args.translation });
          // Authority independently rereads each original source record before retention.
          const proposal = await torontoEditing.points.execute('propose', request, combined) as PointMoveProposal;
          combined.throwIfAborted(); await checkEditing(combined); return proposal;
        },
        async proposeNearestPointMove(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined);
          const nearest = await nearestLabel(args, combined);
          if (nearest.outcome.status !== 'verified-found' || !nearest.outcome.nearest) throw new ModelError('nearest-destination-unavailable');
          const point = scene.toronto.find(p => p.name === args.pointName)!;
          // Use independently resolved query and destination records, not attachment/model coordinates.
          const original = nearest.outcome.queryPosition;
          const entry = pointState.entries.find(e => e.key.sourceFileId === point.key.sourceFileId && e.key.sourceRow === point.key.sourceRow);
          if (entry && !entry.originalPosition.every((v, i) => v === original[i])) throw new ModelError('invalid-point-proposal');
          const before = entry?.position ?? original;
          const destination = nearest.outcome.nearest.position;
          // A verified nearest witness may be this original Pole, or an already
          // approved destination. No change means no retained proposal, not failure.
          await checkEditing(combined);
          if (before.every((v, i) => v === destination[i])) {
            combined.throwIfAborted(); await retained!.check(combined);
            return { status: 'no-change' as const, nearest };
          }
          const translation = destination.map((v, i) => v - before[i]) as unknown as Vec3;
          const request = canonicalPointMoveProposalRequest({ sessionId: pointState.sessionId, revision: pointState.revision,
            artifactRevision: pointState.artifactRevision, points: [{ key: point.key, position: before }], translation });
          await checkEditing(combined);
          const proposal = await torontoEditing.points.execute('propose', request, combined, destination) as PointMoveProposal;
          combined.throwIfAborted(); await checkEditing(combined);
          return { status: 'pending' as const, proposal, nearest };
        },
        async proposeCad(operation, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined); await retained!.check(combined);
          const proposal = await torontoEditing.cad.execute('propose', { sessionId: cadState.sessionId, revision: cadState.revision,
            artifactRevision: cadState.artifactRevision, operation }, combined) as TorontoCadProposal;
          combined.throwIfAborted(); await checkEditing(combined);
          // Explicit allowlist: never leak tessellation/native candidates into provider history/events.
          return { sessionId: proposal.sessionId, revision: proposal.revision, artifactRevision: proposal.artifactRevision,
            datasetId: proposal.datasetId, frameId: proposal.frameId, units: proposal.units, proposalId: proposal.proposalId,
            bodyId: proposal.bodyId, operation: proposal.operation, validation: proposal.validation };
        },
      } satisfies Pick<BoundModelScene, 'proposePointMove' | 'proposeNearestPointMove' | 'proposeCad'> : {}),
      ...(canPropose ? {
        async proposeBox(edit, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (closed || !project) throw new ModelError('stale-scene');
          authority.context(scene.project);
          const { sessionId, projectRevision, frameId, units } = project;
          const request = canonicalBoxProposalRequest({ sessionId, projectRevision, frameId, units, edit });
          combined.throwIfAborted();
          // Retain only a proposal: no geometry publication, including after this turn closes.
          const proposal = authority.propose(request);
          combined.throwIfAborted(); authority.context(scene.project);
          return proposal;
        },
      } satisfies Pick<BoundModelScene, 'proposeBox'> : {}),
      ...(scene.mode === 'toronto' && scene.toronto.length > 0 && retained ? {
        nearestLabel,
      } satisfies Pick<BoundModelScene, 'nearestLabel'> : {}),
      async check() { if (closed) throw new ModelError('stale-scene'); signal.throwIfAborted(); if (scene.project) authority.context(scene.project); await retained?.check(signal); await checkEditing(signal); signal.throwIfAborted(); },
      async close() { closed = true; await retained?.close(); },
    };
  } catch (error) { await artifact?.close(); throw error; }
}
