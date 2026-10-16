import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

export type ProviderMode = 'disabled' | 'api-key' | 'chatgpt';
export interface ProviderAuthOptions {
  mode: ProviderMode;
  apiKey?: string;
  credentialPath?: string;
  redirectUri?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const MAX_BYTES = 1024 * 1024;
const ATTEMPT_MS = 10 * 60 * 1000;
const TERMINAL_REFRESH = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused',
]);

type FailureCode = 'invalid' | 'unavailable' | 'retryable' | 'reauthorize' | 'storage';
/** Only these fixed messages/codes may cross the HTTP boundary. Never attach provider text. */
export class ProviderAuthError extends Error {
  constructor(public readonly code: FailureCode) {
    super(`Provider authentication failed (${code}).`);
    this.name = 'ProviderAuthError';
  }
}
function fail(code: FailureCode = 'invalid'): never { throw new ProviderAuthError(code); }
function sanitized(error: unknown): ProviderAuthError {
  return error instanceof ProviderAuthError ? error : new ProviderAuthError('invalid');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 32_768): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  return value;
}
function issued(value: unknown): string {
  const id = text(value, 512);
  if (!/^oaiapp_[A-Za-z0-9_-]+$/u.test(id)) fail();
  return id;
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail();
  return value;
}
interface Tokens {
  access?: string;
  refresh?: string;
  id?: string;
  scopes: string[];
  expiresAt: number;
  earliestRefreshAt: number;
}
interface Account { id: string; subject: string; tokens?: Tokens }
interface Store { version: 1; host: string; accounts: Account[]; selected?: string }
interface Pending {
  state: string; nonce: string; verifier: string; redirectUri: string;
  expiresAt: number; accountId?: string; clientId?: string; generation: number;
}
interface Discovery { jwks_uri: string; revocation_endpoint?: string }

/** Backend-only credentials. Never serialize this value into HTTP, evidence or logs. */
export interface ProviderCredential {
  mode: 'api-key' | 'chatgpt';
  bearer: string;
  baseUrl: string;
  constraints: Readonly<{
    billing: 'api-key' | 'chatgpt-plan';
    responsesOnly: boolean;
    store?: false;
    stream?: true;
    accountModelCatalog?: true;
  }>;
}

