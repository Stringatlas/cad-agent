<script lang="ts">
  import type { SceneMarkSnapshot, Vec3 } from '@spatial/contracts';
  let { snapshot, selected, onselect }: { snapshot: SceneMarkSnapshot; selected?: string; onselect: (id: string, position: Vec3) => void } = $props();
</script>
<section aria-label="Agent location hypotheses" data-testid="scene-mark-list">
  <h3>Location hypotheses</h3>
  <ol>{#each snapshot.marks as mark (mark.id)}
    <li><button type="button" aria-pressed={selected === mark.id} data-testid={`scene-mark-${mark.rank}`} onclick={() => onselect(mark.id, mark.position)}>
      <strong>C{mark.rank} · Hypothesis</strong>
      <span>{mark.rationale}</span>
      <span class="unknowns">Unknowns: {mark.uncertainty}</span>
    </button></li>
  {/each}</ol>
  <details><summary>Annotation details</summary>
    <p>Model annotations, not verified geometry or clearance.</p>
    {#each snapshot.marks as mark}<p>C{mark.rank}: [{mark.position.map(n => n.toFixed(2)).join(', ')}] m{#if mark.observationId} · Observation {mark.observationId}{/if}</p>{/each}
    <p>Toronto local · meters · Z-up</p>
  </details>
</section>
<style>
  section { color: #1b3158; padding: 12px; border: 1px solid #d2dce7; border-radius: 12px; background: #fffffff2; }
  h3 { margin: 0 0 10px; font-size: 14px; } ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  button { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 8px; padding: 9px; background: #f0f4ff; color: #1b3158; cursor: pointer; min-height: 44px; }
  button[aria-pressed='true'] { border-color: #526fc9; background: #e1e9ff; } strong, span { display: block; } span { font-size: 12px; margin-top: 4px; } .unknowns { color: #425771; }
  details { margin-top: 10px; font-size: 11px; color: #425771; } summary { cursor: pointer; } p { overflow-wrap: anywhere; }
</style>
