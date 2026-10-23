<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveAgentTorontoPoint } from './chat/agent-reference';
  import Toronto from './scenes/toronto/Toronto.svelte';
  import PointCloud from './scenes/point-cloud/PointCloud.svelte';
  import CloudChat from './chat/CloudChat.svelte';
  import type { PreparedSample, PreparedPoint } from './scenes/point-cloud/prepared-cloud-client';
  let cloudSample = $state<PreparedSample>(), cloudSelected = $state<PreparedPoint>();
  let cloudViewer = $state<PointCloud>();
  import ClosestPole from './scenes/toronto/inspection/ClosestPole.svelte';
  import Chat from './chat/Chat.svelte';
  import ProviderAccount from './auth/ProviderAccount.svelte';
  import { createPointSequence, replaceDraftPoint, type TorontoDraftPoint } from './chat/draft-context';
  import type { PointOverrideSnapshot, PointMoveProposal, ModelReferenceSelection } from '@spatial/contracts';
  import { authoredReference } from './scenes/toronto/objects/scene-object-client';
  import type { SceneObjectSnapshot, AuthoredObjectReference } from '@spatial/contracts';
  let objectRefresh = $state(0), objectBlocked = $state(true);
  let objectSnapshot = $state<SceneObjectSnapshot>(), selectedObjectId = $state<string>();
  const selectedObject = $derived(objectSnapshot?.objects.find(object => object.id === selectedObjectId));
  const objectReferences = $derived<AuthoredObjectReference[]>(selectedObject && objectSnapshot ? [authoredReference(objectSnapshot, selectedObject)] : []);
  import { verifiedNearestSelection } from './scenes/toronto/points/point-override-client';
  import { placementWitnessSelection, type PlacementWitnessSelection } from './scenes/toronto/placement/utility-box-evidence';
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
    }
  }
  async function refreshAgentAuthorities() {
    const generation = sourceGeneration, selectedMode = mode;
    if (mode === 'toronto') {
      if (!toronto) throw new Error('Toronto authority unavailable.');
      await toronto.refreshAgentAuthorities();
    }
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
  import type { VisualModelSource } from './chat/visual/visual-model-source';
  import type { AreaOfInterestInput } from './scenes/toronto/placement/area-of-interest';
  let areaInput = $state<AreaOfInterestInput>();
  let visualSource = $state<VisualModelSource>();
  let mode = $state<'cloud' | 'toronto' | 'pole'>('cloud');
  let chatOpen = $state(true);
  let points = $state<readonly TorontoDraftPoint[]>([]);
  const pointSequence = createPointSequence();
  let pointStatus = $state('');
  function pinToronto(point: TorontoDraftPoint) {
    try { points = replaceDraftPoint(points, point); pointStatus = ''; }
    catch (error) { pointStatus = (error as Error).message; }
  }
  function switchSource(next: typeof mode) { if (mode !== next) { sourceGeneration++; cloudSample = undefined; cloudSelected = undefined; areaInput = undefined; points = []; pointStatus = ''; visualSource = undefined; pointOverrides = undefined; pointPreview = undefined; objectSnapshot = undefined; selectedObjectId = undefined; objectBlocked = true; torontoRevision = undefined; } mode = next; }
  onMount(() => { if (window.matchMedia('(max-width: 640px)').matches) chatOpen = false;  });
</script>

<svelte:head><title>Workspace</title></svelte:head>
<header class="workspace-header">
  <select class="workspace-select" aria-label="Scene source" value={mode} onchange={event => switchSource(event.currentTarget.value as typeof mode)}>
    <option value="cloud">STPLS3D</option>
    <option value="toronto">Toronto3D</option>
    <option value="pole">Find nearest</option>
  </select>
  <div class="header-actions"><a class="tools-link" href="/tools">Tools</a><button class="chat-toggle" aria-label="Toggle chat" aria-pressed={chatOpen} onclick={() => chatOpen = !chatOpen}>Chat</button><ProviderAccount /></div>
</header>
<div id="workspace" class="integrated-workspace" class:chat-closed={!chatOpen} data-testid="shared-workspace">
  <div class="scene-source">
    {#if mode === 'cloud'}
      <PointCloud bind:this={cloudViewer} selection={cloudSelected} onscene={value => { cloudSample = value; cloudSelected = undefined; }} onpoint={value => cloudSelected = value} onvisualsource={value => visualSource = value} />
    {:else if mode === 'toronto'}
      <Toronto bind:this={toronto} {objectRefresh} onobjectstate={(snapshot, selectedId, blocked) => { objectSnapshot = snapshot; selectedObjectId = selectedId; objectBlocked = blocked; }} onarea={value => areaInput = value} {pointOverrides} {pointPreview} {pointRefresh} onpointstate={(snapshot, proposal, blocked) => { pointOverrides = snapshot; pointPreview = proposal; pointBlocked = !!blocked; }} {cadRefresh} modelStreaming={torontoStreaming} oncadblocked={value => torontoCadBlocked = value} onrevision={value => { if (torontoRevision && torontoRevision !== value) { sourceGeneration++; pointOverrides = undefined; pointPreview = undefined; points = []; } torontoRevision = value; }} onvisualsource={value => visualSource = value} {points} allocatePointName={() => pointSequence.allocate()} onpoint={pinToronto} onpoints={value => { points = value; pointStatus = ''; }} />
    {:else}<ClosestPole />{/if}
  </div>
  <div class="chat-shell" class:mobile-open={chatOpen}>{#if mode === 'cloud'}{#if cloudSample}{#key cloudSample.cloud.revision}<CloudChat sample={cloudSample} selected={cloudSelected} {visualSource} onselectpoint={value => cloudSelected = value} onscenemarks={snapshot => { if (mode !== 'cloud' || !cloudViewer) throw new Error('Location annotations unavailable.'); cloudViewer.receiveSceneMarks(snapshot); }} />{/key}{/if}{:else}<Chat {objectReferences} {selectedObject} onclearobject={() => toronto?.clearObjectSelection()} {objectBlocked} onobjectproposal={() => objectRefresh++} onscenemarks={snapshot => { if (mode !== 'toronto' || !toronto) throw new Error('Location annotations unavailable.'); toronto.receiveSceneMarks(snapshot); }} onareacandidates={async (result, current) => { const source = toronto, generation = sourceGeneration; if (mode !== 'toronto' || !source || !current()) throw new Error('Toronto candidates unavailable.'); await source.receiveAreaCandidates(result, () => mode === 'toronto' && source === toronto && generation === sourceGeneration && current()); }} onplacementsearch={async (result, current) => { const source = toronto, generation = sourceGeneration; if (mode !== 'toronto' || !source || !current()) throw new Error('Toronto placement unavailable.'); await source.receivePlacementSearch(result, () => mode === 'toronto' && source === toronto && generation === sourceGeneration && current()); }} onselectreference={selectAgentReference} onauthorityrefresh={refreshAgentAuthorities} {areaInput} {pointBlocked} onpointproposal={() => pointRefresh++} {torontoCadBlocked} oncadproposal={() => cadRefresh++} ontorontostreaming={value => torontoStreaming = value} {pointOverrides} onverifiedresult={selectVerified} {visualSource} sceneMode={mode} {points} {pointStatus} onclearpoint={name => { points = points.filter(point => point.name !== name); pointStatus = ''; }} />{/if}</div>
</div>
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
  .workspace-header { position: relative; z-index: 20; flex: 0 0 52px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid #ffffff12; background: #202124; }
  .workspace-select { max-width: 190px; color: #eeeef2; background: #292a2e; border: 1px solid #ffffff18; border-radius: 7px; padding: 7px 10px; cursor: pointer; }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .tools-link { display: inline-flex; align-items: center; min-height: 44px; padding: 5px 8px; color: #b4b5be; text-decoration: none; }
  .tools-link:hover { color: #fff; }
  .chat-toggle { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 5px 12px; color: #d7d9df; background: transparent; border: 1px solid transparent; border-radius: 7px; cursor: pointer; }
  .chat-toggle:hover { color: #fff; background: #ffffff0d; }
  .chat-toggle[aria-pressed='true'] { color: #f2f2f5; background: #ffffff12; border-color: #ffffff18; }
  .integrated-workspace { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; overflow: hidden; }
  .integrated-workspace.chat-closed { grid-template-columns: minmax(0, 1fr); }
  .chat-closed .chat-shell { display: none; }
  .scene-source, .chat-shell { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  .chat-shell { border-left: 1px solid #ffffff12; }
  .scene-source { position: relative; background: #151619; }
  @media (min-width: 1600px) { .integrated-workspace { grid-template-columns: minmax(0, 1fr) 390px; } }
  @media (max-width: 900px) { .workspace-header { gap: 12px; padding: 0 12px; } .header-actions { gap: 5px; } .workspace-select { max-width: 170px; font-size: 12px; } }
  @media (max-width: 640px) {
    .workspace-header { flex-basis: 52px; gap: 8px; padding: 8px 12px; }
    .workspace-select { max-width: 145px; min-width: 0; }
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
