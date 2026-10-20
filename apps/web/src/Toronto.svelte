<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ApprovalReview, { type ApprovalReviewItem } from './ApprovalReview.svelte';
  import TorontoCad from './TorontoCad.svelte';
  import PlacementSearch from './PlacementSearch.svelte';
  import AreaCandidates from './AreaCandidates.svelte';
  import { areaCandidatesMatchScene, validateAreaCandidateResult } from './area-candidate-client';
  import type { AreaCandidateResult } from '@spatial/contracts';
  import { validatePlacementShortlist, placementMatchesScene } from './placement-search-client';
  import SceneObjects from './SceneObjects.svelte';
  import { SceneObjectController, type SceneObjectView } from './scene-object-client';
  import type { SceneObjectSnapshot } from '@spatial/contracts';
  import PointEdits from './PointEdits.svelte';
  import { TorontoCadController, type TorontoCadView } from './toronto-cad-client';
  import { assertCropBox, type CropBox, type CropSelection, type CropStats, type PointObservation, type PointOverrideSnapshot, type PointMoveProposal, type Vec3 } from '@spatial/contracts';
  import { createCropChannel } from './crop-client';
  import { cropFeedback, describeCropSelection, nextCropPhase, type CropPhase } from './crop-feedback';
  import { createTorontoViewer } from './toronto-viewer';
  import { POINT_TYPE_KEY, UNKNOWN_POINT_COLOR, type PointColorMode } from './point-colors';
  let colorMode = $state<PointColorMode>('rgb');
  import VisualObservationPanel from './VisualObservationPanel.svelte';
  import type { VisualModelSource } from './visual-model-source';
  import type { AreaOfInterestInput } from './area-of-interest';
  import { compressScreenshot } from './screenshot-crop';
  import { createObservationChannel } from './observation-client';
  import { createDraftPointGate, type TorontoDraftPoint, type PointName } from './draft-context';
  import type { PoleSelection } from './pole-picking';
  import { effectivePosition } from './point-override-client';
  import { representativeStreetChunk } from './street-chunk';
  import { observedPointLabel } from './point-presentation';
  import { DEFAULT_ADAPTIVE_SETTINGS, type AdaptiveStats } from './adaptive-display';

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
  let cadToolsOpen = $state(false);
  let pointToolsHost = $state<HTMLElement>();
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
  let pointBudget = $state(DEFAULT_ADAPTIVE_SETTINGS.pointBudget);
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
  let harnessBudget = $state(1024), harnessDepth = $state(2);
  let display = $state<PointObservation>(), observation = $state<PointObservation>();
  let displayStatus = $state('Waiting'), harnessStatus = $state('Waiting');
  let viewerError = $state('');
  let displayRequest = 0, harnessRequest = 0;
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
  const harnessChannel = createObservationChannel('harness', sample => { observation = sample; });
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
  async function loadHarness() {
    const request = ++harnessRequest;
    harnessStatus = 'Loading bounded observation…';
    // Do not label a prior observation with newly requested settings while loading/failing.
    observation = undefined;
    try { await harnessChannel.load({ budget: harnessBudget, depth: harnessDepth }); if (alive && request === harnessRequest) harnessStatus = 'Ready'; }
    catch (error) { if (alive && request === harnessRequest) harnessStatus = String(error); }
  }
  function downloadObservation() {
    if (!observation) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(observation)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `toronto3d-observation-${observation.sampleHash.slice(0, 12)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  onMount(() => {
    try {
      viewer = createTorontoViewer(host, placeBox, undefined, viewerFailure, pinPoint, stats => { adaptiveStats = stats; }, (corners, error) => { void selectArea(corners, error); }, () => { boxInitialized = true; }, selectObject);
      tuneDisplay(); mounted = true;
      const current = viewer;
      onvisualsource({ capture: request => current.capture(request), isCurrent: id => current.isCaptureCurrent(id), resolvePixel: (id, x, y) => current.resolvePixel(id, x, y) });
      void loadDisplay(); void loadHarness();
    }
    catch (error) { viewerError = String(error); }
    return () => { alive = false; mounted = false; clearArea(); onvisualsource(undefined); draftGate.dispose(); cadController.dispose(); objectController.dispose(); onobjectstate(undefined, undefined, true); onpoints([]); displayChannel.dispose(); harnessChannel.dispose(); cropChannel.dispose(); viewer?.dispose(); };
  });
</script>

<main>
  <div class="workspace">
    <section class="scene-panel">
      <div class="toolbar"><button data-testid="focus-street" disabled={!display || cropPhase === 'loading'} onclick={focusStreet}>Street chunk</button>
        <select class="color-mode" data-testid="point-color-mode" aria-label="Point colors" bind:value={colorMode} disabled={!display || !!viewerError} onchange={event => { colorMode = event.currentTarget.value as PointColorMode; viewer?.setColorMode(colorMode); }}>
          <option value="rgb">Natural RGB</option><option value="type">Point types</option>
        </select>
        {#if colorMode === 'type'}
          <details class="color-key" data-testid="point-type-key">
            <summary>Key</summary>
            <ul aria-label="Point type color key">
              {#each [...POINT_TYPE_KEY, { label: -1, name: 'Unknown', color: UNKNOWN_POINT_COLOR }] as entry}
                <li><span style:background={entry.color} aria-hidden="true"></span>{entry.name}</li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
      {#if areaError}<p class="area-error" role="alert">{areaError}</p>{/if}
      <div class="viewport" data-testid="toronto-viewer" bind:this={host}></div>
      {#if viewerError}<p role="alert">Viewer unavailable: {viewerError}</p>{/if}
      {#if adaptiveEnabled && adaptiveStats.error && !viewerError}<div class="scene-feedback" role="status"><p class="crop-summary">Detail unavailable. <button data-testid="quick-retry-display" onclick={() => viewer?.retryAdaptive()}>Retry</button></p></div>{/if}
      <div class="point-confirmation" data-testid="scene-point-confirmation">
        <PointEdits {points} toolsHost={pointToolsHost} artifactRevision={display?.dataset.revision} refreshToken={pointRefresh} streaming={modelStreaming} bind:this={pointEditor} onreview={items => pointReviewItems = items} onselect={selection => pinPoint(selection)} onstate={(snapshot, proposal, blocked, proposals) => { retainedSnapshot = snapshot; retainedProposals = proposals ?? []; pointAuthorityBlocked = !!blocked; onpointstate(snapshot, proposal, blocked); }} />
        {#if cadArtifact && (cadView.needsRefresh || /^(Error|TypeError|RangeError|CadError):/.test(cadView.status))}
          <section class="cad-recovery" aria-label="Toronto CAD recovery">
            <p role="alert">{cadView.status}</p>
            <button data-testid="toronto-cad-recover" disabled={cadView.busy} onclick={() => void cadController.refresh()}>Refresh CAD authority</button>
          </section>
        {/if}
      </div>
      <SceneObjects {areaInput} view={objectView} controller={objectController} hiddenIds={hiddenObjectIds} onvisibility={(id, visible) => { hiddenObjectIds = visible ? hiddenObjectIds.filter(hidden => hidden !== id) : [...hiddenObjectIds, id]; if (!visible && selectedObjectId === id) selectObject(); }} {points} overrides={sceneSnapshot} selectedId={selectedObjectId} {selectedSource} streaming={modelStreaming} onselect={selectObject} onsource={name => { selectedSource = name; selectedObjectId = undefined; const point = points.find(point => point.name === name); if (point) viewer?.focusPosition(point.position); }} onpending={id => void focusPending(id)} onfocus={position => viewer?.focusPosition(position)} />
      <ApprovalReview items={reviewItems} focusId={reviewFocusId} />
      <div class="scene-feedback" hidden={cropPhase === 'idle' || cropPhase === 'complete'}>
        <p class="crop-summary" data-testid="crop-summary" aria-live="polite">{cropStatus}</p>
        {#if cropPhase === 'loading'}<div class="inline-crop-actions"><button data-testid="quick-cancel-crop" onclick={cancelCrop}>Cancel detail loading</button><span>{feedback.count}</span></div>
        {:else if feedback.canRetry}<div class="inline-crop-actions"><button data-testid="quick-retry-crop" onclick={retryCrop} disabled={!!viewerError}>Retry street detail</button></div>{/if}
      </div>
    </section>
    <aside class:has-placement={!!areaInput?.area}>
      {#if areaCandidates}
        <AreaCandidates result={areaCandidates} selected={selectedCandidate} onselect={(id, position) => { selectedCandidate = id; viewer?.setAreaCandidates(areaCandidates ? $state.snapshot(areaCandidates) : undefined, id); viewer?.focusPosition(position); }} />
      {/if}
      {#if areaInput?.area}
        <details class="technical"><summary>Equipment placement tools</summary>
        <PlacementSearch bind:this={placementSearch} area={areaInput.area} authorityKey={placementAuthorityKey} blocked={placementBlocked} invalidated={placementInvalidated}
          onpreview={preview => viewer?.setPlacementPreview(preview)}
          onproposed={async () => { await cadController.refresh(); }} onfocus={position => viewer?.focusPosition(position)} />
        </details>
      {/if}
      <details class="technical" data-testid="toronto-technical" bind:open={cadToolsOpen}><summary>Scene tools</summary>
      <div class="tools-content">
      <div bind:this={pointToolsHost}></div>
      <details class="tool-section" open data-testid="toronto-cad-tools"><summary>CAD tools</summary><TorontoCad view={cadView} controller={cadController} streaming={modelStreaming} /></details>
      <details class="tool-section"><summary>Navigation help</summary>
        <p class="note">Click or Tab into the scene, then hold W/S to fly forward/back and A/D to strafe. Drag to orbit · Double-click a point or surface to set the orbit center · Scroll to zoom toward the pointer · Shift-drag to select an AI area of interest and snapshot. Cmd/Ctrl-click to pin a numbered point; remove individual points in Scene references.</p>
        <p class="note">Toronto local frame · meters · Z-up.</p>
        <button onclick={() => viewer?.frameDataset()}>Frame dataset</button>
        <button data-testid="clear-toronto-pins" disabled={!points.length} onclick={() => onpoints([])}>Clear points</button>
      </details>
      <details class="tool-section"><summary>Display quality</summary>
      <label class="mode-toggle"><input data-testid="adaptive-display-toggle" type="checkbox" bind:checked={adaptiveEnabled} onchange={event => { adaptiveEnabled = event.currentTarget.checked; toggleAdaptive(); }} disabled={!display || !!viewerError} />Camera-driven detail</label>
      {#if adaptiveEnabled}
      <label>Full detail within (m)<input data-testid="display-near-radius" type="number" min="0" max="200" step="5" bind:value={nearRadius} onchange={tuneDisplay} /></label>
      <label>Distant detail <select data-testid="display-threshold" bind:value={pixelThreshold} onchange={event => { pixelThreshold = Number(event.currentTarget.value); tuneDisplay(); }}><option value={160}>Coarse</option><option value={80}>Balanced</option><option value={40}>Fine</option><option value={20}>Very fine</option></select></label>
      <label>Point budget <select data-testid="display-budget" bind:value={pointBudget} onchange={event => { pointBudget = Number(event.currentTarget.value); tuneDisplay(); }}><option value={500_000}>500,000</option><option value={1_000_000}>1 million</option><option value={2_000_000}>2 million</option><option value={3_000_000}>3 million</option></select></label>
      <label>Point size <select data-testid="display-point-size" bind:value={pointSize} onchange={event => { pointSize = Number(event.currentTarget.value); viewer?.setPointSize(pointSize); }}><option value={2}>2 px</option><option value={3}>3 px</option><option value={4}>4 px</option><option value={5}>5 px</option><option value={6}>6 px</option></select></label>
      <p data-testid="display-status" aria-live="polite">{adaptiveStats.error ? 'Detail unavailable.' : adaptiveStats.pending ? 'Loading detail…' : adaptiveStats.budgetLimited ? 'Point budget reached' : displayStatus === 'Ready' ? 'Ready' : displayStatus}</p>
      {#if adaptiveStats.error}<button data-testid="retry-display" onclick={() => viewer?.retryAdaptive()}>Retry detail</button>{/if}
      {:else}
      <label>Display point budget <select data-testid="display-budget" bind:value={displayBudget} onchange={event => { displayBudget = Number(event.currentTarget.value); void loadDisplay(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Display maximum depth <select data-testid="display-depth" bind:value={displayDepth} onchange={event => { displayDepth = Number(event.currentTarget.value); void loadDisplay(); }}>{#each [0, 1, 2, 3] as depth}<option value={depth}>{depth}</option>{/each}</select></label>
      <p data-testid="display-status" aria-live="polite">{displayStatus}</p>
      {/if}
      <button onclick={loadDisplay}>Reload display</button>
      </details><details class="tool-section"><summary>Full-resolution selection &amp; crop</summary>
      <p class="note">Shift-drag selects an XY area of interest for chat and automatically attaches a scene snapshot. The rectangle follows the view orientation at the orbit target’s elevation, not terrain; all elevations are in scope. Send shares it with the model. Clear removes both. Tiny Shift-click places the box below. Full-resolution loading is manual.</p>
      <p data-testid="selection-info" class="note">{selectionInfo}</p>
      {#if projected}<p data-testid="projected-selection" class="note">Orbit does not change this selection. Edit box fields to return to box selection.</p><button data-testid="reload-window" disabled={cropPhase === 'loading' || !!viewerError} onclick={() => { if (projected) void loadSelection(projected); }}>Reload projected window</button>{/if}
      <div class="box-fields">
        {#each ['X', 'Y', 'Z'] as axis, i}
          <label>Center {axis} (m)<input type="number" step="0.1" data-testid={'box-center-' + axis.toLowerCase()} bind:value={center[i]} oninput={event => { center[i] = event.currentTarget.valueAsNumber; changeBox(); }} /></label>
          <label>Size {axis} (m)<input type="number" min="0.01" step="0.5" data-testid={'box-size-' + axis.toLowerCase()} bind:value={dimensions[i]} oninput={event => { dimensions[i] = event.currentTarget.valueAsNumber; changeBox(); }} /></label>
        {/each}
      </div>
      <button onclick={() => { const value = viewer?.viewCenter(); if (value) placeBox(value); }}>Box at view target</button>
      <button data-testid="frame-box" onclick={() => viewer?.frameBox()}>Frame box</button>
      <button data-testid="load-crop" onclick={loadCrop} disabled={!display || cropPhase === 'loading' || !!viewerError}>Load full resolution in box</button>
      <button data-testid="cancel-crop" onclick={cancelCrop} disabled={!feedback.canCancel}>Cancel loading (retain partial)</button>
      <button data-testid="clear-crop" onclick={clearCrop} disabled={!feedback.canClear}>Clear full resolution</button>
      {#if feedback.canRetry}<button data-testid="retry-crop" onclick={retryCrop} disabled={!!viewerError}>Retry same selection</button>{/if}
      <p data-testid="crop-status" aria-live="polite">{cropStatus}</p>
      <p data-testid="crop-count">{feedback.count}</p>
      {#if feedback.progress}<p data-testid="crop-progress" class="note">{feedback.progress}</p>
      {:else if crop}<p class="note">Source bytes: {crop.bytesRead.toLocaleString()}; scanned points: {crop.scannedPoints.toLocaleString()}; hierarchy chunks: {crop.hierarchyChunks.toLocaleString()}. {cropPhase === 'complete' && crop.count === 0 ? 'No points in this volume. Select a different region.' : ''}</p>{/if}
      <p class="note">No total point/source-work cap and no downsampling. Bounded stream/GPU chunks load progressively; large selections can exhaust browser/GPU memory or take a long time. Cancel stops future work (not instantaneous OS/GPU work); Clear releases detail. Editing the box cancels and clears old detail.</p>
      </details><details class="tool-section"><summary>Harness observation &amp; export</summary>
      <label>Harness point budget <select data-testid="harness-budget" bind:value={harnessBudget} onchange={event => { harnessBudget = Number(event.currentTarget.value); void loadHarness(); }}><option value={256}>256</option><option value={1024}>1,024</option><option value={4096}>4,096</option></select></label>
      <label>Harness maximum depth <select data-testid="harness-depth" bind:value={harnessDepth} onchange={event => { harnessDepth = Number(event.currentTarget.value); void loadHarness(); }}>{#each [0, 1, 2, 3] as depth}<option value={depth}>{depth}</option>{/each}</select></label>
      <p data-testid="harness-status" aria-live="polite">{harnessStatus}</p>
      <p data-testid="harness-count">Observation: {observation?.count ?? 0} points</p>
      <button onclick={loadHarness}>Reload harness input</button>
      <button onclick={downloadObservation} disabled={!observation}>Download harness observation JSON</button>
      {#if observation}
        <dl><dt>Dataset / artifact revision</dt><dd>{observation.dataset.id} / {observation.dataset.revision}</dd><dt>Algorithm / candidates / source bytes read</dt><dd>{observation.algorithm} / {observation.candidatePoints} / {observation.bytesRead}</dd><dt>Sample SHA256</dt><dd data-testid="harness-hash">{observation.sampleHash}</dd><dt>Actual observation settings</dt><dd>{observation.lod.budget} points maximum; levels 0–{observation.lod.depth}</dd></dl>
      {/if}
      <p class="note">Deterministic evenly spaced points across breadth-first levels 0–depth. Camera-independent, not screen-space LOD or an unbiased whole-cloud sample. Display first shows level 0. JSON contains local XYZ, RGB, semantic labels and stable source IDs; no model consumes it yet.</p>
      </details>
      {#if mounted}<VisualObservationPanel label="Toronto" capture={() => viewer!.capture()} isCurrent={id => viewer!.isCaptureCurrent(id)} resolvePixel={(id: string, x: number, y: number) => viewer!.resolvePixel(id, x, y)} />{/if}
      <details class="tool-section"><summary>Dataset details</summary>
      <p class="note">Read-only prepared cloud · 78.3M source points. Local meters · right-handed Z-up · world = local + [627285, 4841948, 0]. Session-only point overrides are separate from original semantic queries. Real CAD solids use a separate volatile Toronto authority. No Toronto-to-synthetic mapping.</p>
      <p class="note">CC BY-NC 4.0 · <a href="https://github.com/WeikaiTan/Toronto-3D">Toronto-3D</a>. Source UTM; no reprojection or independent CRS certification.</p>
      </details>
      </div>
      </details>
    </aside>
  </div>
</main>

<style>
  main, .workspace, .scene-panel { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  main { color: #f5f5f7; background: #151619; overflow: hidden; }
  .viewport { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; }
  :global(canvas) { display: block; touch-action: none; }
  .toolbar { position: absolute; z-index: 1; top: 16px; left: 16px; display: flex; align-items: center; gap: 10px; padding: 5px 10px; border: 1px solid #ffffff12; border-radius: 12px; background: #202124ed; font-size: 12px; }
  .toolbar .color-mode { width: auto; margin: 0; padding: 7px 5px; }
  .color-key summary { padding: 8px 0; }
  .color-key ul { position: absolute; top: calc(100% + 8px); left: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 9px 14px; list-style: none; margin: 0; padding: 12px; border: 1px solid #ffffff24; border-radius: 10px; background: #202124f5; width: 240px; box-shadow: 0 8px 24px #0004; }
  .color-key li { display: flex; align-items: center; gap: 7px; font-size: 11px; }
  .color-key li span { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .point-confirmation { position: absolute; right: 16px; top: 72px; z-index: 12; width: min(340px, calc(100% - 32px)); max-height: 25%; overflow-y: auto; overscroll-behavior: contain; }
  .cad-recovery { margin-top: 8px; padding: 12px; border: 1px solid #ffffff20; border-radius: 14px; background: #202124f5; }
  .cad-recovery [role="alert"] { position: static; padding: 0; margin: 0 0 8px; border: 0; background: none; max-height: none; color: #ffd187; }
  .cad-recovery button { margin: 0; }
  .toolbar button { background: transparent; border-color: transparent; color: #a8caff; padding: 6px; }
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
  .tool-section { border-top: 1px solid #ffffff18; margin-top: 12px; padding-top: 12px; }
  .tool-section[open] { padding-bottom: 8px; }
  label { display: block; margin: 10px 0; font-size: 12px; color: #b9bac1; }
  select { display: block; width: 100%; margin-top: 4px; }
  .mode-toggle { display: flex; align-items: center; gap: 8px; }
  .mode-toggle input { width: auto; margin: 0; }
  .box-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
  input { width: 100%; box-sizing: border-box; }
  button, select, input { color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff1c; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
  button, select { cursor: pointer; } button { margin: 4px 0; } button:disabled { opacity: .4; cursor: default; }
  button:not(:disabled):hover { border-color: #72737b; }
  button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  dt, .note { font-size: 11px; color: #a8a9b0; line-height: 1.5; } dd { margin: 0 0 8px; font-size: 11px; overflow-wrap: anywhere; } p { font-size: 12px; overflow-wrap: anywhere; }
  a { color: #a8caff; }
  [role="alert"] { position: absolute; z-index: 1; left: 16px; right: 16px; top: 64px; max-height: 25%; overflow-y: auto; margin: 0; color: #ffb2aa; background: #202124f5; border: 1px solid #ffb2aa44; border-radius: 10px; padding: 10px 14px; overflow-wrap: anywhere; }
  @media (max-width: 600px) { .toolbar { top: 12px; left: 12px; gap: 4px; padding: 5px 8px; flex-wrap: wrap; max-width: calc(100% - 150px); } .toolbar .color-mode { font-size: 11px; } .scene-panel .area-error { top: 180px; } .toolbar button { font-size: 11px; } aside { top: auto; bottom: 12px; right: 12px; max-width: calc(100% - 24px); max-height: 45%; } .scene-feedback { left: 12px; bottom: 12px; max-width: calc(100% - 24px); } }

</style>
