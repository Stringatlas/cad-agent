<script lang="ts">
  import { CLUSTER_CLASS_COLORS, FIT_COLOR, GROUND_COLOR, preprocessingLegend, type PreprocessingSummary } from './preprocessing-overlays';
  import { semanticName } from '../points/point-presentation';
  let { summary, loading, status, refresh }: { summary?: PreprocessingSummary; loading: boolean; status: string; refresh: () => void } = $props();
  const legend = $derived(summary ? preprocessingLegend(summary) : undefined);
</script>
<section aria-label="Estimated scene layers" data-testid="preprocessing-status" class="legend">
  {#if loading}<span role="status">Loading scene layers…</span>
  {:else if summary?.status === 'ready' && legend}
    <div class="layers" aria-label="Layer representations">
      <span title="Class-colored wire bounds"><span class="wire" aria-hidden="true">◇</span> Clusters</span>
      {#if legend.fits}<span><i style:background={FIT_COLOR}></i>Fits</span>{/if}
      {#if legend.ground}<span><i style:background={GROUND_COLOR}></i>Ground</span>{/if}
      <button aria-label="Refresh scene layers" data-testid="retry-preprocessing" onclick={refresh} title="Refresh layers for the current box">↻</button>
    </div>
    <div class="classes" aria-label="Cluster classes">{#each legend.classes as label}<span><i style:background={CLUSTER_CLASS_COLORS[label] ?? '#bca2ff'}></i>{semanticName(label)}</span>{/each}</div>
    <small>Estimated{summary.truncated ? ' · limited results' : ''}</small>
  {:else}
    <p role="status">{status}</p><button data-testid="retry-preprocessing" onclick={refresh}>Retry scene layers</button>
  {/if}
</section>
<style>
  .legend { padding: 8px 10px; border: 1px solid #ffffff20; border-radius: 10px; background: #202124ed; font-size: 11px; color: #dddde3; }
  .layers, .classes { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
  .layers > span, .classes > span { display: inline-flex; align-items: center; gap: 5px; }
  .classes { margin-top: 6px; font-size: 10px; }
  i { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
  .wire { color: #bca2ff; font-size: 16px; line-height: 12px; }
  small { display: block; margin-top: 6px; color: #aaaab3; font-size: 10px; }
  button { cursor: pointer; }
  p { max-width: 310px; margin: 6px 0; line-height: 1.5; }
  button { background: transparent; color: #dddde3; border: 1px solid #ffffff25; border-radius: 5px; padding: 2px 6px; font: inherit; }
  button:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
</style>
