<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { MODEL_VISUAL_LIMITS, modelVisualImageSize, type BrowserCaptureRequest, type ModelReferenceSelection, type ModelScene, type ModelVisualObservation, type VisualObservation } from '@spatial/contracts';
  import ScreenshotCrop from './visual/ScreenshotCrop.svelte';
  import { compressScreenshot } from './visual/screenshot-crop';
  import { placementWitnesses } from '../scenes/toronto/placement/utility-box-evidence';
  import { semanticName } from '../scenes/toronto/points/point-presentation';
  import SafeMarkdown from '../components/SafeMarkdown.svelte';
  import { ModelChatController, MODEL_CLIENT_LIMITS, modelFailureDescription, type ModelChatView, type VisualModelAttachment } from './model-chat-client';
  import type { AreaOfInterestInput } from '../scenes/toronto/placement/area-of-interest';
  import type { VisualModelSource } from './visual/visual-model-source';
  import type { TorontoDraftPoint } from './draft-context';
  import { canonicalPoleRequest } from '@spatial/contracts';
  import { validatePoleResult } from '../scenes/toronto/inspection/pole-client';
  let { areaInput, scene, visualSource, points = [], onverifiedresult = () => {}, onplacementsearch, onareacandidates, onscenemarks, onauthorityproposal = () => {}, onproposal = () => {}, oninvalidateproposals = () => {}, onstreamingchange = () => {}, onselectreference, onauthorityrefresh, proposalsBlocked = false }: {
    areaInput?: AreaOfInterestInput;
    scene: ModelScene; visualSource?: VisualModelSource; points?: readonly TorontoDraftPoint[]; onverifiedresult?: (context: unknown) => void;
    onplacementsearch?: (result: unknown, current: () => boolean) => Promise<void>;
    onareacandidates?: (result: unknown, current: () => boolean) => Promise<void>;
    onscenemarks?: (snapshot: unknown) => void;
    onauthorityproposal?: (kind: 'points' | 'cad' | 'objects') => void;
    onproposal?: (proposal: unknown, isCurrent: () => boolean) => void; oninvalidateproposals?: () => void;
    onstreamingchange?: (streaming: boolean) => void; proposalsBlocked?: boolean;
    onselectreference?: (reference: ModelReferenceSelection, isCurrent: () => boolean) => Promise<ModelScene>;
    onauthorityrefresh?: () => Promise<ModelScene>;
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
  let attachment = $state<VisualModelAttachment>(), captureBusy = $state(false), captureError = $state('');
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
    captureTicket++; captureBusy = false; attachment = undefined; captureError = '';
    cropOpen = false; cropObservation = undefined; cropCurrent = () => false; cropAttach = () => {};
  }
  async function attachScreenshot() {
    const source = visualSource, mode = scene.mode;
    if (!source || cropOpen || captureBusy) return;
    removeAttachment(); const ticket = ++captureTicket; captureBusy = true; cropOpen = true;
    // The bytes describe the captured instant, not the current camera or authority.
    const current = () => alive && ticket === captureTicket && mode === scene.mode;
    try {
      const observation = await source.capture();
      if (!alive || ticket !== captureTicket) return;
      if (!current()) return;
      if (observation.image.byteLength > MODEL_VISUAL_LIMITS.sourcePngBytes) throw new Error('Source screenshot exceeds the 12 MiB capture limit.');
      const observationId = observation.observationId;
      cropCurrent = current;
      cropAttach = image => {
        if (!cropCurrent()) return;
        attachment = { observation: image, isCurrent: () => source.isCurrent(observationId), resolvePixel: (id, x, y) => source.resolvePixel(id, x, y) };
        cropOpen = false; cropObservation = undefined;
      };
      cropObservation = observation;
    } catch (error) { if (alive && ticket === captureTicket) captureError = error instanceof Error ? error.message : 'Screenshot unavailable.'; }
    finally { if (alive && ticket === captureTicket) captureBusy = false; }
  }
  async function send(submitted = draft) {
    if (!readyToSend || !submitted.trim()) return;
    const current = effectiveAttachment;
    const pending = controller.send(submitted, current);
    // Admission is synchronous; clear before awaiting network/approval, not after completion.
    // Rejected submissions (for example the history limit) keep their draft and image.
    if (view.phase === 'streaming') {
      draft = '';
      if (attachment === current) removeAttachment();
    }
    await pending;
  }
  async function editMessage(text: string) {
    draft = text;
    await tick();
    draftInput?.focus();
  }
  let draft = $state('');
  let draftInput: HTMLTextAreaElement;
  let view = $state<ModelChatView>({ catalogPhase: 'idle', model: '', phase: 'idle', code: 'refresh-models', messages: [] });
  let approvalWaiting = $state(false);
  async function captureForAgent(request: BrowserCaptureRequest, isCurrent: () => boolean, signal?: AbortSignal): Promise<VisualModelAttachment> {
    const source = visualSource;
    if (!source || !isCurrent()) throw new Error('Scene capture unavailable.');
    const observation = await (source.captureSnapshot ? source.captureSnapshot(request, signal) : source.capture(request, signal));
    const image = await compressScreenshot(observation, { x: 0, y: 0, width: observation.viewport.width, height: observation.viewport.height }, () => alive && isCurrent());
    return { observation: image, isCurrent: () => source.isCurrent(observation.observationId), resolvePixel: (id, x, y) => source.resolvePixel(id, x, y) };
  }
  const controller = new ModelChatController(value => { view = value; onstreamingchange(value.phase === 'streaming'); }, undefined, undefined, undefined,
    { onproposal: (proposal, current) => onproposal(proposal, current), oninvalidate: () => oninvalidateproposals(), onauthorityproposal: kind => onauthorityproposal(kind),
      oncapture: captureForAgent,
      onscenemarks: snapshot => { if (!onscenemarks || !alive || scene.mode !== 'toronto' && scene.mode !== 'cloud') throw new Error('Location annotations unavailable.'); onscenemarks(snapshot); },
      onareacandidates: (result, current) => { if (!onareacandidates) throw new Error('Candidate display unavailable.'); return onareacandidates(result, current); },
      onplacementsearch: (result, current) => { if (!onplacementsearch) throw new Error('Placement display unavailable.'); return onplacementsearch(result, current); },
      onselectreference: (reference, current) => { if (!onselectreference) throw new Error('Reference selection unavailable.'); return onselectreference(reference, current); },
      onauthorityrefresh: () => { if (!onauthorityrefresh) throw new Error('Authority refresh unavailable.'); return onauthorityrefresh(); },
      onapprovalwait: waiting => approvalWaiting = waiting });
  $effect(() => controller.bind(scene));
  // Mode switches clear local image input. Geometry/view changes do not rewrite past pixels.
  // controller.bind independently owns current scene/tool binding and response invalidation.
  const captureMode = $derived(scene.mode);
  $effect(() => { captureMode; untrack(() => removeAttachment()); });
  const effectiveAttachment = $derived(attachment ?? areaInput?.attachment);
  const showingAreaSnapshot = $derived(!attachment && !!areaInput?.attachment);
  const areaIdentity = $derived(areaInput?.area);
  $effect(() => { areaIdentity; untrack(() => removeAttachment()); });
  const readyToSend = $derived(!areaInput?.pending && !areaInput?.error && !proposalsBlocked && view.catalogPhase === 'ready' && view.catalog?.ready && !!view.model && view.phase !== 'streaming' && !captureBusy && !cropOpen);
  const canSend = $derived(readyToSend && !!draft.trim());
  const lastUserIndex = $derived(view.messages.map(message => message.role).lastIndexOf('user'));
  onMount(() => {
    // Discovery is read-only. Focus alone never erases a conversation or retries inference.
    const revalidate = () => { void controller.refreshModels(); };
    const changed = () => { controller.accountChanged(); revalidate(); };
    const visibility = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('spatial-provider-change', changed);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', visibility);
    revalidate();
    return () => {
      alive = false; captureTicket++;
      window.removeEventListener('spatial-provider-change', changed);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', visibility);
      controller.dispose();
    };
  });
