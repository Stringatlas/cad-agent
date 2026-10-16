# Local provider authentication backend

Two explicit modes are supported: **ChatGPT plan usage** via official Sign in with ChatGPT (SIWC), or a separately billed **OpenAI API key**. Default is `disabled`. A failure/limit in one mode never falls back to another. Task016 supplies authentication/configuration; [task019 scene chat](model-chat.md) now adds separately bounded model discovery and streamed inference. Existing deterministic inspection/approved box editing is unchanged; model tools cannot mutate geometry.

## Where `.env` belongs

From the repository root:

```sh
cp apps/server/.env.example apps/server/.env
chmod 600 apps/server/.env
```

Edit **`<repository>/apps/server/.env`**, e.g. `/Users/kevin/Coding/spatial-cad-harness/apps/server/.env` in this checkout. This is the **only** automatically loaded server env file. Repository-root `.env`, `.env.local`, `.env.production`, and `apps/web/.env` are **not** server configuration. The path is resolved from the server module, not the launch directory. Process environment values override file values, including empty values. Restart the server after changing either.

Never put keys/tokens in `VITE_*`, web env files, browser storage, chat/evidence, logs or source control. `.env` files are ignored; the placeholder example is tracked. No credentials are needed for the default deterministic workspace. Imported server factories/tests default authentication to disabled and never automatically read this file or operator auth storage.

### OpenAI API key

```dotenv
SPATIAL_PROVIDER_MODE=api-key
OPENAI_API_KEY=your_openai_api_key
```

This is a server-held OpenAI API key, **not a ChatGPT subscription token**. `ready: true` means a key is configured, not that OpenAI validated it or a paid request succeeded. No key-entry/upload HTTP endpoint is provided. Runtime logout clears the key from the auth service; restart reads the configured key again. Remove it from `.env`/process environment to disable it permanently.

### Continue with ChatGPT

```dotenv
SPATIAL_PROVIDER_MODE=chatgpt
```

An API key is not required and is ignored in this mode. Start `pnpm --filter @spatial/server start` or `pnpm dev`, then visit **http://127.0.0.1:3001/auth** in your browser. Select Add a ChatGPT account or an existing registration, then **Continue with ChatGPT**. OpenAI performs sign-in/registration/consent and returns to **http://127.0.0.1:3001/auth/callback**. Use `127.0.0.1`, **not `localhost`**: the documented OSS callback requires this exact host/path. The executable server fixes port3001; test services can inject an isolated callback port. The workspace header now includes **Account · Sign in with ChatGPT**. Open it for sanitized status and an explicit sign-in link to that fixed backend utility in a new tab. The link is enabled only on an HTTP `127.0.0.1` workspace. Choose **Continue with ChatGPT** on the backend page, then return to the workspace and **Refresh status**. Scene selections/drafts remain open. The Account panel handles credentials only. In Scene chat, explicitly Refresh models, choose a model, then Send; see [model chat](model-chat.md).

