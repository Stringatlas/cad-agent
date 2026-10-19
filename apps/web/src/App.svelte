<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveAgentTorontoPoint } from './agent-reference';
  import Demo from './Demo.svelte';
  import Toronto from './Toronto.svelte';
  import ClosestPole from './ClosestPole.svelte';
  import Chat from './Chat.svelte';
  import ProposalReview from './ProposalReview.svelte';
  import ProviderAccount from './ProviderAccount.svelte';
  import { ProjectController, type ProjectView } from './project-client';
  import { createPointSequence, replaceDraftPoint, type TorontoDraftPoint } from './draft-context';
  import type { ScenePointReference, PointOverrideSnapshot, PointMoveProposal, ModelReferenceSelection } from '@spatial/contracts';
  import { authoredReference } from './scene-object-client';
  import type { SceneObjectSnapshot, AuthoredObjectReference } from '@spatial/contracts';
  let objectRefresh = $state(0), objectBlocked = $state(true);
  let objectSnapshot = $state<SceneObjectSnapshot>(), selectedObjectId = $state<string>();
  const selectedObject = $derived(objectSnapshot?.objects.find(object => object.id === selectedObjectId));
  const objectReferences = $derived<AuthoredObjectReference[]>(selectedObject && objectSnapshot ? [authoredReference(objectSnapshot, selectedObject)] : []);
  import { verifiedNearestSelection } from './point-override-client';
  import { placementWitnessSelection, type PlacementWitnessSelection } from './utility-box-evidence';
  let pointOverrides = $state<PointOverrideSnapshot>();
  let pointPreview = $state<PointMoveProposal>();
  let torontoRevision = $state<string>();
  let pointRefresh = $state(0), pointBlocked = $state(true);
  let cadRefresh = $state(0), torontoStreaming = $state(false), torontoCadBlocked = $state(true);
  let sourceGeneration = 0;
  let toronto = $state<Toronto>();
  async function selectAgentReference(reference: ModelReferenceSelection, isCurrent: () => boolean) {
    const generation = sourceGeneration, selectedMode = mode;
    if (!isCurrent()) throw new Error('Scene changed.');
    if (reference.kind === 'toronto-point') {
      const revision = torontoRevision, previous = points;
      if (mode !== 'toronto' || !revision) throw new Error('Toronto source unavailable.');
      const point = await resolveAgentTorontoPoint(reference, revision, AbortSignal.timeout(5000));
      if (!isCurrent() || generation !== sourceGeneration || mode !== selectedMode || revision !== torontoRevision || points !== previous) throw new Error('Scene changed during source lookup.');
      points = replaceDraftPoint(points, { ...point, name: pointSequence.allocate() }); pointStatus = '';
    } else {
      if (mode !== 'demo') throw new Error('Synthetic source unavailable.');
      const entity = controller.view.snapshot?.project.entities.find(entity => entity.id === reference.entityId);
      const position = entity?.kind === 'point-cloud' ? entity.points[reference.pointIndex] : undefined;
      if (!position || !isCurrent() || !controller.pin({ entityId: reference.entityId, pointIndex: reference.pointIndex, position, name: pointSequence.allocate() })) throw new Error('Original project point unavailable.');
    }
  }
  async function refreshAgentAuthorities() {
    const generation = sourceGeneration, selectedMode = mode;
    if (mode === 'toronto') {
      if (!toronto) throw new Error('Toronto authority unavailable.');
      await toronto.refreshAgentAuthorities();
    } else if (mode === 'demo') await controller.refreshAgentAuthority();
    else throw new Error('Authority unavailable.');
    if (generation !== sourceGeneration || selectedMode !== mode) throw new Error('Scene changed during authority refresh.');
  }
  async function selectVerified(context: unknown) {
    const generation = sourceGeneration, binding = JSON.stringify(points);
    try {
      const point = (context as { kind?: string })?.kind === 'utility-box-witness'
        ? await placementWitnessSelection(context as PlacementWitnessSelection, points)
        : (await verifiedNearestSelection(context, points)).point;
      if (generation !== sourceGeneration || binding !== JSON.stringify(points) || point.artifactRevision !== torontoRevision) throw new Error('Result context changed; select a fresh result.');
      if (mode !== 'toronto') switchSource('toronto');
      pinToronto({ ...point, name: pointSequence.allocate() });
    } catch (error) { pointStatus = String(error); }
  }
  function addQueryPoint(point: Omit<TorontoDraftPoint, 'name'>) {
    if (mode !== 'toronto' || point.artifactRevision !== torontoRevision) { pointStatus = 'Stale query result; select a fresh source.'; return; }
    pinToronto({ ...point, name: pointSequence.allocate() });
  }
  import type { VisualModelSource } from './visual-model-source';
  import type { AreaOfInterestInput } from './area-of-interest';
  let areaInput = $state<AreaOfInterestInput>();
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
  function switchSource(next: typeof mode) { controller.setModelProposalScope(next === 'demo'); if (mode !== next) { sourceGeneration++; areaInput = undefined; points = []; pointStatus = ''; visualSource = undefined; pointOverrides = undefined; pointPreview = undefined; objectSnapshot = undefined; selectedObjectId = undefined; objectBlocked = true; torontoRevision = undefined; } mode = next; }
  onMount(() => { if (window.matchMedia('(max-width: 640px)').matches) chatOpen = false; void controller.refresh(); return () => controller.dispose(); });
