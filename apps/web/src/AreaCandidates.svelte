<script lang="ts">
  import type { AreaCandidateResult, Vec3 } from '@spatial/contracts';
  let { result, selected, onselect }: { result: AreaCandidateResult; selected?: string; onselect: (id: string, position: Vec3) => void } = $props();
</script>
<section aria-label="Candidate locations" data-testid="area-candidate-shortlist">
  <h3>{result.assessment?.kind === 'model-assessed' ? 'Model-assessed locations' : 'Provisional locations'}</h3>
  {#if result.status === 'incomplete'}<p role="alert">Area scan incomplete. Ask to scan again.</p>
  {:else if !result.candidates.length}<p>No matching locations found. Try different preferences or another area.</p>
  {:else}
    {#if result.assessment?.kind !== 'model-assessed'}<p>Visual assessment pending or unavailable.</p>{/if}
    <ol>{#each result.candidates as candidate (candidate.id)}
      <li><button type="button" aria-pressed={selected === candidate.id} data-testid={`area-candidate-${candidate.rank}`} onclick={() => onselect(candidate.id, candidate.position)}>
        <strong>C{candidate.rank} · Candidate point</strong><span>Ground relief {candidate.groundReliefMeters.toFixed(2)} m{#if candidate.poleDistanceMeters !== null} · Pole ≥ {candidate.poleDistanceMeters.toFixed(1)} m{/if}</span>
        {#if candidate.rationale}<span>{candidate.rationale}</span>{/if}
      </button></li>
    {/each}</ol>
  {/if}
  <details><summary>Scan evidence</summary>
    <p>Observed source points only; not verified site clearance.</p>
    <p>{result.evidence.sourcePointsExamined.toLocaleString()} source points · {result.evidence.pagesRead.toLocaleString()} pages · {(result.evidence.elapsedMilliseconds / 1000).toFixed(1)} s · {result.evidence.cellMeters.toFixed(2)} m cells</p>
    {#each result.candidates as candidate}<p>C{candidate.rank}: {candidate.uncertainty ?? ''} [{candidate.position.map(n => n.toFixed(2)).join(', ')}] m · {candidate.groundPoints} ground points · {candidate.observedObstacleCells} observed obstacle cells</p>{/each}
    <p>Toronto local · meters · Z-up</p>
    {#if result.reason}<p>{result.reason}</p>{/if}
    <ul>{#each result.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </details>
</section>
<style>
  section { color: #1b3158; padding: 12px; border: 1px solid #d2dce7; border-radius: 12px; background: #fffffff2; }
  h3 { color: #1b3158; margin: 0 0 10px; font-size: 14px; } ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  button { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 8px; padding: 9px; background: #f0f4ff; color: #1b3158; cursor: pointer; min-height: 44px; }
  button[aria-pressed='true'] { border-color: #526fc9; background: #e1e9ff; } strong, span { display: block; } span { font-size: 11px; margin-top: 3px; }
  details { margin-top: 10px; font-size: 11px; color: #425771; } summary { cursor: pointer; } p { font-size: 12px; } ul { padding-left: 18px; }
</style>
