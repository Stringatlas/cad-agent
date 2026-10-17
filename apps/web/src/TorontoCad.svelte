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
<section class="cad-review" data-testid="toronto-cad-review" aria-label="Toronto CAD changes">
  <h3>Toronto CAD · real kernel solids</h3>
  <p data-testid="toronto-cad-status" role="status">{view.status}</p>
  <p>Volatile session · Toronto local meters · Z-up. Restart clears bodies. Orange ghosts are pending; blue solids are accepted. Native validation is separate from rendering.</p>
  <button data-testid="toronto-cad-refresh" disabled={view.busy || streaming} onclick={() => void controller.refresh()}>Refresh CAD authority</button>
  {#if view.needsRefresh}<p role="alert">Writes blocked until explicit Refresh.</p>{/if}
  {#if view.snapshot}<p>Revision {view.snapshot.revision} · {view.snapshot.bodies.length} accepted solids · {view.snapshot.proposals.length} pending</p>{/if}
  {#each view.snapshot?.proposals ?? [] as proposal (proposal.proposalId)}
    <section class="candidate" data-testid="toronto-cad-proposal">
      <strong>Pending {proposal.operation.kind} · {proposal.proposalId}</strong>
      <p>Center [{proposal.operation.center.join(', ')}] m · {proposal.operation.kind === 'box' ? `size [${proposal.operation.dimensions.join(', ')}] m` : `radius ${proposal.operation.radius} m, height ${proposal.operation.height} m`}</p>
      <p>OpenCascade valid single solid · measured volume {proposal.validation.volume} m³<br />Bounds [{proposal.validation.bounds.min.join(', ')}] → [{proposal.validation.bounds.max.join(', ')}] m</p>
      <button data-testid="toronto-cad-accept" disabled={blocked} onclick={() => void controller.approve(proposal.proposalId)}>Accept exact solid</button>
      <button data-testid="toronto-cad-decline" disabled={blocked} onclick={() => void controller.decline(proposal.proposalId)}>Decline</button>
    </section>
  {/each}
  <button data-testid="toronto-cad-undo" disabled={blocked || !view.snapshot?.nextUndoTransactionId} onclick={() => void controller.undo()}>Undo last CAD solid</button>
  <details><summary>Manual primitive proposal (same authority as AI)</summary>
    <label>Primitive<select data-testid="cad-kind" bind:value={kind}><option value="box">Box</option><option value="cylinder">Z-cylinder</option></select></label>
    <div class="axes">{#each ['X', 'Y', 'Z'] as axis, i}<label>Center {axis} (m)<input data-testid={`cad-center-${axis.toLowerCase()}`} type="number" step="0.1" bind:value={center[i]} /></label>{/each}</div>
    {#if kind === 'box'}<div class="axes">{#each ['X', 'Y', 'Z'] as axis, i}<label>Size {axis} (m)<input type="number" min="0.001" step="0.1" bind:value={dimensions[i]} /></label>{/each}</div>
    {:else}<label>Radius (m)<input type="number" min="0.001" bind:value={radius} /></label><label>Height (m)<input type="number" min="0.001" bind:value={height} /></label>{/if}
    <button data-testid="toronto-cad-propose" disabled={blocked} onclick={propose}>Propose native solid</button>
  </details>
</section>
<style>
  .cad-review { font-size: 11px; color: #d2d3d8; } h3 { font-size: 13px; } p { color: #b1b2bc; overflow-wrap: anywhere; } .candidate { border: 1px solid #ffb45b88; border-radius: 8px; padding: 8px; margin: 8px 0; } button, input, select { background: #2b2c30; color: #f5f5f7; border: 1px solid #ffffff22; border-radius: 6px; padding: 6px; font: inherit; } button { cursor: pointer; margin: 3px; } button:disabled { opacity: .4; } label { display: block; margin: 6px 0; } input, select { width: 100%; box-sizing: border-box; } .axes { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; } [role="alert"] { color: #ffd187; }
</style>
