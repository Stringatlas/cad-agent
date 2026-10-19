<script lang="ts">
  import { onMount } from 'svelte';
  import ApprovalReview, { type ApprovalReviewItem } from './ApprovalReview.svelte';
  import type { ProjectController, ProjectView } from './project-client';
  let { view, controller }: { view: ProjectView; controller: ProjectController } = $props();
  onMount(() => { const timer = setInterval(() => controller.expireModelProposals(), 500); return () => clearInterval(timer); });
  const items = $derived<readonly ApprovalReviewItem[]>((view.modelProposals ?? []).map(proposal => ({
    id: proposal.proposalId,
    title: `${proposal.edit.kind === 'create-box' ? 'Create' : 'Modify'} ${proposal.after.id}`,
    summary: `Center [${proposal.after.center.join(', ')}] m\nSize [${proposal.after.dimensions.join(', ')}] m`,
    details: `Synthetic parameter preview, not a CAD solid. Accept publishes this exact change; Save remains explicit.\n${JSON.stringify(proposal, null, 2)}`,
    disabled: !!view.pending || view.needsRefresh || proposal.expiresAt <= Date.now(),
    onaccept: () => void controller.approve(proposal.proposalId),
    ondecline: () => void controller.decline(proposal.proposalId),
    testId: 'model-box-proposal', acceptTestId: 'model-box-accept', declineTestId: 'model-box-decline',
  })));
</script>

<ApprovalReview {items} />
{#if view.needsRefresh || (!view.pending && /unknown|unavailable|invalid|Rejected|failed/i.test(view.status))}
  <section class="recovery" role="alert" data-testid="model-proposal-recovery">
    <p>{view.status}</p>
    <button disabled={!!view.pending} onclick={() => void controller.refresh()}>Refresh project</button>
  </section>
{/if}

<style>
  .recovery { position: absolute; z-index: 13; left: 16px; bottom: 16px; max-width: min(320px, calc(100% - 32px)); padding: 12px; border-radius: 12px; background: #30271cf5; border: 1px solid #a37e46; color: #f2d5a6; font-size: 12px; }
  p { margin: 0 0 8px; overflow-wrap: anywhere; }
  button { color: inherit; background: #ffffff10; border: 1px solid #ffffff30; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
</style>