Eligible ChatGPT Plus/Pro users authorize identity scopes and separate ChatGPT-plan Responses permission. A validated identity without granted `chatgpt.tokens.use.direct` and `resource.invoke` is authenticated but **not ready** for inference. ChatGPT settings control available usage/credits; this code cannot promise free/unlimited requests. See [ChatGPT Usage](https://chatgpt.com/settings/usage). Paid/remotely hosted apps require OpenAI approval; this backend remains local single-user, not a deployment authentication layer.

First sign-in uses the documented `dynamic_agent_client` registration entrypoint, real app name `Spatial CAD Harness`, and a stable persisted opaque `urn:uuid:` host identifier. Subsequent sign-ins reuse the issued `oaiapp_...` registration; accounts/workspaces remain separate even if identity overlaps. A new attempt does not replace the active account until ID-token validation succeeds. Returning sign-in deliberately omits ID-token/email hints so authorization URLs returned to browser code contain no retained tokens/PII; OpenAI may show its account selector.

## Workspace account panel

Use **http://127.0.0.1:5173**, not localhost. The panel checks status on mount, window focus, becoming visible and manual refresh; requests are bounded and canceled on disposal. It distinguishes loading/unavailable, disabled, server API-key configuration, ChatGPT signed-out, identity-only and credential-ready states. Ready means credentials only: explicitly Refresh models and select a model in Scene chat. Neither credential nor catalog readiness proves successful inference; API-key readiness is not live validation. Backend-offline, denied-origin and malformed responses produce fixed messages without provider error text or account identifiers.

When disabled, configure `SPATIAL_PROVIDER_MODE=chatgpt` in **apps/server/.env** and restart the server. No keys/tokens belong in browser inputs/storage or web env files. API keys remain server-only as described above.

**Sign out / clear credentials** explicitly posts to the local backend. The panel distinguishes local API-key clearing from ChatGPT renewable-session revocation confirmation. False/unconfirmed is not successful remote revocation; an unavailable/timeout response means the logout outcome is unknown, even if the server received it. Refresh checks current local status but cannot certify remote revocation. Use ChatGPT Settings to disconnect when needed. Repeated logout cannot certify previously cleared sessions. API keys read from server configuration return on restart unless removed there.

Vite dev and preview proxy **only exact `/auth/status` and `/auth/logout` requests**, preserving Host/Origin validation. Preview must use the allowed `127.0.0.1:5173` origin to reach auth successfully. `/auth`, `/auth/chatgpt/start` and `/auth/callback` are **not** proxied; the native backend utility owns the entire sign-in/cookie flow at port3001. No browser OAuth handling is added; task019's separate `/chat/` proxy routes model discovery/inference to the same backend.

## Protected local state

Default OAuth store: **`~/.spatial-cad-harness/auth/credentials.json`**. Optional `SPATIAL_AUTH_PATH` must be absolute. The auth directory must be owner-only (`0700`), owned by the current user; credential files are atomically written `0600`. Existing corrupt, permissive, non-regular, symlinked or multiply-linked credentials fail closed. Storage contains separate verified subject/client mappings, token sets, scopes, expiry and host ID. It is sensitive plaintext protected by filesystem permissions, **not OS-keychain encryption**. Keep it outside repositories/shared directories/backups/support bundles.

One process owns `<credentialPath>.lock`. Close normally (Ctrl-C/SIGTERM) before restarting; the lock remains held until in-flight OAuth rotation/revocation cleanup finishes. After a crash, first verify that **no server using that store is running**, then remove only the stale `.lock`; never automatically steal a live lock. Do not delete/rotate the host ID on each restart or logout. Signing out clears credentials for all saved local registrations but retains mappings/host for reauthorization. The backend tries renewable-session revocation and reports `remoteRevocationConfirmed`. In ChatGPT mode, true confirms only the renewable sessions held for this logout call, not previously cleared sessions; false means revocation was not confirmed, including when no tokens remain after repeated logout or restart. Cleared tokens are never retained for retry, and previous failure history is not persisted. If a revocation attempt fails, disconnect the app in ChatGPT Settings; later reauthorization/logout does not certify that older session. Disabled/API-key mode returns true for local-only clearing, not provider-side API-key revocation. Shutdown clears runtime access, not persisted sign-in.

OAuth transactions use random browser-bound state/nonce, S256 PKCE, ten-minute expiry and one-time consumption. Callback cookies are HttpOnly, SameSite=Lax, `/auth` scoped; Secure is intentionally omitted for the documented **HTTP loopback** callback. Signatures/JWKS, issuer, issued-client audience and authorized party, expiry, subject and nonce are verified using pinned `jose`. Fresh callback/refresh tokens cannot resurrect a logged-out runtime. Logout clears persisted credentials immediately, even behind a blocked refresh. Every post-exchange callback rejection attempts revocation of the returned renewable session. Refreshes are serialized, rotating credentials replaced atomically; omitted refresh-response scopes retain the verified prior grant, while explicit reduced scopes replace it. Transient failures remain explicit; terminal refresh rejection or an unusable rotated replacement clears the spent local token set and requires reauthorization. Network requests are bounded and redirect-disabled to approved OpenAI HTTPS endpoints.

## HTTP surface

All endpoints require allowed local Host. Non-callback Origin must be the backend's exact `http://127.0.0.1:<port>` or `http://127.0.0.1:5173`; browser mutations also require an allowed Origin and non-cross-site fetch metadata. CLI requests can omit Origin. These guards are **not public-hosting authorization**; no CORS access is enabled.

| Route | Behavior |
| --- | --- |
| `GET /auth` | Minimal backend utility page; no model requests. |
| `GET /auth/status` | Sanitized mode/authenticated/ready/permission and numbered registration labels. No key, bearer, email, subject, ID token or refresh token. |
| `POST /auth/chatgpt/start` | JSON `{}` or `{ "accountId": "oaiapp_..." }` returns authorization URL and sets the transaction cookie. Native form posts redirect to OpenAI. |
| `GET /auth/callback` | Consumes browser-bound callback; success303 redirects to `/auth` to remove the code from subsequent navigation. Errors are fixed/redacted. |
| `POST /auth/logout` | JSON `{}`/empty form; local clearing plus attempted revocation, returns confirmation boolean. |

POST bodies are bounded to2048bytes/3s, no compression, no arbitrary tokens/URLs/extra fields; one admitted auth mutation at a time,30/minute. Callback/status do not expose raw provider failures. Auth routes do not execute inference or expose an HTTP credential-retrieval endpoint; task019's separate `/chat/models` and `/chat/turn` routes use credentials internally.

`ProviderAuth.credential()` is **server-only**, returns the explicitly chosen bearer/capabilities and refreshes near expiry. It must never be serialized into evidence/HTTP/logs. The task019 model adapter enforces ChatGPT `store:false`, `stream:true`, array input with full history, Responses-only/current account model catalog and [preview parameter/tool restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Identity-only grants/expired or revoked credentials block it; no API-key fallback exists. `/chat/inspect` remains deterministic and separate. Model requests require explicit discovery, selection and Send in the workspace.

## Verification and limitations

Deterministic tests use generated signed JWTs and fake transport, isolated OS-temp credentials/projects/env files; no operator `.env`/keys/state or live provider budget. See [task016](tasks/016-provider-auth.md) for exact verification evidence. **Live SIWC eligibility/consent/callback, real API-key validation and inference remain unrun**. The workspace account panel exposes the local auth utility; model execution belongs to the separate task019 loop. Provider availability/contracts may change.

Official docs rechecked: [quickstart](https://developers.openai.com/siwc/quickstart), [registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts/refresh/revoke](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [ID-token validation](https://developers.openai.com/siwc/website), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference). No Codex client identity, private ChatGPT endpoints, invented OAuth scopes or product Pi dependency.
