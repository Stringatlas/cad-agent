<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModelVisualObservation, VisualObservation } from '@spatial/contracts';
  import { clampCrop, compressScreenshot, cropOutputSize, dragCrop, type CropRect } from './screenshot-crop';
  let { observation, loading, error, isCurrent, onattach, oncancel }: { observation?: VisualObservation; loading: boolean; error: string; isCurrent: () => boolean; onattach: (image: ModelVisualObservation) => void; oncancel: () => void } = $props();
  let dialog: HTMLDialogElement;
  let preview = $state<HTMLDivElement>();
  let crop = $state<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  let busy = $state(false), failure = $state('');
  let alive = true, ticket = 0;
  let drag: { id: number; x: number; y: number } | undefined;
  $effect(() => { if (observation) crop = { x: 0, y: 0, width: observation.viewport.width, height: observation.viewport.height }; });
  onMount(() => {
    dialog.showModal();
    return () => { alive = false; ticket++; dialog.close(); };
  });
  function cancel() { ticket++; oncancel(); }
  function point(event: PointerEvent) {
    const bounds = preview!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * observation!.viewport.width, y: (event.clientY - bounds.top) / bounds.height * observation!.viewport.height };
  }
  function start(event: PointerEvent) {
    if (!observation || busy || event.button !== 0) return;
    event.preventDefault(); preview!.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, ...point(event) };
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId || !observation) return;
    crop = dragCrop(drag, point(event), observation.viewport.width, observation.viewport.height);
  }
  function finish(event: PointerEvent) { move(event); drag = undefined; if (preview!.hasPointerCapture(event.pointerId)) preview!.releasePointerCapture(event.pointerId); }
  function numeric(key: keyof CropRect, value: number) {
    if (observation && Number.isFinite(value)) crop = clampCrop({ ...crop, [key]: value }, observation.viewport.width, observation.viewport.height);
  }
  async function attach() {
    if (!observation || busy) return;
    const current = observation, mine = ++ticket; busy = true; failure = '';
    try {
      const image = await compressScreenshot(current, crop, () => alive && mine === ticket && observation === current && isCurrent());
      if (alive && mine === ticket && isCurrent()) onattach(image);
    } catch (error) { if (alive && mine === ticket) failure = error instanceof Error ? error.message : 'Compression failed.'; }
    finally { if (alive && mine === ticket) busy = false; }
  }
</script>

<dialog bind:this={dialog} data-testid="model-crop-dialog" aria-labelledby="screenshot-crop-title" oncancel={event => { event.preventDefault(); cancel(); }}>
  <h2 id="screenshot-crop-title">Crop scene screenshot</h2>
  {#if loading}<p role="status">Capturing scene…</p>{/if}
  {#if error || failure}<p role="alert" data-testid="model-image-error">{error || failure}</p>{/if}
  {#if observation}
    <p>Drag a rectangle, or enter source-pixel coordinates below.</p>
    <div class="preview" data-testid="model-crop-preview" bind:this={preview} role="img" aria-label="Screenshot crop preview; use numeric controls below for keyboard selection" onpointerdown={start} onpointermove={move} onpointerup={finish} onpointercancel={() => drag = undefined} onlostpointercapture={() => drag = undefined}>
      <img src={observation.image.dataUrl} alt="Captured scene" draggable="false" />
      <div class="selection" style:left={`${100 * crop.x / observation.viewport.width}%`} style:top={`${100 * crop.y / observation.viewport.height}%`} style:width={`${100 * crop.width / observation.viewport.width}%`} style:height={`${100 * crop.height / observation.viewport.height}%`}></div>
    </div>
    <fieldset disabled={busy}><legend>Crop in original image pixels</legend>
      {#each ['x', 'y', 'width', 'height'] as key}
        <label>{key}<input aria-label={`Crop ${key}`} type="number" step="1" min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'width' ? observation.viewport.width : observation.viewport.height} value={crop[key as keyof CropRect]} oninput={event => numeric(key as keyof CropRect, event.currentTarget.valueAsNumber)} /></label>
      {/each}
      <button type="button" onclick={() => crop = { x: 0, y: 0, width: observation!.viewport.width, height: observation!.viewport.height }}>Reset whole image</button>
    </fieldset>
    <p data-testid="model-crop-output">JPEG · {cropOutputSize(crop.width, crop.height).width} × {cropOutputSize(crop.width, crop.height).height} · quality 78%</p>
  {/if}
  <details><summary>Image sharing &amp; provenance</summary>
    <p>Attach prepares a compressed JPEG only. Nothing is sent until you choose Send in chat. Each image send starts fresh without previous chat history. Original PNG bytes stay local.</p>
    <p data-testid="model-image-capability-notice">Any listed model may be tried; the provider catalog does not verify image capability and the provider may reject it. Images are never silently removed or retried as text-only.</p>
    <p>Displayed coverage only, not the whole dataset. Model pixel coordinates refer to the attached crop and map back to the original capture. Browser-observed provenance is not independently verified CAD.</p>
  </details>
  <div class="actions"><button type="button" onclick={cancel}>Cancel</button><button type="button" data-testid="model-crop-attach" disabled={!observation || loading || busy || !!error} onclick={() => void attach()}>{busy ? 'Compressing…' : 'Attach JPEG'}</button></div>
</dialog>

<style>
  dialog { color: #e4ecf7; background: #142331; border: 1px solid #486078; border-radius: 12px; padding: 20px; width: min(760px, 94vw); max-height: 90vh; overflow: auto; }
  dialog::backdrop { background: #000a; } h2 { margin: 0 0 12px; font-size: 18px; }
  p, details { font-size: 12px; color: #b5c9dc; } .preview { position: relative; width: fit-content; max-width: 100%; margin: auto; touch-action: none; cursor: crosshair; overflow: hidden; line-height: 0; }
  img { display: block; max-width: 100%; max-height: 48vh; width: auto; height: auto; user-select: none; }
  .selection { position: absolute; border: 2px solid #99e4d4; box-sizing: border-box; box-shadow: 0 0 0 9999px #0007; pointer-events: none; }
  fieldset { display: flex; flex-wrap: wrap; gap: 10px; border: 1px solid #486078; margin-top: 12px; } legend { font-size: 12px; } label { font-size: 12px; } input { display: block; width: 86px; background: #0d1724; color: #e4ecf7; padding: 6px; border: 1px solid #486078; }
  button { background: #1c2a40; color: #e4ecf7; border: 1px solid #486078; border-radius: 6px; padding: 8px 12px; cursor: pointer; } button:disabled { opacity: .4; } .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
