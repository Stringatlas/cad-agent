<script lang="ts">
  import type { AuthoredObjectReference, DatumPoint } from '@spatial/contracts';
  import { type ProjectSnapshot, type PointOverrideSnapshot, type ModelReferenceSelection } from '@spatial/contracts';
  import { ChatController, type ChatEntry } from './chat-client';
  import BoxControls from './BoxControls.svelte';
  import type { ProjectController, ProjectView } from './project-client';
  import type { TorontoDraftPoint, PointName } from './draft-context';
  import ModelChat from './ModelChat.svelte';
  import { effectivePosition } from './point-override-client';
  import { pointSemanticName, semanticName } from './point-presentation';
  import { onDestroy, tick, untrack } from 'svelte';
  import { createPointTypeChannel, pointTypeKey, type PointTypeState } from './point-type-client';
  import type { VisualModelSource } from './visual-model-source';
  import type { AreaOfInterestInput } from './area-of-interest';
  import { modelScene } from './model-chat-client';
  let { objectReferences = [], selectedObject, onclearobject = () => {}, objectBlocked = true, onobjectproposal = () => {}, areaInput, snapshot, view, controller: projectController, sceneMode, points, pointStatus, onclearpoint, visualSource, pointOverrides, onverifiedresult, pointBlocked = true, onpointproposal = () => {}, oncadproposal = () => {}, ontorontostreaming = () => {}, onselectreference, onauthorityrefresh, torontoCadBlocked = true }: {
    objectReferences?: readonly AuthoredObjectReference[]; selectedObject?: DatumPoint; onclearobject?: () => void; objectBlocked?: boolean; onobjectproposal?: () => void;
    areaInput?: AreaOfInterestInput;
    onselectreference: (reference: ModelReferenceSelection, isCurrent: () => boolean) => Promise<void>;
    onauthorityrefresh: () => Promise<void>;
    torontoCadBlocked?: boolean;
    oncadproposal?: () => void; ontorontostreaming?: (streaming: boolean) => void;
    pointBlocked?: boolean; onpointproposal?: () => void;
    pointOverrides?: PointOverrideSnapshot;
    onverifiedresult: (context: unknown) => void;
    visualSource?: VisualModelSource;
    snapshot?: ProjectSnapshot; view: ProjectView; controller: ProjectController; sceneMode: string;
    points: readonly TorontoDraftPoint[]; pointStatus: string; onclearpoint: (name: PointName) => void;
  } = $props();
  const activePoints = $derived(sceneMode === 'toronto' ? points : []);
  let pointTypes = $state<PointTypeState>(new Map());
  const pointTypeChannel = createPointTypeChannel(value => pointTypes = value);
  $effect(() => { const references = activePoints; untrack(() => pointTypeChannel.bind(references)); });
  onDestroy(() => pointTypeChannel.dispose());
  function selectedType(point: TorontoDraftPoint) {
    const known = pointSemanticName(point); if (known !== 'Unknown') return known;
    const label = pointTypes.get(pointTypeKey(point));
    return label === 'loading' ? 'Loading type…' : semanticName(label);
  }
  // Query lineage stays attached locally; the strict model-reference protocol carries only original source fields.
  const scene = $derived(modelScene(sceneMode, snapshot, view, activePoints.map(({ evidence: _evidence, semanticLabel: _label, ...original }) => original), areaInput?.area, objectReferences));
  const listedPoints = $derived(sceneMode === 'demo' ? view.points : activePoints);
  const referencePreview = $derived([...listedPoints.map(point => `${point.name} · ${'datasetId' in point ? selectedType(point) : 'Synthetic'}`), ...(sceneMode === 'toronto' && selectedObject ? [`${selectedObject.name} · Datum point`] : [])].join(', ') || 'None');
  let command = $state('metadata');
  let entry = $state<ChatEntry>();
  let controller: ChatController | undefined;
  $effect(() => {
    const binding = snapshot;
    entry = undefined;
    if (!binding) { controller = undefined; return; }
    const current = new ChatController({ sessionId: binding.sessionId, projectRevision: binding.project.revision }, value => entry = value);
    controller = current;
    return () => { current.dispose(); if (controller === current) controller = undefined; };
  });
  const reply = $derived(entry?.response?.reply);
  function effectiveCoordinates(point: TorontoDraftPoint) { try { return effectivePosition(point, pointOverrides).join(', '); } catch { return 'Source mismatch — refresh and reselect'; } }
