<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectSnapshot } from '@spatial/contracts';
  import { ChatController, type ChatEntry } from './chat-client';
  let { snapshot }: { snapshot: ProjectSnapshot } = $props();
  let command = $state('metadata');
  let entry = $state<ChatEntry>();
  let controller: ChatController | undefined;
  onMount(() => {
    controller = new ChatController({ sessionId: snapshot.sessionId, projectRevision: snapshot.project.revision }, value => entry = value);
    return () => controller?.dispose();
  });
  const reply = $derived(entry?.response?.reply);
</script>

<aside class="chat" aria-label="Read-only harness chat" data-testid="chat">
  <h2>Inspection chat</h2>
  <p>Deterministic commands · no model · no edits</p>
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
  <form onsubmit={event => { event.preventDefault(); void controller?.submit(command); }}>
    <label for="inspection-command">Inspection command</label>
    <input id="inspection-command" data-testid="chat-command" bind:value={command} maxlength="80" autocomplete="off" />
    <p class="help">Exact grammar: <code>metadata</code> or <code>observe B D</code> (B=1..4096, D=0..3). Bounded first-chunk sample only; not exhaustive or CAD verification.</p>
    <div class="actions"><button type="submit" disabled={entry?.state === 'pending'}>Send inspection</button><button type="button" onclick={() => controller?.cancel()} disabled={entry?.state !== 'pending'}>Cancel inspection</button></div>
  </form>
  {#if entry}
    <section aria-live="polite" data-testid="chat-result" data-state={entry.state}>
      <h3>{entry.state}</h3><p>{entry.code}</p>
      {#if entry.state === 'pending'}<p>Preparing trusted assets / running dispatcher… First use hashes fixed prepared files; cancellation is available.</p>{/if}
      {#if entry.code === 'unsupported-command'}<p>Unsupported request. Use the exact documented grammar. No model answer was generated.</p>{/if}
      {#if entry.response?.evidence}<dl data-testid="chat-evidence"><dt>Run / request reference</dt><dd>{entry.response.evidence.runId} / {entry.response.evidence.requestId}</dd><dt>Semantic outcome hash</dt><dd>{entry.response.evidence.semanticHash}</dd><dt>Configuration hash</dt><dd>{entry.response.evidence.configHash}</dd></dl>{/if}
      {#if reply}<details><summary>Canonical tool request</summary><pre data-testid="chat-request">{JSON.stringify(reply.request, null, 2)}</pre></details><details><summary>Dispatcher result / evidence</summary><pre data-testid="chat-tool-result">{JSON.stringify(reply.outcome, null, 2)}</pre></details>{/if}
    </section>
  {/if}
</aside>

<style>
  .chat { min-width: 0; background: #151f30; padding: 20px; border-left: 1px solid #344660; }
  h2 { margin-top: 0; } h3 { text-transform: capitalize; }
  p, dt, .help { color: #a1b3ca; font-size: 12px; }
  section { border-top: 1px solid #344660; margin-top: 16px; padding-top: 14px; }
  dt { margin-top: 8px; } dd { margin: 0; overflow-wrap: anywhere; font-size: 12px; }
  label { display: block; margin-top: 20px; } input { width: 100%; background: #0b1220; color: #e4ecf7; border: 1px solid #52657e; padding: 10px; }
  .actions { display: flex; gap: 8px; } button { background: #1c2a40; color: #e4ecf7; border: 1px solid #52657e; border-radius: 7px; padding: 8px; cursor: pointer; } button:disabled { opacity: .45; cursor: default; }
  input:focus-visible, button:focus-visible { outline: 2px solid #ffc766; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; font-size: 11px; } summary { cursor: pointer; }
</style>
