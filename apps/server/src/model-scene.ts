import { canonicalBoxProposalRequest, canonicalPoleRequest, canonicalPointMoveProposalRequest, type PointOverrideSnapshot, type PointMoveProposal,
  type TorontoCadSnapshot, type TorontoCadProposal, type ModelScene, type ModelVisualObservation, type Vec3 } from '@spatial/contracts';
import { canonicalSceneObjectProposalRequest, type SceneObjectSnapshot, type SceneObjectProposal, type AuthoredObjectReference } from '../../../packages/contracts/src/scene-objects';
import type { SceneObjectSession } from './scene-object-session';
import type { PointOverrideSession } from './point-overrides';
import { TorontoCadError, type TorontoCadSession } from './toronto-cad-session';
import { randomUUID } from 'node:crypto';
import { queryIndexedClosestPole } from './pole-index';
import { ProjectSession } from './project-session';
import { getSemanticDiskIndex } from './semantic-disk-index';
import { SpatialPageIndex } from './spatial-page-index';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact } from './semantic-artifact';
import { ModelError, type BoundModelScene } from './provider-model';
import { assessUtilityBox, checkPlacementTerrain, UTILITY_BOX_PRESET, type UtilityBoxAssessment } from './utility-box-placement';

export interface ModelEditingAuthorities { readonly points: PointOverrideSession; readonly cad: TorontoCadSession; readonly objects?: SceneObjectSession }

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
    const torontoEditing = scene.mode === 'toronto' ? editing : undefined;
    const pointState = torontoEditing ? await torontoEditing.points.execute('snapshot', undefined, signal) as PointOverrideSnapshot : undefined;
    const cadState = torontoEditing ? await torontoEditing.cad.execute('snapshot', undefined, signal) as TorontoCadSnapshot : undefined;
    const objectState = torontoEditing?.objects ? await torontoEditing.objects.execute('snapshot', undefined, signal) as SceneObjectSnapshot : undefined;
    for (const ref of scene.objects ?? []) {
      const object = objectState?.objects.find(object => object.id === ref.objectId);
      if (!objectState || !object || ref.sessionId !== objectState.sessionId || ref.revision !== objectState.revision || ref.objectRevision !== object.objectRevision || ref.frameId !== object.frameId || ref.units !== object.units) throw new ModelError('stale-scene');
    }
    if (scene.toronto.length || scene.areaOfInterest || visual && scene.mode === 'toronto' || torontoEditing) {
      artifact = await SemanticArtifact.open(directory, signal);
      if (objectState && objectState.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
      if (pointState && pointState.artifactRevision !== artifact.dataset.revision || cadState && cadState.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
      if (scene.areaOfInterest && scene.areaOfInterest.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
      for (const point of scene.toronto) {
        if (point.artifactRevision !== artifact.dataset.revision) throw new ModelError('stale-scene');
        if (point.key.sourceRow >= artifact.sourceCounts[point.key.sourceFileId] || point.position.some((v, i) =>
          v < artifact!.dataset.bounds.min[i] - .002 || v > artifact!.dataset.bounds.max[i] + .002)) throw new ModelError('invalid-scene');
      }
      await artifact.check(signal);
    }
    const retained = artifact;
    const placements = new Map<string, Extract<UtilityBoxAssessment, { status: 'assessed' }>>();
    const checkEditing = async (querySignal: AbortSignal) => {
      if (!torontoEditing || !pointState || !cadState) return;
      const points = await torontoEditing.points.execute('snapshot', undefined, querySignal) as PointOverrideSnapshot;
      const cad = await torontoEditing.cad.execute('snapshot', undefined, querySignal) as TorontoCadSnapshot;
      if (points.sessionId !== pointState.sessionId || points.revision !== pointState.revision || points.artifactRevision !== pointState.artifactRevision ||
        cad.sessionId !== cadState.sessionId || cad.revision !== cadState.revision || cad.artifactRevision !== cadState.artifactRevision) throw new ModelError('stale-scene');
      if (objectState && torontoEditing.objects) {
        const objects = await torontoEditing.objects.execute('snapshot', undefined, querySignal) as SceneObjectSnapshot;
        if (objects.sessionId !== objectState.sessionId || objects.revision !== objectState.revision || objects.artifactRevision !== objectState.artifactRevision) throw new ModelError('stale-scene');
      }
      // Images describe a past instant and never grant tool authority. All editing
      // still binds current sessions/revisions above, independently of image metadata.
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
      context: { ...(scene.areaOfInterest ? { areaOfInterest: { ...scene.areaOfInterest, source: 'user-selected-xy-rectangle',
        elevationScope: 'all-elevations', referencePlane: 'orbit-target-z-not-terrain', purpose: 'spatial-query-footprint-not-geometry-authority' } } : {}),
        objects: (scene.objects ?? []).map(reference => ({ reference, object: objectState!.objects.find(object => object.id === reference.objectId) })),
        utilityBoxPreset: UTILITY_BOX_PRESET, mode: scene.mode, project, selectedGeometry, availableProjectBoxes, toronto: scene.toronto.map(point => ({ ...point,
        source: 'user-attached-toronto-record-reference', artifactValidation: 'revision-and-metadata-checked',
        recordValidation: 'unverified', mapping: 'unmapped-to-project' })),
      ...(torontoEditing ? { torontoEditing: { points: { sessionId: pointState!.sessionId, revision: pointState!.revision, artifactRevision: pointState!.artifactRevision, overrideCount: pointState!.entries.length,
          attachedOverrides: pointState!.entries.filter(e => scene.toronto.some(p => p.key.sourceFileId === e.key.sourceFileId && p.key.sourceRow === e.key.sourceRow)) },
        cad: { sessionId: cadState!.sessionId, revision: cadState!.revision, artifactRevision: cadState!.artifactRevision,
          bodies: cadState!.bodies.map(({ bodyId, operation }) => ({ bodyId, operation })),
          proposals: cadState!.proposals.map(({ proposalId, operation }) => ({ proposalId, operation })) },
        ...(objectState ? { objects: { sessionId: objectState.sessionId, revision: objectState.revision, artifactRevision: objectState.artifactRevision, count: objectState.objects.length } } : {}), volatile: true } } : {}),
      capabilities: { queryAoiPoints: scene.mode === 'toronto' && !!scene.areaOfInterest && !!retained, inspectScene: true, listObjects: !!objectState, getObject: !!objectState, pointCreateProposals: !!objectState, authoredObjectKinds: objectState ? ['datum-point'] : [], authoredReferenceConsumers: objectState ? ['get_object', 'propose_point_create'] : [], nearestLabel: scene.mode === 'toronto' && scene.toronto.length > 0 && !!retained, boxParameterProposals: canPropose,
        utilityBoxAssessment: !!torontoEditing && scene.toronto.length > 0, pointMoveProposals: !!torontoEditing && scene.toronto.length > 0, cadSolidProposals: !!torontoEditing, geometryMutation: false, cadVerification: !!torontoEditing },
      nearestLabelSearchGeometry: 'original-prepared-dataset',
      limitations: ['Toronto original point record/position is not independently verified by this chat attachment boundary.',
        'Toronto and synthetic project frames are separate; no mapping exists.',
        'Synthetic box proposals are parameter-postconditions-not-cad candidates only. Toronto CAD tools, when available, retain kernel-validated pending solids, never publish. Human acceptance of each change is required.',
        'Toronto point proposals independently reread original records and check effective-position preconditions. Overrides do not change original-source nearest-label searches. All Toronto edits are volatile; restart clears them.',
        'Images may show past edits or ghosts and never grant current tool authority; rendering and publication are distinct from kernel validation. No model approval, decline or Undo tools exist.'] },
      ...(torontoEditing?.objects && objectState && pointState ? {
        async listObjects(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]);
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined);
          if (!Number.isInteger(args.offset) || args.offset < 0 || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 32) throw new ModelError('invalid-object-query');
          return { total: objectState.objects.length, offset: args.offset, objects: objectState.objects.slice(args.offset, args.offset + args.limit), nextOffset: args.offset + args.limit < objectState.objects.length ? args.offset + args.limit : null };
        },
        async getObject(objectId, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]);
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined);
          const object = objectState.objects.find(object => object.id === objectId);
          if (!object) throw new ModelError('unknown-object');
          const reference: AuthoredObjectReference = { kind: 'authored-object', sessionId: objectState.sessionId, revision: objectState.revision, objectId, objectRevision: object.objectRevision, frameId: object.frameId, units: object.units };
          return { object, reference };
        },
        async proposePointCreate(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]);
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined);
          let input: unknown;
          const source = args.input;
          if (source.kind === 'position') input = source;
          else if (source.kind === 'object') {
            const object = objectState.objects.find(object => object.id === source.objectId);
            if (!object) throw new ModelError('unknown-object');
            input = { kind: 'reference', offset: source.offset, reference: { kind: 'authored-object', sessionId: objectState.sessionId, revision: objectState.revision, objectId: object.id, objectRevision: object.objectRevision, frameId: object.frameId, units: object.units } };
          } else {
            const point = scene.toronto.find(point => point.name === source.pointName);
            if (!point) throw new ModelError('invalid-point-proposal');
            input = { kind: 'reference', offset: source.offset, reference: { kind: 'source-record', datasetId: 'toronto3d', artifactRevision: pointState.artifactRevision, key: point.key, domain: 'effective', overrideSessionId: pointState.sessionId, overrideRevision: pointState.revision, frameId: 'toronto3d-local-v1', units: 'm' } };
          }
          const request = canonicalSceneObjectProposalRequest({ sessionId: objectState.sessionId, revision: objectState.revision, artifactRevision: objectState.artifactRevision, frameId: objectState.frameId, units: objectState.units, name: args.name, input });
          const proposal = await torontoEditing.objects!.execute('propose', request, combined) as SceneObjectProposal;
          await checkEditing(combined); return proposal;
        },
      } satisfies Pick<BoundModelScene, 'listObjects' | 'getObject' | 'proposePointCreate'> : {}),
      ...(torontoEditing && pointState && cadState ? {
        async assessUtilityBox(args, querySignal) {
          const combined = AbortSignal.any([signal, querySignal, AbortSignal.timeout(25000)]);
          if (closed) throw new ModelError('stale-scene');
          await checkEditing(combined); await retained!.check(combined);
          if (pointState.entries.length || cadState.bodies.length) return { status: 'unavailable', complete: false, reason: 'edited-state-unsupported' };
          const point = scene.toronto.find(p => p.name === args.pointName);
          if (!point) throw new ModelError('invalid-placement');
          if (placements.size >= 4) return { status: 'unavailable', complete: false, reason: 'assessment-limit' };
          try {
            const result = await assessUtilityBox(retained!, point, args, combined);
            await checkEditing(combined); await retained!.check(combined);
            const assessmentId = randomUUID();
            if (result.status === 'assessed') placements.set(assessmentId, structuredClone(result));
            return { ...result, assessmentId, authorityBinding: { points: { sessionId: pointState.sessionId, revision: pointState.revision }, cad: { sessionId: cadState.sessionId, revision: cadState.revision } } };
          } catch (error) {
            await checkEditing(combined); await retained!.check(combined);
            if (error instanceof ModelError) throw error;
            return { status: 'unavailable', complete: false, reason: 'source-terrain-or-budget-unavailable', recovery: 'Prepare current source/terrain artifacts and retry; no placement was verified.' };
          }
        },
        async proposeUtilityBox(assessmentId, querySignal) {
          const combined = AbortSignal.any([signal, querySignal]); combined.throwIfAborted();
          if (closed || pointState.entries.length || cadState.bodies.length) throw new ModelError('placement-unavailable');
          await checkEditing(combined); await retained!.check(combined);
          const assessment = placements.get(assessmentId);
          if (!assessment) throw new ModelError('placement-assessment-unavailable');
          await checkPlacementTerrain(retained!, assessment.binding.preprocessingHash, combined);
          await checkEditing(combined);
          const proposal = await torontoEditing.cad.execute('propose', { sessionId: cadState.sessionId, revision: cadState.revision,
            artifactRevision: cadState.artifactRevision, operation: assessment.operation }, combined, async approvalSignal => {
              const deadline = AbortSignal.any([approvalSignal ?? new AbortController().signal, AbortSignal.timeout(5000)]);
              const current = await SemanticArtifact.open(directory, deadline);
              try {
                if (current.dataset.revision !== cadState.artifactRevision) throw new TorontoCadError('stale-artifact');
                try { await checkPlacementTerrain(current, assessment.binding.preprocessingHash, deadline); }
                catch { throw new TorontoCadError('stale-artifact'); }
              } finally { await current.close(); }
              // Last awaited precondition, independent of this model turn's lifetime.
              let points: PointOverrideSnapshot;
              try { points = await torontoEditing.points.execute('snapshot', undefined, deadline) as PointOverrideSnapshot; }
              catch { throw new TorontoCadError('stale-revision'); }
              if (points.sessionId !== pointState.sessionId || points.revision !== pointState.revision || points.entries.length ||
                points.artifactRevision !== pointState.artifactRevision) throw new TorontoCadError('stale-revision');
            }) as TorontoCadProposal;
          await checkEditing(combined); await retained!.check(combined); placements.delete(assessmentId);
          return { sessionId: proposal.sessionId, revision: proposal.revision, artifactRevision: proposal.artifactRevision,
            datasetId: proposal.datasetId, frameId: proposal.frameId, units: proposal.units, proposalId: proposal.proposalId,
            bodyId: proposal.bodyId, operation: proposal.operation, validation: proposal.validation, assessmentId,
            finding: assessment.finding, needsBasePreparation: assessment.needsBasePreparation };
        },
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
      } satisfies Pick<BoundModelScene, 'assessUtilityBox' | 'proposeUtilityBox' | 'proposePointMove' | 'proposeNearestPointMove' | 'proposeCad'> : {}),
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
      ...(scene.mode === 'toronto' && scene.areaOfInterest && retained ? {
        async queryAoiPoints(args, querySignal) {
          if (closed) throw new ModelError('stale-scene');
          if (!args || Object.keys(args).sort().join(',') !== 'label,maxResults' ||
            (args.label !== null && (!Number.isInteger(args.label) || args.label < 0 || args.label > 8)) ||
            !Number.isSafeInteger(args.maxResults) || args.maxResults < 1 || args.maxResults > 64) throw new ModelError('invalid-aoi-query');
          const outer = AbortSignal.any([signal, querySignal]);
          const combined = AbortSignal.any([outer, AbortSignal.timeout(30000)]);
          const started = performance.now();
          try {
            await retained.check(combined); await checkEditing(combined);
            const { index } = await getSemanticDiskIndex(retained, combined);
            const spatial = await SpatialPageIndex.create(retained, index, combined);
            const remaining = Math.floor(30000 - (performance.now() - started));
            if (remaining <= 0) throw new RangeError('AOI query deadline exceeded');
            const result = await spatial.aoi(scene.areaOfInterest!.corners, {
              label: args.label ?? undefined, maxResults: args.maxResults, signal: combined, maxMilliseconds: remaining,
            });
            combined.throwIfAborted(); await retained.check(combined); await checkEditing(combined);
            if (closed) throw new ModelError('stale-scene');
            return { ...result, areaOfInterest: scene.areaOfInterest, domain: 'original-source-points', elevationScope: 'all-elevations',
              selection: 'deterministic-capped-subset-not-ranked', independentVerification: false, cadVerification: false,
              boundaryRule: 'inclusive-with-tiny-floating-point-tolerance',
              limitations: 'Excludes accepted edits. Samples and counts do not establish clearance, suitability or free space.',
              points: result.points.map(({ source, ...point }) => {
                const key = { sourceFileId: source.sourceFileId, sourceRow: source.sourceRow };
                return { ...point, semanticType: TORONTO_SEMANTIC_LABELS[point.label as keyof typeof TORONTO_SEMANTIC_LABELS], key,
                  selectReference: { kind: 'toronto-point' as const, key } };
              }) };
          } catch (error) {
            outer.throwIfAborted();
            if (closed) throw new ModelError('stale-scene');
            await retained.check(outer); await checkEditing(outer);
            if (combined.aborted || error instanceof RangeError) return { complete: false, status: 'unavailable', reason: 'AOI query exceeded resource limits; no complete result' };
            throw error;
          }
        },
      } satisfies Pick<BoundModelScene, 'queryAoiPoints'> : {}),
      ...(scene.mode === 'toronto' && scene.toronto.length > 0 && retained ? {
        nearestLabel,
      } satisfies Pick<BoundModelScene, 'nearestLabel'> : {}),
      async check() { if (closed) throw new ModelError('stale-scene'); signal.throwIfAborted(); if (scene.project) authority.context(scene.project); await retained?.check(signal); await checkEditing(signal); signal.throwIfAborted(); },
      async close() { closed = true; await retained?.close(); },
    };
  } catch (error) { await artifact?.close(); throw error; }
}
