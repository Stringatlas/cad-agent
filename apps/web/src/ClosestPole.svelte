<script lang="ts">
  import { onMount } from 'svelte';
  import { TORONTO_SEMANTIC_LABELS, type TorontoSemanticLabel, type PointObservation, type CropSelection, type CropStats } from '@spatial/contracts';
  import { createCropChannel } from './crop-client';
  import { cropFeedback, describeCropSelection, type CropPhase } from './crop-feedback';
  import { createTorontoViewer } from './toronto-viewer';
  import { createObservationChannel } from './observation-client';
  import { createPoleChannel, type PoleState } from './pole-client';
  let host: HTMLDivElement;
  let viewer: ReturnType<typeof createTorontoViewer> | undefined;
  let budget = $state(50_000), depth = $state(3), display = $state<PointObservation>();
  let loading = $state('Waiting'), gpuError = $state(''), queryState = $state<PoleState>({ phase: 'idle' });
  let label = $state<TorontoSemanticLabel>(6);
  const labelName = $derived(TORONTO_SEMANTIC_LABELS[label].replaceAll('_', ' '));
  let projected = $state<CropSelection>(), crop = $state<CropStats>(), cropPhase = $state<CropPhase>('idle');
  let cropStatus = $state('Shift-drag to load a full-resolution window for picking');
  const feedback = $derived(cropFeedback(cropPhase, crop, !gpuError));
  let alive = true, displayRequest = 0, cropRequest = 0, cropRevision: string | undefined;
  const completed = $derived(queryState.result?.status === 'verified-found' || queryState.result?.status === 'verified-none' ? queryState.result : undefined);
  const running = $derived(['indexing', 'resolving', 'searching', 'verifying'].includes(queryState.phase));
  const query = createPoleChannel(value => {
    queryState = value;
    const result = value.result;
    try { viewer?.setQueryMarkers(value.selection?.position, result?.status === 'verified-found' ? result.nearest?.position : undefined); }
    catch (error) { gpuError = `Marker rendering failed: ${String(error)}. Server verification is shown separately.`; }
  });
  function changeLabel(event: Event) {
    label = Number((event.currentTarget as HTMLSelectElement).value) as TorontoSemanticLabel;
    if (queryState.selection) void query.select(queryState.selection, label); else query.clear();
  }
  const cropChannel = createCropChannel(async event => {
    if (event.type === 'start') {
      if (event.dataset.revision !== display?.dataset.revision) throw new Error('Dataset revision changed — reload display before selecting a window.');
      cropRevision = event.dataset.revision;
    } else if (event.type === 'batch') {
      viewer?.appendCrop(event.positions, event.colors, event.sourceIds, cropRevision); crop = event.stats;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } else if (event.type === 'end') crop = event.stats;
  });
  function clearWindow() {
    cropRequest++; cropChannel.cancel(); viewer?.clearCrop(); crop = undefined; cropRevision = undefined;
    cropPhase = 'idle'; cropStatus = 'Overview only — frozen window retained for retry';
  }
  function cancelWindow() {
    if (cropPhase !== 'loading') return;
    cropRequest++; cropChannel.cancel(); cropPhase = 'cancelled';
    cropStatus = 'Cancelled — partial detail retained, selection incomplete. Retry or clear; no downsampling.';
  }
  async function selectWindow(selection: CropSelection) {
    if (gpuError || !display) return;
    clearWindow(); projected = selection; const token = cropRequest;
    cropPhase = 'loading'; cropStatus = 'Loading every point in frozen window progressively…';
    try {
      await cropChannel.load(selection);
      if (alive && token === cropRequest) { cropPhase = 'complete'; cropStatus = 'Ready — full resolution in frozen window'; }
    } catch (error) { if (alive && token === cropRequest) { cropPhase = 'error'; cropStatus = `Incomplete full resolution: ${String(error)}. Retry or clear; no downsampling.`; } }
  }
  function viewerFailure(message: string) {
    cropRequest++; cropChannel.cancel(); cropPhase = 'error';
    cropStatus = 'Viewer resource failure — detail incomplete. Reload this tab to restore rendering.';
    gpuError = `${message} Query verification remains separate.`;
  }
  const channel = createObservationChannel('display', sample => {
    if (display && display.dataset.revision !== sample.dataset.revision) { clearWindow(); projected = undefined; }
    query.revision(sample.dataset.revision);
    viewer?.update(sample); display = sample;
  });
  async function reload() {
    const token = ++displayRequest; loading = 'Loading root then selected display LOD…';
    try { await channel.load({ budget, depth }, true); if (alive && token === displayRequest) loading = 'Ready'; }
    catch (error) { if (alive && token === displayRequest) loading = String(error); }
  }
  onMount(() => {
    try {
      viewer = createTorontoViewer(host, undefined, selection => { void selectWindow(selection); },
        viewerFailure, selection => { void query.select(selection, label); });
      void reload();
    } catch (error) { gpuError = String(error); }
    return () => { alive = false; channel.dispose(); cropChannel.dispose(); query.dispose(); viewer?.dispose(); };
  });
