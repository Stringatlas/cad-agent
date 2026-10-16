<script lang="ts">
  import { onMount } from 'svelte';
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

  let { points = [], pointOverrides, pointPreview, onrevision = () => {}, allocatePointName, onpoint, onpoints = () => {}, onvisualsource = () => {} }: {
    pointOverrides?: PointOverrideSnapshot; pointPreview?: PointMoveProposal; onrevision?: (revision: string) => void;
    onvisualsource?: (source: VisualModelSource | undefined) => void;
    points?: readonly TorontoDraftPoint[]; allocatePointName: () => PointName;
    onpoint: (point: TorontoDraftPoint) => void; onpoints?: (points: readonly TorontoDraftPoint[]) => void;
  } = $props();
  const draftGate = createDraftPointGate();
  let mounted = $state(false);
  const effectiveMarkers = $derived(points.map(point => {
    let position = point.position;
    try { position = effectivePosition(point, pointOverrides); } catch { /* A mismatched source stays original until explicit refresh/reselection. */ }
    return { name: point.name, artifactRevision: point.artifactRevision, position };
  }));
  $effect(() => { if (mounted) viewer?.setDraftMarkers(effectiveMarkers); });
  // Svelte deep-state proxies must not cross the renderer's structuredClone boundary.
  $effect(() => { if (mounted) viewer?.setPointOverrides(pointOverrides ? $state.snapshot(pointOverrides) : undefined); });
  $effect(() => { if (mounted) viewer?.setPointMovePreview(pointPreview ? $state.snapshot(pointPreview) : undefined); });
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
    viewer?.setPointOverrides(pointOverrides ? $state.snapshot(pointOverrides) : undefined); viewer?.setPointMovePreview(pointPreview ? $state.snapshot(pointPreview) : undefined);
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
    return () => { alive = false; mounted = false; onvisualsource(undefined); draftGate.dispose(); onpoints([]); displayChannel.dispose(); harnessChannel.dispose(); cropChannel.dispose(); viewer?.dispose(); };
  });
</script>

