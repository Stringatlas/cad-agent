<script lang="ts">
  import type { TorontoCadView, TorontoCadController } from './toronto-cad-client';
  import type { Vec3 } from '@spatial/contracts';
  let { view, controller, streaming = false }: { view: TorontoCadView; controller: TorontoCadController; streaming?: boolean } = $props();
  let kind = $state<'box' | 'cylinder'>('box');
  let center = $state<number[]>([0, 0, 125]), dimensions = $state<number[]>([2, 2, 2]);
  let radius = $state(1), height = $state(2);
  const blocked = $derived(view.busy || view.needsRefresh || streaming);
  function propose() { controller.propose(kind === 'box' ? { kind, center: center as unknown as Vec3, dimensions: dimensions as unknown as Vec3 } : { kind, center: center as unknown as Vec3, radius, height }); }
</script>
<section class="cad-tools" data-testid="toronto-cad-review" aria-label="Toronto CAD tools">
  <button data-testid="toronto-cad-refresh" disabled={view.busy} onclick={() => void controller.refresh()}>Refresh CAD authority</button>
  <button data-testid="toronto-cad-undo" disabled={blocked || !view.snapshot?.nextUndoTransactionId} onclick={() => void controller.undo()}>Undo last CAD solid</button>
  <details><summary>Details</summary>
    <p data-testid="toronto-cad-status" role="status">{view.status}</p>
    {#if view.snapshot}<p>Revision {view.snapshot.revision} · {view.snapshot.bodies.length} accepted solids · {view.snapshot.proposals.length} pending</p>{/if}
    <p>Session-only OpenCascade solids · Toronto local meters · Z-up. Restart clears bodies. Orange ghosts are pending; blue solids are accepted.</p>
  </details>
  <details><summary>Manual primitive proposal</summary>
    <fieldset disabled={blocked}>
      <label>Primitive<select data-testid="cad-kind" bind:value={kind}><option value="box">Box</option><option value="cylinder">Z-cylinder</option></select></label>
      <div class="axes">{#each ['X', 'Y', 'Z'] as axis, i}<label>Center {axis} (m)<input data-testid={`cad-center-${axis.toLowerCase()}`} type="number" step="0.1" bind:value={center[i]} /></label>{/each}</div>
      {#if kind === 'box'}<div class="axes">{#each ['X', 'Y', 'Z'] as axis, i}<label>Size {axis} (m)<input type="number" min="0.001" step="0.1" bind:value={dimensions[i]} /></label>{/each}</div>
      {:else}<label>Radius (m)<input type="number" min="0.001" bind:value={radius} /></label><label>Height (m)<input type="number" min="0.001" bind:value={height} /></label>{/if}
      <button data-testid="toronto-cad-propose" disabled={blocked} onclick={propose}>Propose native solid</button>
    </fieldset>
  </details>
</section>
<style>
  .cad-tools { font-size: 11px; color: #d2d3d8; } p { color: #b1b2bc; overflow-wrap: anywhere; } button, input, select { background: #2b2c30; color: #f5f5f7; border: 1px solid #ffffff22; border-radius: 6px; padding: 6px; font: inherit; } button { cursor: pointer; margin: 3px; } button:disabled { opacity: .4; } label { display: block; margin: 6px 0; } input, select { width: 100%; box-sizing: border-box; } .axes { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; } fieldset { border: 0; margin: 0; padding: 0; min-width: 0; } summary { cursor: pointer; margin: 8px 0; }
</style>
