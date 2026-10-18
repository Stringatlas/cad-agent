<script lang="ts">
  import { onMount } from 'svelte';
  import type { VisualObservation, VisualPixelResolution } from '@spatial/contracts';
  let { label, capture, resolvePixel, isCurrent }: { label: string; capture: () => Promise<VisualObservation>; isCurrent: (id: string) => boolean;
    resolvePixel: (id: string, x: number, y: number) => VisualPixelResolution } = $props();
  let observation = $state<VisualObservation>(), result = $state<VisualPixelResolution>();
  let busy = $state(false), stale = $state(false), error = $state('');
  let x = $state(0), y = $state(0), alive = true, ticket = 0;
  const metadata = $derived(observation ? { ...observation, image: { ...observation.image, dataUrl: '(PNG retained locally; included in JSON download)' } } : undefined);
  function check() {
    if (!observation || stale) return;
    // Metadata-only liveness check: never raycast uncapped detail on a timer.
    if (!isCurrent(observation.observationId)) {
      stale = true;
      result = { status: 'stale', observationId: observation.observationId, x, y, reason: 'View changed or viewer unavailable; capture again' };
    }
  }
  async function takeCapture() {
    const request = ++ticket; busy = true; error = ''; result = undefined; observation = undefined; stale = false;
    try { const next = await capture(); if (alive && request === ticket) observation = next; }
    catch (cause) { if (alive && request === ticket) error = String(cause); }
    finally { if (alive && request === ticket) busy = false; }
  }
  function resolve() {
    if (!observation) return;
    result = resolvePixel(observation.observationId, x, y);
    if (result.status === 'stale' || result.status === 'unavailable') stale = true;
  }
  function download() {
    if (!observation) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(observation)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `visual-${observation.observationId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  onMount(() => {
    const timer = setInterval(check, 1000);
    return () => { alive = false; ticket++; clearInterval(timer); };
  });
</script>

<details class="visual-observation" data-testid="visual-observation">
  <summary>{label} visual observation · fixed-view capture</summary>
  <p>This panel is local-only. To send an image, use Attach scene screenshot in model chat, then Send. Displayed samples/partial detail are not whole-dataset coverage. Semantic queries remain camera-independent.</p>
  <button type="button" data-testid="capture-visual" disabled={busy} onclick={() => void takeCapture()}>{busy ? 'Capturing…' : 'Capture current view'}</button>
  {#if error}<p role="alert" data-testid="visual-error">{error}</p>{/if}
  {#if observation}
    <p role="status" data-testid="visual-status">{stale ? 'Captured image retained; pixel grounding unavailable.' : 'Captured view — pixel grounding available while this view remains unchanged.'}</p>
    <p>Image {observation.viewport.width} × {observation.viewport.height} · top-left origin · integer drawing-buffer pixels (not CSS pixels). Click the preview to resolve a pixel.</p>
    <button class="preview" type="button" aria-label="Resolve pixel in captured image" disabled={stale} onclick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      x = Math.min(observation!.viewport.width - 1, Math.floor((event.clientX - rect.left) / rect.width * observation!.viewport.width));
      y = Math.min(observation!.viewport.height - 1, Math.floor((event.clientY - rect.top) / rect.height * observation!.viewport.height)); resolve();
    }}><img data-testid="visual-image" src={observation.image.dataUrl} alt={`${label} captured scene; use pixel fields for precise resolution`} /></button>
    <form onsubmit={event => { event.preventDefault(); resolve(); }}>
      <label>Image X<input data-testid="visual-x" type="number" step="1" bind:value={x} /></label>
      <label>Image Y<input data-testid="visual-y" type="number" step="1" bind:value={y} /></label>
      <button data-testid="resolve-visual" type="submit">Resolve pixel</button>
    </form>
    {#if result}<pre data-testid="visual-resolution">{JSON.stringify(result, null, 2)}</pre>{/if}
    <button type="button" data-testid="download-visual" onclick={download}>Download image + metadata JSON</button>
    <details><summary>Capture metadata / SHA256 / coverage</summary><pre data-testid="visual-metadata">{JSON.stringify(metadata, null, 2)}</pre></details>
  {/if}
</details>

<style>
  .visual-observation { padding: 12px 16px; border-top: 1px solid #344660; color: #aec4da; font-size: 12px; }
  summary { cursor: pointer; } p { overflow-wrap: anywhere; font-size: 11px; }
  button, input { background: #1c2a40; color: #e4ecf7; border: 1px solid #415b77; border-radius: 5px; padding: 7px 10px; }
  button { cursor: pointer; } button:disabled { opacity: .5; }
  .preview { display: block; padding: 0; border: 0; width: 100%; max-width: 720px; margin: 10px 0; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  form { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; margin: 10px 0; }
  label { display: grid; gap: 5px; } input { width: 90px; }
  pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 10px; }
</style>
