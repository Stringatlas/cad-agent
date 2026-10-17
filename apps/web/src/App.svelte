<script lang="ts">
  import { onMount } from 'svelte';
  import Demo from './Demo.svelte';
  import Toronto from './Toronto.svelte';
  import ClosestPole from './ClosestPole.svelte';
  import Chat from './Chat.svelte';
  import ProposalReview from './ProposalReview.svelte';
  import ProviderAccount from './ProviderAccount.svelte';
  import { ProjectController, type ProjectView } from './project-client';
  import { createPointSequence, replaceDraftPoint, type TorontoDraftPoint } from './draft-context';
  import type { ScenePointReference, PointOverrideSnapshot, PointMoveProposal } from '@spatial/contracts';
  import { verifiedNearestSelection } from './point-override-client';
  let pointOverrides = $state<PointOverrideSnapshot>();
  let pointPreview = $state<PointMoveProposal>();
  let torontoRevision = $state<string>();
  let pointRefresh = $state(0), pointBlocked = $state(true);
  let cadRefresh = $state(0), torontoStreaming = $state(false), torontoCadBlocked = $state(true);
  let sourceGeneration = 0;
  async function selectVerified(context: unknown) {
    const generation = sourceGeneration, binding = JSON.stringify(points);
    try {
      const result = await verifiedNearestSelection(context, points);
      if (generation !== sourceGeneration || binding !== JSON.stringify(points) || result.point.artifactRevision !== torontoRevision) throw new Error('Result context changed; select a fresh result.');
      if (mode !== 'toronto') switchSource('toronto');
      pinToronto({ ...result.point, name: pointSequence.allocate() });
    } catch (error) { pointStatus = String(error); }
  }
  function addQueryPoint(point: Omit<TorontoDraftPoint, 'name'>) {
    if (mode !== 'toronto' || point.artifactRevision !== torontoRevision) { pointStatus = 'Stale query result; select a fresh source.'; return; }
    pinToronto({ ...point, name: pointSequence.allocate() });
  }
  import type { VisualModelSource } from './visual-model-source';
  let visualSource = $state<VisualModelSource>();
  let mode = $state<'demo' | 'toronto' | 'pole'>('toronto');
  let chatOpen = $state(true);
  let points = $state<readonly TorontoDraftPoint[]>([]);
  const pointSequence = createPointSequence();
  let pointStatus = $state('');
  function pinToronto(point: TorontoDraftPoint) {
    try { points = replaceDraftPoint(points, point); pointStatus = ''; }
    catch (error) { pointStatus = (error as Error).message; }
  }
  function pinSynthetic(point: Omit<ScenePointReference, 'name'>) {
    controller.pin({ ...point, name: pointSequence.allocate() });
  }
  let view = $state<ProjectView>({ selectedId: null, points: [], needsRefresh: false, status: 'Loading authoritative project…', undoAvailable: false });
  const controller = new ProjectController(value => view = value);
  function switchSource(next: typeof mode) { controller.setModelProposalScope(next === 'demo'); if (mode !== next) { sourceGeneration++; points = []; pointStatus = ''; visualSource = undefined; pointOverrides = undefined; pointPreview = undefined; torontoRevision = undefined; } mode = next; }
  onMount(() => { if (window.matchMedia('(max-width: 640px)').matches) chatOpen = false; void controller.refresh(); return () => controller.dispose(); });
</script>

<svelte:head><title>Spatial · Scene workspace</title></svelte:head>
<header class="workspace-header">
  <a class="brand" href="#workspace"><span class="brand-icon" aria-hidden="true">◇</span><span>Spatial</span></a>
  <nav aria-label="Scene source">
    <button aria-pressed={mode === 'toronto'} onclick={() => switchSource('toronto')}>Toronto3D</button>
    <button aria-pressed={mode === 'demo'} onclick={() => switchSource('demo')}>Synthetic</button>
    <button aria-pressed={mode === 'pole'} onclick={() => switchSource('pole')}>Find nearest</button>
  </nav>
  <div class="header-actions"><button class="chat-toggle" aria-label="Toggle chat" aria-pressed={chatOpen} onclick={() => chatOpen = !chatOpen}>Chat</button><ProviderAccount /></div>
