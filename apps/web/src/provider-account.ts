export type ProviderMode = 'disabled' | 'api-key' | 'chatgpt';
export type ProviderStatus = Readonly<{
  mode: ProviderMode;
  authenticated: boolean;
  ready: boolean;
  planUsageEnabled: boolean;
}>;
export type AccountView = Readonly<{
  phase: 'loading' | 'available' | 'unavailable' | 'logging-out';
  status?: ProviderStatus;
  notice?: 'chatgpt-revoked' | 'chatgpt-unconfirmed' | 'local-cleared' | 'logout-unknown';
}>;

export const PROVIDER_AUTH_URL = 'http://127.0.0.1:3001/auth';
export function canonicalWorkspace(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  } catch { return false; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account response');
  return value as Record<string, unknown>;
}
/** Copy only validated primitives; account IDs, labels and provider errors never enter UI state. */
export function validateProviderStatus(value: unknown): ProviderStatus {
  const data = record(value);
  const { mode, authenticated, ready, planUsageEnabled } = data;
  if (!['disabled', 'api-key', 'chatgpt'].includes(mode as string) ||
    typeof authenticated !== 'boolean' || typeof ready !== 'boolean' || typeof planUsageEnabled !== 'boolean' ||
    (ready && !authenticated) || (mode !== 'chatgpt' && planUsageEnabled) ||
    (mode === 'disabled' && (authenticated || ready)) ||
    (mode === 'api-key' && ready !== authenticated) ||
    (mode === 'chatgpt' && ((ready && !planUsageEnabled) || (planUsageEnabled && !authenticated)))) {
    throw new Error('Invalid account response');
  }
  return Object.freeze({ mode: mode as ProviderMode, authenticated, ready, planUsageEnabled });
}

export function accountDescription(status: ProviderStatus): string {
  if (status.mode === 'disabled') return 'Provider authentication is disabled.';
  if (status.mode === 'api-key') return status.ready ? 'API key configured on the server. Not validated with OpenAI.' : 'API key is not configured or was cleared from server runtime.';
  if (!status.authenticated) return 'ChatGPT · signed out.';
  if (!status.planUsageEnabled) return 'ChatGPT identity signed in; ChatGPT plan usage permission was not granted.';
  return status.ready ? 'ChatGPT credentials ready.' : 'ChatGPT signed in, but credentials are not ready. Reauthorize in the backend utility.';
}

/** All requests are same-origin, redirect-denied and bounded, including body reads. */
export class ProviderAccountController {
  view: AccountView = { phase: 'loading' };
  private generation = 0;
  private active?: AbortController;
  private disposed = false;
  private loggingOut = false;
  constructor(private publish: (view: AccountView) => void, private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private timeoutMs = 5000) {}

  private set(view: AccountView) { this.view = Object.freeze(view); this.publish(this.view); }
  private async request(path: '/auth/status' | '/auth/logout', signal: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(path, {
      method: path === '/auth/logout' ? 'POST' : 'GET',
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
      ...(path === '/auth/logout' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    });
    // Never consume or display a server/provider failure body.
    if (!response.ok) throw new Error('Account request unavailable');
    const envelope = record(await response.json());
    if (envelope.ok !== true) throw new Error('Account request unavailable');
    return envelope.result;
  }
  private async run(logout: boolean): Promise<void> {
    if (this.disposed || this.loggingOut) return;
    const previousMode = this.view.status?.mode;
    if (logout && !previousMode) return;
    const generation = ++this.generation;
    this.active?.abort();
    const controller = new AbortController(); this.active = controller;
    this.loggingOut = logout;
    const notice = this.view.notice;
    this.set({ phase: logout ? 'logging-out' : 'loading', notice });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted = () => {};
    const timeout = new Promise<never>((_, reject) => {
      aborted = () => { clearTimeout(timer); reject(new Error('Account request canceled')); };
      controller.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    });
    try {
      const result = await Promise.race([this.request(logout ? '/auth/logout' : '/auth/status', controller.signal), timeout]);
      if (this.disposed || generation !== this.generation) return;
      if (logout) {
        const { remoteRevocationConfirmed } = record(result);
        if (typeof remoteRevocationConfirmed !== 'boolean') throw new Error('Invalid logout response');
        this.set({ phase: 'available', status: Object.freeze({ mode: previousMode!, authenticated: false, ready: false, planUsageEnabled: false }),
          notice: previousMode === 'chatgpt' ? (remoteRevocationConfirmed ? 'chatgpt-revoked' : 'chatgpt-unconfirmed') : 'local-cleared' });
      } else this.set({ phase: 'available', status: validateProviderStatus(result), notice });
    } catch {
      if (!this.disposed && generation === this.generation) this.set({ phase: 'unavailable', notice: logout ? 'logout-unknown' : notice });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', aborted);
      if (generation === this.generation) { this.active = undefined; this.loggingOut = false; }
    }
  }
  refresh(): Promise<void> { return this.run(false); }
  logout(): Promise<void> { return this.run(true); }
  dispose(): void { this.disposed = true; ++this.generation; this.active?.abort(); this.active = undefined; }
}
