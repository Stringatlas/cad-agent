<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { MODEL_VISUAL_LIMITS, modelVisualImageSize, type ModelScene, type ModelVisualObservation, type VisualObservation } from '@spatial/contracts';
  import ScreenshotCrop from './ScreenshotCrop.svelte';
  import SafeMarkdown from './SafeMarkdown.svelte';
  import { ModelChatController, MODEL_CLIENT_LIMITS, modelFailureDescription, type ModelChatView, type VisualModelAttachment } from './model-chat-client';
  import type { VisualModelSource } from './visual-model-source';
  import type { TorontoDraftPoint } from './draft-context';
  import { canonicalPoleRequest } from '@spatial/contracts';
  import { validatePoleResult } from './pole-client';
  let { scene, visualSource, points = [], onverifiedresult = () => {}, onauthorityproposal = () => {}, onproposal = () => {}, oninvalidateproposals = () => {}, onstreamingchange = () => {}, proposalsBlocked = false }: {
    scene: ModelScene; visualSource?: VisualModelSource; points?: readonly TorontoDraftPoint[]; onverifiedresult?: (context: unknown) => void;
    onauthorityproposal?: (kind: 'points' | 'cad') => void;
    onproposal?: (proposal: unknown, isCurrent: () => boolean) => void; oninvalidateproposals?: () => void;
    onstreamingchange?: (streaming: boolean) => void; proposalsBlocked?: boolean;
  } = $props();
  function selectableNearest(context: unknown) {
    try {
      const c = context as { searchGeometry: string; pointName: string; request: unknown; outcome: unknown };
      if (scene.mode !== 'toronto' || c.searchGeometry !== 'original-prepared-dataset') return false;
      const request = canonicalPoleRequest(c.request), source = points.find(p => p.name === c.pointName);
      if (!source || request.input.kind !== 'point-ref' || request.expectedArtifactRevision !== source.artifactRevision || JSON.stringify(request.input.key) !== JSON.stringify(source.key)) return false;
      return validatePoleResult(c.outcome, request).status === 'verified-found';
    } catch { return false; }
  }
  let attachment = $state<VisualModelAttachment>(), captureBusy = $state(false), captureError = $state(''), captureStale = $state(false);
  let captureTicket = 0, alive = true;
  let cameraButton: HTMLButtonElement;
  async function restoreCameraFocus() {
    await tick();
    if (alive && !cropOpen) cameraButton?.focus();
  }
  let cropOpen = $state(false), cropObservation = $state<VisualObservation>();
  let cropCurrent: () => boolean = () => false;
  let cropAttach: (image: ModelVisualObservation) => void = () => {};
  function removeAttachment() {
    captureTicket++; captureBusy = false; attachment = undefined; captureStale = false; captureError = '';
    cropOpen = false; cropObservation = undefined; cropCurrent = () => false; cropAttach = () => {};
  }
  async function attachScreenshot() {
    const source = visualSource, binding = JSON.stringify(scene), model = view.model, generation = view.catalog?.generation;
    if (!source || !catalogModelSelected) return;
    removeAttachment(); const ticket = ++captureTicket; captureBusy = true; cropOpen = true;
    const current = () => alive && ticket === captureTicket && source === visualSource && binding === JSON.stringify(scene) && model === view.model && generation === view.catalog?.generation;
    try {
      const observation = await source.capture();
      if (!alive || ticket !== captureTicket) return;
      if (!current() || !source.isCurrent(observation.observationId)) throw new Error('View or context changed during capture. Cancel and capture again.');
      if (observation.image.byteLength > MODEL_VISUAL_LIMITS.sourcePngBytes) throw new Error('Source screenshot exceeds the 12 MiB capture limit.');
      const observationId = observation.observationId;
      cropCurrent = () => current() && source.isCurrent(observationId);
      cropAttach = image => {
        if (!cropCurrent()) { captureError = 'Screenshot is stale. Cancel and capture again.'; return; }
        attachment = { observation: image, isCurrent: cropCurrent, resolvePixel: (id, x, y) => source.resolvePixel(id, x, y) };
        cropOpen = false; cropObservation = undefined;
      };
      cropObservation = observation;
    } catch (error) { if (alive && ticket === captureTicket) captureError = error instanceof Error ? error.message : 'Screenshot unavailable.'; }
    finally { if (alive && ticket === captureTicket) captureBusy = false; }
  }
  async function send() {
    if (!canSend) return;
    const current = attachment;
    const sent = await controller.send(draft, current);
    if (sent && attachment === current) removeAttachment();
  }
  let draft = $state('');
  let view = $state<ModelChatView>({ catalogPhase: 'idle', model: '', phase: 'idle', code: 'refresh-models', messages: [] });
  const catalogModelSelected = $derived(view.catalogPhase === 'ready' && view.catalog?.ready && !!view.catalog.models.some(model => model.id === view.model));
  const controller = new ModelChatController(value => { view = value; onstreamingchange(value.phase === 'streaming'); }, undefined, undefined, undefined,
    { onproposal: (proposal, current) => onproposal(proposal, current), oninvalidate: () => oninvalidateproposals(), onauthorityproposal: kind => onauthorityproposal(kind) });
  $effect(() => controller.bind(scene));
  // A replacement scene/source invalidates even a capture still waiting for pixels.
  const sceneKey = $derived(JSON.stringify(scene));
  $effect(() => { sceneKey; visualSource; untrack(() => { removeAttachment(); oninvalidateproposals(); if (view.phase === 'streaming') controller.cancel(); }); });
  const canSend = $derived(!proposalsBlocked && view.catalogPhase === 'ready' && view.catalog?.ready && !!view.model && view.phase !== 'streaming' && !!draft.trim() && !captureBusy && !cropOpen && (!attachment || !captureStale));
  onMount(() => {
    const timer = setInterval(() => {
      if (attachment && !captureStale && !attachment.isCurrent()) {
        captureStale = true;
        if (view.phase === 'streaming') controller.cancel();
      }
    }, 250);
    // Discovery is read-only. Focus alone never erases a conversation or retries inference.
    const revalidate = () => { void controller.refreshModels(); };
    const changed = () => { removeAttachment(); controller.accountChanged(); revalidate(); };
    const visibility = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('spatial-provider-change', changed);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', visibility);
    revalidate();
    return () => {
      alive = false; captureTicket++; clearInterval(timer);
      window.removeEventListener('spatial-provider-change', changed);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', visibility);
      controller.dispose();
    };
  });
