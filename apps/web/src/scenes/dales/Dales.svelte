<script lang="ts">
  import { onMount } from 'svelte';
  import { createDalesViewer } from './dales-viewer';
  import { DALES_PALETTE, loadPreparedScenes, loadPreparedSample, type PreparedSample, type PreparedPoint } from './prepared-cloud-client';
  let host: HTMLDivElement;
  let scenes = $state<{ id: string; name: string }[]>([]);
  let sceneId = $state('dales2-5080-54435');
  let quality = $state('balanced');
  let sample = $state<PreparedSample>();
  let selected = $state<PreparedPoint>();
  let loading = $state(true), error = $state('');
  let controller: AbortController | undefined, disposed = false;
  let viewer: ReturnType<typeof createDalesViewer> | undefined;
  const classes = $derived(Object.entries(sample?.cloud.descriptor.semantics?.classes ?? {}));
  async function load() {
    controller?.abort(); controller = new AbortController();
    const current = controller, id = sceneId;
    sample = undefined; selected = undefined; error = ''; loading = true;
    try {
      const budget = quality === 'light' ? 20000 : quality === 'fine' ? 100000 : 60000;
      const result = await loadPreparedSample(id, budget, quality === 'light' ? 0 : 1, current.signal);
      if (disposed || current !== controller || current.signal.aborted) return;
      sample = result;
    } catch (cause) {
      if (disposed || current !== controller || current.signal.aborted) return;
      error = cause instanceof Error ? cause.message : 'Scene unavailable. Retry loading.';
    } finally { if (!disposed && current === controller) loading = false; }
  }
  onMount(() => {
    const inventory = new AbortController();
    void (async () => {
      try {
        scenes = await loadPreparedScenes(inventory.signal);
        if (disposed) return;
        if (!scenes.some(s => s.id === sceneId)) sceneId = scenes[0]?.id ?? '';
        if (!sceneId) throw new Error('No prepared scenes registered.');
        await load();
      } catch { if (!disposed && !inventory.signal.aborted) { loading = false; error = 'Scene inventory unavailable. Reload workspace.'; } }
    })();
    return () => { disposed = true; inventory.abort(); controller?.abort(); };
  });
  $effect(() => {
    const current = sample;
    if (!current || !host) return;
    try {
      const instance = createDalesViewer(host, current, point => selected = point, () => error = 'Graphics interrupted. Reload scene.');
      viewer = instance;
      return () => { instance.dispose(); if (viewer === instance) viewer = undefined; };
    } catch { error = '3D display unavailable. Check WebGL and retry.'; }
  });
</script>

<section class="dales" aria-label="DALES-2 scene" data-testid="dales-workspace">
  <div class="scene-controls">
    <select aria-label="DALES-2 tile" bind:value={sceneId} onchange={load} disabled={!scenes.length}>
      {#each scenes as scene}<option value={scene.id}>{scene.name}</option>{/each}
    </select>
    <button onclick={() => viewer?.fit()} disabled={!sample || !!error}>Fit</button>
    <details class="quality"><summary>Display quality</summary>
      <div class="quality-options"><label>Sample <select aria-label="Display quality" bind:value={quality} onchange={load} disabled={!scenes.length}>
        <option value="light">Light</option><option value="balanced">Balanced</option><option value="fine">Fine</option>
      </select></label><p>Sampled overview · not full resolution</p></div>
    </details>
  </div>
  <div class="viewport" bind:this={host}></div>
  {#if loading}<div class="notice" role="status">Loading scene…</div>{/if}
  {#if error}<div class="notice error" role="alert">{error} <button onclick={load} disabled={!scenes.length}>Retry</button></div>{/if}
  <div class="inspection">
    {#if selected}
      <div class="selection" aria-live="polite"><strong>Point · {selected.type}</strong>
        <details><summary>Details</summary><dl><dt>Local position (m)</dt><dd>{selected.position.map(n => n.toFixed(2)).join(', ')}</dd>
          <dt>Frame</dt><dd>{selected.frameId}</dd><dt>Source / row</dt><dd>{selected.sourceId} / {selected.sourceRow}</dd></dl></details>
      </div>
    {/if}
    {#if classes.length}
      <details class="class-key"><summary>Point types</summary><ul aria-label="DALES-2 point types">
        {#each classes as [id, name]}<li><span class="swatch" style:background={DALES_PALETTE[Number(id)] ?? '#aaa'}></span>{name}</li>{/each}
      </ul></details>
    {/if}
  </div>
</section>
<style>
  .dales { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .scene-controls { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #ffffff12; z-index: 3; }
  select, button, summary { color: #eeeef2; font: inherit; }
  select, button { border: 1px solid #ffffff20; border-radius: 7px; padding: 7px 10px; background: #25262b; }
  button { cursor: pointer; } button:disabled { opacity: .45; }
  .scene-controls > select { min-width: 0; max-width: 260px; }
  summary { cursor: pointer; padding: 8px; }
  .quality { position: relative; margin-left: auto; }
  .quality-options { position: absolute; top: 100%; right: 0; width: 230px; padding: 12px; border: 1px solid #ffffff20; border-radius: 10px; background: #25262b; box-shadow: 0 8px 24px #0005; }
  .quality-options label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .quality-options p { color: #b6b7c0; font-size: 11px; margin: 10px 0 0; }
  .viewport { flex: 1; min-height: 0; }
  .notice { position: absolute; left: 50%; top: 40%; transform: translateX(-50%); padding: 12px; border-radius: 10px; background: #25262bf5; max-width: calc(100% - 24px); }
  .error { border: 1px solid #d7a07b; }
  .inspection { position: absolute; left: 12px; bottom: 12px; max-width: min(340px, calc(100% - 24px)); display: flex; flex-direction: column; gap: 6px; max-height: calc(100% - 90px); overflow-y: auto; }
  .selection, .class-key { border: 1px solid #ffffff20; border-radius: 10px; background: #202124f0; }
  .selection { padding: 10px 12px; } .selection summary { padding: 5px 0; color: #b6b7c0; }
  dl { margin: 4px 0; font-size: 11px; overflow-wrap: anywhere; } dt { color: #b6b7c0; } dd { margin: 0 0 5px; }
  ul { list-style: none; margin: 0; padding: 0 12px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 11px; }
  li { display: flex; align-items: center; gap: 6px; } .swatch { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
  @media (max-width: 640px) { .scene-controls { padding: 8px; gap: 5px; } .scene-controls > select { flex: 1; width: 150px; } .quality summary { font-size: 11px; padding: 8px 3px; } button, select { padding: 7px; } }
</style>