</script>

<svelte:head><title>Spatial · Scene workspace</title></svelte:head>
<header class="workspace-header" class:synthetic={mode === 'demo'}>
  <a class="brand" href="#workspace"><span class="brand-icon" aria-hidden="true">◇</span><span>Spatial</span></a>
  <select class="workspace-select" aria-label="Scene source" value={mode} onchange={event => switchSource(event.currentTarget.value as typeof mode)}>
    <option value="toronto">Toronto3D</option>
    <option value="demo">Synthetic sandbox</option>
    <option value="pole">Find nearest</option>
  </select>
  <div class="header-actions"><button class="chat-toggle" aria-label="Toggle chat" aria-pressed={chatOpen} onclick={() => chatOpen = !chatOpen}>Chat</button><ProviderAccount /></div>
</header>
<div id="workspace" class="integrated-workspace" class:chat-closed={!chatOpen} data-testid="shared-workspace">
  <div class="scene-source">
    {#if mode === 'toronto'}
      <Toronto bind:this={toronto} {objectRefresh} onobjectstate={(snapshot, selectedId, blocked) => { objectSnapshot = snapshot; selectedObjectId = selectedId; objectBlocked = blocked; }} onarea={value => areaInput = value} {pointOverrides} {pointPreview} {pointRefresh} onpointstate={(snapshot, proposal, blocked) => { pointOverrides = snapshot; pointPreview = proposal; pointBlocked = !!blocked; }} {cadRefresh} modelStreaming={torontoStreaming} oncadblocked={value => torontoCadBlocked = value} onrevision={value => { if (torontoRevision && torontoRevision !== value) { sourceGeneration++; pointOverrides = undefined; pointPreview = undefined; points = []; } torontoRevision = value; }} onvisualsource={value => visualSource = value} {points} allocatePointName={() => pointSequence.allocate()} onpoint={pinToronto} onpoints={value => { points = value; pointStatus = ''; }} />
    {:else if mode === 'demo'}
      {#if view.snapshot}
        {#key view.snapshot}<Demo onvisualsource={value => visualSource = value} snapshot={view.snapshot} selectedId={view.selectedId} points={view.points} proposal={view.proposal} modelProposals={view.modelProposals} onselect={id => controller.select(id)} onpin={pinSynthetic} onremovepoint={name => controller.removePoint(name)} onclearpoints={() => controller.clearPoints()} />{/key}
      {:else}<section class="unavailable" role="status">Synthetic project unavailable. Open Project to refresh.</section>{/if}
    {:else}<ClosestPole />{/if}
    {#if mode === 'demo'}<ProposalReview {view} {controller} />{/if}
  </div>
  <div class="chat-shell" class:mobile-open={chatOpen}><Chat {objectReferences} {selectedObject} onclearobject={() => toronto?.clearObjectSelection()} {objectBlocked} onobjectproposal={() => objectRefresh++} onselectreference={selectAgentReference} onauthorityrefresh={refreshAgentAuthorities} {areaInput} {pointBlocked} onpointproposal={() => pointRefresh++} {torontoCadBlocked} oncadproposal={() => cadRefresh++} ontorontostreaming={value => torontoStreaming = value} {pointOverrides} onverifiedresult={selectVerified} {visualSource} snapshot={view.snapshot} {view} {controller} sceneMode={mode} {points} {pointStatus} onclearpoint={name => { if (mode === 'demo') controller.removePoint(name); else { points = points.filter(point => point.name !== name); pointStatus = ''; } }} /></div>
</div>
{#if mode === 'demo'}
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
{#if view.needsRefresh}<p class="authority-alert" role="alert">Synthetic editing blocked. Reload the shared project in Project to continue.</p>{/if}
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body), :global(#app) { width: 100%; height: 100%; overflow: hidden; }
  :global(body) { margin: 0; background: #151619; color: #f2f2f5; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(#app) { display: flex; flex-direction: column; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  :global(canvas:focus-visible) { outline: 2px solid #78acff; outline-offset: -3px; }
  :global(:is(button, input, select, textarea, summary, a):focus-visible) { outline: 2px solid #78acff; outline-offset: 3px; }
  :global(summary) { cursor: pointer; }
  :global(button:disabled) { cursor: not-allowed; }
  .workspace-header { position: relative; z-index: 20; flex: 0 0 58px; display: flex; align-items: center; gap: 24px; padding: 0 20px; border-bottom: 1px solid #ffffff12; background: #202124; }
  .brand { display: flex; gap: 8px; align-items: center; color: inherit; text-decoration: none; font-size: 17px; font-weight: 600; letter-spacing: -.5px; }
  .brand-icon { color: #d7d9df; font-size: 27px; line-height: 1; }
  .workspace-select { max-width: 190px; color: #eeeef2; background: #292a2e; border: 1px solid #ffffff18; border-radius: 7px; padding: 7px 10px; cursor: pointer; }
  button { color: #b4b5be; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 5px 12px; cursor: pointer; white-space: nowrap; }
  button:hover { color: #fff; background: #ffffff0c; } button[aria-pressed="true"] { color: #fff; background: #36373d; box-shadow: 0 1px 4px #0003; }
  button:disabled { opacity: .45; }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .synthetic .header-actions { padding-right: 65px; }
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
  @media (pointer: coarse) { .workspace-select, .chat-toggle { min-height: 44px; } .project-controls > summary { min-height: 32px; } }
  @media (min-width: 1600px) { .integrated-workspace { grid-template-columns: minmax(0, 1fr) 390px; } }
  @media (max-width: 900px) { .workspace-header { gap: 12px; padding: 0 12px; } .brand > span:last-child { display: none; } .header-actions { gap: 5px; } .workspace-select { max-width: 170px; font-size: 12px; } }
  @media (max-width: 640px) {
    .workspace-header { flex-basis: 58px; gap: 8px; padding: 8px 12px; }
    .brand { font-size: 15px; }
    .workspace-select { max-width: 145px; min-width: 0; }
    .synthetic { flex-basis: 96px; flex-wrap: wrap; }
    .synthetic .header-actions { padding-right: 0; }
    .project-controls { right: 12px; top: 60px; }
    .workspace-select { flex: 1; }
    .header-actions { gap: 2px; }
    .integrated-workspace { display: block; }
    .chat-shell { display: none; }
    .chat-shell.mobile-open { display: block; position: absolute; z-index: 10; right: 8px; bottom: 8px; width: calc(100% - 16px); height: 68%; border: 1px solid #ffffff24; border-radius: 18px; box-shadow: 0 12px 45px #0008; }
    .integrated-workspace:has(:global(.approval-review)) .chat-shell.mobile-open { top: 8px; bottom: auto; height: calc(60% - 16px); }
  }
  @media (max-width: 640px) and (max-height: 650px) {
    .integrated-workspace:has(:global(.approval-review)) .chat-shell.mobile-open :global(.chat) { overflow-y: auto; overscroll-behavior: contain; }
    .integrated-workspace:has(:global(.approval-review)) .chat-shell.mobile-open :global(.model-chat) { flex-shrink: 0; min-height: 260px; }
  }
</style>
