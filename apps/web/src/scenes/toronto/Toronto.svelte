<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ApprovalReview, { type ApprovalReviewItem } from '../../components/ApprovalReview.svelte';
  import PlacementSearch from './placement/PlacementSearch.svelte';
  import AreaCandidates from './placement/AreaCandidates.svelte';
  import SceneMarks from './inspection/SceneMarks.svelte';
  import { canonicalSceneMarkSnapshot, type SceneMarkSnapshot } from '@spatial/contracts';
  import { sceneMarksMatchScene } from './inspection/scene-marks-client';
  import { areaCandidatesMatchScene, validateAreaCandidateResult } from './placement/area-candidate-client';
  import type { AreaCandidateResult } from '@spatial/contracts';
  import { validatePlacementShortlist, placementMatchesScene } from './placement/placement-search-client';
  import SceneObjects from './objects/SceneObjects.svelte';
  import { SceneObjectController, type SceneObjectView } from './objects/scene-object-client';
  import type { SceneObjectSnapshot } from '@spatial/contracts';
  import PointEdits from './points/PointEdits.svelte';
  import { TorontoCadController, type TorontoCadView } from './cad/toronto-cad-client';
  import { assertCropBox, type CropBox, type CropSelection, type CropStats, type PointObservation, type PointOverrideSnapshot, type PointMoveProposal, type Vec3 } from '@spatial/contracts';
  import { createCropChannel } from './display/crop-client';
  import { cropFeedback, describeCropSelection, nextCropPhase, type CropPhase } from './display/crop-feedback';
  import { createTorontoViewer } from './toronto-viewer';
  import { POINT_TYPE_KEY, UNKNOWN_POINT_COLOR, type PointColorMode } from './display/point-colors';
  let colorMode = $state<PointColorMode>('rgb');
  import type { VisualModelSource } from '../../chat/visual/visual-model-source';
  import type { AreaOfInterestInput } from './placement/area-of-interest';
  import { compressScreenshot } from '../../chat/visual/screenshot-crop';
  import { createObservationChannel } from './display/observation-client';
  import { createDraftPointGate, type TorontoDraftPoint, type PointName } from '../../chat/draft-context';
  import type { PoleSelection } from './inspection/pole-picking';
  import { effectivePosition } from './points/point-override-client';
  import { representativeStreetChunk } from './display/street-chunk';
  import { observedPointLabel } from './points/point-presentation';
  import { DISPLAY_BUDGET_KEYS, MIN_DISPLAY_POINTS, readDisplayBudget, saveDisplayBudget, validDisplayBudget } from '../../viewer/display-budget';
  import { MAX_ADAPTIVE_POINTS } from '../../viewer/adaptive-plan';
  import { DEFAULT_ADAPTIVE_SETTINGS, type AdaptiveStats } from './display/adaptive-display';

  let { objectRefresh = 0, onobjectstate = () => {}, onarea = () => {}, points = [], pointOverrides, pointPreview, pointRefresh = 0, onpointstate = () => {}, cadRefresh = 0, modelStreaming = false, oncadblocked = () => {}, onrevision = () => {}, allocatePointName, onpoint, onpoints = () => {}, onvisualsource = () => {} }: {
    objectRefresh?: number; onobjectstate?: (snapshot: SceneObjectSnapshot | undefined, selectedId: string | undefined, blocked: boolean) => void;
    onarea?: (input?: AreaOfInterestInput) => void;
    cadRefresh?: number; modelStreaming?: boolean; oncadblocked?: (blocked: boolean) => void;
    pointRefresh?: number; onpointstate?: (snapshot?: PointOverrideSnapshot, proposal?: PointMoveProposal, blocked?: boolean) => void;
    pointOverrides?: PointOverrideSnapshot; pointPreview?: PointMoveProposal; onrevision?: (revision: string) => void;
    onvisualsource?: (source: VisualModelSource | undefined) => void;
    points?: readonly TorontoDraftPoint[]; allocatePointName: () => PointName;
    onpoint: (point: TorontoDraftPoint) => void; onpoints?: (points: readonly TorontoDraftPoint[]) => void;
  } = $props();
  const draftGate = createDraftPointGate();
  let objectView = $state<SceneObjectView>({ busy: false, needsRefresh: true });
  let selectedObjectId = $state<string>(), selectedSource = $state<string>();
  let hiddenObjectIds = $state<readonly string[]>([]);
  let reviewFocusId = $state<string>();
  const objectController = new SceneObjectController(value => { objectView = value; });
  function selectObject(id?: string) { selectedObjectId = id; selectedSource = undefined; }
  export function clearObjectSelection() { selectObject(); }
  async function focusPending(id: string) { reviewFocusId = undefined; await tick(); reviewFocusId = id; }
  $effect(() => {
    const snapshot = objectView.snapshot;
    // Preserve selection across transient reads, but never across authority replacement/removal.
    if (snapshot && selectedObjectId && !snapshot.objects.some(object => object.id === selectedObjectId)) selectedObjectId = undefined;
    onobjectstate(snapshot, selectedObjectId, objectView.busy || objectView.needsRefresh);
  });
  $effect(() => { if (mounted) viewer?.setObjects(objectView.snapshot ? $state.snapshot(objectView.snapshot) : undefined, selectedObjectId, hiddenObjectIds); });
  $effect(() => { const token = objectRefresh; untrack(() => { if (token && cadArtifact && !objectView.needsRefresh) void objectController.refresh(); }); });
  const objectReviewItems = $derived<ApprovalReviewItem[]>((objectView.snapshot?.proposals ?? []).map(proposal => ({
    id: proposal.proposalId, title: `Create ${proposal.object.name}`, summary: 'Datum point · pending',
    details: `[${proposal.object.position.join(', ')}] m\nToronto local · Z-up\nSession-only independent datum\nProposal ${proposal.proposalId}\nRevision ${proposal.revision}`,
    disabled: objectView.busy || objectView.needsRefresh,
    testId: 'scene-object-proposal', acceptTestId: 'scene-object-accept', declineTestId: 'scene-object-decline',
    onaccept: () => objectController.approve(proposal.proposalId), ondecline: () => objectController.decline(proposal.proposalId),
  })));
  let cadView = $state<TorontoCadView>({ busy: false, needsRefresh: true, status: 'Waiting for Toronto artifact…' });
  const cadController = new TorontoCadController(value => { cadView = value; oncadblocked(value.busy || value.needsRefresh); });
  let cadArtifact = $state<string>();
  let pointEditor: PointEdits | undefined;
  let pointReviewItems = $state<readonly ApprovalReviewItem[]>([]);
  const cadReviewItems = $derived<ApprovalReviewItem[]>((cadView.snapshot?.proposals ?? []).map(proposal => ({
    id: proposal.proposalId,
    title: proposal.operation.kind === 'box' ? 'Create box' : 'Create cylinder',
    summary: proposal.operation.kind === 'box' ? `Size ${proposal.operation.dimensions.join(' × ')} m` : `Radius ${proposal.operation.radius} m · height ${proposal.operation.height} m`,
    details: `Toronto local meters · Z-up · revision ${proposal.revision}\nCenter [${proposal.operation.center.join(', ')}] m\nOpenCascade valid single solid\nMeasured volume ${proposal.validation.volume} m³\nBounds [${proposal.validation.bounds.min.join(', ')}] → [${proposal.validation.bounds.max.join(', ')}] m\nProposal ${proposal.proposalId}`,
    disabled: cadView.busy || cadView.needsRefresh,
    testId: 'toronto-cad-proposal', acceptTestId: 'toronto-cad-accept', declineTestId: 'toronto-cad-decline',
    onaccept: () => cadController.approve(proposal.proposalId),
    ondecline: () => cadController.decline(proposal.proposalId),
  })));
  const reviewItems = $derived([...pointReviewItems, ...cadReviewItems, ...objectReviewItems]);
  export async function refreshAgentAuthorities(): Promise<void> {
    await tick();
    const deadline = Date.now() + 35_000;
    while ((cadView.busy || objectView.busy) && alive && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!alive || !cadArtifact || !pointEditor || cadView.busy || objectView.busy) throw new Error('Toronto authority unavailable or busy. Retry Refresh.');
    await Promise.all([cadController.refresh(), pointEditor.refreshAuthority(), objectController.refresh()]);
    await tick();
    if (!alive || cadView.needsRefresh || objectView.needsRefresh) throw new Error(objectView.error ?? cadView.status);
  }
  $effect(() => { const token = cadRefresh; untrack(() => { if (token && cadArtifact && !cadView.needsRefresh) void cadController.refresh(); }); });
  $effect(() => { if (mounted) viewer?.setCad(cadView.snapshot ? $state.snapshot(cadView.snapshot) : undefined); });
  let mounted = $state(false);
  let retainedSnapshot = $state<PointOverrideSnapshot>();
  let retainedProposals = $state<readonly PointMoveProposal[]>([]);
  const sceneSnapshot = $derived(retainedSnapshot ?? pointOverrides);
  const sceneProposals = $derived(retainedProposals);
  let pointAuthorityBlocked = $state(true);
  const placementAuthorityKey = $derived(JSON.stringify([cadArtifact, sceneSnapshot?.sessionId, sceneSnapshot?.revision,
    cadView.snapshot?.sessionId, cadView.snapshot?.revision, objectView.snapshot?.sessionId, objectView.snapshot?.revision, pointRefresh, cadRefresh, objectRefresh]));
  const effectiveMarkers = $derived([
    ...points.map(point => {
      let position = point.position;
      try { position = effectivePosition(point, sceneSnapshot); } catch { /* Source mismatch stays original. */ }
      return { name: point.name, artifactRevision: point.artifactRevision, position };
    }),
    ...sceneProposals.flatMap(proposal => proposal.moves.map(move => ({
      name: points.find(point => point.key.sourceFileId === move.key.sourceFileId && point.key.sourceRow === move.key.sourceRow)?.name ?? `File ${move.key.sourceFileId} row ${move.key.sourceRow}`,
      artifactRevision: proposal.artifactRevision, position: move.after, proposed: true,
      markerId: `${proposal.proposalId}:${move.key.sourceFileId}:${move.key.sourceRow}`,
    }))),
  ]);
  $effect(() => { if (mounted) viewer?.setDraftMarkers(effectiveMarkers); });
  // Svelte deep-state proxies must not cross the renderer's structuredClone boundary.
  $effect(() => { if (mounted) viewer?.setPointOverrides(sceneSnapshot ? $state.snapshot(sceneSnapshot) : undefined); });
  $effect(() => { if (mounted) viewer?.setPointMovePreview($state.snapshot(sceneProposals)); });
  function pinPoint(selection: PoleSelection) {
    if (!alive || viewerError) return;
    const point = draftGate.accept(selection, allocatePointName());
    if (point) { selectedObjectId = undefined; selectedSource = point.name; onpoint({ ...point, semanticLabel: observedPointLabel(selection, display) }); }
  }
  let host: HTMLDivElement;
  let viewer: ReturnType<typeof createTorontoViewer> | undefined;
  let adaptiveEnabled = $state(true);
  let pointSize = $state(4);
  let displayBudget = $state(50_000), displayDepth = $state(3);
  let nearRadius = $state(DEFAULT_ADAPTIVE_SETTINGS.nearRadius);
  let pixelThreshold = $state(DEFAULT_ADAPTIVE_SETTINGS.pixelThreshold);
  let pointBudget = $state(DEFAULT_ADAPTIVE_SETTINGS.pointBudget), budgetDraft = $state(DEFAULT_ADAPTIVE_SETTINGS.pointBudget), budgetError = $state('');
  function setBudget() {
    if (!validDisplayBudget(budgetDraft)) { budgetError = 'Enter a whole number from 65,536 to 50,000,000.'; return; }
    try { viewer?.configureAdaptive({ nearRadius, pixelThreshold, pointBudget: budgetDraft }); }
    catch { budgetError = 'Could not apply this point budget. Try a smaller value.'; return; }
    pointBudget = budgetDraft;
    budgetError = saveDisplayBudget(DISPLAY_BUDGET_KEYS.toronto, pointBudget) ? '' : 'Applied for this session; browser storage is unavailable.';
  }
  let adaptiveStats = $state<AdaptiveStats>({ loadedPoints: 0, chunks: 0, pending: 0, budgetLimited: false, error: null });
  function tuneDisplay() {
    if (!Number.isFinite(nearRadius) || nearRadius < 0 || nearRadius > 200) return;
    viewer?.configureAdaptive({ nearRadius, pixelThreshold, pointBudget });
  }
  function toggleAdaptive() {
    if (adaptiveEnabled) {
      clearCrop(); viewer?.setBox(); viewer?.startAdaptive();
    } else {
      viewer?.stopAdaptive(); focusStreet();
    }
  }
  let display = $state<PointObservation>();
  let displayStatus = $state('Waiting');
  let viewerError = $state('');
  let displayRequest = 0;
  let alive = true;
  let center = $state<number[]>([0, 0, 125]), dimensions = $state<number[]>([5, 5, 5]);
  let crop = $state<CropStats>(), cropStatus = $state('Overview only — Shift-drag a window or select a box');
  let projected = $state<CropSelection>(), cropPhase = $state<CropPhase>('idle');
  const feedback = $derived(cropFeedback(cropPhase, crop, !viewerError));
  const selectionInfo = $derived.by(() => {
    try { return describeCropSelection(projected ?? currentBox()); }
    catch { return describeCropSelection(); }
  });
  let cropRequest = 0, boxInitialized = false;
  let streetRevision: string | undefined;
  function focusStreet() {
    if (!display) return;
    const box = representativeStreetChunk(display); if (!box) return;
    center = box.min.map((n, i) => (n + box.max[i]) / 2);
    dimensions = box.min.map((n, i) => box.max[i] - n);
    changeBox(); viewer?.frameBox();
    if (adaptiveEnabled) viewer?.setBox(); else void loadSelection(box);
  }
  let cropRevision: string | undefined;
  $effect(() => { if (mounted) viewer?.setDetailState(cropPhase); });
  const cropChannel = createCropChannel(async event => {
    if (event.type === 'start') {
      if (!display || event.dataset.revision !== display.dataset.revision) throw new Error('Artifact changed; reload display before selecting detail');
      cropRevision = event.dataset.revision;
    } else if (event.type === 'batch') {
      viewer?.appendCrop(event.positions, event.colors, event.sourceIds, cropRevision, event.labels); crop = event.stats;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } else if (event.type === 'end') { crop = event.stats; }
  });
  const displayChannel = createObservationChannel('display', sample => {
    if (draftGate.bind(sample.dataset.revision)) { onpoints([]); clearCrop(); clearArea(); }
    viewer?.update(sample); display = sample; onrevision(sample.dataset.revision);
    if (cadArtifact !== sample.dataset.revision) { cadArtifact = sample.dataset.revision; selectedObjectId = undefined; selectedSource = undefined; hiddenObjectIds = []; cadController.bind(cadArtifact); objectController.bind(cadArtifact); void cadController.refresh(); void objectController.refresh(); }
    viewer?.setPointOverrides(sceneSnapshot ? $state.snapshot(sceneSnapshot) : undefined); viewer?.setPointMovePreview($state.snapshot(sceneProposals));
    viewer?.setDraftMarkers(effectiveMarkers);
  });
  function currentBox(): CropBox {
    const box: CropBox = { min: center.map((n, i) => n - dimensions[i] / 2) as unknown as Vec3, max: center.map((n, i) => n + dimensions[i] / 2) as unknown as Vec3 };
    assertCropBox(box); return box;
  }
  function changeBox() {
    boxInitialized = true; projected = undefined; cropRequest++; cropChannel.cancel(); crop = undefined; cropPhase = nextCropPhase(cropPhase, 'clear'); viewer?.clearCrop();
    try { viewer?.setBox(currentBox()); cropStatus = 'Box changed — load full resolution'; }
    catch { viewer?.setBox(); cropStatus = 'Enter finite center and positive dimensions in meters'; }
  }
  function placeBox(value: Vec3) { center = value.map(n => Math.round(n * 1000) / 1000); changeBox(); }
  function clearCrop() {
    cropRequest++; cropChannel.cancel(); crop = undefined; cropPhase = nextCropPhase(cropPhase, 'clear'); viewer?.clearCrop(); cropStatus = 'Overview only — selection retained';
  }
  function cancelCrop() {
    if (cropPhase !== 'loading') return;
    cropRequest++; cropChannel.cancel(); cropPhase = nextCropPhase(cropPhase, 'cancel');
    cropStatus = `Cancelled — ${(crop?.count ?? 0).toLocaleString()} partial points retained, selection incomplete (no downsampling). Retry the same selection or Clear.`;
  }
  async function loadSelection(selection: CropSelection) {
    if (!feedback.canLoad) return;
    clearCrop(); const request = cropRequest;
    try {
      cropPhase = nextCropPhase(cropPhase, 'load');
      cropStatus = 'Loading every point in selected volume progressively…';
      await cropChannel.load(selection);
      if (alive && request === cropRequest) {
        cropPhase = nextCropPhase(cropPhase, 'complete');
        cropStatus = projected ? 'Ready — full resolution in projected window' : 'Ready — full resolution inside box';
      }
    } catch (error) { if (alive && request === cropRequest) { cropPhase = nextCropPhase(cropPhase, 'fail'); cropStatus = `Error — incomplete full resolution (${(crop?.count ?? 0).toLocaleString()} partial points retained): ${String(error)}. Clear or retry; no downsampling.`; } }
  }
  async function loadCrop() { changeBox(); try { await loadSelection(currentBox()); } catch (error) { cropPhase = nextCropPhase(cropPhase, 'fail'); cropStatus = String(error); } }
  function retryCrop() { if (projected) void loadSelection(projected); else void loadCrop(); }
  let areaInput = $state<AreaOfInterestInput>();
  let placementSearch = $state<PlacementSearch>();
  let sceneMarks = $state<SceneMarkSnapshot>();
  let selectedSceneMark = $state<string>();
  let sceneMarkAuthority = $state(''), sceneMarkArea = $state('');
  const sceneMarksInvalidated = $derived(!!viewerError || !mounted || !!areaInput?.pending || !!areaInput?.error ||
    !!sceneProposals.length || !!pointPreview || pointAuthorityBlocked || cadView.needsRefresh || !!cadView.snapshot?.proposals.length ||
    objectView.needsRefresh || !!objectView.snapshot?.proposals.length || cadView.busy || objectView.busy);
  export function receiveSceneMarks(value: unknown): void {
    // Conversation cancellation/reset is annotation-only, independent of scene readiness.
    // Forget its revision too so the next conversation can begin at revision zero.
    if (value === undefined) {
      sceneMarks = undefined; selectedSceneMark = undefined;
      sceneMarkAuthority = ''; sceneMarkArea = ''; viewer?.setSceneMarks();
      return;
    }
    const snapshot = canonicalSceneMarkSnapshot(value);
    if (!alive || sceneMarksInvalidated || !sceneMarksMatchScene(snapshot, cadArtifact, sceneSnapshot, cadView.snapshot, objectView.snapshot)) throw new Error('Location annotations no longer match the scene. Explore again.');
    if (sceneMarks && snapshot.annotationRevision < sceneMarks.annotationRevision) throw new Error('Stale location annotations.');
    sceneMarks = snapshot; selectedSceneMark = undefined;
    sceneMarkAuthority = placementAuthorityKey; sceneMarkArea = JSON.stringify(areaInput?.area) ?? '';
    areaCandidates = undefined; selectedCandidate = undefined; viewer?.setAreaCandidates();
    viewer?.setSceneMarks(snapshot);
  }
  $effect(() => {
    if (sceneMarks && (sceneMarksInvalidated || sceneMarkAuthority !== placementAuthorityKey || sceneMarkArea !== (JSON.stringify(areaInput?.area) ?? '') ||
      !sceneMarksMatchScene(sceneMarks, cadArtifact, sceneSnapshot, cadView.snapshot, objectView.snapshot))) {
      sceneMarks = undefined; selectedSceneMark = undefined; viewer?.setSceneMarks();
    }
  });
  let areaCandidates = $state<AreaCandidateResult>();
  let selectedCandidate = $state<string>();
  let candidateAuthority = $state('');
  const candidatesInvalidated = $derived(!!viewerError || !mounted || !!areaInput?.pending || !!areaInput?.error ||
    !!sceneProposals.length || !!pointPreview || cadView.needsRefresh || !!cadView.snapshot?.proposals.length ||
    objectView.needsRefresh || !!objectView.snapshot?.proposals.length || pointAuthorityBlocked || cadView.busy || objectView.busy ||
    !!sceneSnapshot?.entries.length || !!cadView.snapshot?.bodies.length);
  export async function receiveAreaCandidates(value: unknown, current: () => boolean): Promise<void> {
    if (!alive || !current()) throw new Error('Candidate context changed.');
    const authority = placementAuthorityKey, result = validateAreaCandidateResult(value);
    const matches = () => alive && current() && authority === placementAuthorityKey && !candidatesInvalidated &&
      areaCandidatesMatchScene(result, areaInput?.area, sceneSnapshot, cadView.snapshot);
    await tick();
    if (!matches()) throw new Error('Candidate result no longer matches the active area or source-only scene. Scan again.');
    sceneMarks = undefined; selectedSceneMark = undefined; viewer?.setSceneMarks();
    areaCandidates = result; candidateAuthority = authority; selectedCandidate = undefined;
    viewer?.setAreaCandidates(result);
    await tick();
    if (!matches()) { areaCandidates = undefined; viewer?.setAreaCandidates(); throw new Error('Candidate context changed.'); }
  }
  $effect(() => {
    if (areaCandidates && (candidatesInvalidated || candidateAuthority !== placementAuthorityKey ||
      !areaCandidatesMatchScene(areaCandidates, areaInput?.area, sceneSnapshot, cadView.snapshot))) {
      areaCandidates = undefined; selectedCandidate = undefined; viewer?.setAreaCandidates();
    }
  });
  const placementInvalidated = $derived(!!viewerError || !mounted || !!areaInput?.pending ||
    !!sceneProposals.length || !!pointPreview || cadView.needsRefresh || !!cadView.snapshot?.proposals.length ||
    objectView.needsRefresh || !!objectView.snapshot?.proposals.length);
  export async function receivePlacementSearch(value: unknown, current: () => boolean): Promise<void> {
    if (!alive || !current()) throw new Error('Placement context changed.');
    const authority = placementAuthorityKey, area = JSON.stringify(areaInput?.area);
    const result = validatePlacementShortlist(value);
    await tick();
    const matches = () => alive && current() && authority === placementAuthorityKey && area === JSON.stringify(areaInput?.area) &&
      !placementInvalidated && !!areaInput?.area && placementMatchesScene(result, areaInput.area, sceneSnapshot, cadView.snapshot);
    if (!placementSearch || !matches()) throw new Error('Placement result does not match the active area or scene authority.');
    await placementSearch.receivePlacementSearch(result, matches);
    await tick();
    if (!matches()) throw new Error('Placement context changed.');
  }
  const placementBlocked = $derived(modelStreaming || !!viewerError || !mounted || !!areaInput?.pending ||
    pointAuthorityBlocked || !!sceneProposals.length || !!pointPreview || cadView.busy || cadView.needsRefresh ||
    !!cadView.snapshot?.proposals.length || objectView.busy || objectView.needsRefresh || !!objectView.snapshot?.proposals.length);
  let areaError = $state('');
  let areaTicket = 0;
  function clearArea() {
    areaTicket++; areaInput = undefined; areaError = ''; viewer?.setArea(); onarea(undefined);
  }
  async function selectArea(corners?: readonly [Vec3, Vec3, Vec3, Vec3], error?: string) {
    if (error) { areaError = error; return; }
    if (!corners || !display || !viewer) return;
    clearArea(); const ticket = areaTicket, source = viewer;
    const current = () => alive && ticket === areaTicket;
    const area = { datasetId: 'toronto3d' as const, artifactRevision: display.dataset.revision,
      frameId: 'toronto3d-local-v1' as const, units: 'm' as const, localOrigin: [627285, 4841948, 0] as const, corners };
    viewer.setBox(); viewer.setArea(corners);
    areaInput = { area, clear: clearArea, pending: true }; onarea(areaInput);
    try {
      const capture = await source.capture();
      if (!current()) return;
      const image = await compressScreenshot(capture, { x: 0, y: 0, width: capture.viewport.width, height: capture.viewport.height }, current);
      if (!current()) return;
      areaInput = { area, clear: clearArea, pending: false, attachment: { observation: image,
        isCurrent: () => source.isCaptureCurrent(capture.observationId), resolvePixel: (id, x, y) => source.resolvePixel(id, x, y) } };
      onarea(areaInput);
    } catch (error) {
      if (!current()) return;
      areaError = `Snapshot unavailable: ${error instanceof Error ? error.message : 'Capture failed'}. Select again or Clear.`;
      areaInput = { area, clear: clearArea, pending: false, error: areaError }; onarea(areaInput);
    }
  }
  function viewerFailure(message: string) {
    cropRequest++; cropChannel.cancel(); cropPhase = nextCropPhase(cropPhase, 'fail');
    cropStatus = 'Error — viewer resource failure; retained detail is incomplete. Clear detail and reload the scene before retrying.';
    viewerError = message;
  }
  async function loadDisplay() {
    const request = ++displayRequest;
    displayStatus = 'Loading root then selected LOD…';
    try {
      await displayChannel.load({ budget: displayBudget, depth: displayDepth }, true);
      if (alive && request === displayRequest) {
        displayStatus = 'Ready';
        if (display && streetRevision !== display.dataset.revision) {
          streetRevision = display.dataset.revision;
          // Only once per artifact, never on orbit/zoom or ordinary LOD reload.
          if (!boxInitialized) focusStreet();
        }
        if (adaptiveEnabled) viewer?.startAdaptive();
      }
    }
    catch (error) { if (alive && request === displayRequest) displayStatus = String(error); }
  }
  onMount(() => {
    pointBudget = readDisplayBudget(DISPLAY_BUDGET_KEYS.toronto); budgetDraft = pointBudget;
    try {
      viewer = createTorontoViewer(host, placeBox, undefined, viewerFailure, pinPoint, stats => { adaptiveStats = stats; }, (corners, error) => { void selectArea(corners, error); }, () => { boxInitialized = true; }, selectObject);
      tuneDisplay(); mounted = true;
      const current = viewer;
      onvisualsource({ capture: (request, signal) => current.capture(request, signal), captureSnapshot: (request, signal) => current.captureSnapshot(request, signal), releaseGrounding: () => current.releaseGrounding(), isCurrent: id => current.isCaptureCurrent(id), resolvePixel: (id, x, y) => current.resolvePixel(id, x, y) });
      void loadDisplay();
    }
    catch (error) { viewerError = String(error); }
    return () => { alive = false; mounted = false; clearArea(); onvisualsource(undefined); draftGate.dispose(); cadController.dispose(); objectController.dispose(); onobjectstate(undefined, undefined, true); onpoints([]); displayChannel.dispose(); cropChannel.dispose(); viewer?.dispose(); };
  });
