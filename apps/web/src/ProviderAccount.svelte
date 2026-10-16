<script lang="ts">
  import { onMount } from 'svelte';
  import { ProviderAccountController, PROVIDER_AUTH_URL, accountDescription, canonicalWorkspace, type AccountView } from './provider-account';
  let view = $state<AccountView>({ phase: 'loading' });
  let canonical = $state(false);
  let previousStatus: string | undefined;
  const controller = new ProviderAccountController(value => {
    view = value;
    // Loading an unchanged status must not discard a model conversation. Logout invalidates immediately.
    const status = value.phase === 'available' ? JSON.stringify(value.status) : value.phase === 'unavailable' ? 'unavailable' : undefined;
    if (typeof window !== 'undefined' && (value.phase === 'logging-out' || (status !== undefined && previousStatus !== undefined && status !== previousStatus))) {
      window.dispatchEvent(new Event('spatial-provider-change'));
    }
    if (status !== undefined) previousStatus = status;
  });
  onMount(() => {
    canonical = canonicalWorkspace(window.location.origin);
    if (!canonical) { view = { phase: 'unavailable' }; return () => controller.dispose(); }
    void controller.refresh();
    const refresh = () => { if (document.visibilityState === 'visible') void controller.refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      controller.dispose();
    };
  });
</script>

<details class="account" data-testid="provider-account">
  <summary>Account <span>· Sign in with ChatGPT</span></summary>
  <section class="account-panel" aria-label="Provider account">
    <h2>Provider account</h2>
    <div role="status" aria-live="polite" data-testid="provider-status">
      {#if view.phase === 'loading'}<p>Checking provider status…</p>
      {:else if view.phase === 'logging-out'}<p>Signing out and clearing server credentials…</p>
      {:else if view.phase === 'unavailable'}<p>Provider status unavailable. Start the local server, use the 127.0.0.1 workspace, then refresh. The server may be offline, deny this origin, or return an invalid response.</p>
      {:else if view.status}<p>{accountDescription(view.status)}</p>{/if}
    </div>
    <p class="model-note">In Scene chat, use Refresh models and choose a model before sending. Credential readiness alone does not prove model availability. Chat is read-only; exact-approval scene tools remain separate.</p>
    {#if view.status?.mode === 'disabled'}
      <p>To enable Sign in with ChatGPT, set <code>SPATIAL_PROVIDER_MODE=chatgpt</code> in <code>apps/server/.env</code>, then restart the server. Open the workspace at <code>http://127.0.0.1:5173</code>, not localhost.</p>
    {:else if view.status?.mode === 'api-key'}
      <p>API keys are configured only in <code>apps/server/.env</code> using <code>SPATIAL_PROVIDER_MODE=api-key</code> and <code>OPENAI_API_KEY</code>. Restart the server after changes. Never enter keys in this workspace.</p>
    {/if}
    {#if canonical}
      <a class="signin" href={PROVIDER_AUTH_URL} target="_blank" rel="noopener noreferrer">Sign in with ChatGPT ↗</a>
      <p>The local backend utility opens in a new tab. Choose <strong>Continue with ChatGPT</strong> there; return here and refresh status. ChatGPT mode must be enabled on the server. Your scene stays open.</p>
    {:else}
      <p>Sign-in is available only from the HTTP 127.0.0.1 workspace. Open <code>http://127.0.0.1:5173</code>; localhost and remote hosts are not supported.</p>
    {/if}
    <div class="actions">
      <button onclick={() => void controller.refresh()} disabled={!canonical || view.phase === 'logging-out'}>Refresh status</button>
      <button onclick={() => void controller.logout()} disabled={!canonical || !view.status || view.status.mode === 'disabled' || view.phase === 'logging-out'}>Sign out / clear credentials</button>
    </div>
    <div aria-live="polite" data-testid="provider-logout-result">
      {#if view.notice === 'chatgpt-revoked'}<p>Local credentials cleared. Remote revocation confirmed only for renewable sessions held by this logout call, not previously cleared sessions.</p>
      {:else if view.notice === 'chatgpt-unconfirmed'}<p>Local credentials cleared. Remote revocation was not confirmed (also possible when no tokens remained). Disconnect the app in ChatGPT Settings if needed; earlier cleared sessions cannot be certified here.</p>
      {:else if view.notice === 'local-cleared'}<p>Server runtime credentials cleared locally; no provider-side API key revocation was performed. A configured API key is read again on server restart. Remove it from server configuration to disable it permanently.</p>
      {:else if view.notice === 'logout-unknown'}<p>Logout outcome unknown. The request may have reached the server; local clearing and remote revocation cannot be confirmed. Refresh status to check current local state; use ChatGPT Settings to disconnect if needed.</p>{/if}
    </div>
    <p class="privacy">Credentials stay on the backend. This panel never collects keys or stores tokens in the browser.</p>
  </section>
</details>

<style>
  .account { position: relative; margin-left: auto; font-size: 12px; }
  summary { border: 1px solid #3d6469; border-radius: 7px; padding: 8px 12px; color: #c6f4e9; cursor: pointer; white-space: nowrap; }
  summary:hover { background: #233d42; }
  summary span { color: #b8c8dd; }
  .account-panel { position: absolute; z-index: 30; right: 0; top: calc(100% + 10px); width: min(440px, calc(100vw - 32px)); max-height: 75vh; overflow: auto; padding: 18px; background: #111d2d; border: 1px solid #3b526c; border-radius: 10px; box-shadow: 0 12px 32px #0008; color: #bdccdf; overflow-wrap: anywhere; }
  h2 { color: #e4ecf7; font-size: 16px; margin: 0 0 12px; }
  p { margin: 10px 0; }
  .model-note { padding: 9px; background: #293126; color: #e4dba5; border-radius: 5px; }
  code { color: #d1e7f5; }
  .signin { display: inline-block; padding: 9px 12px; border: 1px solid #4c8a83; border-radius: 6px; color: #c6f4e9; text-decoration: none; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; color: #d2e1f3; background: #21344a; border: 1px solid #49607b; border-radius: 5px; padding: 8px 10px; cursor: pointer; }
  button:disabled { opacity: .5; }
  .privacy { color: #94a8c1; font-size: 11px; }
  @media (max-width: 760px) { .account { margin-left: auto; } summary { padding: 7px; } summary span { display: none; } }
</style>