</script>

<section class="model-chat" data-testid="model-chat" data-state={view.phase} aria-label="Model conversation">
  <div class="chat-toolbar">
    <span class="active-model">{view.model || 'Choose a model in settings'}</span>
    <button type="button" data-testid="model-new-chat" onclick={() => { controller.newChat(); removeAttachment(); }}>New chat</button>
  </div>
  <div class="conversation-scroll" role="region" aria-label="Conversation and model context">
  <details class="model-settings" data-testid="model-settings">
    <summary>Model &amp; session settings{view.catalogPhase === 'error' || (view.catalogPhase === 'ready' && !view.catalog?.ready) ? ' · unavailable' : ''}</summary>
    <div class="catalog-actions">
      <button type="button" data-testid="model-refresh" onclick={() => void controller.refreshModels()} disabled={view.catalogPhase === 'loading'}>{view.catalogPhase === 'loading' ? 'Loading models…' : 'Refresh models'}</button>
    </div>
  <label class="model-label" for="chat-model">Model</label>
  <select id="chat-model" data-testid="model-select" value={view.model} onchange={event => { removeAttachment(); controller.selectModel(event.currentTarget.value); }} disabled={!view.catalog?.ready || view.catalogPhase !== 'ready'}>
    <option value="">Choose a model…</option>
    {#each view.catalog?.models ?? [] as model (model.id)}<option value={model.id}>{model.label}</option>{/each}
  </select>
  <p class="catalog-status" role="status" data-testid="model-catalog-status">
    {#if view.catalogPhase === 'idle'}Models load automatically. No message is sent until you choose Send.
    {:else if view.catalogPhase === 'loading'}Discovering models from the server's configured provider…
    {:else if view.catalogPhase === 'error'}Model catalog unavailable. Check Account, server connectivity and permissions, then refresh. No fallback provider was used.
    {:else if !view.catalog?.ready}Model unavailable · {view.catalog?.mode} · {view.catalog?.code}. Account readiness alone does not authorize inference.
    {:else if !view.catalog.models.length}No usable models were returned by the configured provider.
    {:else}{view.catalog.mode === 'chatgpt' ? 'ChatGPT plan' : 'API key'} · {view.model ? 'Models available' : 'Select a model to enable Send.'}{/if}
  </p>
  <details class="bound-scene"><summary>Context &amp; session · {scene.mode}</summary>
    <p>Only active-scene references are sent. Toronto coordinates remain unmapped; attachment provenance is not CAD verification.</p>
    <pre data-testid="model-scene-context">{JSON.stringify(scene, null, 2)}</pre>
    <p class="continuation" data-testid="model-continuation">{view.continuationActive ? 'Active server continuation · retained server history can be replayed on the next send.' : 'No active server continuation · retained messages are display-only; the next send starts a new server conversation.'}</p>
  </details>
  </details>
  {#if view.historyNotice}<p class="history-notice" role="status" data-testid="model-history-notice">{view.historyNotice}</p>{/if}
  {#if view.messages.length}
    <div class="history" aria-live="polite" data-testid="model-history">
      {#each view.messages as message, index (index)}
        <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'} data-testid={`model-message-${index}`} data-role={message.role} data-state={message.state}>
          <strong class="message-author">{message.role === 'user' ? 'You' : 'Assistant'}{message.role === 'assistant' && message.state !== 'complete' ? ` · ${message.state}` : ''}</strong>
          {#if message.role === 'assistant'}
            <div class="message-body"><SafeMarkdown text={message.text || (message.state === 'streaming' ? 'Waiting for response…' : 'No completed answer.')} /></div>
          {:else}
            <p class="message-text">{message.text || 'Empty message'}</p>
          {/if}
          {#if message.role === 'assistant'}
            <details class="request-inspector" data-testid="model-request-inspector">
              <summary>Actual model requests · {message.inspections?.length ?? 0} retained rounds</summary>
              <p>Safe view of the effective request body, not a provider-internal prompt. Product instructions use the actual <code>instructions</code> field; input roles are shown as sent, with no invented system message.</p>
              <p>Credentials and authentication headers are excluded. Opaque reasoning is not shown. Memory only; New chat or reload clears this view. Snapshots may be truncated or evicted at bounded limits.</p>
              {#if message.inspectionsDropped}<p data-testid="model-inspection-evicted">{message.inspectionsDropped} older request snapshots evicted from memory.</p>{/if}
              {#if !message.inspections?.length}<p>No retained request snapshot. Preparation may not have reached the provider adapter.</p>{/if}
              {#each message.inspections ?? [] as inspection (inspection.round)}
                <details class="request-round" data-testid="model-request-round" data-phase={inspection.phase}>
                  <summary>Round {inspection.round} · {inspection.phase} · {inspection.mode === 'chatgpt' ? 'ChatGPT plan' : 'API key'}</summary>
                  <p>{inspection.continuation ? 'This request uses an existing server conversation.' : 'This turn started a new server conversation.'} Later rounds include visible tool history. Inspect input below for the actual replay.</p>
                  <p>{inspection.source === 'client' ? 'Local monitoring ended; provider completion or cancellation is not confirmed.' : inspection.phase === 'completed' ? 'Server validated this provider response and EOF. This alone does not establish completion of the whole chat turn.' : inspection.phase === 'dispatched' ? 'Dispatch was invoked; provider receipt or successful inference is not established.' : inspection.phase === 'prepared' ? 'Prepared on server; dispatch is not yet confirmed.' : 'Server reported this round ended without a completed response.'}</p>
                  <p data-testid="model-request-omissions">Omissions: {inspection.omissions.join(', ')}</p>
                  <pre data-testid="model-request-body">{JSON.stringify(JSON.parse(inspection.bodyJson), null, 2)}</pre>
                </details>
              {/each}
            </details>
          {/if}
          {#each message.tools as context}
            <details class="tool-context"><summary>Scene tool · actual context / evidence (not approval)</summary><pre data-testid="model-tool-context">{JSON.stringify(context, null, 2)}</pre></details>
            {#if selectableNearest(context)}<button type="button" data-testid="model-select-nearest" onclick={() => onverifiedresult(context)}>Select verified result</button><p>Original prepared-dataset search only. Select attaches the original winner with complete query evidence; it does not move geometry.</p>{/if}
          {/each}
          {#if message.state === 'incomplete'}
            {@const failure = modelFailureDescription(message.failureCode)}
            <div class="message-failure" role="status" data-testid="model-message-failure">
              <strong>{failure.title}</strong>
              <p>{failure.detail}</p>
              <p class="recovery"><b>Next step:</b> {failure.recovery}</p>
              <p class="incomplete">Incomplete — not a completed answer or committed history. The next send starts a new server conversation.</p>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {:else}
    <div class="conversation-empty"><h3>What would you like to build?</h3><p>Ask about your scene or describe a change. Proposed changes stay previews until you accept each one.</p></div>
  {/if}
  </div>
  <form class="composer" data-testid="local-draft-form" onsubmit={event => { event.preventDefault(); void send(); }}>
    {#if attachment}
      {@const size = modelVisualImageSize(attachment.observation)}
      <div class="screenshot-attachment" aria-label="Attached scene screenshot">
        <img data-testid="model-image-preview" src={attachment.observation.image.dataUrl} alt="Scene crop attached to the next send" />
        <span data-testid="model-image-status" role="status">{captureStale ? 'Stale screenshot — recapture or remove.' : `${size.width} × ${size.height} JPEG · ${Math.ceil(attachment.observation.image.byteLength / 1024)} KB`}</span>
        <button type="button" title="Remove screenshot" aria-label="Remove screenshot" data-testid="model-remove-screenshot" disabled={view.phase === 'streaming'} onclick={removeAttachment}>×</button>
      </div>
    {/if}
    {#if captureError && !cropOpen}<p role="alert" data-testid="model-image-error">{captureError}</p>{/if}
    <label class="draft-label" for="local-draft">Message</label>
    <textarea id="local-draft" data-testid="local-draft" bind:value={draft} rows="2" maxlength={MODEL_CLIENT_LIMITS.textChars} placeholder="Ask about the scene…" onkeydown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!event.repeat) void send();
      }
    }}></textarea>
    <div class="composer-footer">
      <button bind:this={cameraButton} class="camera" type="button" title={visualSource ? 'Crop and attach scene screenshot' : 'Screenshot capture unavailable in this scene'} aria-label="Attach scene screenshot" data-testid="model-attach-screenshot" disabled={!visualSource || !catalogModelSelected || cropOpen || view.phase === 'streaming'} onclick={() => void attachScreenshot()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/></svg>
      </button>
      <button class="cancel" type="button" data-testid="model-cancel" disabled={view.phase !== 'streaming' && view.catalogPhase !== 'loading'} onclick={() => controller.cancel()}>Cancel</button>
      <button class="send" type="submit" data-testid="send-local-draft" disabled={!canSend}>Send <span aria-hidden="true">↑</span></button>
    </div>
  </form>
  <div class="progress" role="status" data-testid="local-draft-status" data-state={view.phase}>
    {#if view.phase !== 'idle' || view.code === 'history-limit-new-chat-required'}<p>{view.code}</p>{/if}
    {#if view.phase === 'streaming'}<p>Streaming model text · proposals are previews only. Accept/Decline waits for the stream to end.</p>{/if}
    {#if view.phase === 'error' || view.phase === 'cancelled'}<p>No automatic retry. Partial text is incomplete; no geometry was changed by this chat.</p>{/if}
  </div>
  <details class="boundary"><summary>Changes require your approval</summary><p>{scene.mode === 'toronto' ? 'Chat can propose point translations and real kernel solids in Toronto local meters. Accept or Decline each retained change; only human Accept publishes. State is volatile.' : 'Chat can propose synthetic box changes, never approve them. Review each ghost; parameter checks are not CAD verification.'}</p></details>
  {#if proposalsBlocked && view.phase !== 'streaming'}<p role="status">Sending is blocked while an authority request is pending or Refresh is required. Refresh the active point/CAD authority before proposing more changes.</p>{/if}
</section>
{#if cropOpen}<ScreenshotCrop observation={cropObservation} loading={captureBusy} error={captureError} isCurrent={() => cropCurrent()} onattach={image => { cropAttach(image); void restoreCameraFocus(); }} oncancel={() => { removeAttachment(); void restoreCameraFocus(); }} />{/if}

<style>
  .model-chat { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
  .chat-toolbar, .catalog-actions, .composer-footer { display: flex; align-items: center; gap: 8px; }
  .chat-toolbar { flex-shrink: 0; justify-content: space-between; margin-bottom: 8px; }
  .active-model { color: #a5a5af; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-toolbar button, .catalog-actions button { flex-shrink: 0; background: transparent; border-color: transparent; color: #aaaab4; padding: 4px 0; font-size: 10px; }
  .model-settings { font-size: 10px; color: #9999a4; padding: 6px 0 8px; border-bottom: 1px solid #ffffff0c; }
  .catalog-actions { margin: 8px 0; }
  .model-label, .draft-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  select, textarea { box-sizing: border-box; width: 100%; min-width: 0; color: #f1f1f3; font: inherit; font-size: 12px; }
  select { flex-shrink: 0; background: #151619; border: 1px solid #ffffff16; border-radius: 9px; padding: 9px 10px; }
  .conversation-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 3px 2px 10px; }
  p { font-size: 11px; line-height: 1.5; color: #a5a5af; overflow-wrap: anywhere; }
  .catalog-status { font-size: 10px; margin: 8px 0; }
  .bound-scene { font-size: 10px; color: #9999a4; margin: 8px 0; }
  summary { cursor: pointer; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; font-size: 10px; }
  .history-notice { border-left: 2px solid #c9af74; padding: 6px 9px; color: #dbc898; background: #29271f; }
  .history { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; margin: 16px 0 0; }
  article { box-sizing: border-box; min-width: 0; max-width: 94%; padding: 12px; border-radius: 14px 14px 14px 4px; background: #28292e; border: 1px solid #ffffff0b; }
  article.assistant { align-self: flex-start; }
  article.user { align-self: flex-end; max-width: 86%; background: #253c61; border-color: #6197e424; border-radius: 14px 14px 4px 14px; }
  .message-author { display: block; font-size: 10px; font-weight: 550; color: #b1b1bc; }
  .message-body { margin-top: 6px; }
  .message-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #ededf2; margin: 6px 0 0; }
  .conversation-empty { margin: 28px 8px; color: #d9d9e2; }
  .conversation-empty h3 { font-size: 16px; font-weight: 550; margin-bottom: 8px; }
  .conversation-empty p { font-size: 12px; }
  .message-failure { margin-top: 10px; padding: 10px; border: 1px solid #a37e46; border-left: 4px solid #d2a45e; border-radius: 8px; background: #30271c; }
  .message-failure strong { color: #f2d5a6; font-size: 11px; }
  .message-failure p { color: #d9c4a6; margin: 8px 0 0; }
  .message-failure .recovery { color: #f1e0c9; }
  .message-failure .incomplete { font-size: 10px; }
  .tool-context { font-size: 10px; color: #a3a3b0; margin-top: 8px; }
  .request-inspector { margin-top: 10px; padding: 8px 0; border-top: 1px solid #ffffff12; font-size: 10px; color: #a3a3b0; }
  .request-round { margin-top: 10px; padding-top: 8px; border-top: 1px solid #ffffff14; }
  .request-round pre { background: #151619; border-radius: 6px; padding: 8px; }
  .continuation { font-size: 10px; color: #92929d; }
  .composer { flex-shrink: 0; background: #151619; border: 1px solid #ffffff1c; border-radius: 14px; padding: 10px; }
  textarea { background: transparent; border: 0; border-radius: 4px; padding: 2px; resize: none; height: 62px; min-height: 0; line-height: 1.5; } textarea::placeholder { color: #777782; }
  .composer-footer { margin-top: 6px; }
  button { background: #2c2d32; color: #ededf2; border: 1px solid #ffffff16; border-radius: 8px; padding: 7px 10px; cursor: pointer; font-size: 11px; }
  button:disabled { opacity: .4; cursor: default; }
  button:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #70a9ff; outline-offset: 2px; }
  .camera { display: inline-flex; align-items: center; justify-content: center; padding: 6px; background: transparent; border-color: transparent; }
  .cancel { margin-left: auto; } .cancel:disabled { visibility: hidden; }
  .send { background: #3478f6; color: white; border-color: #4283fc; font-weight: 550; } .send span { margin-left: 7px; }
  .screenshot-attachment { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 10px; color: #b7b7c2; }
  .screenshot-attachment img { width: 56px; height: 38px; object-fit: contain; background: #202124; border-radius: 5px; }
  .screenshot-attachment span { flex: 1; }
  .progress { flex-shrink: 0; max-height: 70px; overflow: auto; } .progress p { color: #d2bf93; font-size: 10px; margin: 5px 0; }
  .boundary { flex-shrink: 0; font-size: 9px; color: #858590; margin: 7px 0 0; }
  .boundary[open] { max-height: 90px; overflow: auto; }
  @media (max-height: 600px) { textarea { height: 44px; } }
</style>