</script>

<main>
  <div class="workspace">
    <section class="scene-panel">
      <div class="toolbar" role="group" aria-label="Scene controls">
      <SceneObjects {areaInput} view={objectView} controller={objectController} hiddenIds={hiddenObjectIds} onvisibility={(id, visible) => { hiddenObjectIds = visible ? hiddenObjectIds.filter(hidden => hidden !== id) : [...hiddenObjectIds, id]; if (!visible && selectedObjectId === id) selectObject(); }} {points} overrides={sceneSnapshot} selectedId={selectedObjectId} {selectedSource} streaming={modelStreaming} onselect={selectObject} onsource={name => { selectedSource = name; selectedObjectId = undefined; const point = points.find(point => point.name === name); if (point) viewer?.focusPosition(point.position); }} onpending={id => void focusPending(id)} onfocus={position => viewer?.focusPosition(position)} />
      <button data-testid="focus-street" disabled={!display || cropPhase === 'loading'} onclick={focusStreet} title="Return to the street view">Street view</button>
      <details class="navigation" name="scene-display"><summary>View</summary><div class="tools-content"><button disabled={!display || !!viewerError} onclick={() => viewer?.frameDataset()}>Fit scene</button><details><summary>Navigation help</summary><dl><dt>Orbit</dt><dd>Drag</dd><dt>Pan</dt><dd>Right-drag or two-finger drag</dd><dt>Zoom</dt><dd>Scroll or pinch</dd><dt>Attach a point</dt><dd>⌘ / Ctrl-click</dd><dt>Select an area</dt><dd>Shift-drag</dd></dl></details></div></details>
      <details class="technical" data-testid="display-quality" name="scene-display"><summary>Display</summary>
      <div class="tools-content">
        <select class="color-mode" data-testid="point-color-mode" aria-label="Point colors" bind:value={colorMode} disabled={!display || !!viewerError} onchange={event => { colorMode = event.currentTarget.value as PointColorMode; viewer?.setColorMode(colorMode); }}>
          <option value="rgb">Natural RGB</option><option value="type">Point types</option>
        </select>
        {#if colorMode === 'type'}
          <details class="color-key" data-testid="point-type-key">
            <summary>Point type key</summary>
            <ul aria-label="Point type color key">
              {#each [...POINT_TYPE_KEY, { label: -1, name: 'Unknown', color: UNKNOWN_POINT_COLOR }] as entry}
                <li><span style:background={entry.color} aria-hidden="true"></span>{entry.name}</li>
              {/each}
            </ul>
          </details>
        {/if}
      <label>Point size <select data-testid="display-point-size" bind:value={pointSize} onchange={event => { pointSize = Number(event.currentTarget.value); viewer?.setPointSize(pointSize); }}><option value={2}>2 px</option><option value={3}>3 px</option><option value={4}>4 px</option><option value={5}>5 px</option><option value={6}>6 px</option></select></label>
      <details><summary>Detail settings</summary>
      <label class="mode-toggle"><input data-testid="adaptive-display-toggle" type="checkbox" bind:checked={adaptiveEnabled} onchange={event => { adaptiveEnabled = event.currentTarget.checked; toggleAdaptive(); }} disabled={!display || !!viewerError} />Camera-driven detail</label>
      {#if adaptiveEnabled}
      <label>Full detail within (m)<input data-testid="display-near-radius" type="number" min="0" max="200" step="5" bind:value={nearRadius} onchange={tuneDisplay} /></label>
      <label>Distant detail <select data-testid="display-threshold" bind:value={pixelThreshold} onchange={event => { pixelThreshold = Number(event.currentTarget.value); tuneDisplay(); }}><option value={160}>Coarse</option><option value={80}>Balanced</option><option value={40}>Fine</option><option value={20}>Very fine</option></select></label>
      <label>Point budget <input data-testid="display-budget" type="number" min={MIN_DISPLAY_POINTS} max={MAX_ADAPTIVE_POINTS} step="1" bind:value={budgetDraft} onchange={setBudget} /></label>{#if budgetError}<p role="alert">{budgetError}</p>{/if}

      <p data-testid="display-status" aria-live="polite">{adaptiveStats.error ? 'Detail unavailable.' : adaptiveStats.pending ? 'Loading detail…' : adaptiveStats.budgetLimited ? 'Point budget reached' : displayStatus === 'Ready' ? 'Ready' : displayStatus}</p>
      {#if adaptiveStats.error}<button data-testid="retry-display" onclick={() => viewer?.retryAdaptive()}>Retry detail</button>{/if}
      {:else}
      <label>Display point budget <select data-testid="display-budget" bind:value={displayBudget} onchange={event => { displayBudget = Number(event.currentTarget.value); void loadDisplay(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Display maximum depth <select data-testid="display-depth" bind:value={displayDepth} onchange={event => { displayDepth = Number(event.currentTarget.value); void loadDisplay(); }}>{#each [0, 1, 2, 3] as depth}<option value={depth}>{depth}</option>{/each}</select></label>
      <p data-testid="display-status" aria-live="polite">{displayStatus}</p>
      {/if}
      <button onclick={loadDisplay}>Reload display</button>
      </details>
      </div>
      </details>
      </div>
      {#if areaError}<p class="area-error" role="alert">{areaError}</p>{/if}
      <div class="viewport" data-testid="toronto-viewer" bind:this={host}></div>
      {#if viewerError}<p role="alert">Viewer unavailable: {viewerError}</p>{/if}
      {#if adaptiveEnabled && adaptiveStats.error && !viewerError}<div class="scene-feedback" role="status"><p class="crop-summary">Detail unavailable. <button data-testid="quick-retry-display" onclick={() => viewer?.retryAdaptive()}>Retry</button></p></div>{/if}
      <div class="point-confirmation" data-testid="scene-point-confirmation">
        <PointEdits {points} artifactRevision={display?.dataset.revision} refreshToken={pointRefresh} bind:this={pointEditor} onreview={items => pointReviewItems = items} onstate={(snapshot, proposal, blocked, proposals) => { retainedSnapshot = snapshot; retainedProposals = proposals ?? []; pointAuthorityBlocked = !!blocked; onpointstate(snapshot, proposal, blocked); }} />
        {#if cadArtifact && (cadView.needsRefresh || /^(Error|TypeError|RangeError|CadError):/.test(cadView.status))}
          <section class="cad-recovery" aria-label="Toronto CAD recovery">
            <p role="alert">{cadView.status}</p>
            <button data-testid="toronto-cad-recover" disabled={cadView.busy} onclick={() => void cadController.refresh()}>Refresh CAD authority</button>
          </section>
        {/if}
      </div>
      <ApprovalReview items={reviewItems} focusId={reviewFocusId} />
      <div class="scene-feedback" hidden={cropPhase === 'idle' || cropPhase === 'complete'}>
        <p class="crop-summary" data-testid="crop-summary" aria-live="polite">{cropStatus}</p>
        {#if cropPhase === 'loading'}<div class="inline-crop-actions"><button data-testid="quick-cancel-crop" onclick={cancelCrop}>Cancel detail loading</button><span>{feedback.count}</span></div>
        {:else if feedback.canRetry}<div class="inline-crop-actions"><button data-testid="quick-retry-crop" onclick={retryCrop} disabled={!!viewerError}>Retry street detail</button></div>{/if}
      </div>
    </section>
    <aside class:has-placement={!!areaInput?.area || !!sceneMarks?.marks.length}>
      {#if sceneMarks?.marks.length}
        <SceneMarks snapshot={sceneMarks} selected={selectedSceneMark} onselect={(id, position) => { selectedSceneMark = id; viewer?.setSceneMarks(sceneMarks ? $state.snapshot(sceneMarks) : undefined, id); viewer?.focusPosition(position); }} />
      {/if}
      {#if areaCandidates}
        <AreaCandidates result={areaCandidates} selected={selectedCandidate} onselect={(id, position) => { selectedCandidate = id; viewer?.setAreaCandidates(areaCandidates ? $state.snapshot(areaCandidates) : undefined, id); viewer?.focusPosition(position); }} />
      {/if}
    </aside>
  </div>
</main>

<style>
  main, .workspace, .scene-panel { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  main { color: #f5f5f7; background: #151619; overflow: hidden; }
  .scene-panel { display: flex; flex-direction: column; }
  .viewport { position: relative; flex: 1; width: 100%; min-height: 0; }
  :global(canvas) { display: block; touch-action: none; }
  .toolbar { position: relative; z-index: 5; flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid #ffffff12; background: #1c1d20; font-size: 12px; }
  .toolbar > details { position: relative; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .toolbar > details[open] { width: auto; }
  .toolbar > details > summary { padding: 8px 10px; min-height: 36px; }
  .toolbar .tools-content { position: absolute; top: calc(100% + 8px); left: 0; width: min(300px, calc(100vw - 32px)); padding: 12px; border: 1px solid #ffffff24; border-radius: 10px; background: #242528; box-shadow: 0 8px 24px #0004; }
  .toolbar .technical { margin-left: auto; }
  .toolbar .technical .tools-content { left: auto; right: 0; }
  .toolbar .color-mode { width: 100%; margin: 0; }
  .color-key ul { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; list-style: none; margin: 0; padding: 8px 0; }
  .color-key li { display: flex; align-items: center; gap: 7px; font-size: 11px; }
  .color-key li span { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  dt { color: #f5f5f7; } dd { margin: 0 0 10px; color: #b9bac1; }
  .point-confirmation { position: absolute; right: 16px; top: 72px; z-index: 12; width: min(340px, calc(100% - 32px)); max-height: 25%; overflow-y: auto; overscroll-behavior: contain; }
  .cad-recovery { margin-top: 8px; padding: 12px; border: 1px solid #ffffff20; border-radius: 14px; background: #202124f5; }
  .cad-recovery [role="alert"] { position: static; padding: 0; margin: 0 0 8px; border: 0; background: none; max-height: none; color: #ffd187; }
  .cad-recovery button { margin: 0; }
  .toolbar > button { background: transparent; border-color: transparent; color: #d5d6dc; padding: 8px 10px; margin: 0; min-height: 36px; }
  .scene-feedback { position: absolute; z-index: 1; left: 16px; bottom: 16px; max-width: min(520px, calc(100% - 32px)); max-height: 25%; overflow-y: auto; border: 1px solid #ffffff12; border-radius: 10px; background: #202124ed; }
  .scene-panel .area-error { position: absolute; z-index: 2; left: 16px; top: 140px; max-width: calc(100% - 32px); border-radius: 8px; background: #202124ed; font-size: 12px; padding: 0 12px; color: #ffd1a3; }
  .crop-summary { font-size: 11px; color: #b9bac1; padding: 9px 12px; margin: 0; overflow-wrap: anywhere; }
  .inline-crop-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 0 12px 8px; font-size: 11px; color: #b9bac1; }
  aside { position: absolute; z-index: 2; top: 16px; right: 16px; max-width: calc(100% - 32px); max-height: calc(100% - 32px); overflow-y: auto; overscroll-behavior: contain; }
  aside.has-placement { width: 360px; }
  .technical { border: 1px solid #ffffff18; border-radius: 12px; background: #202124f5; box-shadow: 0 8px 32px #0003; }
  .technical > summary { padding: 10px 14px; }
  .technical[open] { width: 360px; max-width: 100%; }
  .tools-content { padding: 0 14px 14px; box-sizing: border-box; max-height: min(65dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  summary { color: #e8e8ed; font-size: 12px; cursor: pointer; }
  label { display: block; margin: 10px 0; font-size: 12px; color: #b9bac1; }
  select { display: block; width: 100%; margin-top: 4px; }
  .mode-toggle { display: flex; align-items: center; gap: 8px; }
  .mode-toggle input { width: auto; margin: 0; }
  input { width: 100%; box-sizing: border-box; }
  button, select, input { color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff1c; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
  button, select { cursor: pointer; } button { margin: 4px 0; } button:disabled { opacity: .4; cursor: default; }
  button:not(:disabled):hover { border-color: #72737b; }
  button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  [role="alert"] { position: absolute; z-index: 1; left: 16px; right: 16px; top: 64px; max-height: 25%; overflow-y: auto; margin: 0; color: #ffb2aa; background: #202124f5; border: 1px solid #ffb2aa44; border-radius: 10px; padding: 10px 14px; overflow-wrap: anywhere; }
  @media (pointer: coarse) { .toolbar > button, .toolbar > details > summary { min-height: 44px; } }
  @media (max-width: 600px) {
    .toolbar { padding: 4px 8px; gap: 0; }
    .toolbar > button, .toolbar > details > summary { padding: 10px 8px; font-size: 12px; }
    .scene-panel .area-error { top: 112px; }
    aside { top: auto; bottom: 12px; right: 12px; max-width: calc(100% - 24px); max-height: 45%; }
    .scene-feedback { left: 12px; bottom: 12px; max-width: calc(100% - 24px); }
  }
</style>
