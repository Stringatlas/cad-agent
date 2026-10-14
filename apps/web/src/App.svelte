<script lang="ts">
  import Demo from './Demo.svelte';
  import Toronto from './Toronto.svelte';
  import ClosestPole from './ClosestPole.svelte';
  let mode = $state<'demo' | 'toronto' | 'pole'>('demo');
</script>

<nav aria-label="Scene source">
  <button aria-pressed={mode === 'demo'} onclick={() => mode = 'demo'}>Synthetic demo</button>
  <button aria-pressed={mode === 'toronto'} onclick={() => mode = 'toronto'}>Toronto3D preview</button>
  <button aria-pressed={mode === 'pole'} onclick={() => mode = 'pole'}>Closest: label</button>
</nav>
{#if mode === 'demo'}<Demo />{:else if mode === 'toronto'}<Toronto />{:else}<ClosestPole />{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #0b1220; color: #e4ecf7; font: 15px/1.5 system-ui, sans-serif; }
  nav { display: flex; gap: 12px; padding: 12px 28px 0; }
  button { color: #e4ecf7; background: #1c2a40; border: 1px solid #344660; border-radius: 7px; padding: 10px 16px; cursor: pointer; }
  button[aria-pressed="true"] { border-color: #72d9cd; }
  button:focus-visible { outline: 2px solid #ffc766; }
</style>
