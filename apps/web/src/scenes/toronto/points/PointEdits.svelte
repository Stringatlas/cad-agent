<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { ApprovalReviewItem } from '../../../components/ApprovalReview.svelte';
  import type { PointMoveProposal, PointOverrideSnapshot } from '@spatial/contracts';
  import type { TorontoDraftPoint } from '../../../chat/draft-context';
  import { PointOverrideController, type PointEditView } from './point-override-client';
  let { points, artifactRevision, refreshToken = 0, onreview = () => {}, onstate }: { onreview?: (items: readonly ApprovalReviewItem[]) => void; refreshToken?: number; points: readonly TorontoDraftPoint[]; artifactRevision?: string; onstate: (snapshot?: PointOverrideSnapshot, proposal?: PointMoveProposal, blocked?: boolean, proposals?: readonly PointMoveProposal[]) => void } = $props();
  let view = $state<PointEditView>({ busy: false, needsRefresh: true, status: 'Loading volatile point authority…' });
  const controller = new PointOverrideController(value => { view = value; onstate(value.snapshot, value.proposal, value.busy || value.needsRefresh, value.needsRefresh ? [] : value.proposals); }, undefined, true);
  $effect(() => { const token = refreshToken; untrack(() => { if (token && !view.needsRefresh) void controller.refresh(); }); });
  let alive = true;
  let boundArtifact: string | undefined;
  const problem = $derived(view.needsRefresh || /^(Error|TypeError|RangeError):/.test(view.status));
  $effect(() => {
    const items: ApprovalReviewItem[] = (view.proposals ?? []).map(proposal => ({
      id: proposal.proposalId, title: proposal.moves.length === 1 ? 'Move point' : `Move ${proposal.moves.length} points`,
      summary: proposal.moves.map(move => {
        const name = points.find(point => point.key.sourceFileId === move.key.sourceFileId && point.key.sourceRow === move.key.sourceRow)?.name ?? 'Point';
        return `${name} → [${move.after.join(', ')}] m`;
      }).join('\n'),
      details: `Toronto local meters · Z-up · revision ${proposal.revision}\n` + proposal.moves.map(move => `File ${move.key.sourceFileId}, row ${move.key.sourceRow}\nBefore [${move.before.join(', ')}] m\nAfter [${move.after.join(', ')}] m`).join('\n\n'),
      disabled: view.busy || view.needsRefresh,
      testId: 'point-edit-review', acceptTestId: 'point-edit-approve', declineTestId: 'point-edit-cancel',
      onaccept: () => { controller.selectProposal(proposal.proposalId); return controller.approve(); },
      ondecline: () => { controller.selectProposal(proposal.proposalId); return controller.decline(); },
    }));
    untrack(() => onreview(items));
  });
  export async function refreshAuthority(): Promise<void> {
    await tick();
    const deadline = Date.now() + 35_000;
    while (view.busy && alive && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!alive || view.busy) throw new Error('Point authority is unavailable or busy. Retry Refresh.');
    await controller.refresh(); await tick();
    if (!alive || view.needsRefresh) throw new Error(view.status);
  }
  $effect(() => {
    const references = points, revision = artifactRevision;
    JSON.stringify(references);
    untrack(() => {
      controller.bind(references, revision);
      if (revision && (boundArtifact !== revision || !view.needsRefresh)) { boundArtifact = revision; void controller.refresh(); }
    });
  });
  onMount(() => { return () => { alive = false; controller.dispose(); onstate(undefined, undefined); }; });
</script>

<section class="point-edits" hidden={!problem} data-testid="point-edits" aria-label="Toronto point recovery">
  {#if problem}<p role="alert">{view.status}</p>{/if}
  {#if view.needsRefresh && !view.busy}<button data-testid="point-edit-recover" onclick={() => void controller.refresh()}>Refresh point changes</button>{/if}
</section>
<style>
  .point-edits[hidden] { display: none; }
  .point-edits { padding: 12px; border: 1px solid #ffffff20; border-radius: 14px; background: #202124f5; box-shadow: 0 8px 30px #0004; }
  p { font-size: 11px; overflow-wrap: anywhere; color: #9badc3; }
  button { background: #1c2a40; color: #e4ecf7; border: 1px solid #3a4e66; border-radius: 5px; padding: 6px; font: inherit; font-size: 11px; margin: 3px; cursor: pointer; }
  [role="alert"] { color: #ffd187; }
</style>
