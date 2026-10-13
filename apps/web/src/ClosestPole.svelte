<script lang="ts">
  import { onMount } from 'svelte';
  import type { PointObservation } from '@spatial/contracts';
  import { createTorontoViewer } from './toronto-viewer';
  import { createObservationChannel } from './observation-client';
  import { createPoleChannel, type PoleState } from './pole-client';
  let host: HTMLDivElement;
  let viewer: ReturnType<typeof createTorontoViewer> | undefined;
  let budget = $state(50_000), depth = $state(3), display = $state<PointObservation>();
  let loading = $state('Waiting'), gpuError = $state(''), queryState = $state<PoleState>({ phase: 'idle' });
  let alive = true, displayRequest = 0;
  const completed = $derived(queryState.result?.status === 'verified-found' || queryState.result?.status === 'verified-none' ? queryState.result : undefined);
  const running = $derived(['indexing', 'resolving', 'searching', 'verifying'].includes(queryState.phase));
  const query = createPoleChannel(value => {
    queryState = value;
    const result = value.result;
    try { viewer?.setQueryMarkers(value.selection?.position, result?.status === 'verified-found' ? result.nearest?.position : undefined); }
    catch (error) { gpuError = `Marker rendering failed: ${String(error)}. Server verification is shown separately.`; }
  });
  const channel = createObservationChannel('display', sample => {
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
      viewer = createTorontoViewer(host, undefined, undefined,
        message => { gpuError = `${message} Query verification remains separate; reload this tab to restore rendering.`; },
        selection => { void query.select(selection); });
      void reload();
    } catch (error) { gpuError = String(error); }
    return () => { alive = false; channel.dispose(); query.dispose(); viewer?.dispose(); };
  });
