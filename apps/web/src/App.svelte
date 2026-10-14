<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectSnapshot } from '@spatial/contracts';
  import Demo from './Demo.svelte';
  import Toronto from './Toronto.svelte';
  import ClosestPole from './ClosestPole.svelte';
  import Chat from './Chat.svelte';
  import { fetchProject } from './chat-client';
  let mode = $state<'demo' | 'toronto' | 'pole'>('demo');
  let snapshot = $state<ProjectSnapshot>();
  let error = $state('');
  let loading = $state(true);
  let generation = 0, disposed = false, active: AbortController | undefined;
  async function reload() {
    active?.abort(); const current = ++generation, controller = active = new AbortController();
    snapshot = undefined; error = ''; loading = true;
    try { const next = await fetchProject(controller.signal); if (!disposed && current === generation) snapshot = next; }
    catch { if (!disposed && current === generation && !controller.signal.aborted) error = 'Project server unavailable or invalid snapshot. No local fallback. Start the local server and reload.'; }
    finally { if (!disposed && current === generation) loading = false; }
  }
  onMount(() => { void reload(); return () => { disposed = true; generation++; active?.abort(); }; });
</script>

<nav aria-label="Scene source">
  <button aria-pressed={mode === 'demo'} onclick={() => mode = 'demo'}>Synthetic demo</button>
  <button aria-pressed={mode === 'toronto'} onclick={() => mode = 'toronto'}>Toronto3D preview</button>
  <button aria-pressed={mode === 'pole'} onclick={() => mode = 'pole'}>Closest: label</button>
  <button onclick={() => void reload()}>Reload shared project</button>
</nav>
{#if loading}<p class="status" role="status">Loading authoritative project from /project…</p>{:else if error}<p class="status" role="alert" data-testid="project-error">{error}</p>{/if}
{#if snapshot}
  {#key snapshot}
    <div class="integrated-workspace" data-testid="shared-workspace">
      <div class="scene-source">{#if mode === 'demo'}<Demo {snapshot} />{:else if mode === 'toronto'}<Toronto />{:else}<ClosestPole />{/if}</div>
      <Chat {snapshot} />
    </div>
  {/key}
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #0b1220; color: #e4ecf7; font: 15px/1.5 system-ui, sans-serif; }
  nav { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px 28px; }
  button { color: #e4ecf7; background: #1c2a40; border: 1px solid #344660; border-radius: 7px; padding: 10px 16px; cursor: pointer; }
  button[aria-pressed="true"] { border-color: #72d9cd; }
  button:focus-visible { outline: 2px solid #ffc766; }
  .integrated-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 380px; }
  .scene-source { min-width: 0; } .status { padding: 12px 28px; }
  @media (max-width: 1000px) { .integrated-workspace { grid-template-columns: 1fr; } }
</style>
