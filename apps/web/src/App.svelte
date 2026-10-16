<script lang="ts">
  import { onMount } from 'svelte';
  import Demo from './Demo.svelte';
  import Toronto from './Toronto.svelte';
  import ClosestPole from './ClosestPole.svelte';
  import Chat from './Chat.svelte';
  import ProviderAccount from './ProviderAccount.svelte';
  import { ProjectController, type ProjectView } from './project-client';
  import type { PointName, TorontoDraftPoint } from './draft-context';
  let mode = $state<'demo' | 'toronto' | 'pole'>('toronto');
  let points = $state<readonly TorontoDraftPoint[]>([]);
  let pinName = $state<PointName>('A');
  let view = $state<ProjectView>({ selectedId: null, points: [], needsRefresh: false, status: 'Loading authoritative project…', undoAvailable: false });
  const controller = new ProjectController(value => view = value);
  function switchSource(next: typeof mode) { if (mode !== next) points = []; mode = next; }
  onMount(() => { void controller.refresh(); return () => controller.dispose(); });
</script>

<svelte:head><title>Spatial · Scene workspace</title></svelte:head>
<header class="workspace-header">
  <a class="brand" href="#workspace"><span class="brand-icon" aria-hidden="true">◇</span><span>Spatial <small>SCENE WORKSPACE</small></span></a>
  <nav aria-label="Scene source">
    <button aria-pressed={mode === 'toronto'} onclick={() => switchSource('toronto')}>Toronto3D preview</button>
    <button aria-pressed={mode === 'demo'} onclick={() => switchSource('demo')}>Synthetic demo</button>
    <button aria-pressed={mode === 'pole'} onclick={() => switchSource('pole')}>Closest: label</button>
  </nav>
  <ProviderAccount />
</header>
<div id="workspace" class="integrated-workspace" data-testid="shared-workspace">
  <div class="scene-source">
    {#if mode === 'toronto'}
      <Toronto {points} {pinName} onpinname={name => pinName = name} onpoints={value => points = value} />
    {:else if mode === 'demo'}
      {#if view.snapshot}
        {#key view.snapshot}<Demo snapshot={view.snapshot} selectedId={view.selectedId} points={view.points} proposal={view.proposal} onselect={id => controller.select(id)} onpin={point => controller.pin(point)} onclearpoints={() => controller.clearPoints()} />{/key}
      {:else}<section class="unavailable" role="status">Synthetic project unavailable. Open project controls below to refresh; no local fallback.</section>{/if}
    {:else}<ClosestPole />{/if}
  </div>
  <Chat snapshot={view.snapshot} {view} {controller} sceneMode={mode} {points} {pinName} onpinname={name => pinName = name} onclearpoint={name => points = points.filter(point => point.name !== name)} />
</div>
<details class="project-controls" data-testid="project-controls">
  <summary>Project &amp; persistence <span>Separate synthetic authority · explicit Save / Load</span></summary>
  <div class="project-actions">
    <button onclick={() => { points = []; void controller.refresh(); }}>Reload shared project</button>
    <button data-testid="project-save" disabled={!view.snapshot || !!view.pending || view.needsRefresh} onclick={() => void controller.save()}>Save project</button>
    <button data-testid="project-load" disabled={!view.snapshot || !!view.pending || view.needsRefresh} onclick={() => { if (confirm('Load the last explicitly saved geometry? This discards unsaved geometry and clears selections, proposals and undo history.')) { points = []; void controller.load(); } }}>Load saved project</button>
  </div>
  <section class="status" aria-live="polite">
    <p data-testid="project-status">{view.status}</p>
    <p data-testid="project-persistence">{view.session ? (view.session.dirty ? 'Unsaved geometry — explicit Save required.' : `Saved geometry · revision ${view.session.savedRevision}`) : 'Persistence status unknown.'}
      {#if view.session} · Next undo: {view.session.nextUndoTransactionId ?? 'none'}{/if}</p>
    {#if view.needsRefresh}<p role="alert">Editing blocked. Explicit Reload shared project required; no automatic mutation retry.</p>{/if}
    {#if !view.snapshot && !view.pending}<p role="alert" data-testid="project-error">Project server unavailable or invalid snapshot. No local fallback. Start the local server and reload.</p>{/if}
  </section>
</details>
{#if view.needsRefresh}<p class="authority-alert" role="alert">Synthetic editing blocked — refresh required in Project &amp; persistence. Toronto draft remains separate.</p>{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #0b111b; color: #e4ecf7; font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  :global(button:focus-visible), :global(input:focus-visible), :global(select:focus-visible), :global(textarea:focus-visible), :global(summary:focus-visible), :global(a:focus-visible) { outline: 2px solid #7de4d3; outline-offset: 3px; }
  :global(summary) { cursor: pointer; }
  :global(button:disabled) { cursor: not-allowed; }
  .workspace-header { display: flex; align-items: center; gap: 24px; padding: 16px 24px; border-bottom: 1px solid #243043; }
  .brand { display: flex; gap: 10px; align-items: center; color: inherit; text-decoration: none; font-size: 19px; font-weight: 650; white-space: nowrap; }
  .brand-icon { color: #89e5d3; font-size: 32px; line-height: 1; } small { display: block; color: #8797ad; font-size: 9px; letter-spacing: 1.7px; }
  nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid #263449; border-radius: 9px; }
  button { color: #b8c8dd; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 7px 12px; cursor: pointer; }
  button:hover { color: #fff; background: #1d2c40; } button[aria-pressed="true"] { color: #c6f4e9; background: #233d42; border-color: #3e6868; }
  button:disabled { opacity: .45; }
  .integrated-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 390px); gap: 1px; background: #243043; border-bottom: 1px solid #243043; align-items: start; }
  .scene-source { min-width: 0; background: #0b111b; }
  .unavailable { min-height: 65vh; padding: 32px; }
  .project-controls { padding: 12px 24px; color: #a0b2c9; font-size: 12px; }
  summary { font-weight: 600; } summary span { font-weight: 400; color: #71859f; margin-left: 12px; }
  .project-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; } .project-actions button { border-color: #344660; }
  .status p { margin: 6px 0; overflow-wrap: anywhere; } .authority-alert { color: #ffd187; padding: 0 24px; font-size: 12px; }
  @media (min-width: 1600px) { .integrated-workspace { grid-template-columns: minmax(0, 1fr) 420px; } }
  @media (max-width: 1000px) { .workspace-header { gap: 12px; flex-wrap: wrap; padding: 12px 16px; } .integrated-workspace { grid-template-columns: minmax(0, 1fr) 330px; } }
  @media (max-width: 760px) { .integrated-workspace { grid-template-columns: minmax(0, 1fr); } .workspace-header { gap: 12px; } nav { order: 3; width: 100%; } nav button { flex: 1; font-size: 12px; padding: 7px; } summary span { display: block; margin-left: 16px; } }
</style>