/** Local single-user OAuth runtime. No provider calls occur until callback, refresh or logout. */
export class ProviderAuth {
  private readonly options: ProviderAuthOptions;
  private readonly now: () => number;
  private readonly transport: typeof globalThis.fetch;
  private readonly path?: string;
  private store?: Store;
  private lockFd?: number;
  private closed = false;
  private generation = 0;
  private modelGeneration = randomUUID();
  private readonly generationListeners = new Set<() => void>();
  /** Opaque account lifecycle identity, independent of ordinary access-token rotation. */
  credentialGeneration(): string { return this.modelGeneration; }
  onCredentialChange(listener: () => void): () => void {
    this.generationListeners.add(listener);
    return () => { this.generationListeners.delete(listener); };
  }
  private invalidateModels(): void {
    this.modelGeneration = randomUUID();
    for (const listener of this.generationListeners) { try { listener(); } catch { /* Observers cannot break logout. */ } }
  }
  private pending = new Map<string, Pending>();
  private incomplete = new Map<string, { clientId: string; expiresAt: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private operations = 0;
  private discovery?: Discovery;
  private keys?: ReturnType<typeof createLocalJWKSet>;
  private keysAt = 0;
  private unconfirmedRevocation = false;

  constructor(options: ProviderAuthOptions) {
    this.options = { ...options };
    this.now = options.now ?? Date.now;
    this.transport = options.fetch ?? globalThis.fetch;
    if (!['disabled', 'api-key', 'chatgpt'].includes(options.mode)) fail();
    if (options.mode === 'api-key' && options.apiKey !== undefined) text(options.apiKey);
    if (options.mode !== 'chatgpt') return;
    if (!options.credentialPath || !isAbsolute(options.credentialPath)) fail('storage');
    this.path = resolve(options.credentialPath);
    this.callbackUri();
    // Existing state is loaded synchronously so status after restart is meaningful.
    // Disabled/API-key modes never inspect the filesystem, even if given a path.
    try {
      this.checkPath(this.path, false);
      if (existsSync(this.path)) this.ensureStore();
    } catch (error) {
      this.releaseLock();
      throw sanitized(error);
    }
  }

  status() {
    const selected = this.store?.accounts.find((account) => account.id === this.store?.selected);
    const tokens = selected?.tokens;
    const planUsageEnabled = !!tokens?.scopes.includes('chatgpt.tokens.use.direct') &&
      tokens.scopes.includes('resource.invoke');
    const apiReady = this.options.mode === 'api-key' && !!this.options.apiKey && !this.closed;
    return {
      mode: this.options.mode,
      authenticated: !this.closed && (apiReady || !!tokens),
      ready: !this.closed && (apiReady || (this.options.mode === 'chatgpt' && planUsageEnabled &&
        !!tokens?.access && tokens.expiresAt > this.now())),
      planUsageEnabled: this.options.mode === 'chatgpt' && planUsageEnabled && !this.closed,
      selectedAccount: this.store?.selected ?? null,
      accounts: (this.store?.accounts ?? []).map((account, index) => ({
        id: account.id, label: `ChatGPT account ${index + 1}`,
      })),
    };
  }

  async start(browserId: string, accountId?: string): Promise<string> {
    const generation = this.generation;
    return this.serial(async () => {
      this.active(generation);
      this.chatgpt();
      text(browserId, 512);
      const store = this.ensureStore();
      if (accountId !== undefined && !store.accounts.some((account) => account.id === accountId)) fail();
      if (accountId === undefined && store.accounts.length >= 64) fail('unavailable');
      for (const [key, attempt] of this.pending) {
        if (attempt.expiresAt <= this.now()) this.pending.delete(key);
      }
      for (const [key, registration] of this.incomplete) {
        if (registration.expiresAt <= this.now()) this.incomplete.delete(key);
      }
      if (accountId) this.incomplete.delete(browserId);
      const clientId = accountId ?? this.incomplete.get(browserId)?.clientId;
      if (!this.pending.has(browserId) && this.pending.size >= 16) fail('unavailable');
      const attempt: Pending = {
        state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
        verifier: randomBytes(64).toString('base64url'), redirectUri: this.callbackUri(),
        expiresAt: this.now() + ATTEMPT_MS, generation,
        ...(accountId === undefined ? {} : { accountId }),
        ...(clientId === undefined ? {} : { clientId }),
      };
      this.pending.set(browserId, attempt);
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: clientId ?? 'dynamic_agent_client', ext_agent_host_id: store.host,
        ...(!clientId ? { agent_name_hint: 'Spatial CAD Harness' } : {}),
        response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES,
        resource: RESOURCE, state: attempt.state, nonce: attempt.nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
      }).toString();
      // Deliberately no login_hint or id_token_hint: browser JavaScript receives this URL.
      return url.toString();
    });
  }

  async callback(browserId: string, url: URL): Promise<void> {
    const generation = this.generation;
    // Consume before asynchronous work/queueing: concurrent replay can never redeem twice.
    const attempt = this.pending.get(browserId);
    this.pending.delete(browserId);
    return this.serial(async () => {
      this.active(generation);
      this.chatgpt();
      if (!attempt || attempt.generation !== generation || attempt.expiresAt <= this.now()) fail();
      for (const key of new Set(url.searchParams.keys())) {
        if (url.searchParams.getAll(key).length !== 1) fail();
      }
      if (`${url.origin}${url.pathname}` !== attempt.redirectUri || url.hash ||
        url.searchParams.get('state') !== attempt.state || url.searchParams.has('error')) fail();
      const code = text(url.searchParams.get('code'));
      const returnedId = url.searchParams.get('client_id');
      const clientId = attempt.clientId ?? issued(returnedId);
      if (returnedId !== null && returnedId !== clientId) fail();
      const store = this.ensureStore();
      // A new registration must not replace an existing registration without selecting it.
      if (!attempt.accountId && store.accounts.some((account) => account.id === clientId)) fail();
      // Retain an incomplete issued registration privately for a fresh OAuth attempt after a
      // consumed/invalid code. It is not an account until a signed identity has been verified.
      if (!attempt.accountId) {
        if (this.incomplete.size >= 16 && !this.incomplete.has(browserId)) {
          this.incomplete.delete(this.incomplete.keys().next().value!);
        }
        this.incomplete.set(browserId, { clientId, expiresAt: this.now() + ATTEMPT_MS });
      }
      const data = await this.exchange({
        grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE,
      });
      if (this.closed || generation !== this.generation) {
        if (typeof data.refresh_token === 'string') await this.revokeLate(clientId, data.refresh_token);
        fail('unavailable');
      }
      try {
        const tokens = this.tokens(data);
        const subject = await this.identity(text(data.id_token), clientId, attempt.nonce);
        this.active(generation);
        const previous = store.accounts.find((account) => account.id === clientId);
        if (previous && previous.subject !== subject) fail();
        const next: Store = {
          ...store, selected: clientId,
          accounts: previous
            ? store.accounts.map((account) => account.id === clientId ? { id: clientId, subject, tokens } : account)
            : [...store.accounts, { id: clientId, subject, tokens }],
        };
        this.save(next);
        this.invalidateModels();
        this.incomplete.delete(browserId);
      } catch (error) {
        // Even a malformed token set, changed subject or failed disk write can leave a
        // renewable provider session. Cleanup must cover every post-exchange rejection.
        if (typeof data.refresh_token === 'string') await this.revokeLate(clientId, data.refresh_token);
        throw error;
      }
    });
  }

  async credential(): Promise<ProviderCredential> {
    const generation = this.generation;
    return this.serial(async () => {
      this.active(generation);
      if (this.options.mode === 'api-key') {
        if (!this.options.apiKey) fail('unavailable');
        return { mode: 'api-key', bearer: this.options.apiKey, baseUrl: RESOURCE,
          constraints: { billing: 'api-key', responsesOnly: false } };
      }
      this.chatgpt();
      const store = this.ensureStore();
      const account = store.accounts.find((candidate) => candidate.id === store.selected);
      if (!account?.tokens) fail('reauthorize');
      let tokens = account.tokens;
      this.permission(tokens);
      if (tokens.expiresAt <= this.now() + 60_000 && tokens.earliestRefreshAt <= this.now()) {
        if (!tokens.refresh) fail('reauthorize');
        let data: Record<string, unknown>;
        try {
          data = await this.exchange({ grant_type: 'refresh_token', client_id: account.id,
            refresh_token: tokens.refresh, resource: RESOURCE }, true);
        } catch (error) {
          this.active(generation);
          if (error instanceof ProviderAuthError && error.code === 'reauthorize') {
            this.save({ ...store, accounts: store.accounts.map((candidate) =>
              candidate.id === account.id ? { id: candidate.id, subject: candidate.subject } : candidate) });
          }
          throw error;
        }
        if (this.closed || generation !== this.generation) {
          // A rotation that finishes after logout must not leave a renewable replacement behind.
          if (typeof data.refresh_token === 'string') await this.revokeLate(account.id, data.refresh_token);
          fail('unavailable');
        }
        try {
          // RFC6749 allows omitted response scope when it is unchanged. Only refresh
          // inherits a previously verified grant; an initial callback must state it.
          const replacement = this.tokens(data, tokens.scopes);
          if (!replacement.access || !replacement.refresh) fail();
          if (replacement.id) {
            const subject = await this.identity(replacement.id, account.id);
            if (subject !== account.subject) fail();
          }
          this.active(generation);
          tokens = { ...replacement, ...(replacement.id ? {} : (tokens.id ? { id: tokens.id } : {})) };
          this.save({ ...store, accounts: store.accounts.map((candidate) =>
            candidate.id === account.id ? { ...candidate, tokens } : candidate) });
        } catch (error) {
          // The old refresh token may already have rotated. Never retry it after a
          // successful exchange whose replacement we cannot validate or persist.
          if (!this.closed && generation === this.generation) {
            const cleared = { ...store, accounts: store.accounts.map((candidate) =>
              candidate.id === account.id ? { id: candidate.id, subject: candidate.subject } : candidate) };
            this.store = cleared;
            try { this.save(cleared); } catch { /* Original storage failure remains explicit. */ }
          }
          if (typeof data.refresh_token === 'string') await this.revokeLate(account.id, data.refresh_token);
          throw error;
        }
      }
      this.active(generation);
      this.permission(tokens);
      if (!tokens.access || tokens.expiresAt <= this.now()) fail('retryable');
      return { mode: 'chatgpt', bearer: tokens.access, baseUrl: RESOURCE,
        constraints: { billing: 'chatgpt-plan', responsesOnly: true, store: false,
          stream: true, accountModelCatalog: true } };
    });
  }

  async logout(): Promise<{ remoteRevocationConfirmed: boolean }> {
    if (this.closed) fail('unavailable');
    this.generation += 1;
    this.invalidateModels();
    this.pending.clear();
    this.incomplete.clear();
    this.options.apiKey = undefined;
    const accounts = this.store?.accounts ?? [];
    // Immediate stop: even status during a slow revocation cannot report usable credentials.
    if (this.store) {
      this.store = { ...this.store,
        accounts: accounts.map((account) => ({ id: account.id, subject: account.subject })) };
      // Clear disk now, not behind a blocked refresh: shutdown/crash must not restore
      // credentials after the runtime has accepted a logout request.
      this.save(this.store);
    }
    return this.serial(async () => {
      if (this.closed) fail('unavailable');
      if (this.options.mode !== 'chatgpt') return { remoteRevocationConfirmed: true };
      // No retained renewable session means there is nothing we can confirm remotely.
      // In particular, repeated logout/restart must not turn a failed attempt into true.
      let confirmed = accounts.some((account) => !!account.tokens?.refresh) && !this.unconfirmedRevocation;
      for (const account of accounts) {
        if (account.tokens?.refresh && !await this.revoke(account.id, account.tokens.refresh)) confirmed = false;
        else if (account.tokens?.access && !account.tokens.refresh) confirmed = false;
      }
      return { remoteRevocationConfirmed: confirmed };
    });
  }

  close(): void {
    this.closed = true;
    this.options.apiKey = undefined;
    this.generation += 1;
    this.invalidateModels();
    this.pending.clear();
    this.incomplete.clear();
    this.store = undefined;
    // A late rotation/revocation still owns the old session. Keep the process lock
    // until it drains so a replacement runtime cannot refresh concurrently.
    if (this.operations === 0) this.releaseLock();
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    this.operations += 1;
    const result = this.queue.then(operation).catch((error: unknown) => { throw sanitized(error); }).finally(() => {
      this.operations -= 1;
      if (this.closed && this.operations === 0) this.releaseLock();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private active(generation: number): void {
    if (this.closed || generation !== this.generation) fail('unavailable');
  }
  private chatgpt(): void { if (this.options.mode !== 'chatgpt') fail('unavailable'); }
  private callbackUri(): string {
    try {
      const url = new URL(this.options.redirectUri ?? 'http://127.0.0.1:3001/auth/callback');
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/auth/callback' ||
        url.username || url.password || url.search || url.hash) fail();
      return url.toString();
    } catch { return fail(); }
  }
  private permission(tokens: Tokens): void {
    if (!tokens.scopes.includes('chatgpt.tokens.use.direct') || !tokens.scopes.includes('resource.invoke')) fail('unavailable');
  }
  private tokens(data: Record<string, unknown>, retainedScopes?: string[]): Tokens {
    const scopes = data.scope === undefined && retainedScopes ? [...retainedScopes] : text(data.scope, 8192).split(/ +/u);
    if (data.token_type !== 'Bearer') fail();
    const expiresIn = finite(data.expires_in);
    if (!Number.isSafeInteger(expiresIn) || expiresIn > 86_400) fail();
    let earliestRefreshAt = 0;
    if (data.earliest_refresh_at !== undefined) {
      earliestRefreshAt = typeof data.earliest_refresh_at === 'number'
        ? finite(data.earliest_refresh_at) * 1000
        : Date.parse(text(data.earliest_refresh_at, 64));
      finite(earliestRefreshAt);
    }
    const tokens: Tokens = {
      scopes, expiresAt: this.now() + expiresIn * 1000, earliestRefreshAt,
      ...(data.access_token === undefined ? {} : { access: text(data.access_token) }),
      ...(data.refresh_token === undefined ? {} : { refresh: text(data.refresh_token) }),
      ...(data.id_token === undefined ? {} : { id: text(data.id_token) }),
    };
    if (scopes.includes('chatgpt.tokens.use.direct') && !tokens.access) fail();
    return tokens;
  }

  private async exchange(fields: Record<string, string>, refresh = false): Promise<Record<string, unknown>> {
    await this.discover();
    const response = await this.request(TOKEN, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields),
    });
    const data = object(response.data);
    if (response.status !== 200) {
      if (refresh && typeof data.error === 'string' && TERMINAL_REFRESH.has(data.error)) fail('reauthorize');
      if (response.status === 429 || response.status >= 500) fail('retryable');
      fail();
    }
    return data;
  }
  private trustedEndpoint(value: unknown): string {
    const url = new URL(text(value, 2048));
    if (url.origin !== ISSUER || url.username || url.password || url.hash || url.search) fail();
    return url.toString();
  }
  private async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const response = await this.request(`${ISSUER}/.well-known/openid-configuration`);
    if (response.status !== 200) fail('retryable');
    const data = object(response.data);
    if (data.issuer !== ISSUER || data.authorization_endpoint !== AUTHORIZE || data.token_endpoint !== TOKEN) fail();
    const discovery: Discovery = { jwks_uri: this.trustedEndpoint(data.jwks_uri),
      ...(data.revocation_endpoint === undefined ? {} : { revocation_endpoint: this.trustedEndpoint(data.revocation_endpoint) }) };
    this.discovery = discovery;
    return discovery;
  }
  private async identity(token: string, audience: string, nonce?: string): Promise<string> {
    const discovery = await this.discover();
    const loadKeys = async () => {
      const response = await this.request(discovery.jwks_uri);
      if (response.status !== 200) fail('retryable');
      const data = object(response.data);
      if (!Array.isArray(data.keys) || data.keys.length > 32) fail();
      this.keys = createLocalJWKSet(data as unknown as JSONWebKeySet);
      this.keysAt = this.now();
    };
    if (!this.keys || this.now() - this.keysAt > 3_600_000) await loadKeys();
    const verify = () => jwtVerify(token, this.keys!, {
      issuer: ISSUER, audience, algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5, currentDate: new Date(this.now()),
    });
    let result;
    try { result = await verify(); }
    catch (error) {
      if (object(error).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
      await loadKeys();
      result = await verify();
    }
    if (nonce !== undefined && result.payload.nonce !== nonce) fail();
    // OIDC authorized-party checks supplement jose's audience-membership check.
    // A multi-audience token must not be accepted on another client's authority.
    const audiences = result.payload.aud;
    if (Array.isArray(audiences) && (!audiences.every((value) => typeof value === 'string' && value) ||
      (audiences.length > 1 && result.payload.azp !== audience))) fail();
    if (result.payload.azp !== undefined && result.payload.azp !== audience) fail();
    if (typeof result.payload.iat !== 'number' || result.payload.iat > this.now() / 1000 + 5 ||
      typeof result.payload.exp !== 'number' || result.payload.exp <= result.payload.iat) fail();
    return text(result.payload.sub, 2048);
  }
  private async revokeLate(clientId: string, token: string): Promise<void> {
    if (!await this.revoke(clientId, token)) this.unconfirmedRevocation = true;
  }
  private async revoke(clientId: string, token: string): Promise<boolean> {
    try {
      const discovery = await this.discover();
      if (!discovery.revocation_endpoint) return false;
      const response = await this.request(discovery.revocation_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: clientId }),
      }, true);
      return response.status === 200;
    } catch { return false; }
  }
  private async request(url: string, init: RequestInit = {}, empty = false): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.transport(url, { ...init, redirect: 'error', signal: controller.signal });
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          if (reader) {
            try {
              for (;;) {
                const result = await reader.read();
                if (result.done) break;
                bytes += result.value.byteLength;
                if (bytes > MAX_BYTES) { await reader.cancel(); fail(); }
                chunks.push(result.value);
              }
            } finally { reader.releaseLock(); }
          }
          const body = Buffer.concat(chunks).toString('utf8');
          return { status: response.status, data: empty ? null : JSON.parse(body) as unknown };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new ProviderAuthError('retryable')); }, 8000);
          timer.unref();
        }),
      ]);
    } catch (error) { throw error instanceof ProviderAuthError ? error : new ProviderAuthError('retryable'); }
    finally { if (timer) clearTimeout(timer); }
  }

  private checkPath(path: string, ownerOnly: boolean): void {
    let current = parse(path).root;
    const parts = path.slice(current.length).split('/').filter(Boolean);
    for (const part of parts) {
      current = join(current, part);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) fail('storage');
        if (ownerOnly && current === path &&
          ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))) fail('storage');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }
  private ensureStore(): Store {
    if (this.store) return this.store;
    if (!this.path || this.closed) fail('storage');
    try {
      const directory = dirname(this.path);
      this.checkPath(directory, true);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.checkPath(directory, true);
      this.checkPath(this.path, true);
      const lockPath = `${this.path}.lock`;
      this.checkPath(lockPath, true);
      // Fail closed on an existing lock, including crash-stale locks. Never steal a live session.
      this.lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      writeFileSync(this.lockFd, `${process.pid}\n`);
      if (existsSync(this.path)) {
        // Nonblocking open lets fstat reject FIFOs instead of hanging startup before
        // we can establish that the credential input is a regular file.
        const fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES ||
            (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail('storage');
          const raw: unknown = JSON.parse(readFileSync(fd, 'utf8'));
          this.store = this.readStore(raw);
        } finally { closeSync(fd); }
      } else {
        this.save({ version: 1, host: `urn:uuid:${randomUUID()}`, accounts: [] });
      }
      return this.store!;
    } catch {
      this.releaseLock();
      return fail('storage');
    }
  }
  private readStore(raw: unknown): Store {
    const data = object(raw);
    if (data.version !== 1 || typeof data.host !== 'string' ||
      !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(data.host) ||
      !Array.isArray(data.accounts) || data.accounts.length > 64) fail('storage');
    const accounts: Account[] = data.accounts.map((value: unknown) => {
      const account = object(value);
      const parsed: Account = { id: issued(account.id), subject: text(account.subject, 2048) };
      if (account.tokens !== undefined) {
        const tokens = object(account.tokens);
        if (!Array.isArray(tokens.scopes) || tokens.scopes.length > 64) fail();
        parsed.tokens = {
          scopes: tokens.scopes.map((scope: unknown) => text(scope, 256)),
          expiresAt: finite(tokens.expiresAt), earliestRefreshAt: finite(tokens.earliestRefreshAt),
          ...(tokens.access === undefined ? {} : { access: text(tokens.access) }),
          ...(tokens.refresh === undefined ? {} : { refresh: text(tokens.refresh) }),
          ...(tokens.id === undefined ? {} : { id: text(tokens.id) }),
        };
      }
      return parsed;
    });
    if (new Set(accounts.map((account) => account.id)).size !== accounts.length) fail();
    if (data.selected !== undefined && !accounts.some((account) => account.id === data.selected)) fail();
    return { version: 1, host: data.host, accounts,
      ...(typeof data.selected === 'string' ? { selected: data.selected } : {}) };
  }
  private save(store: Store): void {
    if (!this.path || this.lockFd === undefined || this.closed) fail('storage');
    const temporary = `${this.path}.${randomBytes(12).toString('hex')}.tmp`;
    let fd: number | undefined;
    try {
      if (store.accounts.length > 64) fail('storage');
      this.checkPath(dirname(this.path), true);
      this.checkPath(this.path, true);
      const serialized = JSON.stringify(store);
      if (Buffer.byteLength(serialized) > MAX_BYTES) fail('storage');
      fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, serialized);
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, this.path);
      this.store = store;
    } catch { fail('storage'); }
    finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* Already atomically renamed. */ }
    }
  }
  private releaseLock(): void {
    if (this.lockFd === undefined) return;
    try { closeSync(this.lockFd); } finally {
      this.lockFd = undefined;
      try { unlinkSync(`${this.path}.lock`); } catch { /* No credential content in lock. */ }
    }
  }
}
