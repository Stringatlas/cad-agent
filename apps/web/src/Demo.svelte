<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveEntity, selectEntity, localToWorld } from '@spatial/project-state';
  import type { ProjectSnapshot, ScenePointName, ScenePointReference, BoxProposal } from '@spatial/contracts';
  import { createViewer } from './viewer';
  import VisualObservationPanel from './VisualObservationPanel.svelte';
  import type { VisualModelSource } from './visual-model-source';

  let { snapshot, selectedId, points, proposal, modelProposals = [], onselect, onpin, onremovepoint, onclearpoints, onvisualsource = () => {} }: {
    onvisualsource?: (source: VisualModelSource | undefined) => void;
    snapshot: ProjectSnapshot; selectedId: string | null; points: readonly ScenePointReference[]; proposal?: BoxProposal; modelProposals?: readonly BoxProposal[];
    onselect: (id: string | null) => void; onpin: (point: Omit<ScenePointReference, 'name'>) => void;
    onremovepoint: (name: ScenePointName) => void; onclearpoints: () => void;
  } = $props();
  // Selection and numbered pins are disposable view state, shared with chat, never geometry.
  const project = $derived(selectEntity(snapshot.project, selectedId));
  let host: HTMLDivElement;
  let error = $state('');
  let viewer: ReturnType<typeof createViewer> | undefined;
  const selected = $derived(project.selectedEntityId ? resolveEntity(project, project.selectedEntityId) : undefined);
  function select(id: string | null) { onselect(id); }
  let mounted = $state(false);
  $effect(() => { if (mounted) { viewer?.updateSelection(project); viewer?.updateOverlays(points, proposal, modelProposals); } });
  onMount(() => {
    try {
      viewer = createViewer(host, project, select, point => onpin(point),
        cause => error = String(cause), () => error = '', { sessionId: snapshot.sessionId, frameId: snapshot.frameId });
      mounted = true;
      const current = viewer;
      onvisualsource({ capture: request => current.capture(request), isCurrent: id => current.isCaptureCurrent(id), resolvePixel: (id, x, y) => current.resolvePixel(id, x, y) });
    }
    catch (cause) { error = String(cause); console.error(cause); }
    return () => { mounted = false; onvisualsource(undefined); viewer?.dispose(); };
  });
</script>

<main>
  <section class="workspace">
    <div class="scene-panel">
      <div class="scene-label">Synthetic <span>Local · meters</span></div>
      <div class="viewport" bind:this={host} data-testid="viewer"></div>
      {#if error}<p class="error" role="alert">Render unavailable (authority/commit status is independent): {error}</p>{/if}

    </div>
    <aside>
      <details data-testid="synthetic-scene-tools"><summary>Scene tools</summary>
      <div class="tools-content">
      <details class="help"><summary>Navigation help</summary><p>Click or Tab into the scene, then hold W/S to fly forward/back and A/D to strafe. Drag to orbit · Double-click a point or surface to set the orbit center · Scroll to zoom toward the pointer · Click to select · Cmd/Ctrl-click to pin.</p><p>X red · Y green · Z blue · XY ground · meters.</p></details>
      <h2>Entities</h2>
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
      <h2>Numbered synthetic points</h2>
      <p>Cmd/Ctrl-click adds a new numbered point for chat context.</p>
      {#each points as point (point.name)}
        <div data-testid={`point-${point.name}`}>
          <p>{point.name}: {point.entityId} / index {point.pointIndex}<br />[{point.position.join(', ')}] m (original binary64)</p>
          <button onclick={() => onremovepoint(point.name)} aria-label={`Remove ${point.name}`}>Remove {point.name}</button>
        </div>
      {/each}
      <button onclick={onclearpoints}>Clear all points</button>
      <h2>Shared server snapshot</h2>
      <p data-testid="viewer-project-binding">Session {snapshot.sessionId}<br />Frame {snapshot.frameId} · geometry revision {project.revision}</p>
      <h2>Coordinate metadata</h2>
      <dl><dt>Units / frame</dt><dd>Meters (m) · right-handed · Z-up</dd><dt>Local origin in world</dt><dd>{project.coordinates.localOrigin.join(', ')} m</dd><dt>World conversion</dt><dd>world = local + origin</dd></dl>
      <p class="note">The box is a parameterized rendering placeholder, <strong>not an OpenCascade body</strong>. Human-approved parameter edits only; model ghosts are not committed or CAD solids.</p>
      {#if mounted}<VisualObservationPanel label="Synthetic" capture={() => viewer!.capture()} isCurrent={id => viewer!.isCaptureCurrent(id)} resolvePixel={(id, x, y) => viewer!.resolvePixel(id, x, y)} />{/if}
      </div>
      </details>
    </aside>
  </section>
</main>

<style>
  main, .workspace, .scene-panel { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  main { color: #f5f5f7; background: #151619; overflow: hidden; }
  .viewport { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; }
  :global(canvas) { display: block; touch-action: none; }
  .scene-label { position: absolute; z-index: 1; top: 16px; left: 16px; padding: 9px 12px; border: 1px solid #ffffff12; border-radius: 12px; background: #202124ed; font-size: 12px; font-weight: 550; pointer-events: none; }
  .scene-label span { margin-left: 8px; font-size: 11px; color: #a8a9b0; font-weight: 400; }
  aside { position: absolute; z-index: 2; top: 16px; right: 16px; max-width: calc(100% - 32px); }
  aside > details { background: #202124f5; border: 1px solid #ffffff18; border-radius: 12px; box-shadow: 0 8px 32px #0003; }
  aside > details > summary { padding: 10px 14px; }
  aside > details[open] { width: 340px; max-width: 100%; }
  .tools-content { box-sizing: border-box; padding: 0 14px 14px; max-height: calc(100dvh - 180px); max-height: min(65dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  summary { color: #e8e8ed; font-size: 12px; cursor: pointer; }
  p, dd { overflow-wrap: anywhere; font-size: 12px; }
  h2 { font-size: 12px; color: #a8a9b0; margin: 20px 0 10px; font-weight: 500; }
  button { display: block; width: 100%; text-align: left; color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff1c; border-radius: 8px; padding: 10px; margin: 8px 0; cursor: pointer; }
  button span { display: block; font-size: 11px; color: #a8a9b0; }
  button.active { border-color: #5b9cff; background: #23344d; }
  button.clear { background: transparent; }
  button:hover { border-color: #72737b; }
  button:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  dt { color: #a8a9b0; font-size: 11px; margin-top: 10px; }
  dd { margin: 0; }
  .note { color: #a8a9b0; font-size: 11px; border-top: 1px solid #ffffff18; padding-top: 14px; }
  .help { margin-top: 8px; color: #a8a9b0; }
  .error { position: absolute; z-index: 1; left: 16px; right: 16px; bottom: 16px; margin: 0; color: #ffb2aa; background: #202124f5; border: 1px solid #ffb2aa44; border-radius: 10px; padding: 12px; overflow-wrap: anywhere; max-height: 30%; overflow-y: auto; }
  @media (max-width: 600px) { .scene-label { top: 12px; left: 12px; } .scene-label span { display: none; } aside { top: 12px; right: 12px; max-width: calc(100% - 24px); } }
</style>
