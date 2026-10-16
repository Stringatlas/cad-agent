<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModelScene } from '@spatial/contracts';
  import { ModelChatController, MODEL_CLIENT_LIMITS, modelFailureDescription, type ModelChatView } from './model-chat-client';
  let { scene }: { scene: ModelScene } = $props();
  let draft = $state('');
  let view = $state<ModelChatView>({ catalogPhase: 'idle', model: '', phase: 'idle', code: 'refresh-models', messages: [] });
  const controller = new ModelChatController(value => view = value);
  $effect(() => controller.bind(scene));
  const canSend = $derived(view.catalogPhase === 'ready' && view.catalog?.ready && !!view.model && view.phase !== 'streaming' && !!draft.trim());
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
    <button type="button" data-testid="model-new-chat" onclick={() => controller.newChat()}>New chat</button>
  </div>
  <label for="chat-model">Configured provider model</label>
  <select id="chat-model" data-testid="model-select" value={view.model} onchange={event => controller.selectModel(event.currentTarget.value)} disabled={!view.catalog?.ready || view.catalogPhase !== 'ready'}>
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
  {#if view.messages.length}
    <div class="history" aria-live="polite" data-testid="model-history">
      {#each view.messages as message, index (index)}
        <article class:assistant={message.role === 'assistant'} data-testid={`model-message-${index}`} data-role={message.role} data-state={message.state}>
          <strong>{message.role === 'user' ? 'You' : 'Model'}{message.role === 'assistant' ? ` · ${message.state}` : ''}</strong>
          <p class="message-text">{message.text || (message.state === 'streaming' ? 'Waiting for response…' : 'No completed answer.')}</p>
          {#each message.tools as context}<details class="tool-context"><summary>Read-only inspect_scene · actual bound context</summary><pre data-testid="model-tool-context">{JSON.stringify(context, null, 2)}</pre></details>{/each}
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
  <form class="composer" data-testid="local-draft-form" onsubmit={event => { event.preventDefault(); if (canSend) void controller.send(draft); }}>
    <label for="local-draft">Describe your request</label>
    <textarea id="local-draft" data-testid="local-draft" bind:value={draft} rows="4" maxlength={MODEL_CLIENT_LIMITS.textChars} placeholder="Ask about points A and B or describe your intended channel…"></textarea>
    <div class="composer-footer"><button class="send" type="submit" data-testid="send-local-draft" disabled={!canSend}>Send <span aria-hidden="true">↑</span></button></div>
  </form>
  <div class="progress" role="status" data-testid="local-draft-status" data-state={view.phase}>
    {#if view.phase !== 'idle' || view.code === 'history-limit-new-chat-required'}<p>{view.code}</p>{/if}
    {#if view.phase === 'streaming'}<p>Streaming model text · read-only scene inspection only. Waiting for a verified stream ending.</p>{/if}
    {#if view.phase === 'error' || view.phase === 'cancelled'}<p>No automatic retry. Partial text is incomplete; no geometry was changed by this chat.</p>{/if}
  </div>
  <button type="button" data-testid="model-cancel" disabled={view.phase !== 'streaming' && view.catalogPhase !== 'loading'} onclick={() => controller.cancel()}>Cancel model request</button>
  <p class="boundary">Model text is not verification. This chat cannot approve edits, create channels/CAD, save projects or change geometry. Use the separate exact-approval tools for supported box edits.</p>
</section>

<style>
  .model-chat { margin-top: 22px; min-width: 0; }
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
  .composer-footer { margin-top: 10px; }
  .send { background: #99e4d4; color: #102b2e; border-color: #99e4d4; font-weight: 600; } .send span { margin-left: 8px; }
  .progress p { color: #dcc38a; } .boundary { font-size: 10px; color: #8197b1; }
</style>