<main>
  <header class="scene-heading"><div><p class="eyebrow">LIVE SCENE / ORIGINAL DATA + VOLATILE OVERRIDES</p><h1>Toronto3D <span>Point cloud</span></h1></div><span class="scene-badge">{display?.count.toLocaleString() ?? '…'} overview points</span></header>
  <div class="workspace">
    <section class="scene-panel">
      <div class="toolbar"><span>Drag to orbit <span class="divider">·</span> Scroll to zoom</span><button onclick={() => viewer?.frameDataset()}>Frame dataset</button></div>
      <div class="viewport" data-testid="toronto-viewer" bind:this={host}></div>
      {#if viewerError}<p role="alert">Viewer unavailable: {viewerError}</p>{/if}
      <div class="selection-bar"><span>Cmd/Ctrl-click to add a new numbered point · remove points in Scene references</span><button data-testid="clear-toronto-pins" disabled={!points.length} onclick={() => onpoints([])}>Clear points</button></div>
      <div class="scene-footer"><span>Shift-drag a window for full-resolution detail</span><span>Toronto local frame · meters · Z-up</span></div>
      {#if mounted}<VisualObservationPanel label="Toronto" capture={() => viewer!.capture()} isCurrent={id => viewer!.isCaptureCurrent(id)} resolvePixel={(id: string, x: number, y: number) => viewer!.resolvePixel(id, x, y)} />{/if}
      <p class="crop-summary" data-testid="crop-summary" aria-live="polite">{cropStatus}</p>
      {#if cropPhase === 'loading'}<div class="inline-crop-actions"><button data-testid="quick-cancel-crop" onclick={cancelCrop}>Cancel detail loading</button><span>{feedback.count}</span></div>{/if}
    </section>
    <aside>
      <details class="technical" data-testid="toronto-technical"><summary>Scene tools &amp; data <span>Display quality, full-resolution crop, observation export</span></summary>
      <details class="tool-section" open><summary>Display quality</summary>
      <h2>User display LOD</h2>
      <label>Display point budget <select data-testid="display-budget" bind:value={displayBudget} onchange={event => { displayBudget = Number(event.currentTarget.value); void loadDisplay(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Display maximum depth <select data-testid="display-depth" bind:value={displayDepth} onchange={event => { displayDepth = Number(event.currentTarget.value); void loadDisplay(); }}>{#each [0, 1, 2, 3] as depth}<option value={depth}>{depth}</option>{/each}</select></label>
      <p data-testid="display-status" aria-live="polite">{displayStatus}</p>
      <p data-testid="display-count">Rendered sample: {display?.count ?? 0} points (depth {display?.lod.depth ?? '—'})</p>
      <button onclick={loadDisplay}>Reload display</button>
      </details><details class="tool-section" open><summary>Full-resolution selection &amp; crop</summary>
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
      <p class="note">Read-only prepared cloud · 78.3M source points. Local meters · right-handed Z-up · world = local + [627285, 4841948, 0]. Session-only point overrides are separate from original semantic queries. No Toronto-to-project mapping or CAD edits.</p>
      <p class="note">CC BY-NC 4.0 · <a href="https://github.com/WeikaiTan/Toronto-3D">Toronto-3D</a>. Source UTM; no reprojection or independent CRS certification.</p>
      </details>
    </aside>
  </div>
</main>

<style>
  main { min-width: 0; padding: 22px; }
  .scene-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; }
  .eyebrow { color: #829bb4; font-size: 9px; letter-spacing: 1.7px; margin: 0 0 5px; }
  h1 { font-size: 22px; font-weight: 550; margin: 0; } h1 span { font-size: 12px; font-weight: 400; color: #7890ac; margin-left: 10px; }
  .scene-badge { color: #94aec6; border: 1px solid #2d4055; border-radius: 20px; padding: 4px 9px; font-size: 10px; white-space: nowrap; }
  .workspace { min-width: 0; } .scene-panel { border: 1px solid #2a3c50; border-radius: 10px; background: #101927; overflow: hidden; }
  section { min-width: 0; }
  .toolbar { padding: 8px 14px; display: flex; gap: 8px; align-items: center; justify-content: space-between; font-size: 11px; color: #96abc2; border-bottom: 1px solid #243449; }
  .divider { color: #4a627e; padding: 0 8px; }
  .viewport { position: relative; width: 100%; height: clamp(380px, calc(100vh - 330px), 900px); min-height: 340px; }
  :global(canvas) { display: block; touch-action: none; }
  .selection-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; border-top: 1px solid #2a3c50; padding: 8px 14px; font-size: 11px; color: #aac0d7; }
  .selection-bar button { margin-left: auto; padding: 4px 8px; }
  .scene-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px; padding: 0 14px 10px; font-size: 10px; color: #7f97b2; }
  .crop-summary { font-size: 10px; color: #a4bad0; border-top: 1px solid #223246; padding: 8px 14px; margin: 0; overflow-wrap: anywhere; }
  .inline-crop-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 0 14px 8px; font-size: 10px; color: #d9bd83; }
  aside { margin-top: 16px; } .technical { border: 1px solid #293b50; border-radius: 8px; padding: 12px 14px; background: #101a28; }
  summary { color: #bdcfe0; font-size: 12px; } .technical > summary > span { margin-left: 12px; color: #718aa5; font-size: 10px; }
  .tool-section { border-top: 1px solid #2b3e54; margin-top: 14px; padding-top: 12px; }
  .tool-section[open] { padding-bottom: 10px; } .tool-section summary { color: #9bc8c5; }
  h2 { font-size: 12px; color: #a1b3ca; margin-top: 16px; font-weight: 500; }
  label { display: block; margin: 10px 0; font-size: 12px; color: #9db2ca; }
  select { display: block; width: 100%; max-width: 360px; margin-top: 4px; }
  .box-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; max-width: 600px; }
  input { width: 100%; box-sizing: border-box; }
  button, select, input { color: #d4e3f3; background: #1a2a3e; border: 1px solid #3a526b; border-radius: 6px; padding: 7px 10px; font-size: 12px; }
  button, select { cursor: pointer; } button { margin: 4px 0; } button:disabled { opacity: .4; }
  dt, .note { font-size: 11px; color: #869eb8; } dd { margin: 0 0 8px; font-size: 11px; overflow-wrap: anywhere; } p { font-size: 12px; }
  a { color: #8bdccc; } [role="alert"] { color: #ffb2aa; padding: 10px 14px; overflow-wrap: anywhere; }
  @media (max-width: 1000px) { main { padding: 16px; } .scene-badge { display: none; } h1 span { margin-left: 5px; } .technical > summary > span { display: block; margin: 4px 0 0 16px; } }
  @media (max-width: 760px) { main { padding: 16px 12px; } .viewport { height: 52vh; min-height: 320px; } .scene-heading { margin-bottom: 12px; } .selection-bar { gap: 8px; font-size: 10px; } .scene-footer { font-size: 9px; } }

</style>