</header>
<div id="workspace" class="integrated-workspace" class:chat-closed={!chatOpen} data-testid="shared-workspace">
  <div class="scene-source">
    {#if mode === 'toronto'}
      <Toronto {pointOverrides} {pointPreview} {pointRefresh} onpointstate={(snapshot, proposal, blocked) => { pointOverrides = snapshot; pointPreview = proposal; pointBlocked = !!blocked; }} {cadRefresh} modelStreaming={torontoStreaming} oncadblocked={value => torontoCadBlocked = value} onrevision={value => { if (torontoRevision && torontoRevision !== value) { sourceGeneration++; pointOverrides = undefined; pointPreview = undefined; points = []; } torontoRevision = value; }} onvisualsource={value => visualSource = value} {points} allocatePointName={() => pointSequence.allocate()} onpoint={pinToronto} onpoints={value => { points = value; pointStatus = ''; }} />
    {:else if mode === 'demo'}
      {#if view.snapshot}
        {#key view.snapshot}<Demo onvisualsource={value => visualSource = value} snapshot={view.snapshot} selectedId={view.selectedId} points={view.points} proposal={view.proposal} modelProposals={view.modelProposals} onselect={id => controller.select(id)} onpin={pinSynthetic} onremovepoint={name => controller.removePoint(name)} onclearpoints={() => controller.clearPoints()} />{/key}
      {:else}<section class="unavailable" role="status">Synthetic project unavailable. Open Project to refresh.</section>{/if}
    {:else}<ClosestPole />{/if}
    {#if mode === 'demo'}<ProposalReview {view} {controller} />{/if}
  </div>
  <div class="chat-shell" class:mobile-open={chatOpen}><Chat {pointBlocked} onpointproposal={() => pointRefresh++} {torontoCadBlocked} oncadproposal={() => cadRefresh++} ontorontostreaming={value => torontoStreaming = value} {pointOverrides} onverifiedresult={selectVerified} {visualSource} snapshot={view.snapshot} {view} {controller} sceneMode={mode} {points} {pointStatus} onclearpoint={name => { if (mode === 'demo') controller.removePoint(name); else { points = points.filter(point => point.name !== name); pointStatus = ''; } }} /></div>
</div>
<details class="project-controls" data-testid="project-controls">
  <summary title="Project controls">Project</summary>
  <div class="project-panel"><div class="project-actions">
    <button onclick={() => { points = []; void controller.refresh(); }}>Reload shared project</button>
    <button data-testid="project-save" disabled={!view.snapshot || !!view.pending || view.needsRefresh || view.modelStreaming} onclick={() => void controller.save()}>Save project</button>
    <button data-testid="project-load" disabled={!view.snapshot || !!view.pending || view.needsRefresh || view.modelStreaming} onclick={() => { if (confirm('Load the last explicitly saved geometry? This discards unsaved geometry and clears selections, proposals and undo history.')) { points = []; void controller.load(); } }}>Load saved project</button>
  </div>
  <section class="status" aria-live="polite">
    <p data-testid="project-status">{view.status}</p>
    <p data-testid="project-persistence">{view.session ? (view.session.dirty ? 'Unsaved geometry — explicit Save required.' : `Saved geometry · revision ${view.session.savedRevision}`) : 'Persistence status unknown.'}
      {#if view.session} · Next undo: {view.session.nextUndoTransactionId ?? 'none'}{/if}</p>
    {#if view.needsRefresh}<p role="alert">Editing blocked. Explicit Reload shared project required; no automatic mutation retry.</p>{/if}
    {#if !view.snapshot && !view.pending}<p role="alert" data-testid="project-error">Project server unavailable or invalid snapshot. No local fallback. Start the local server and reload.</p>{/if}
  </section></div>
</details>
{#if view.needsRefresh}<p class="authority-alert" role="alert">Synthetic editing blocked — refresh required in Project &amp; persistence. Toronto draft remains separate.</p>{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body), :global(#app) { width: 100%; height: 100%; overflow: hidden; }
  :global(body) { margin: 0; background: #151619; color: #f2f2f5; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(#app) { display: flex; flex-direction: column; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  :global(:is(button, input, select, textarea, summary, a):focus-visible) { outline: 2px solid #78acff; outline-offset: 3px; }
  :global(summary) { cursor: pointer; }
  :global(button:disabled) { cursor: not-allowed; }
  .workspace-header { position: relative; z-index: 20; flex: 0 0 58px; display: flex; align-items: center; gap: 24px; padding: 0 20px; border-bottom: 1px solid #ffffff12; background: #202124; }
  .brand { display: flex; gap: 8px; align-items: center; color: inherit; text-decoration: none; font-size: 17px; font-weight: 600; letter-spacing: -.5px; }
  .brand-icon { color: #d7d9df; font-size: 27px; line-height: 1; }
  nav { display: flex; gap: 2px; padding: 3px; background: #151619; border-radius: 9px; }
  button { color: #b4b5be; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 5px 12px; cursor: pointer; white-space: nowrap; }
  button:hover { color: #fff; background: #ffffff0c; } button[aria-pressed="true"] { color: #fff; background: #36373d; box-shadow: 0 1px 4px #0003; }
  button:disabled { opacity: .45; }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; padding-right: 65px; }
  .integrated-workspace { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; overflow: hidden; }
  .integrated-workspace.chat-closed { grid-template-columns: minmax(0, 1fr); }
  .chat-closed .chat-shell { display: none; }
  .scene-source, .chat-shell { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  .chat-shell { border-left: 1px solid #ffffff12; }
  .scene-source { position: relative; background: #151619; }
  .unavailable { padding: 32px; color: #b3b4be; }
  .project-controls { position: fixed; right: 20px; top: 15px; z-index: 30; font-size: 12px; }
  .project-controls > summary { list-style: none; color: #b9bac3; padding: 3px 0; } .project-controls > summary::-webkit-details-marker { display: none; }
  .project-panel { position: absolute; right: 0; top: 40px; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 90px); overflow: auto; padding: 18px; border: 1px solid #ffffff20; border-radius: 14px; background: #202124; box-shadow: 0 16px 50px #0006; }
  .project-actions { display: flex; gap: 6px; flex-wrap: wrap; } .project-actions button { border-color: #ffffff20; }
  .status p { margin: 12px 0 0; overflow-wrap: anywhere; color: #a7a8b2; } .authority-alert { position: fixed; bottom: 16px; left: 16px; max-width: min(500px, 90vw); z-index: 25; color: #ffd187; background: #29251e; border: 1px solid #735c35; padding: 12px; border-radius: 10px; font-size: 12px; }
  @media (min-width: 1600px) { .integrated-workspace { grid-template-columns: minmax(0, 1fr) 390px; } }
  @media (max-width: 900px) { .workspace-header { gap: 12px; padding: 0 12px; } .brand > span:last-child { display: none; } .header-actions { gap: 5px; padding-right: 60px; } nav button { padding: 5px 8px; font-size: 11px; } }
  @media (max-width: 640px) {
    .workspace-header { flex-basis: 96px; align-content: center; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
    .brand > span:last-child { display: inline; } .brand { font-size: 15px; }
    nav { order: 3; width: 100%; } nav button { flex: 1; }
    .header-actions { padding-right: 58px; } .project-controls { right: 12px; top: 16px; }
    .integrated-workspace { display: block; }
    .chat-shell { display: none; }
    .chat-shell.mobile-open { display: block; position: absolute; z-index: 10; right: 8px; bottom: 8px; width: calc(100% - 16px); height: 68%; border: 1px solid #ffffff24; border-radius: 18px; box-shadow: 0 12px 45px #0008; }
  }
</style>
