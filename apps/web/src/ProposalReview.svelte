<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectController, ProjectView } from './project-client';
  let { view, controller }: { view: ProjectView; controller: ProjectController } = $props();
  onMount(() => { const timer = setInterval(() => controller.expireModelProposals(), 500); return () => clearInterval(timer); });
</script>

{#if view.modelProposals?.length || view.undoAvailable}
  <section class="proposal-review" aria-label="Pending AI changes" data-testid="model-proposal-review">
    <h2>{view.modelProposals?.length ?? 0} pending AI changes</h2>
    <p>Amber ghosts are uncommitted previews, not authoritative geometry. Parameter postconditions only — <strong>not CAD solids or collision verification</strong>.</p>
    {#if view.modelStreaming}<p role="status">Model still running. Accept/Decline is locked until the stream ends.</p>{/if}
    {#each view.modelProposals ?? [] as proposal (proposal.proposalId)}
      <article data-testid="model-box-proposal" data-proposal-id={proposal.proposalId}>
        <strong>{proposal.edit.kind === 'create-box' ? 'Create' : 'Modify'} {proposal.after.id}</strong>
        <p>Center [{proposal.after.center.join(', ')}] m<br />Dimensions [{proposal.after.dimensions.join(', ')}] m</p>
        <p>Frame {proposal.frameId} · revision {proposal.projectRevision} · {proposal.units}<br />Expires {new Date(proposal.expiresAt).toISOString()}</p>
        <details><summary>Exact retained candidate, binding &amp; digest</summary><pre>{JSON.stringify(proposal, null, 2)}</pre></details>
        <button data-testid="model-box-accept" disabled={!!view.pending || view.needsRefresh || view.modelStreaming || proposal.expiresAt <= Date.now()} onclick={() => void controller.approve(proposal.proposalId)}>Accept this change</button>
        <button data-testid="model-box-decline" disabled={!!view.pending || view.needsRefresh || view.modelStreaming} onclick={() => void controller.decline(proposal.proposalId)}>Decline this change</button>
      </article>
    {/each}
    {#if view.modelProposals?.length}<p>Accepting one change invalidates every other revision-bound preview. No silent rebase. Accepted geometry stays unsaved until explicit Save.</p>{/if}
    {#if view.undoAvailable}<button data-testid="model-box-undo" disabled={!!view.pending || view.needsRefresh || view.modelStreaming} onclick={() => { if (confirm('Undo the latest retained edit as a new geometry revision?')) void controller.undo(); }}>Undo latest accepted edit</button>{/if}
    <p role="status">{view.status}</p>
  </section>
{/if}

<style>
  .proposal-review { position: absolute; z-index: 4; left: 16px; bottom: 16px; width: min(390px, calc(100% - 32px)); max-height: 48%; overflow: auto; padding: 14px; border: 1px solid #c7974f88; border-radius: 14px; background: #25231ff5; box-shadow: 0 10px 40px #0005; color: #fff0d8; }
  h2 { margin: 0; font-size: 14px; } p { font-size: 11px; overflow-wrap: anywhere; } article { padding: 10px 0; border-top: 1px solid #c7974f44; } pre { max-height: 180px; overflow: auto; font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; } summary { font-size: 11px; cursor: pointer; }
  button { padding: 8px 10px; margin: 10px 6px 0 0; color: #fff0d8; background: #614521; border: 1px solid #c7974f88; border-radius: 7px; cursor: pointer; font-size: 12px; } button:disabled { opacity: .4; cursor: not-allowed; }
</style>