</script>

<section class="model-chat" data-testid="model-chat" data-state={view.phase} aria-label="Model conversation">
  <div class="chat-toolbar">
    <label class="model-label" for="chat-model">Model</label>
    <select id="chat-model" data-testid="model-select" aria-label="Chat model" value={view.model} onchange={event => controller.selectModel(event.currentTarget.value)} disabled={!view.catalog?.ready || view.catalogPhase !== 'ready'}>
      <option value="">Choose a model…</option>
      {#each view.catalog?.models ?? [] as model (model.id)}<option value={model.id}>{model.label}</option>{/each}
    </select>
    <button type="button" data-testid="model-new-chat" onclick={() => { controller.newChat(); visualSource?.releaseGrounding?.(); removeAttachment(); }}>New chat</button>
  </div>
  {#if view.catalogPhase === 'error' || (view.catalogPhase === 'ready' && (!view.catalog?.ready || !view.catalog.models.length))}
    <div class="catalog-recovery" role="alert" data-testid="model-catalog-recovery">
      <p>Models unavailable. Check Account and server connectivity, then retry.</p>
      <button type="button" onclick={() => void controller.refreshModels()}>Retry models</button>
    </div>
  {/if}
  <div class="conversation-scroll" role="region" aria-label="Conversation and model context">
  <details class="model-settings" data-testid="model-settings">
    <summary>Session details{view.catalogPhase === 'error' || (view.catalogPhase === 'ready' && !view.catalog?.ready) ? ' · unavailable' : ''}</summary>
    <div class="catalog-actions">
      <button type="button" data-testid="model-refresh" onclick={() => void controller.refreshModels()} disabled={view.catalogPhase === 'loading'}>{view.catalogPhase === 'loading' ? 'Loading models…' : 'Refresh models'}</button>
    </div>
  <p class="catalog-status" role="status" data-testid="model-catalog-status">
    {#if view.catalogPhase === 'idle'}Models load automatically. No message is sent until you choose Send.
    {:else if view.catalogPhase === 'loading'}Discovering models from the server's configured provider…
    {:else if view.catalogPhase === 'error'}Model catalog unavailable. Check Account, server connectivity and permissions, then refresh. No fallback provider was used.
    {:else if !view.catalog?.ready}Model unavailable · {view.catalog?.mode} · {view.catalog?.code}. Account readiness alone does not authorize inference.
    {:else if !view.catalog.models.length}No usable models were returned by the configured provider.
    {:else}{view.catalog.mode === 'chatgpt' ? 'ChatGPT plan' : 'API key'} · {view.model ? 'Models available' : 'Select a model to enable Send.'}{/if}
  </p>
  <details class="bound-scene"><summary>Context &amp; session · {scene.mode}</summary>
    <pre data-testid="model-scene-context">{JSON.stringify(scene, null, 2)}</pre>
    <p class="continuation" data-testid="model-continuation">{view.continuationActive ? 'Active server continuation · retained server history can be replayed on the next send.' : 'No active server continuation · retained messages are display-only; the next send starts a new server conversation.'}</p>
  </details>
  <details class="boundary"><summary>Changes require your approval</summary><p>Chat can propose point translations and real kernel solids in Toronto local meters. Accept or Decline each retained change; only human Accept publishes. State is volatile.</p></details>
  </details>
  {#if view.historyNotice}
    <p class="continuation" role="status" data-testid="model-history-notice">{view.historyNotice}</p>
  {/if}
  {#if view.messages.length}
    <div class="history" aria-live="polite" data-testid="model-history">
      {#each view.messages as message, index (index)}
        <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'} data-testid={`model-message-${index}`} data-role={message.role} data-state={message.state}>
          {#each message.attachments ?? [] as image}
            <a class="message-image" href={image.image.dataUrl} target="_blank" rel="noreferrer" aria-label="Open attached scene screenshot">
              <img src={image.image.dataUrl} alt={message.role === 'user' ? 'Attached scene screenshot' : 'Scene screenshot captured by the assistant'} loading="lazy" data-testid="model-message-image" />
            </a>
          {/each}
          {#if message.role === 'assistant'}
            <div class="message-body"><SafeMarkdown text={message.text || (message.state === 'streaming' ? 'Waiting for response…' : 'No completed answer.')} /></div>
          {:else}
            <p class="message-text">{message.text || 'Empty message'}</p>
            <div class="message-actions">
              <button type="button" aria-label="Edit message" title="Edit in composer · sends as a new message" data-testid="model-edit-message" disabled={view.phase === 'streaming' || !!draft.trim()} onclick={() => void editMessage(message.text)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5Z M13 6l5 5"/></svg>
              </button>
              {#if index === lastUserIndex}
                <button type="button" aria-label="Retry message" title="Send again using the current scene" data-testid="model-retry-message" disabled={!readyToSend || !!draft.trim()} onclick={() => void send(message.text)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5 M20 12a8 8 0 1 0-2 6 M20 7l-3-3"/></svg>
                </button>
              {/if}
            </div>
          {/if}
          {#if message.role === 'assistant'}
            <details class="request-inspector" data-testid="model-request-inspector">
              <summary>Actual model requests · {message.inspections?.length ?? 0} retained rounds</summary>
              {#if message.inspectionsDropped}<p data-testid="model-inspection-evicted">{message.inspectionsDropped} older request snapshots evicted from memory.</p>{/if}
              {#if !message.inspections?.length}<p>No retained request snapshot. Preparation may not have reached the provider adapter.</p>{/if}
              {#each message.inspections ?? [] as inspection (inspection.round)}
                <details class="request-round" data-testid="model-request-round" data-phase={inspection.phase}>
                  <summary>Round {inspection.round} · {inspection.phase} · {inspection.mode === 'chatgpt' ? 'ChatGPT plan' : 'API key'}</summary>
                  <p data-testid="model-request-omissions">Omissions: {inspection.omissions.join(', ')}</p>
                  <pre data-testid="model-request-body">{JSON.stringify(JSON.parse(inspection.bodyJson), null, 2)}</pre>
                </details>
              {/each}
            </details>
          {/if}
          {#each message.tools as context}
            <details class="tool-context"><summary>Tool evidence</summary>
              {#each placementWitnesses(context, points) as evidence}
                <button type="button" data-testid="model-select-placement-witness" onclick={() => onverifiedresult(evidence)}>Show {evidence.volume === 'body' ? 'box' : 'access'} conflict · {semanticName(evidence.witness.label)}</button>
              {/each}
              <pre data-testid="model-tool-context">{JSON.stringify(context, null, 2)}</pre>
            </details>
            {#if selectableNearest(context)}<button type="button" data-testid="model-select-nearest" onclick={() => onverifiedresult(context)}>Select verified result</button>{/if}
          {/each}
          {#if message.state === 'incomplete'}
            {@const failure = modelFailureDescription(message.failureCode)}
            <div class="message-failure" role="status" data-testid="model-message-failure">
              <strong>{failure.title}</strong>
              <p>{failure.detail}</p>
              <p class="recovery"><b>Next step:</b> {failure.recovery}</p>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
  </div>
  <form class="composer" data-testid="local-draft-form" onsubmit={event => { event.preventDefault(); void send(); }}>
    {#if effectiveAttachment}
      {@const size = modelVisualImageSize(effectiveAttachment.observation)}
      <div class="screenshot-attachment" aria-label="Attached scene screenshot">
        <img data-testid="model-image-preview" src={effectiveAttachment.observation.image.dataUrl} alt="Scene crop attached to the next send" />
        <span data-testid="model-image-status" role="status">{size.width} × {size.height} JPEG · {Math.ceil(effectiveAttachment.observation.image.byteLength / 1024)} KB{showingAreaSnapshot ? ' · Area of interest' : ''}</span>
        <button type="button" title={showingAreaSnapshot ? 'Clear area of interest and snapshot' : 'Remove screenshot'} aria-label={showingAreaSnapshot ? 'Clear area of interest and snapshot' : 'Remove screenshot'} data-testid="model-remove-screenshot" disabled={showingAreaSnapshot && view.phase === 'streaming'} onclick={() => showingAreaSnapshot ? areaInput?.clear() : removeAttachment()}>×</button>
      </div>
    {/if}
    {#if areaInput?.pending}<p role="status">Capturing area of interest…</p>{/if}
    {#if areaInput?.error}<p role="alert">{areaInput.error}</p>{/if}
    {#if captureError && !cropOpen}<p role="alert" data-testid="model-image-error">{captureError}</p>{/if}
    <label class="draft-label" for="local-draft">Message</label>
    <textarea id="local-draft" data-testid="local-draft" bind:this={draftInput} bind:value={draft} rows="2" maxlength={MODEL_CLIENT_LIMITS.textChars} placeholder="Ask about the scene…" onkeydown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!event.repeat) void send();
      }
    }}></textarea>
    <div class="composer-footer">
      <button bind:this={cameraButton} class="camera" type="button" title={visualSource ? 'Crop and attach scene screenshot' : 'Screenshot capture unavailable in this scene'} aria-label="Attach scene screenshot" data-testid="model-attach-screenshot" disabled={!visualSource || cropOpen || captureBusy} onclick={() => void attachScreenshot()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/></svg>
      </button>
      <button class="cancel" type="button" data-testid="model-cancel" disabled={view.phase !== 'streaming' && view.catalogPhase !== 'loading'} onclick={() => controller.cancel()}>Cancel</button>
      <button class="send" type="submit" data-testid="send-local-draft" disabled={!canSend}>Send <span aria-hidden="true">↑</span></button>
    </div>
  </form>
  <div class="progress" role="status" data-testid="local-draft-status" data-state={view.phase}>
    {#if view.phase === 'streaming'}<p>{approvalWaiting ? 'Waiting for your review…' : 'Responding…'}</p>{/if}
    {#if view.code === 'history-limit-new-chat-required'}<p>Conversation limit reached. Start a new chat to continue.</p>{/if}
  </div>
  {#if proposalsBlocked && view.phase !== 'streaming'}<p role="status">Sending is blocked while an authority request is pending or Refresh is required. Refresh the active point/CAD authority before proposing more changes.</p>{/if}
</section>
{#if cropOpen}<ScreenshotCrop observation={cropObservation} loading={captureBusy} error={captureError} isCurrent={() => cropCurrent()} onattach={image => { cropAttach(image); void restoreCameraFocus(); }} oncancel={() => { removeAttachment(); void restoreCameraFocus(); }} />{/if}

<style>
  .model-chat { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
  .chat-toolbar, .catalog-actions, .composer-footer { display: flex; align-items: center; gap: 8px; }
  .chat-toolbar { flex-shrink: 0; justify-content: space-between; margin-bottom: 8px; }
  .chat-toolbar select { flex: 1; min-width: 0; width: 0; padding: 7px 8px; text-overflow: ellipsis; }
  .catalog-recovery { flex-shrink: 0; max-height: 110px; overflow: auto; margin-bottom: 8px; padding: 8px 10px; border: 1px solid #a37e46; border-radius: 8px; }
  .catalog-recovery p { margin: 0 0 6px; color: #f2d5a6; }
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
  .history { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; margin: 16px 0 0; }
  article { box-sizing: border-box; min-width: 0; max-width: 94%; padding: 12px; border-radius: 14px 14px 14px 4px; background: #28292e; border: 1px solid #ffffff0b; }
  article.assistant { align-self: flex-start; }
  article.user { align-self: flex-end; max-width: 86%; background: #253c61; border-color: #6197e424; border-radius: 14px 14px 4px 14px; }
  .message-image { display: block; margin-bottom: 8px; }
  .message-image img { display: block; max-width: 100%; max-height: 240px; object-fit: contain; border-radius: 8px; }
  .message-body { margin: 0; }
  .message-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #ededf2; margin: 0; }
  .message-failure { margin-top: 10px; padding: 10px; border: 1px solid #a37e46; border-left: 4px solid #d2a45e; border-radius: 8px; background: #30271c; }
  .message-failure strong { color: #f2d5a6; font-size: 11px; }
  .message-failure p { color: #d9c4a6; margin: 8px 0 0; }
  .message-failure .recovery { color: #f1e0c9; }
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
  .message-actions { display: flex; justify-content: flex-end; gap: 2px; opacity: 0; }
  article:hover .message-actions, article:focus-within .message-actions { opacity: 1; }
  .message-actions button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; background: transparent; border-color: transparent; color: #b7b7c2; }
  .message-actions button:hover { background: #ffffff0c; color: white; }
  @media (hover: none) { .message-actions { opacity: 1; } .message-actions button { width: 36px; height: 36px; } }
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
