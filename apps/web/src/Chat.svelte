<script lang="ts">
  import type { ProjectSnapshot } from '@spatial/contracts';
  import { ChatController, type ChatEntry } from './chat-client';
  import BoxControls from './BoxControls.svelte';
  import type { ProjectController, ProjectView } from './project-client';
  import type { TorontoDraftPoint, PointName } from './draft-context';
  import ModelChat from './ModelChat.svelte';
  import { modelScene } from './model-chat-client';
  let { snapshot, view, controller: projectController, sceneMode, points, pinName, onpinname, onclearpoint }: {
    snapshot?: ProjectSnapshot; view: ProjectView; controller: ProjectController; sceneMode: string;
    points: readonly TorontoDraftPoint[]; pinName: PointName; onpinname: (name: PointName) => void; onclearpoint: (name: PointName) => void;
  } = $props();
  const activePoints = $derived(sceneMode === 'toronto' ? points : []);
  const scene = $derived(modelScene(sceneMode, snapshot, view, activePoints));
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
</script>

<aside class="chat" aria-label="Scene chat" data-testid="chat">
  <header><div><p class="eyebrow">YOUR SPATIAL COPILOT</p><h2>Scene chat</h2></div><span class="readonly">Read-only model chat</span></header>
  <div class="introduction">
    <span class="intro-icon" aria-hidden="true">◇</span>
    <h3>Start with a point of view.</h3>
    <p>Pin points in the scene, then describe what you want to build or inspect.</p>
    <p class="honesty">Models load automatically; choose a different model anytime before sending with explicit scene references. The model can inspect bound context, but cannot build channels or change geometry.</p>
  </div>
  <section class="attachments" data-testid="draft-attachments" aria-label="Toronto3D draft attachments">
    <div class="section-heading"><strong>Scene references</strong><span>{activePoints.length}/2 attached</span></div>
    <div class="pin-target"><span>Next pin</span>{#each ['A', 'B'] as name}<button type="button" aria-pressed={pinName === name} disabled={sceneMode !== 'toronto'} onclick={() => onpinname(name as PointName)}>{name}</button>{/each}<span class="gesture">Cmd/Ctrl-click a point</span></div>
    {#if activePoints.length}
      {#each activePoints as point (point.name)}
        <div class="attachment" data-testid={`draft-point-${point.name}`}>
          <div class="attachment-heading"><span class="pin-label" class:b={point.name === 'B'}>{point.name}</span><strong>Toronto3D point {point.name}</strong><button type="button" aria-label={`Remove point ${point.name}`} data-testid={`remove-draft-point-${point.name}`} onclick={() => onclearpoint(point.name)}>×</button></div>
          <p class="coordinates">[{point.position.join(', ')}] m</p>
          <details><summary>Original source &amp; frame</summary><dl><dt>Prepared point key</dt><dd>File {point.key.sourceFileId} · row {point.key.sourceRow}</dd><dt>Artifact revision</dt><dd>{point.artifactRevision}</dd><dt>Frame / units</dt><dd>{point.frameId} · meters · right-handed Z-up</dd><dt>World origin (translation only)</dt><dd>[{point.localOrigin.join(', ')}]</dd></dl><pre data-testid={`draft-point-json-${point.name}`}>{JSON.stringify(point, null, 2)}</pre></details>
        </div>
      {/each}
      <p class="hint">Original prepared coordinates, not GPU values. Sent only with your model request; unmapped to synthetic project and excluded from project editing tools.</p>
    {:else}
      <p class="empty">{sceneMode === 'toronto' ? 'Choose A or B, then Cmd/Ctrl-click any rendered overview or detail point.' : 'Switch to Toronto3D to attach dataset points. Synthetic context stays in technical tools.'}</p>
    {/if}
  </section>
  <ModelChat {scene} />
  <details class="technical" data-testid="inspection-tools">
    <summary>Technical tools <span>Deterministic inspection &amp; approved parameters</span></summary>
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
      <details class="box-tools" data-testid="approved-box-tools"><summary>Box parameters &amp; exact approval</summary><BoxControls {view} controller={projectController} /></details>
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
  .chat { min-width: 0; min-height: calc(100vh - 80px); background: #111b29; padding: 24px; }
  header, .section-heading, .attachment-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .eyebrow { font-size: 9px; letter-spacing: 1.7px; color: #7992ad; margin: 0 0 4px; } h2 { font-size: 20px; margin: 0; font-weight: 550; }
  .readonly { color: #dbc48d; background: #393222; border: 1px solid #57492e; border-radius: 20px; padding: 3px 8px; font-size: 10px; white-space: nowrap; }
  .introduction { padding: 32px 0 24px; } .intro-icon { display: inline-block; font-size: 30px; line-height: 1; color: #86dfcc; margin-bottom: 10px; }
  h3 { font-weight: 500; font-size: 18px; margin: 0 0 8px; } p { color: #9badc3; font-size: 12px; }
  .introduction p { margin: 8px 0; } .introduction .honesty { color: #7e93ad; font-size: 11px; }
  .attachments { border-top: 1px solid #2c394b; padding-top: 18px; } .section-heading strong { font-size: 12px; font-weight: 550; } .section-heading span { color: #7f93ad; font-size: 10px; }
  .pin-target { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 12px 0; font-size: 11px; color: #98acc5; } .pin-target button { padding: 3px 9px; } .gesture { margin-left: auto; font-size: 10px; }
  .pin-target button[aria-pressed="true"] { border-color: #7bd7c4; color: #a5efdf; background: #233f43; }
  .empty { border: 1px dashed #344660; border-radius: 8px; padding: 14px; color: #8096b0; }
  .attachment { background: #172638; border: 1px solid #344b61; border-radius: 8px; margin: 10px 0; padding: 10px; }
  .attachment-heading { font-size: 11px; justify-content: start; } .attachment-heading > button { margin-left: auto; border: 0; padding: 0 5px; font-size: 18px; }
  .pin-label { display: inline-grid; place-items: center; background: #8be6d4; color: #122b2d; border-radius: 50%; width: 21px; height: 21px; font-weight: 700; } .pin-label.b { background: #efb5db; }
  .coordinates { color: #c3d8e7; font-family: ui-monospace, monospace; font-size: 11px; overflow-wrap: anywhere; } .attachment summary, .hint { font-size: 10px; color: #91a7bf; }
  label { display: block; font-size: 12px; margin: 12px 0 8px; color: #c1cfe0; }
  input { width: 100%; background: #0d1724; color: #e4ecf7; border: 1px solid #3b506a; border-radius: 8px; padding: 12px; }
  button { background: #1c2a40; color: #e4ecf7; border: 1px solid #3a4e66; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-size: 12px; }
  button:disabled { opacity: .4; }
  .technical { border-top: 1px solid #2c394b; margin-top: 28px; padding-top: 16px; } .technical > summary { font-size: 12px; color: #b3c5d9; } .technical > summary span { display: block; margin-left: 16px; font-size: 10px; color: #788fa8; }
  .technical section { border-top: 1px solid #344660; margin-top: 16px; padding-top: 14px; font-size: 12px; } .box-tools { margin-top: 20px; font-size: 12px; }
  dt, .help { color: #91a6c0; font-size: 11px; } dt { margin-top: 8px; } dd { margin: 0; overflow-wrap: anywhere; font-size: 11px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; } pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; font-size: 10px; }
  @media (max-width: 1000px) { .chat { padding: 18px; } .gesture { margin-left: 0; width: 100%; } }
  @media (max-width: 760px) { .chat { min-height: auto; padding: 24px 18px; } .introduction { padding: 24px 0 16px; } }
</style>