</script>
<svelte:head><title>Closest Pole-labelled point · Toronto3D</title></svelte:head>
<main>
  <h1>Closest pole</h1>
  <p>Cmd/Ctrl-click a displayed point to find the closest Pole-labelled stored point across the whole prepared Toronto3D dataset.</p>
  <p class="note">Point proxy for a pole, measured with 3D Euclidean distance. This does not detect pole instances or fit an axis. Local meters · right-handed Z-up · world origin [627285, 4841948, 0].</p>
  <div class="workspace">
    <section>
      <div class="toolbar"><span>Orbit: drag · Zoom: scroll · Query: Cmd/Ctrl-click</span><button onclick={() => viewer?.frameDataset()}>Frame dataset</button></div>
      <div class="viewport" data-testid="pole-viewer" bind:this={host}></div>
      {#if gpuError}<p role="alert" data-testid="pole-gpu-error">{gpuError}</p>{/if}
      <p class="note">Cyan: selected point · Pink: verified Pole-labelled point · Yellow: distance. Frame result moves the camera only when requested. Shift takes precedence and never queries; use Toronto3D preview for Shift box/window selections. Ctrl-click context menus are suppressed on this canvas.</p>
    </section>
    <aside>
      <h2>Display sample</h2>
      <label>Point budget <select data-testid="pole-budget" bind:value={budget} onchange={event => { budget = Number(event.currentTarget.value); void reload(); }}><option value={10_000}>10,000</option><option value={50_000}>50,000</option><option value={100_000}>100,000</option></select></label>
      <label>Maximum depth <select data-testid="pole-depth" bind:value={depth} onchange={event => { depth = Number(event.currentTarget.value); void reload(); }}>{#each [0, 1, 2, 3] as d}<option value={d}>{d}</option>{/each}</select></label>
      <p data-testid="pole-display-status">{loading} · {display?.count ?? 0} displayed points</p>
      <button onclick={reload}>Reload display</button>
      <h2>Whole-dataset query</h2>
      <p data-testid="pole-status" aria-live="polite">{queryState.phase}</p>
      {#if queryState.progress}<p data-testid="pole-progress">{queryState.progress.phase}: {queryState.progress.scannedPoints.toLocaleString()} records scanned; {queryState.progress.payloadBytes.toLocaleString()} payload bytes read in this phase.</p>{/if}
      <p class="note">Exact category-index search, independently checked against all indexed Pole points. The first query after a dataset change builds a reusable index; subsequent queries reuse it. Progress reports actual work; no percentage or ETA. Only verified-found and verified-none are complete. Display/harness LOD and camera do not restrict the answer.</p>
      <button data-testid="pole-cancel" disabled={!running} onclick={() => query.cancel()}>Cancel query</button>
      <button data-testid="pole-clear" onclick={() => query.clear()}>Clear query</button>
      <button data-testid="pole-retry" disabled={!queryState.selection || running} onclick={() => { if (queryState.selection) void query.select(queryState.selection); }}>Retry same selection</button>
      <button data-testid="pole-frame" disabled={!queryState.selection || !!gpuError} onclick={() => viewer?.frameResult()}>Frame result</button>
      {#if queryState.selection}
        <dl data-testid="pole-selection"><dt>Selected source file / row (zero-based)</dt><dd>{queryState.selection.key.sourceFileId} / {queryState.selection.key.sourceRow}</dd><dt>Selected position (local m)</dt><dd>{queryState.selection.position.join(', ')}</dd><dt>Artifact revision</dt><dd>{queryState.selection.artifactRevision}</dd></dl>
      {/if}
      {#if completed}
        {#if completed.nearest}
          <dl data-testid="pole-result"><dt>Verified distance (m)</dt><dd>{completed.nearest.distanceMeters}</dd><dt>Pole-labelled source file / row</dt><dd>{completed.nearest.key.sourceFileId} / {completed.nearest.key.sourceRow}</dd><dt>Returned position (local m)</dt><dd>{completed.nearest.position.join(', ')}</dd></dl>
        {:else}<p data-testid="pole-result">Verified-none: no Pole-labelled point in the whole dataset.</p>{/if}
        <p class="note">Search: {completed.search.scannedPoints.toLocaleString()} records visited. Independent verifier: {completed.verification.scannedPoints.toLocaleString()} {completed.search.index ? 'indexed Pole' : 'source'} records.{#if completed.search.index} Complete category index: {completed.search.index.points.toLocaleString()} points.{/if} Revision: {completed.dataset.revision}</p>
      {:else if queryState.result}
        <p role="alert" data-testid="pole-error">{queryState.result.status === 'error' ? queryState.result.code : queryState.result.status === 'incomplete' ? `Incomplete: ${queryState.result.reason}` : queryState.result.status === 'verification-rejected' ? `Verification rejected: ${queryState.result.reason}` : ''}</p>
      {/if}
      {#if queryState.error}<p role="alert" data-testid="pole-error">{queryState.error}</p>{/if}
    </aside>
  </div>
</main>
<style>
  main { max-width: 1600px; margin: auto; padding: 28px; }
  h1 { margin-bottom: 8px; font-size: 28px; } h2 { font-size: 17px; }
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 350px; border: 1px solid #344660; border-radius: 12px; overflow: hidden; }
  section { min-width: 0; } section p { padding: 0 16px; }
  .toolbar { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .viewport { position: relative; width: 100%; height: 68vh; min-height: 340px; }
  :global(canvas) { display: block; touch-action: none; }
  aside { padding: 20px; background: #151f30; } label { display: block; margin: 10px 0; }
  button, select { color: #e4ecf7; background: #1c2a40; border: 1px solid #52627a; border-radius: 6px; padding: 8px; cursor: pointer; }
  select { display: block; width: 100%; } button { margin: 4px 0; } button:disabled { opacity: .5; }
  dt, .note { font-size: 12px; color: #a1b3ca; } .note { overflow-wrap: anywhere; } dd { margin: 0 0 8px; font-size: 12px; overflow-wrap: anywhere; }
  [role="alert"] { color: #ff8888; }
  @media (max-width: 850px) { main { padding: 12px; } .workspace { grid-template-columns: 1fr; } .viewport { height: 55vh; } }
</style>