</script>
<svelte:head><title>Closest: {labelName} · Toronto3D</title></svelte:head>
<main>
  <div class="workspace">
    <section class="scene-panel">
      <div class="toolbar"><span>Closest: {labelName}</span><button onclick={() => viewer?.frameDataset()}>Frame dataset</button></div>
      <div class="viewport" data-testid="pole-viewer" bind:this={host}></div>
      <div class="scene-feedback" hidden={queryState.phase === 'idle' && cropPhase === 'idle'}>
        <p data-testid="pole-status" aria-live="polite" hidden={queryState.phase === 'idle'}>{queryState.phase}</p>
        <p data-testid="pole-window-status" aria-live="polite" hidden={cropPhase === 'idle'}>{cropStatus}</p>
      </div>
      <div class="scene-errors">
        {#if gpuError}<p role="alert" data-testid="pole-gpu-error">{gpuError}</p>{/if}
        {#if !completed && queryState.result}
          <p role="alert" data-testid="pole-error">{queryState.result.status === 'error' ? queryState.result.code : queryState.result.status === 'incomplete' ? `Incomplete: ${queryState.result.reason}` : queryState.result.status === 'verification-rejected' ? `Verification rejected: ${queryState.result.reason}` : ''}</p>
        {/if}
        {#if queryState.error}<p role="alert" data-testid="pole-error">{queryState.error}</p>{/if}
      </div>
    </section>
    <aside>
      <details class="technical"><summary>Scene tools</summary>
      <div class="tools-content">
      <details class="tool-section"><summary>Navigation &amp; query guide</summary>
      <p>Cmd/Ctrl-click an overview or full-resolution point to find the closest {labelName}-labelled stored point across the whole prepared Toronto3D dataset.</p>
      <p class="note">Orbit: drag · Zoom: scroll · Window: Shift-drag · Query: Cmd/Ctrl-click</p>
      <p class="note">Semantic point proxy measured with 3D Euclidean distance, not object-instance detection or fitted geometry. Local meters · right-handed Z-up · world origin [627285, 4841948, 0].</p>
      <p class="note">Cyan: selected point · Pink: verified {labelName}-labelled point · Yellow: distance. Frame result moves the camera only when requested. Shift takes precedence and never queries. Window detail is display-only; search remains whole-dataset. Ctrl-click context menus are suppressed on this canvas.</p>
      </details>
      <details class="tool-section"><summary>Display quality</summary>
      <p data-testid="pole-display-status">{loading} · {display?.count ?? 0} displayed points</p>
      <label>Point budget <select data-testid="pole-budget" bind:value={budget} onchange={event => { budget = Number(event.currentTarget.value); void reload(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Maximum depth <select data-testid="pole-depth" bind:value={depth} onchange={event => { depth = Number(event.currentTarget.value); void reload(); }}>{#each [0, 1, 2, 3] as d}<option value={d}>{d}</option>{/each}</select></label>
      <button onclick={reload}>Reload display</button>
      </details>
      <details class="tool-section"><summary>Full-resolution window</summary>
      <p class="note">Shift-drag a frozen camera volume, including occluded depth. Orbiting does not change it. Detail is preferred for picking; the faded overview remains a fallback. Loading is uncapped and may exhaust GPU memory.</p>
      {#if projected}<p class="note" data-testid="pole-window-selection">{describeCropSelection(projected)}</p>{/if}
      <button data-testid="pole-window-cancel" disabled={!feedback.canCancel} onclick={cancelWindow}>Cancel window loading</button>
      <button data-testid="pole-window-clear" disabled={!feedback.canClear} onclick={clearWindow}>Clear window detail</button>
      <button data-testid="pole-window-retry" disabled={!projected || cropPhase === 'loading' || !!gpuError} onclick={() => { if (projected) void selectWindow(projected); }}>Reload same window</button>
      <p data-testid="pole-window-count">{feedback.count}</p>
      {#if feedback.progress}<p class="note">{feedback.progress}</p>{/if}
      </details>
      <details class="tool-section" open><summary>Whole-dataset query</summary>
      <label>Closest semantic category <select data-testid="closest-label" value={label} onchange={changeLabel}>
        {#each Object.entries(TORONTO_SEMANTIC_LABELS) as [id, name]}<option value={Number(id)}>{name.replaceAll('_', ' ')}</option>{/each}
      </select></label>
      {#if queryState.progress}<p data-testid="pole-progress">{queryState.progress.phase}: {queryState.progress.scannedPoints.toLocaleString()} records scanned; {queryState.progress.payloadBytes.toLocaleString()} payload bytes read in this phase.</p>{/if}
      <p class="note">Exact search with independent verification. All categories share a disk-backed spatial index and source lookup; first use prepares it once with bounded reads and memory. Each query independently checks page coverage and recomputes the nearest point. Progress reports actual work; no percentage or ETA. Only verified-found and verified-none are complete. Display/harness LOD and camera do not restrict the answer.</p>
      <button data-testid="pole-cancel" disabled={!running} onclick={() => query.cancel()}>Cancel query</button>
      <button data-testid="pole-clear" onclick={() => query.clear()}>Clear query</button>
      <button data-testid="pole-retry" disabled={!queryState.selection || running} onclick={() => { if (queryState.selection) void query.select(queryState.selection, label); }}>Retry same selection</button>
      <button data-testid="pole-frame" disabled={!queryState.selection || !!gpuError} onclick={() => viewer?.frameResult()}>Frame result</button>
      {#if queryState.selection}
        <dl data-testid="pole-selection"><dt>Selected source file / row (zero-based)</dt><dd>{queryState.selection.key.sourceFileId} / {queryState.selection.key.sourceRow}</dd><dt>Selected position (local m)</dt><dd>{queryState.selection.position.join(', ')}</dd><dt>Artifact revision</dt><dd>{queryState.selection.artifactRevision}</dd></dl>
      {/if}
      {#if completed}
        {#if completed.nearest}
          <dl data-testid="pole-result"><dt>Verified distance (m)</dt><dd>{completed.nearest.distanceMeters}</dd><dt>{labelName}-labelled source file / row</dt><dd>{completed.nearest.key.sourceFileId} / {completed.nearest.key.sourceRow}</dd><dt>Returned position (local m)</dt><dd>{completed.nearest.position.join(', ')}</dd></dl>
        {:else}<p data-testid="pole-result">Verified-none: no {labelName}-labelled point in the whole dataset.</p>{/if}
        <p class="note">Search: {completed.search.scannedPoints.toLocaleString()} records visited. Independent verifier: {completed.verification.scannedPoints.toLocaleString()} {completed.search.disk ? 'disk-page' : completed.search.index ? 'indexed category' : 'source'} records.{#if completed.search.disk} Complete disk coverage: {completed.verification.disk?.coveredPoints.toLocaleString()} source points. Requested category: {completed.search.index?.points.toLocaleString()} points.{:else if completed.search.index} Complete category index: {completed.search.index.points.toLocaleString()} points.{/if} Revision: {completed.dataset.revision}</p>
      {/if}
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
  .toolbar > span { font-weight: 550; }
  .toolbar button { background: transparent; border-color: transparent; color: #a8caff; padding: 6px; }
  .scene-feedback { position: absolute; z-index: 1; left: 16px; bottom: 16px; max-width: min(520px, calc(100% - 32px)); max-height: 25%; overflow-y: auto; border: 1px solid #ffffff12; border-radius: 10px; background: #202124ed; padding: 6px 12px; }
  .scene-feedback p { margin: 4px 0; color: #b9bac1; font-size: 11px; }
  .scene-errors { position: absolute; z-index: 3; left: 16px; right: 16px; top: 68px; max-height: 30%; overflow-y: auto; pointer-events: none; }
  [role="alert"] { color: #ffb2aa; background: #202124f5; border: 1px solid #ffb2aa44; border-radius: 10px; padding: 10px 14px; pointer-events: auto; }
  aside { position: absolute; z-index: 2; top: 16px; right: 16px; max-width: calc(100% - 32px); }
  .technical { border: 1px solid #ffffff18; border-radius: 12px; background: #202124f5; box-shadow: 0 8px 32px #0003; }
  .technical > summary { padding: 10px 14px; }
  .technical[open] { width: 360px; max-width: 100%; }
  .tools-content { padding: 0 14px 14px; box-sizing: border-box; max-height: min(65dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  summary { color: #e8e8ed; font-size: 12px; cursor: pointer; }
  .tool-section { border-top: 1px solid #ffffff18; margin-top: 12px; padding-top: 12px; }
  .tool-section[open] { padding-bottom: 8px; }
  label { display: block; margin: 10px 0; font-size: 12px; color: #b9bac1; }
  select { display: block; width: 100%; margin-top: 4px; }
  button, select { color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff1c; border-radius: 8px; padding: 8px 10px; font-size: 12px; cursor: pointer; }
  button { margin: 4px 0; } button:disabled { opacity: .4; cursor: default; }
  button:not(:disabled):hover { border-color: #72737b; }
  button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  dt, .note { font-size: 11px; color: #a8a9b0; line-height: 1.5; } dd { margin: 0 0 8px; font-size: 11px; overflow-wrap: anywhere; } p { font-size: 12px; overflow-wrap: anywhere; }
  @media (max-width: 600px) { .toolbar { top: 12px; left: 12px; gap: 4px; padding: 5px 8px; } .toolbar button { font-size: 11px; } aside { top: 60px; right: 12px; max-width: calc(100% - 24px); } .scene-errors { top: 108px; left: 12px; right: 12px; } .scene-feedback { left: 12px; bottom: 12px; max-width: calc(100% - 24px); } }
</style>