</script>

<aside class="chat" aria-label="Scene chat" data-testid="chat">
  {#if pointStatus}<p class="point-status" role="status" data-testid="point-status">{pointStatus}</p>{/if}
  <details class="attachments" data-testid="draft-attachments" aria-label="Scene point references">
    <summary><span>Scene references</span><span class="reference-preview" title={referencePreview}>{referencePreview}</span>{#if listedPoints.length}<span class="reference-count" aria-label={`${listedPoints.length} source references`}>{listedPoints.length}</span>{/if}</summary>

    {#if sceneMode === 'toronto' && selectedObject}<div class="attachment" data-testid="datum-chat-reference"><div class="attachment-heading"><strong>{selectedObject.name} · Datum point</strong><button type="button" aria-label={`Remove ${selectedObject.name} reference`} onclick={onclearobject}>×</button></div><details><summary>Details</summary><p>[{selectedObject.position.join(', ')}] m · Toronto local</p><pre>{JSON.stringify(objectReferences[0], null, 2)}</pre></details></div>{/if}
    {#if listedPoints.length}
      <div class="point-list" role="list" aria-label="Numbered scene points">
      {#each listedPoints as point (point.name)}
        <div class="attachment" role="listitem" data-testid={`draft-point-${point.name}`}>
          <div class="attachment-heading"><strong>{point.name}</strong><span data-testid={`point-type-${point.name}`}>{'datasetId' in point ? selectedType(point) : 'Synthetic'}</span><button type="button" aria-label={`Remove ${point.name}`} data-testid={`remove-draft-point-${point.name}`} disabled={sceneMode === 'demo' && !!view.pending && ['approve', 'undo', 'load'].includes(view.pending)} onclick={() => onclearpoint(point.name)}>×</button></div>
          {#if 'datasetId' in point}
          <details><summary>Details</summary><p class="coordinates">Original [{point.position.join(', ')}] m</p>{#if pointOverrides}<p class="coordinates">Effective [{effectiveCoordinates(point)}] m · override revision {pointOverrides.revision}</p>{/if}<dl><dt>Prepared point key</dt><dd>File {point.key.sourceFileId} · row {point.key.sourceRow}</dd><dt>Artifact revision</dt><dd>{point.artifactRevision}</dd><dt>Frame / units</dt><dd>{point.frameId} · meters · right-handed Z-up</dd><dt>World origin (translation only)</dt><dd>[{point.localOrigin.join(', ')}]</dd></dl><pre data-testid={`draft-point-json-${point.name}`}>{JSON.stringify(point, null, 2)}</pre></details>
          {:else}
          <details><summary>Details</summary><p class="coordinates">[{point.position.join(', ')}] m</p><p>{point.entityId} · index {point.pointIndex}<br />{snapshot?.frameId} · revision {snapshot?.project.revision} · meters · right-handed Z-up<br />Origin [{snapshot?.project.coordinates.localOrigin.join(', ')}]</p></details>
          {/if}
        </div>
      {/each}
      </div>

    {:else if !selectedObject || sceneMode !== 'toronto'}
      <p class="empty">{sceneMode === 'pole' ? 'Switch to Toronto3D or Synthetic demo to attach numbered points.' : 'Cmd/Ctrl-click any rendered cloud point to attach Point 1, Point 2, and more.'}</p>
    {/if}
  </details>
  <ModelChat {scene} {visualSource} points={activePoints} {onverifiedresult} areaInput={sceneMode === 'toronto' ? areaInput : undefined}
    onselectreference={async (reference, current) => { await onselectreference(reference, current); await tick(); return scene; }}
    onauthorityrefresh={async () => { await onauthorityrefresh(); await tick(); return scene; }}
    proposalsBlocked={sceneMode === 'demo' ? (!!view.pending || view.needsRefresh) : sceneMode === 'toronto' && (torontoCadBlocked || pointBlocked || objectBlocked)}
    onstreamingchange={streaming => { projectController.setModelStreaming(streaming); ontorontostreaming(streaming); }}
    onauthorityproposal={kind => { if (sceneMode === 'toronto') { if (kind === 'cad') oncadproposal(); else if (kind === 'objects') onobjectproposal(); else onpointproposal(); } }}
    oninvalidateproposals={() => projectController.clearModelProposals()}
    onproposal={(proposal, current) => { if (sceneMode === 'demo') void projectController.admitModelProposal(proposal, () => sceneMode === 'demo' && current()); }} />
  <details class="technical" data-testid="inspection-tools">
    <summary>Diagnostics</summary>
    {#if snapshot}
      {#key snapshot}
      <section data-testid="chat-project-binding">
        <strong>Shared demo project</strong>
        <dl><dt>Server session</dt><dd>{snapshot.sessionId}</dd><dt>Geometry revision / units</dt><dd>{snapshot.project.revision} / {snapshot.project.coordinates.units}</dd>
          <dt>Project frame / world origin</dt><dd>{snapshot.frameId} · right-handed Z-up<br />[{snapshot.project.coordinates.localOrigin.join(', ')}]</dd>
          <dt>Authoritative entity IDs</dt><dd>{snapshot.project.entities.map(e => e.id).join(', ')}</dd></dl>
      </section>
      <section>
        <strong>Separate Toronto3D inspection</strong>
        <p>toronto3d-local-v1 · meters · right-handed Z-up<br />Origin [627285, 4841948, 0]. No mapping into the demo scene.</p>
        {#if reply?.request}<dl><dt>Artifact revision (not geometry revision)</dt><dd data-testid="chat-artifact-revision">{reply.request.binding.artifactRevision}</dd><dt>Artifact content digest</dt><dd>{reply.request.binding.artifactDigest}</dd></dl>{/if}
      </section>
      <section data-testid="chat-scene-selections">
        <strong>Explicit synthetic scene selections</strong>
        <p>Entity: {view.selectedId ?? 'none'} · revision {snapshot.project.revision}</p>
        <pre>{JSON.stringify(view.points, null, 2)}</pre>
        {#if sceneMode !== 'demo'}<p>Toronto3D view is unmapped. Its selected points/entities are excluded from project context; only retained synthetic selections below are eligible.</p>{/if}
      </section>
      <form onsubmit={event => { event.preventDefault(); if (command === 'context') { controller?.cancel(); entry = undefined; void projectController.context(); } else void controller?.submit(command); }}>
        <label for="inspection-command">Inspection command</label>
        <input id="inspection-command" data-testid="chat-command" bind:value={command} maxlength="80" autocomplete="off" />
        <p class="help">Exact grammar: <code>context</code>, <code>metadata</code> or <code>observe B D</code> (B=1..4096, D=0..3). Bounded first-chunk sample only; not exhaustive or CAD verification.</p>
        <div class="actions"><button type="submit" disabled={entry?.state === 'pending' || view.pending === 'context'}>Send inspection</button><button type="button" onclick={() => { if (view.pending === 'context') projectController.cancel(); else controller?.cancel(); }} disabled={entry?.state !== 'pending' && view.pending !== 'context'}>Cancel inspection</button></div>
      </form>
      {#if view.context}<section aria-live="polite"><strong>Actual bound context · no model answer</strong><pre data-testid="chat-context">{JSON.stringify(view.context, null, 2)}</pre></section>{/if}
      {#if sceneMode === 'demo'}<details class="box-tools" data-testid="approved-box-tools"><summary>Box parameters &amp; exact approval</summary><BoxControls {view} controller={projectController} /></details>{/if}
      {#if entry}
        <section aria-live="polite" data-testid="chat-result" data-state={entry.state}>
          <h3>{entry.state}</h3><p>{entry.code}</p>
          {#if entry.state === 'pending'}<p>Preparing trusted assets / running dispatcher… First use hashes fixed prepared files; cancellation is available.</p>{/if}
          {#if entry.code === 'unsupported-command'}<p>Unsupported request. Use the exact documented grammar. No model answer was generated.</p>{/if}
          {#if entry.response?.evidence}<dl data-testid="chat-evidence"><dt>Run / request reference</dt><dd>{entry.response.evidence.runId} / {entry.response.evidence.requestId}</dd><dt>Semantic outcome hash</dt><dd>{entry.response.evidence.semanticHash}</dd><dt>Configuration hash</dt><dd>{entry.response.evidence.configHash}</dd></dl>{/if}
          {#if reply}<details><summary>Canonical tool request</summary><pre data-testid="chat-request">{JSON.stringify(reply.request, null, 2)}</pre></details><details><summary>Dispatcher result / evidence</summary><pre data-testid="chat-tool-result">{JSON.stringify(reply.outcome, null, 2)}</pre></details>{/if}
        </section>
      {/if}
      {/key}
    {:else}<p>Authoritative project unavailable. Refresh in Project &amp; persistence; local draft and Toronto view remain independent.</p>{/if}
  </details>
</aside>

<style>
  .chat { box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; min-width: 0; overflow: hidden; background: #202124; color: #f1f1f3; padding: 12px; }
  .attachment-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { font-size: 14px; font-weight: 550; } p { color: #a5a5ad; font-size: 11px; line-height: 1.5; }
  .point-status { margin: 0; flex-shrink: 0; max-height: 52px; overflow: auto; color: #d7c697; }
  .attachments, .technical { flex-shrink: 0; min-height: 0; border-top: 1px solid #ffffff12; padding-top: 9px; font-size: 11px; }
  .attachments[open], .technical[open] { flex-shrink: 0; max-height: 30%; overflow: auto; overscroll-behavior: contain; }
  summary { cursor: pointer; color: #b9b9c1; } summary:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #70a9ff; outline-offset: 3px; }
  .attachments > summary { display: flex; align-items: center; gap: 8px; }
  .attachments > summary::before { content: '▸'; color: #8e8e98; }
  .attachments[open] > summary::before { content: '▾'; }
  .reference-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a5a5af; }
  .reference-count { margin-left: auto; color: #8e8e98; font-variant-numeric: tabular-nums; }
  .empty { padding: 6px 0; color: #92929c; }
  .technical { border-top: 0; padding-top: 0; color: #92929c; }
  @media(pointer: coarse) { .attachment-heading > button { min-width: 44px; min-height: 44px; } summary { min-height: 32px; } }
  .attachment { background: #151619; border: 1px solid #ffffff12; border-radius: 10px; margin: 8px 0; padding: 10px; }
  .attachment-heading { font-size: 11px; justify-content: start; } .attachment-heading > button { margin-left: auto; border: 0; padding: 0 5px; font-size: 18px; }
  .attachment-heading strong { overflow-wrap: anywhere; }
  .coordinates { color: #cdccd3; font-family: ui-monospace, monospace; font-size: 10px; overflow-wrap: anywhere; } .attachment summary { font-size: 10px; color: #92929c; }
  label { display: block; font-size: 11px; margin: 10px 0 6px; color: #c9c9d0; }
  input { box-sizing: border-box; width: 100%; background: #151619; color: #f1f1f3; border: 1px solid #ffffff20; border-radius: 8px; padding: 9px; }
  button { background: #2c2d31; color: #ededf1; border: 1px solid #ffffff16; border-radius: 7px; padding: 7px 10px; cursor: pointer; font-size: 11px; }
  button:disabled { opacity: .4; cursor: default; }
  .technical section { border-top: 1px solid #ffffff14; margin-top: 12px; padding-top: 10px; font-size: 11px; } .box-tools { margin-top: 14px; font-size: 11px; }
  dt, .help { color: #9898a3; font-size: 10px; } dt { margin-top: 8px; } dd { margin: 0; overflow-wrap: anywhere; font-size: 10px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; } pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; font-size: 10px; }
</style>
