<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import TorontoCad from './TorontoCad.svelte';
  import PointEdits from './PointEdits.svelte';
  import { TorontoCadController, type TorontoCadView } from './toronto-cad-client';
  import { assertCropBox, type CropBox, type CropSelection, type CropStats, type PointObservation, type PointOverrideSnapshot, type PointMoveProposal, type Vec3 } from '@spatial/contracts';
  import { createCropChannel } from './crop-client';
  import { cropFeedback, describeCropSelection, nextCropPhase, type CropPhase } from './crop-feedback';
  import { createTorontoViewer } from './toronto-viewer';
  import VisualObservationPanel from './VisualObservationPanel.svelte';
  import type { VisualModelSource } from './visual-model-source';
  import { createObservationChannel } from './observation-client';
  import { createDraftPointGate, type TorontoDraftPoint, type PointName } from './draft-context';
  import type { PoleSelection } from './pole-picking';
  import { effectivePosition } from './point-override-client';

  let { points = [], pointOverrides, pointPreview, pointRefresh = 0, onpointstate = () => {}, cadRefresh = 0, modelStreaming = false, oncadblocked = () => {}, onrevision = () => {}, allocatePointName, onpoint, onpoints = () => {}, onvisualsource = () => {} }: {
    cadRefresh?: number; modelStreaming?: boolean; oncadblocked?: (blocked: boolean) => void;
    pointRefresh?: number; onpointstate?: (snapshot?: PointOverrideSnapshot, proposal?: PointMoveProposal, blocked?: boolean) => void;
    pointOverrides?: PointOverrideSnapshot; pointPreview?: PointMoveProposal; onrevision?: (revision: string) => void;
    onvisualsource?: (source: VisualModelSource | undefined) => void;
    points?: readonly TorontoDraftPoint[]; allocatePointName: () => PointName;
    onpoint: (point: TorontoDraftPoint) => void; onpoints?: (points: readonly TorontoDraftPoint[]) => void;
  } = $props();
  const draftGate = createDraftPointGate();
  let cadView = $state<TorontoCadView>({ busy: false, needsRefresh: true, status: 'Waiting for Toronto artifact…' });
  const cadController = new TorontoCadController(value => { cadView = value; oncadblocked(value.busy || value.needsRefresh); });
  let cadArtifact: string | undefined;
  let cadToolsOpen = $state(false);
  $effect(() => { if (cadView.snapshot?.proposals.length) cadToolsOpen = true; });
  $effect(() => { const token = cadRefresh; untrack(() => { if (token && cadArtifact && !cadView.needsRefresh) void cadController.refresh(); }); });
  $effect(() => { if (mounted) viewer?.setCad(cadView.snapshot ? $state.snapshot(cadView.snapshot) : undefined); });
  let mounted = $state(false);
  let retainedSnapshot = $state<PointOverrideSnapshot>();
  let retainedProposals = $state<readonly PointMoveProposal[]>([]);
  const sceneSnapshot = $derived(retainedSnapshot ?? pointOverrides);
  const sceneProposals = $derived(retainedProposals);
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
    if (point) onpoint(point);
  }
  let host: HTMLDivElement;
  let viewer: ReturnType<typeof createTorontoViewer> | undefined;
  let displayBudget = $state(50_000), displayDepth = $state(3);
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
  let cropRevision: string | undefined;
  $effect(() => { if (mounted) viewer?.setDetailState(cropPhase); });
  const cropChannel = createCropChannel(async event => {
    if (event.type === 'start') {
      if (!display || event.dataset.revision !== display.dataset.revision) throw new Error('Artifact changed; reload display before selecting detail');
      cropRevision = event.dataset.revision;
    } else if (event.type === 'batch') {
      viewer?.appendCrop(event.positions, event.colors, event.sourceIds, cropRevision); crop = event.stats;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } else if (event.type === 'end') { crop = event.stats; }
  });
  const displayChannel = createObservationChannel('display', sample => {
    if (draftGate.bind(sample.dataset.revision)) { onpoints([]); clearCrop(); }
    viewer?.update(sample); display = sample; onrevision(sample.dataset.revision);
    if (cadArtifact !== sample.dataset.revision) { cadArtifact = sample.dataset.revision; cadController.bind(cadArtifact); void cadController.refresh(); }
    viewer?.setPointOverrides(sceneSnapshot ? $state.snapshot(sceneSnapshot) : undefined); viewer?.setPointMovePreview($state.snapshot(sceneProposals));
    viewer?.setDraftMarkers(effectiveMarkers);
    if (!boxInitialized && sample.count) { boxInitialized = true; placeBox(sample.positions.slice(0, 3) as unknown as Vec3); }
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
  function selectWindow(selection: CropSelection) {
    if (!feedback.canLoad) return;
    projected = selection; viewer?.setBox();
    void loadSelection(selection);
  }
  function viewerFailure(message: string) {
    cropRequest++; cropChannel.cancel(); cropPhase = nextCropPhase(cropPhase, 'fail');
    cropStatus = 'Error — viewer resource failure; retained detail is incomplete. Clear detail and reload the scene before retrying.';
    viewerError = message;
  }
  async function loadDisplay() {
    const request = ++displayRequest;
    displayStatus = 'Loading root then selected LOD…';
    try { await displayChannel.load({ budget: displayBudget, depth: displayDepth }, true); if (alive && request === displayRequest) displayStatus = 'Ready'; }
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
      viewer = createTorontoViewer(host, placeBox, selectWindow, viewerFailure, pinPoint); mounted = true;
      const current = viewer;
      onvisualsource({ capture: () => current.capture(), isCurrent: id => current.isCaptureCurrent(id), resolvePixel: (id, x, y) => current.resolvePixel(id, x, y) });
      void loadDisplay(); void loadHarness();
    }
    catch (error) { viewerError = String(error); }
    return () => { alive = false; mounted = false; onvisualsource(undefined); draftGate.dispose(); cadController.dispose(); onpoints([]); displayChannel.dispose(); harnessChannel.dispose(); cropChannel.dispose(); viewer?.dispose(); };
  });
