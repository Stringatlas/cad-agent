<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { MODEL_VISUAL_LIMITS, modelVisualImageSize, type ModelScene, type ModelVisualObservation, type VisualObservation } from '@spatial/contracts';
  import ScreenshotCrop from './ScreenshotCrop.svelte';
  import { ModelChatController, MODEL_CLIENT_LIMITS, modelFailureDescription, type ModelChatView, type VisualModelAttachment } from './model-chat-client';
  import type { VisualModelSource } from './visual-model-source';
  import type { TorontoDraftPoint } from './draft-context';
  import { canonicalPoleRequest } from '@spatial/contracts';
  import { validatePoleResult } from './pole-client';
  let { scene, visualSource, points = [], onverifiedresult = () => {} }: { scene: ModelScene; visualSource?: VisualModelSource; points?: readonly TorontoDraftPoint[]; onverifiedresult?: (context: unknown) => void } = $props();
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
  const controller = new ModelChatController(value => view = value);
  $effect(() => controller.bind(scene));
  // A replacement scene/source invalidates even a capture still waiting for pixels.
  $effect(() => { JSON.stringify(scene); visualSource; removeAttachment(); });
  const canSend = $derived(view.catalogPhase === 'ready' && view.catalog?.ready && !!view.model && view.phase !== 'streaming' && !!draft.trim() && !captureBusy && !cropOpen && (!attachment || !captureStale));
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
  <div class="catalog-actions">
    <button type="button" data-testid="model-refresh" onclick={() => void controller.refreshModels()} disabled={view.catalogPhase === 'loading'}>{view.catalogPhase === 'loading' ? 'Loading models…' : 'Refresh models'}</button>
    <button type="button" data-testid="model-new-chat" onclick={() => { controller.newChat(); removeAttachment(); }}>New chat</button>
  </div>
  <label for="chat-model">Configured provider model</label>
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
    {:else}{view.catalog.mode === 'chatgpt' ? 'ChatGPT plan' : 'API key'} · {view.model ? `Selected: ${view.model}` : 'Select a model to enable Send.'} Catalog availability is not proof of successful inference.{/if}
  </p>
  <details class="bound-scene"><summary>Current model context · {scene.mode}</summary>
    <p>Only active-scene references are sent. Toronto coordinates remain unmapped; attachment provenance is not CAD verification.</p>
    <pre data-testid="model-scene-context">{JSON.stringify(scene, null, 2)}</pre>
  </details>
  {#if view.historyNotice}<p class="history-notice" role="status" data-testid="model-history-notice">{view.historyNotice}</p>{/if}
  <p class="continuation" data-testid="model-continuation">{view.continuationActive ? 'Active server continuation · retained server history can be replayed on the next send.' : 'No active server continuation · retained messages are display-only; the next send starts a new server conversation.'}</p>
  {#if view.messages.length}
    <div class="history" aria-live="polite" data-testid="model-history">
      {#each view.messages as message, index (index)}
        <article class:assistant={message.role === 'assistant'} data-testid={`model-message-${index}`} data-role={message.role} data-state={message.state}>
          <strong>{message.role === 'user' ? 'You' : 'Model'}{message.role === 'assistant' ? ` · ${message.state}` : ''}</strong>
          <p class="message-text">{message.text || (message.state === 'streaming' ? 'Waiting for response…' : 'No completed answer.')}</p>
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
            <details class="tool-context"><summary>Read-only scene tool · actual context / evidence</summary><pre data-testid="model-tool-context">{JSON.stringify(context, null, 2)}</pre></details>
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
  {/if}
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
    <label for="local-draft">Describe your request</label>
    <textarea id="local-draft" data-testid="local-draft" bind:value={draft} rows="4" maxlength={MODEL_CLIENT_LIMITS.textChars} placeholder="Ask about Point 1 and Point 2 or describe your intended channel…"></textarea>
    <div class="composer-footer">
      <button bind:this={cameraButton} class="camera" type="button" title={visualSource ? 'Crop and attach scene screenshot' : 'Screenshot capture unavailable in this scene'} aria-label="Attach scene screenshot" data-testid="model-attach-screenshot" disabled={!visualSource || !catalogModelSelected || cropOpen || view.phase === 'streaming'} onclick={() => void attachScreenshot()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/></svg>
      </button>
      <button class="send" type="submit" data-testid="send-local-draft" disabled={!canSend}>Send <span aria-hidden="true">↑</span></button>
    </div>
  </form>
  <div class="progress" role="status" data-testid="local-draft-status" data-state={view.phase}>
    {#if view.phase !== 'idle' || view.code === 'history-limit-new-chat-required'}<p>{view.code}</p>{/if}
    {#if view.phase === 'streaming'}<p>Streaming model text · read-only scene inspection only. Waiting for a verified stream ending.</p>{/if}
    {#if view.phase === 'error' || view.phase === 'cancelled'}<p>No automatic retry. Partial text is incomplete; no geometry was changed by this chat.</p>{/if}
  </div>
  <button type="button" data-testid="model-cancel" disabled={view.phase !== 'streaming' && view.catalogPhase !== 'loading'} onclick={() => controller.cancel()}>Cancel model request</button>
  <p class="boundary">Model text is not verification. This chat cannot approve edits, create channels/CAD, save projects or change geometry. Use the separate human exact-approval tools for box or volatile Toronto point edits.</p>
</section>
{#if cropOpen}<ScreenshotCrop observation={cropObservation} loading={captureBusy} error={captureError} isCurrent={() => cropCurrent()} onattach={image => { cropAttach(image); void restoreCameraFocus(); }} oncancel={() => { removeAttachment(); void restoreCameraFocus(); }} />{/if}

<style>
  .model-chat { margin-top: 22px; min-width: 0; }
  .screenshot-attachment { display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 11px; color: #b5c9dc; }
  .screenshot-attachment img { width: 64px; height: 44px; object-fit: contain; background: #0d1724; border-radius: 4px; }
  .camera { display: inline-flex; align-items: center; justify-content: center; padding: 7px; }
  .catalog-actions, .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  button { background: #1c2a40; color: #e4ecf7; border: 1px solid #3a4e66; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-size: 12px; }
  button:disabled { opacity: .4; }
  label { display: block; font-size: 12px; margin: 12px 0 8px; color: #c1cfe0; }
  select, textarea { width: 100%; min-width: 0; background: #0d1724; color: #e4ecf7; border: 1px solid #3b506a; border-radius: 8px; padding: 10px; }
  textarea { resize: vertical; min-height: 116px; } textarea::placeholder { color: #607793; }
  p { font-size: 11px; color: #9badc3; overflow-wrap: anywhere; }
  .bound-scene { font-size: 11px; color: #9badc3; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; font-size: 10px; }
  .history-notice { border-left: 2px solid #d4b474; padding: 8px 10px; color: #ddc998; background: #28271f; }
  .history { max-height: 520px; overflow: auto; margin: 18px 0; }
  article { padding: 12px; border: 1px solid #33485e; border-radius: 8px; margin: 10px 0; }
  article.assistant { background: #142331; } article strong { font-size: 11px; color: #c6e4dc; }
  .message-text { white-space: pre-wrap; font-size: 12px; color: #d9e4ed; }
  .message-failure { margin-top: 12px; padding: 10px; border: 1px solid #ce9b59; border-left: 4px solid #edc17f; border-radius: 6px; background: #34271d; }
  .message-failure strong { color: #ffe0af; font-size: 12px; }
  .message-failure p { color: #f0d7b4; font-size: 12px; margin: 8px 0 0; }
  .message-failure .recovery { color: #fff0db; }
  .message-failure .incomplete { color: #d6bd99; font-size: 10px; }
  .tool-context { font-size: 10px; color: #95b6bc; }
  .request-inspector { margin-top: 12px; padding: 10px; border: 1px solid #486078; border-radius: 6px; font-size: 11px; color: #c5d9ed; }
  .request-inspector summary { cursor: pointer; overflow-wrap: anywhere; }
  .request-round { margin-top: 10px; padding-top: 8px; border-top: 1px solid #33485e; }
  .request-round pre { background: #0d1724; padding: 8px; }
  .continuation { font-size: 10px; color: #9bb4cb; }
  .composer-footer { margin-top: 10px; }
  .send { background: #99e4d4; color: #102b2e; border-color: #99e4d4; font-weight: 600; } .send span { margin-left: 8px; }
  .progress p { color: #dcc38a; } .boundary { font-size: 10px; color: #8197b1; }
</style>
