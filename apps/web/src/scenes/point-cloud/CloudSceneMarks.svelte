<script lang="ts">
  import type { SceneMarkSnapshot, Vec3 } from '@spatial/contracts';
  import { onMount } from 'svelte';
  let { snapshot, selected, onselect, onlayout = () => {} }: { snapshot: SceneMarkSnapshot; selected?: string; onselect: (id: string, position: Vec3) => void; onlayout?: () => void } = $props();
  onMount(() => { onlayout(); });
</script>
<details class="hypotheses" data-testid="scene-mark-list" ontoggle={onlayout}>
  <summary>Hypotheses · {snapshot.marks.length}</summary>
  <ol aria-label="Agent location hypotheses">{#each snapshot.marks as mark (mark.id)}
    <li><button type="button" aria-pressed={selected === mark.id} data-testid={`scene-mark-${mark.rank}`} onclick={() => onselect(mark.id, mark.position)}>
      <strong>C{mark.rank} · Hypothesis</strong><span>{mark.rationale}</span><span class="unknowns">Unknowns: {mark.uncertainty}</span>
    </button></li>
  {/each}</ol>
</details>
<style>
  .hypotheses { border:1px solid #ffffff20; border-radius:10px; background:#202124f0; }
  summary { padding:10px 12px; cursor:pointer; min-height:44px; }
  ol { list-style:none; padding:0 8px 8px; margin:0; display:grid; gap:5px; }
  button { width:100%; min-height:44px; text-align:left; border:1px solid transparent; border-radius:7px; padding:9px; background:#ffffff0a; color:#eeeef2; cursor:pointer; }
  button[aria-pressed=true] { border-color:#8eaaf0; background:#526fc930; }
  strong,span { display:block; } span { margin-top:4px; font-size:12px; } .unknowns { color:#bfc6d5; }
</style>
