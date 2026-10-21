import { setTimeout as delay } from 'node:timers/promises';
import { canonicalModelScene, canonicalProtocolJson, type ModelScene, type ModelReferenceSelection, type ModelProposalAuthority,
  type ModelTurnRequest, type ModelVisualObservation, type PointOverrideSnapshot, type TorontoCadSnapshot } from '@spatial/contracts';
import type { SceneObjectSnapshot } from '../../../../packages/contracts/src/scene-objects';
import { bindModelScene, type ModelEditingAuthorities } from './model-scene';
import { ModelError, type BoundModelScene } from './provider-model';
import { ModelBrowserBroker } from './model-browser-broker';
import { validateModelVisual } from './model-visual';
import { readSourcePoint } from '../datasets/source-point';

/** Retry only side-effect-free scene reads. Never wrap a proposal or human mutation. */
export async function retryModelSceneRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    try { return await read(); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'busy')) throw error;
      await delay(25, undefined, { signal });
    }
  }
}

export interface ApprovalObservation { readonly outcome: 'accepted' | 'declined' | 'invalidated'; readonly scene: ModelScene; readonly context: unknown }
/** Browser RPC never supplies a decision. Only successful authority operations create decision receipts. */
export function createModelAgentRuntime(call: ModelTurnRequest, initial: BoundModelScene, directory: string,
  signal: AbortSignal, browser: ModelBrowserBroker, editing?: ModelEditingAuthorities) {
  let scene = call.scene, current = initial;
  const rebind = async (next: ModelScene) => {
    const bound = await retryModelSceneRead(() => bindModelScene(next, directory, signal, undefined, editing), signal);
    const old = current; current = bound; scene = next; await old.close();
  };
  const approval = async (kind: ModelProposalAuthority, proposalId: string): Promise<ApprovalObservation> => {
    const baseline = current.context as { torontoEditing?: { points: Pick<PointOverrideSnapshot, 'sessionId' | 'revision' | 'artifactRevision'>; cad: Pick<TorontoCadSnapshot, 'sessionId' | 'revision' | 'artifactRevision'>; objects?: Pick<SceneObjectSnapshot, 'sessionId' | 'revision' | 'artifactRevision'> } };
    const pointBefore = baseline.torontoEditing?.points;
    const cadBefore = baseline.torontoEditing?.cad;
    const objectBefore = baseline.torontoEditing?.objects;
    const owner = kind === 'points' ? editing?.points : kind === 'objects' ? editing?.objects : editing?.cad;
    if (!owner) throw new ModelError('invalid-scene');
    // The authority owns these receipts; a client cannot forge or inject them via chat callbacks.
    const decisionOwner = owner as typeof owner & { proposalDecision(id: string): 'accepted' | 'declined' | undefined };
    if (typeof decisionOwner.proposalDecision !== 'function') throw new ModelError('approval-observation-unavailable');
    for (;;) {
      signal.throwIfAborted();
      const decision = decisionOwner.proposalDecision(proposalId);
      if (decision) {
        const points = editing && await retryModelSceneRead(() => editing.points.execute('snapshot', undefined, signal), signal) as PointOverrideSnapshot | undefined;
        const cad = editing && await retryModelSceneRead(() => editing.cad.execute('snapshot', undefined, signal), signal) as TorontoCadSnapshot | undefined;
        const objects = editing?.objects && await retryModelSceneRead(() => editing.objects!.execute('snapshot', undefined, signal), signal) as SceneObjectSnapshot | undefined;
        const increment = (target: ModelProposalAuthority) => decision === 'accepted' && kind === target ? 1 : 0;
        const verify = (points: typeof pointBefore, cad: typeof cadBefore, objects: typeof objectBefore) => {
          if (pointBefore && (!points || points.sessionId !== pointBefore.sessionId || points.artifactRevision !== pointBefore.artifactRevision || points.revision !== pointBefore.revision + increment('points')) ||
            cadBefore && (!cad || cad.sessionId !== cadBefore.sessionId || cad.artifactRevision !== cadBefore.artifactRevision || cad.revision !== cadBefore.revision + increment('cad')) ||
            objectBefore && (!objects || objects.sessionId !== objectBefore.sessionId || objects.artifactRevision !== objectBefore.artifactRevision || objects.revision !== objectBefore.revision + increment('objects')))  throw new ModelError('stale-scene');
        };
        verify(points, cad, objects);
        const next = canonicalModelScene({ ...scene,
          ...(scene.objects ? { objects: scene.objects.map(ref => ({ ...ref, revision: objects?.revision ?? ref.revision })) } : {}) });
        await rebind(next);
        // A contended rebind must not silently adopt another edit after the receipt check.
        const rebound = current.context as typeof baseline;
        verify(rebound.torontoEditing?.points, rebound.torontoEditing?.cad, rebound.torontoEditing?.objects);
        return { outcome: decision, scene, context: current.context };
      }
      try { await current.check(); }
      catch (error) {
        if (decisionOwner.proposalDecision(proposalId)) continue;
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'busy')) throw error;
      }
      await delay(100, undefined, { signal });
    }
  };
  const select = async (reference: ModelReferenceSelection, toolCallId: string) => {
    await retryModelSceneRead(() => current.check(), signal);
    let position: readonly number[];
    if (reference.kind === 'toronto-point') {
      if (scene.mode !== 'toronto') throw new ModelError('invalid-scene');
      const context = current.context as { torontoEditing?: { points: { artifactRevision: string } } };
      const revision = context.torontoEditing?.points.artifactRevision ?? scene.toronto[0]?.artifactRevision ?? scene.areaOfInterest?.artifactRevision;
      if (!revision) throw new ModelError('invalid-scene');
      position = (await readSourcePoint(directory, { revision, key: reference.key }, signal)).position;
    } else throw new ModelError('invalid-scene');
    const result = await browser.request({ kind: 'select-reference', reference }, toolCallId);
    await retryModelSceneRead(() => current.check(), signal);
    if (result.status !== 'selected') return { status: 'unavailable' as const };
    const next = result.scene;
    if (reference.kind === 'toronto-point') {
      const added = next.toronto.at(-1);
      if (next.toronto.length !== scene.toronto.length + 1 || !added || canonicalProtocolJson(added.key) !== canonicalProtocolJson(reference.key) ||
        canonicalProtocolJson(added.position) !== canonicalProtocolJson(position) || canonicalProtocolJson({ ...next, toronto: next.toronto.slice(0, -1) }) !== canonicalProtocolJson(scene)) throw new ModelError('invalid-tool-result');
    }
    await rebind(next);
    return { status: 'selected' as const, scene, context: current.context };
  };
  const capture = async (request: Parameters<NonNullable<BoundModelScene['captureScene']>>[0], toolCallId: string): Promise<ModelVisualObservation | undefined> => {
    const result = await browser.request({ kind: 'capture', request }, toolCallId);
    await retryModelSceneRead(() => current.check(), signal);
    if (result.status !== 'captured') return undefined;
    return validateModelVisual({ ...call, scene, visualObservation: result.observation }, signal);
  };
  // Dynamic forwarding ensures every subsequent tool uses the freshly bound revision and references.
  return new Proxy({} as BoundModelScene, { get(_target, key) {
    if (key === 'check') return () => retryModelSceneRead(() => current.check(), signal);
    if (key === 'waitForApproval') return approval;
    if (key === 'selectReference') return select;
    if (key === 'captureScene') return capture;
    if (key === 'close') return () => current.close();
    const value = current[key as keyof BoundModelScene];
    return typeof value === 'function' ? (...args: unknown[]) => (current[key as keyof BoundModelScene] as (...args: unknown[]) => unknown)(...args) : value;
  } });
}
