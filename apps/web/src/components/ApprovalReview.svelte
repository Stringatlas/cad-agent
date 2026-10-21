<script module lang="ts">
  export interface ApprovalReviewItem {
    id: string;
    title: string;
    summary?: string;
    details: string;
    disabled: boolean;
    onaccept: () => unknown;
    ondecline: () => unknown;
    testId?: string;
    acceptTestId?: string;
    declineTestId?: string;
  }
</script>

<script lang="ts">
  let { items, focusId }: { items: readonly ApprovalReviewItem[]; focusId?: string } = $props();
  let selectedId = $state<string>();
  // Keep the current candidate stable as other proposals arrive or disappear.
  const index = $derived(Math.max(0, items.findIndex(item => item.id === selectedId)));
  const item = $derived(items[index]);
  $effect(() => { if (focusId) selectedId = focusId; });
  function navigate(offset: number) { selectedId = items[index + offset]?.id ?? item?.id; }
  $effect(() => { if (item && selectedId !== item.id) selectedId = item.id; });
</script>

{#if item}
  <section class="approval-review" aria-label="Pending changes" data-testid="approval-review">
    <header>
      <span>Review change</span>
      <nav aria-label="Browse pending changes">
        <button type="button" aria-label="Previous change" data-testid="approval-previous" disabled={index === 0} onclick={() => navigate(-1)}>←</button>
        <span class="counter" data-testid="approval-counter" aria-live="polite">{index + 1}/{items.length}</span>
        <button type="button" aria-label="Next change" data-testid="approval-next" disabled={index === items.length - 1} onclick={() => navigate(1)}>→</button>
      </nav>
    </header>
    {#key item.id}
      <article data-testid={item.testId} data-proposal-id={item.id}>
        <h2>{item.title}</h2>
        {#if item.summary}<p>{item.summary}</p>{/if}
        <details><summary>Details</summary><pre>{item.details}</pre></details>
        <div class="actions">
          <button type="button" data-testid={item.declineTestId} disabled={item.disabled} onclick={() => item.ondecline()}>Decline</button>
          <button type="button" class="accept" data-testid={item.acceptTestId} disabled={item.disabled} onclick={() => item.onaccept()}>Accept</button>
        </div>
      </article>
    {/key}
  </section>
{/if}

<style>
  .approval-review { position: absolute; z-index: 12; right: 16px; bottom: 16px; width: min(320px, calc(100% - 32px)); max-height: min(60%, 560px); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 14px; border: 1px solid #ffffff28; border-radius: 16px; background: #242528f5; box-shadow: 0 10px 36px #0005; color: #f5f5f7; }
  header, nav, .actions { display: flex; align-items: center; gap: 8px; }
  header { justify-content: space-between; color: #b9bac1; font-size: 11px; }
  nav { gap: 2px; }
  .counter { min-width: 32px; text-align: center; font-variant-numeric: tabular-nums; }
  h2 { margin: 12px 0 8px; font-size: 15px; font-weight: 550; }
  p { margin: 8px 0; color: #c1c2c9; font-size: 12px; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
  details { margin: 10px 0; }
  summary { color: #b9bac1; cursor: pointer; font-size: 11px; }
  pre { font: 11px/1.5 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto; color: #b9bac1; }
  button { border: 1px solid #ffffff22; border-radius: 8px; background: #333438; color: #f5f5f7; padding: 9px 14px; font: inherit; font-size: 12px; cursor: pointer; }
  nav button { min-width: 32px; min-height: 32px; padding: 4px; font-size: 16px; background: transparent; border-color: transparent; }
  .actions { justify-content: flex-end; margin-top: 14px; }
  .accept { background: #4677c5; border-color: #77a0e4; }
  button:disabled { opacity: .4; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
  @media (max-width: 640px) {
    .approval-review { right: 8px; bottom: 8px; width: calc(100% - 16px); max-height: calc(40% - 8px); padding: 12px; }
    nav button { min-width: 44px; min-height: 44px; }
    .actions button { min-height: 44px; }
  }
</style>
