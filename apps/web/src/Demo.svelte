<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveEntity, selectEntity, localToWorld } from '@spatial/project-state';
  import type { ProjectSnapshot } from '@spatial/contracts';
  import { createViewer } from './viewer';

  let { snapshot }: { snapshot: ProjectSnapshot } = $props();
  // Selection is disposable view state over the fetched geometry snapshot.
  let selectedId = $state<string | null>(null);
  const project = $derived(selectEntity(snapshot.project, selectedId));
  let host: HTMLDivElement;
  let error = $state('');
  let viewer: ReturnType<typeof createViewer> | undefined;
  const selected = $derived(project.selectedEntityId ? resolveEntity(project, project.selectedEntityId) : undefined);
  function select(id: string | null) {
    selectedId = id;
    viewer?.updateSelection(project);
  }
  onMount(() => {
    try { viewer = createViewer(host, project, select); }
    catch (cause) { error = String(cause); console.error(cause); }
    return () => viewer?.dispose();
  });
</script>

<svelte:head><title>Spatial CAD harness · viewer</title></svelte:head>
<main>
  <header><div><p class="eyebrow">SPATIAL CAD HARNESS / FOUNDATION</p><h1>Inspect a scene. Verify a proposal.</h1></div><span class="badge">Revision {project.revision}</span></header>
  <section class="workspace">
    <div class="scene-panel">
      <div class="toolbar"><strong>Local scene</strong><span>Orbit: drag · Zoom: scroll · Select: click</span></div>
      <div class="viewport" bind:this={host} data-testid="viewer"></div>
      {#if error}<p class="error" role="alert">Viewer unavailable: {error}</p>{/if}
      <div class="legend">X <span class="red">red</span> / Y <span class="green">green</span> / Z <span class="blue">blue</span> · XY ground · meters</div>
    </div>
    <aside>
      <h2>Authoritative entities</h2>
      {#each project.entities as entity}
        <button class:active={project.selectedEntityId === entity.id} onclick={() => select(entity.id)} aria-pressed={project.selectedEntityId === entity.id}>
          <strong>{entity.id}</strong><span>{entity.kind === 'box' ? 'Proposed box · mesh placeholder' : `Synthetic cloud · ${entity.points.length} points`}</span>
        </button>
      {/each}
      <button class="clear" onclick={() => select(null)}>Clear selection</button>
      <h2>Selection</h2>
      <p data-testid="selected-id" aria-live="polite">{project.selectedEntityId ?? 'None'}</p>
      {#if selected?.kind === 'box'}
        <dl><dt>Dimensions (X / Y / Z)</dt><dd>{selected.dimensions.join(' / ')} m</dd><dt>Local center</dt><dd>{selected.center.join(', ')} m</dd><dt>World center</dt><dd>{localToWorld(selected.center, project.coordinates).join(', ')} m</dd></dl>
      {/if}
      <h2>Shared server snapshot</h2>
      <p data-testid="viewer-project-binding">Session {snapshot.sessionId}<br />Frame {snapshot.frameId} · geometry revision {project.revision}</p>
      <h2>Coordinate metadata</h2>
      <dl><dt>Units / frame</dt><dd>Meters (m) · right-handed · Z-up</dd><dt>Local origin in world</dt><dd>{project.coordinates.localOrigin.join(', ')} m</dd><dt>World conversion</dt><dd>world = local + origin</dd></dl>
      <p class="note">The box is a parameterized rendering placeholder, <strong>not an OpenCascade body</strong>. No CAD edits or model integration yet.</p>
    </aside>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #0b1220; color: #e4ecf7; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1600px; margin: auto; padding: 28px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
  .eyebrow { color: #72d9cd; font-size: 11px; letter-spacing: 2px; margin: 0; }
  h1 { font-size: clamp(22px, 3vw, 34px); margin: 8px 0 0; font-weight: 600; }
  .badge { border: 1px solid #344660; border-radius: 20px; padding: 6px 14px; white-space: nowrap; }
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 240px; border: 1px solid #2b3b53; border-radius: 12px; overflow: hidden; }
  .scene-panel { min-width: 0; background: #101927; }
  .toolbar, .legend { padding: 12px 18px; display: flex; justify-content: space-between; gap: 12px; color: #a1b3ca; font-size: 12px; }
  .viewport { width: 100%; height: 64vh; min-height: 340px; }
  :global(canvas) { display: block; touch-action: none; }
  aside { background: #151f30; padding: 20px; }
  h2 { font-size: 13px; color: #a1b3ca; margin: 20px 0 10px; }
  h2:first-child { margin-top: 0; }
  button { display: block; width: 100%; text-align: left; color: #e4ecf7; background: #1c2a40; border: 1px solid #344660; border-radius: 7px; padding: 12px; margin: 8px 0; cursor: pointer; }
  button span { display: block; font-size: 11px; color: #a1b3ca; }
  button.active { border-color: #ffc766; background: #3a3428; }
  button.clear { background: transparent; padding: 7px 12px; }
  button:hover { border-color: #a1b3ca; }
  button:focus-visible { outline: 2px solid #ffc766; outline-offset: 2px; }
  dt { color: #a1b3ca; font-size: 11px; margin-top: 10px; }
  dd { margin: 0; font-size: 13px; }
  .note { color: #a1b3ca; font-size: 12px; border-top: 1px solid #344660; padding-top: 16px; }
  .legend { display: block; }
  .red { color: #ff6666; } .green { color: #66dd88; } .blue { color: #7799ff; }
  .error { color: #ff8888; padding: 12px; }
  @media (max-width: 800px) { main { padding: 12px; } .workspace { grid-template-columns: 1fr; } .toolbar { flex-direction: column; } .viewport { height: 50vh; } }
</style>
