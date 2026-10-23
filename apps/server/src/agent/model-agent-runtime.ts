import { captureAuthorityScope, captureAdmission } from './exploration-evidence';
import type { CaptureEvidenceAdmission } from '@spatial/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalModelScene, canonicalProtocolJson, type ModelScene, type ModelReferenceSelection, type ModelProposalAuthority,
  type ModelTurnRequest, type ModelVisualObservation, type PointOverrideSnapshot, type TorontoCadSnapshot } from '@spatial/contracts';
import type { SceneObjectSnapshot } from '../../../../packages/contracts/src/scene-objects';
import { bindModelScene, type ModelEditingAuthorities } from './model-scene';
import { ModelError, type BoundModelScene } from './provider-model';
import { ModelBrowserBroker } from './model-browser-broker';
import { validateModelVisual } from './model-visual';
import { readSourcePoint } from '../datasets/source-point';
import { assertCaptureSourceIdentity, sceneCaptureCapabilities, resolveViewSourceReference, sameSourceBinding } from './agent-view-source';
import { CaptureViewError, canonicalModelCaptureRequest, canonicalBrowserCaptureRequest, canonicalAgentViewReceipt, canonicalSceneBox, sceneRegionBounds, type AgentViewReceipt, type BrowserCaptureRequest, type SceneSourceBinding } from '@spatial/contracts';
import { assertVec3, protocolKeys, protocolRecord, canonicalModelReferenceSelection, modelVisualImageSize, type VisualPixelResolution } from '@spatial/contracts';

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
  signal: AbortSignal, browser: ModelBrowserBroker, editing?: ModelEditingAuthorities, clouds?: Readonly<Record<string, string>>,
  visualResolve?: NonNullable<BoundModelScene['resolveVisualPixel']>) {
  let scene = call.scene, current = initial;
  let visual = call.visualObservation;
  let pixelOwner = visual?.observationId;
  let evidenceAdmission: CaptureEvidenceAdmission | undefined;
  let baseView: { id: string; binding: SceneSourceBinding; receipt: AgentViewReceipt; expires: number } | undefined;
  const clearView = () => { baseView = undefined; pixelOwner = undefined; evidenceAdmission = undefined; };
  signal.addEventListener('abort', clearView, { once: true });
  const rebind = async (next: ModelScene) => {
    clearView();
    const bound = await retryModelSceneRead(() => bindModelScene(next, directory, signal, undefined, editing, clouds), signal);
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
    } else if (scene.mode === 'cloud' && reference.kind === 'cloud-point' && current.resolveReference) {
      position = await current.resolveReference(reference, signal);
    } else throw new ModelError('invalid-scene');
    const result = await browser.request({ kind: 'select-reference', reference }, toolCallId);
    await retryModelSceneRead(() => current.check(), signal);
    if (result.status !== 'selected') return { status: 'unavailable' as const };
    const next = result.scene;
    if (reference.kind === 'cloud-point') {
      const previous = scene.cloud, cloud = next.cloud, added = cloud?.points.at(-1);
      if (next.mode !== 'cloud' || !previous || !cloud || cloud.points.length !== previous.points.length + 1 || !added ||
        canonicalProtocolJson(added.key) !== canonicalProtocolJson(reference.key) || canonicalProtocolJson(added.position) !== canonicalProtocolJson(position) ||
        canonicalProtocolJson({ ...next, cloud: { ...cloud, points: cloud.points.slice(0, -1) } }) !== canonicalProtocolJson(scene)) throw new ModelError('invalid-tool-result');
    }
    if (reference.kind === 'toronto-point') {
      const added = next.toronto.at(-1);
      if (next.toronto.length !== scene.toronto.length + 1 || !added || canonicalProtocolJson(added.key) !== canonicalProtocolJson(reference.key) ||
        canonicalProtocolJson(added.position) !== canonicalProtocolJson(position) || canonicalProtocolJson({ ...next, toronto: next.toronto.slice(0, -1) }) !== canonicalProtocolJson(scene)) throw new ModelError('invalid-tool-result');
    }
    await rebind(next);
    return { status: 'selected' as const, scene, context: current.context };
  };
  const capture: NonNullable<BoundModelScene['captureScene']> = async (input, toolCallId) => {
    const oldBase = baseView; clearView();
    const started = performance.now();
    await retryModelSceneRead(() => current.check(), signal);
    const source = sceneCaptureCapabilities(scene, current);
    let normalized: BrowserCaptureRequest;
    try {
      assertCaptureSourceIdentity(input, source);
      const request = canonicalModelCaptureRequest(input);
      if (request.colorMode && source && !source.colorModes.includes(request.colorMode)) throw new CaptureViewError('unsupported');
      if (request.kind === 'frame') {
        if (!source) throw new CaptureViewError('unsupported');
        let bounds: import('@spatial/contracts').SceneBox;
        if (request.target.kind === 'reference') {
          const center = await resolveViewSourceReference(request.target.reference, scene, current, directory, signal);
          await retryModelSceneRead(() => current.check(), signal);
          const half = request.target.spanMeters / 2;
          try { bounds = canonicalSceneBox({ min: center.map(n => n - half), max: center.map(n => n + half) }); }
          catch { throw new CaptureViewError('numerical-range'); }
          normalized = { kind: 'framed', binding: source.binding, bounds, pivot: center, orientation: request.orientation, targetKind: 'original-source-reference', reference: request.target.reference, ...(request.colorMode ? { colorMode: request.colorMode } : {}) };
        } else {
          const region = request.target.region;
          if (!sameSourceBinding(region.binding, source.binding)) throw new ModelError('stale-scene');
          bounds = sceneRegionBounds(region);
          normalized = { kind: 'framed', binding: source.binding, bounds, pivot: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2], orientation: request.orientation, targetKind: region.shape.kind === 'box' ? 'declared-box' : 'declared-polygon-prism', region, ...(request.colorMode ? { colorMode: request.colorMode } : {}) };
        }
        if (bounds.min.some((n, i) => n > source.bounds.max[i] || bounds.max[i] < source.bounds.min[i])) throw new CaptureViewError('outside-source-bounds');
      } else if (request.kind === 'relative') {
        if (!source || !oldBase || oldBase.id !== request.observationId || performance.now() >= oldBase.expires || !sameSourceBinding(oldBase.binding, source.binding)) throw new CaptureViewError('view-unavailable');
        normalized = { kind: 'adjust', binding: source.binding, observationId: oldBase.id, base: oldBase.receipt,
          adjustment: { azimuthDeltaDegrees: request.azimuthDeltaDegrees, elevationDeltaDegrees: request.elevationDeltaDegrees, distanceScale: request.distanceScale }, ...(request.colorMode ? { colorMode: request.colorMode } : {}) };
      } else normalized = request;
      normalized = canonicalBrowserCaptureRequest(normalized);
      const authorityBefore = await captureAuthorityScope(scene.mode === 'toronto' ? editing : undefined, signal);
      const result = await browser.request({ kind: 'capture', request: normalized }, toolCallId);
      await retryModelSceneRead(() => current.check(), signal);
      const authorityAfter = await captureAuthorityScope(scene.mode === 'toronto' ? editing : undefined, signal);
      await retryModelSceneRead(() => current.check(), signal);
      const admitted = captureAdmission(request, normalized, authorityBefore, authorityAfter);
      if (result.status !== 'captured') {
        if (result.status === 'unavailable') evidenceAdmission = admitted;
        return result.status === 'unavailable' ? result : undefined;
      }
      const checked = await validateModelVisual({ ...call, scene, visualObservation: result.observation }, signal);
      await retryModelSceneRead(() => current.check(), signal);
      if (!checked) return undefined;
      if (source && (checked.binding.sourceId !== source.binding.sourceId || checked.binding.sourceRevision !== source.binding.sourceRevision || checked.binding.frameId !== source.binding.frameId || canonicalProtocolJson(checked.binding.origin) !== canonicalProtocolJson(source.binding.origin))) throw new ModelError('invalid-tool-result');
      const rawReceipt = checked.coverage.agentView;
      if (rawReceipt !== undefined) {
        const receipt = canonicalAgentViewReceipt(rawReceipt);
        if (receipt.fov !== checked.camera.fov || receipt.zoom !== checked.camera.zoom) throw new ModelError('invalid-tool-result');
        const offset = checked.camera.position.map((n, i) => n - receipt.pivot[i]);
        const distance = Math.hypot(...offset);
        const closeNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
        const actualElevation = Math.asin(Math.max(-1, Math.min(1, offset[2]! / distance))) * 180 / Math.PI;
        const actualAzimuth = Math.atan2(offset[0]!, offset[1]!) * 180 / Math.PI;
        const azimuthError = ((receipt.azimuthDegrees - actualAzimuth + 180) % 360 + 360) % 360 - 180;
        if (!closeNumber(receipt.distance, distance) || Math.abs(receipt.elevationDegrees - actualElevation) > 1e-5 || Math.abs(actualElevation) < 89.99999 && Math.abs(azimuthError) > 1e-5) throw new ModelError('invalid-tool-result');
        if (normalized.kind === 'framed' || normalized.kind === 'adjust') {
          const expected = normalized.kind === 'framed' ? normalized : normalized.base;
          const pivot = normalized.kind === 'framed' ? normalized.pivot : normalized.base.pivot;
          if (canonicalProtocolJson(receipt.bounds) !== canonicalProtocolJson(expected.bounds) || canonicalProtocolJson(receipt.pivot) !== canonicalProtocolJson(pivot) || receipt.targetKind !== expected.targetKind || canonicalProtocolJson(receipt.reference ?? null) !== canonicalProtocolJson(expected.reference ?? null) || canonicalProtocolJson(receipt.region ?? null) !== canonicalProtocolJson(expected.region ?? null)) throw new ModelError('invalid-tool-result');
          if (normalized.kind === 'framed' && (receipt.azimuthDegrees !== 45 || receipt.elevationDegrees !== (normalized.orientation === 'top' ? 90 : 45) || receipt.fov !== 50 || receipt.zoom !== 1 || !receipt.fitGuaranteed || receipt.targetBehind || receipt.requested !== undefined)) throw new ModelError('invalid-tool-result');
          if (normalized.kind === 'adjust') {
            const a = normalized.adjustment, old = normalized.base;
            const azimuth = ((old.azimuthDegrees + a.azimuthDeltaDegrees + 180) % 360 + 360) % 360 - 180;
            if (receipt.azimuthDegrees !== azimuth || receipt.elevationDegrees !== old.elevationDegrees + a.elevationDeltaDegrees || !closeNumber(receipt.distance, old.distance * a.distanceScale) || receipt.fov !== old.fov || receipt.zoom !== old.zoom || receipt.fitGuaranteed || canonicalProtocolJson(receipt.requested) !== canonicalProtocolJson(a)) throw new ModelError('invalid-tool-result');
          }
        } else if (receipt.targetKind !== (normalized.kind === 'camera' ? 'explicit-camera' : 'browser-focus') || receipt.reference || receipt.region || receipt.requested || receipt.fitGuaranteed || canonicalProtocolJson(receipt.bounds.min) !== canonicalProtocolJson(receipt.pivot) || canonicalProtocolJson(receipt.bounds.max) !== canonicalProtocolJson(receipt.pivot)) {
          throw new ModelError('invalid-tool-result');
        }
        if (source) baseView = { id: checked.observationId, binding: source.binding, receipt: JSON.parse(JSON.stringify(receipt)), expires: started + 300000 };
      } else if (normalized.kind === 'framed' || normalized.kind === 'adjust') throw new ModelError('invalid-tool-result');
      evidenceAdmission = admitted;
      visual = checked; pixelOwner = checked.observationId;
      return checked;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CaptureViewError) return { status: 'unavailable', reason: error.code };
      throw error;
    }
  };
  const resolveVisualPixel: NonNullable<BoundModelScene['resolveVisualPixel']> = async (args, toolCallId, querySignal) => {
    const check = async () => { signal.throwIfAborted(); querySignal.throwIfAborted(); await retryModelSceneRead(() => current.check(), signal); };
    await check();
    const observation = visual;
    if (!visualResolve || !observation || observation.observationId !== args.observationId) throw new ModelError('invalid-visual-pixel');
    if (pixelOwner !== args.observationId) return { status: 'unavailable', ...args, reason: 'Observation replaced by a later capture request' };
    const size = modelVisualImageSize(observation);
    if (!Number.isSafeInteger(args.x) || !Number.isSafeInteger(args.y) || args.x < 0 || args.y < 0 || args.x >= size.width || args.y >= size.height) throw new ModelError('invalid-visual-pixel');
    const result = await visualResolve(args, toolCallId, querySignal); await check();
    if (result.observationId !== args.observationId || result.x !== args.x || result.y !== args.y) throw new ModelError('invalid-tool-result');
    if (result.status !== 'resolved') return result;
    try {
      const p = protocolRecord(result.provenance);
      protocolKeys(p, ['datasetId', 'artifactRevision', 'key', 'position', 'frameId', 'units', 'origin', 'layer']);
      assertVec3(p.position); assertVec3(p.origin);
      const b = observation.binding;
      if (p.datasetId !== b.sourceId || p.artifactRevision !== b.sourceRevision || p.frameId !== b.frameId || p.units !== 'm' ||
        canonicalProtocolJson(p.origin) !== canonicalProtocolJson(b.origin) || typeof p.layer !== 'string' || p.layer.length > 128) throw new ModelError('invalid-tool-result');
      let position: readonly number[], reference: ModelReferenceSelection;
      if (scene.mode === 'cloud' && scene.cloud && current.resolveReference) {
        const cloud = scene.cloud;
        if (b.sourceId !== cloud.id || b.sourceRevision !== cloud.revision || b.frameId !== cloud.frameId || canonicalProtocolJson(b.origin) !== canonicalProtocolJson(cloud.localOrigin)) throw new ModelError('stale-scene');
        reference = canonicalModelReferenceSelection({ kind: 'cloud-point', cloudId: cloud.id, revision: cloud.revision, key: p.key });
        position = await current.resolveReference(reference, querySignal);
      } else if (scene.mode === 'toronto') {
        const context = current.context as { spatialFrame?: { artifactRevision?: string }; torontoEditing?: { points: { artifactRevision: string } } };
        const revision = context.torontoEditing?.points.artifactRevision ?? scene.toronto[0]?.artifactRevision ?? scene.areaOfInterest?.artifactRevision ?? context.spatialFrame?.artifactRevision;
        if (!revision || b.sourceId !== 'toronto3d' || b.sourceRevision !== revision || b.frameId !== 'toronto3d-local-v1' || canonicalProtocolJson(b.origin) !== '[627285,4841948,0]') throw new ModelError('stale-scene');
        reference = canonicalModelReferenceSelection({ kind: 'toronto-point', key: p.key });
        position = (await readSourcePoint(directory, { revision, key: reference.key }, querySignal)).position;
      } else throw new ModelError('invalid-scene');
      await check();
      if (canonicalProtocolJson(position) !== canonicalProtocolJson(p.position)) throw new ModelError('invalid-tool-result');
      return { ...result, provenance: { datasetId: b.sourceId, artifactRevision: b.sourceRevision, key: reference.key,
        position: [...position], frameId: b.frameId, units: 'm', origin: [...b.origin], layer: p.layer,
        recordValidation: 'server-verified-original-record', visibility: 'browser-observed-capture-time', selectReference: { ...reference } } } as VisualPixelResolution;
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError('invalid-tool-result');
    }
  };
  // Dynamic forwarding ensures every subsequent tool uses the freshly bound revision and references.
  return new Proxy({} as BoundModelScene, { get(_target, key) {
    if (key === 'check') return () => retryModelSceneRead(() => current.check(), signal);
    if (key === 'waitForApproval') return approval;
    if (key === 'selectReference') return select;
    if (key === 'captureScene') return capture;
    if (key === 'invalidateCapture') return clearView;
    if (key === 'captureCapabilities') return sceneCaptureCapabilities(scene, current);
    if (key === 'captureEvidenceAdmission') return evidenceAdmission;
    if (key === 'resolveVisualPixel') return visualResolve ? resolveVisualPixel : undefined;
    if (key === 'close') return () => { clearView(); signal.removeEventListener('abort', clearView); return current.close(); };
    const value = current[key as keyof BoundModelScene];
    return typeof value === 'function' ? (...args: unknown[]) => (current[key as keyof BoundModelScene] as (...args: unknown[]) => unknown)(...args) : value;
  } });
}