</script>

<main>
  <div class="workspace">
    <section class="scene-panel">
      <div class="toolbar"><span>Toronto3D</span><button onclick={() => viewer?.frameDataset()}>Frame dataset</button></div>
      <div class="viewport" data-testid="toronto-viewer" bind:this={host}></div>
      {#if viewerError}<p role="alert">Viewer unavailable: {viewerError}</p>{/if}
      <div class="point-confirmation" data-testid="scene-point-confirmation">
        <PointEdits {points} artifactRevision={display?.dataset.revision} refreshToken={pointRefresh} streaming={modelStreaming} onselect={selection => pinPoint(selection)} onstate={(snapshot, proposal, blocked, proposals) => { retainedSnapshot = snapshot; retainedProposals = proposals ?? []; onpointstate(snapshot, proposal, blocked); }} />
      </div>
      <div class="scene-feedback" hidden={cropPhase === 'idle'}>
        <p class="crop-summary" data-testid="crop-summary" aria-live="polite">{cropStatus}</p>
        {#if cropPhase === 'loading'}<div class="inline-crop-actions"><button data-testid="quick-cancel-crop" onclick={cancelCrop}>Cancel detail loading</button><span>{feedback.count}</span></div>{/if}
      </div>
    </section>
    <aside>
      <details class="technical" data-testid="toronto-technical" bind:open={cadToolsOpen}><summary>Scene tools</summary>
      <div class="tools-content">
      <details class="tool-section" open data-testid="toronto-cad-tools"><summary>CAD solids &amp; pending changes</summary><TorontoCad view={cadView} controller={cadController} streaming={modelStreaming} /></details>
      <details class="tool-section"><summary>Navigation &amp; points</summary>
        <p class="note">Drag to orbit · Scroll to zoom · Shift-drag for full-resolution detail. Cmd/Ctrl-click to pin a numbered point; remove individual points in Scene references.</p>
        <p class="note">Toronto local frame · meters · Z-up.</p>
        <button data-testid="clear-toronto-pins" disabled={!points.length} onclick={() => onpoints([])}>Clear points</button>
      </details>
      <details class="tool-section"><summary>Display quality</summary>
      <h2>User display LOD</h2>
      <label>Display point budget <select data-testid="display-budget" bind:value={displayBudget} onchange={event => { displayBudget = Number(event.currentTarget.value); void loadDisplay(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Display maximum depth <select data-testid="display-depth" bind:value={displayDepth} onchange={event => { displayDepth = Number(event.currentTarget.value); void loadDisplay(); }}>{#each [0, 1, 2, 3] as depth}<option value={depth}>{depth}</option>{/each}</select></label>
      <p data-testid="display-status" aria-live="polite">{displayStatus}</p>
      <p data-testid="display-count">Rendered sample: {display?.count ?? 0} points (depth {display?.lod.depth ?? '—'})</p>
      <button onclick={loadDisplay}>Reload display</button>
      </details><details class="tool-section"><summary>Full-resolution selection &amp; crop</summary>
      <h2>Full-resolution display selection</h2>
      <p class="note">Shift-click-drag a screen window to load every point through its camera volume automatically. Depth: camera near/far clipped to dataset extent, not just visible surfaces. Plain drag still orbits. Tiny Shift-click places the yellow axis-aligned box instead. Harness input is unchanged.</p>
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
      <h2>Harness input LOD (independent)</h2>
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
      <p class="note">Read-only prepared cloud · 78.3M source points. Local meters · right-handed Z-up · world = local + [627285, 4841948, 0]. Session-only point overrides are separate from original semantic queries. Real CAD solids use a separate volatile Toronto authority. No Toronto-to-synthetic mapping.</p>
      <p class="note">CC BY-NC 4.0 · <a href="https://github.com/WeikaiTan/Toronto-3D">Toronto-3D</a>. Source UTM; no reprojection or independent CRS certification.</p>
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
  .toolbar > span { font-weight: 550; }
  .point-confirmation { position: absolute; right: 16px; bottom: 16px; z-index: 3; width: min(340px, calc(100% - 32px)); max-height: min(60%, 560px); overflow-y: auto; overscroll-behavior: contain; }
  .toolbar button { background: transparent; border-color: transparent; color: #a8caff; padding: 6px; }
  .scene-feedback { position: absolute; z-index: 1; left: 16px; bottom: 16px; max-width: min(520px, calc(100% - 32px)); max-height: 25%; overflow-y: auto; border: 1px solid #ffffff12; border-radius: 10px; background: #202124ed; }
  .crop-summary { font-size: 11px; color: #b9bac1; padding: 9px 12px; margin: 0; overflow-wrap: anywhere; }
  .inline-crop-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 0 12px 8px; font-size: 11px; color: #b9bac1; }
  aside { position: absolute; z-index: 2; top: 16px; right: 16px; max-width: calc(100% - 32px); }
  .technical { border: 1px solid #ffffff18; border-radius: 12px; background: #202124f5; box-shadow: 0 8px 32px #0003; }
  .technical > summary { padding: 10px 14px; }
  .technical[open] { width: 360px; max-width: 100%; }
  .tools-content { padding: 0 14px 14px; box-sizing: border-box; max-height: min(65dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  summary { color: #e8e8ed; font-size: 12px; cursor: pointer; }
  .tool-section { border-top: 1px solid #ffffff18; margin-top: 12px; padding-top: 12px; }
  .tool-section[open] { padding-bottom: 8px; }
  h2 { font-size: 12px; color: #a8a9b0; margin-top: 16px; font-weight: 500; }
  label { display: block; margin: 10px 0; font-size: 12px; color: #b9bac1; }
  select { display: block; width: 100%; margin-top: 4px; }
  .box-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
  input { width: 100%; box-sizing: border-box; }
  button, select, input { color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff1c; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
  button, select { cursor: pointer; } button { margin: 4px 0; } button:disabled { opacity: .4; cursor: default; }
  button:not(:disabled):hover { border-color: #72737b; }
  button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  dt, .note { font-size: 11px; color: #a8a9b0; line-height: 1.5; } dd { margin: 0 0 8px; font-size: 11px; overflow-wrap: anywhere; } p { font-size: 12px; overflow-wrap: anywhere; }
  a { color: #a8caff; }
  [role="alert"] { position: absolute; z-index: 1; left: 16px; right: 16px; top: 64px; max-height: 25%; overflow-y: auto; margin: 0; color: #ffb2aa; background: #202124f5; border: 1px solid #ffb2aa44; border-radius: 10px; padding: 10px 14px; overflow-wrap: anywhere; }
  @media (max-width: 600px) { .toolbar { top: 12px; left: 12px; gap: 4px; padding: 5px 8px; } .toolbar button { font-size: 11px; } aside { top: 12px; right: 12px; max-width: calc(100% - 24px); } .scene-feedback { left: 12px; bottom: 12px; max-width: calc(100% - 24px); } }

</style>
