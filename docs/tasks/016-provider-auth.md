# Task016 — Local provider authentication backend

## Authorization and scope
User requested backend Sign in with ChatGPT and API token support, with explicit `.env` locations. OpenAI API key is the API-token mode. Implement the documented local/open-source ChatGPT-plan OAuth flow, not identity-only login. No live credentials/inference budget, model loop, project edits, product settings UI, public hosting or commits are authorized.

## Acceptance
- Explicit `disabled`, `api-key`, `chatgpt` modes; no paid-key fallback or secret-bearing HTTP status/errors/logs/evidence.
- `apps/server/.env` is the sole automatic env file, located using module URL independent of cwd. Process environment wins. Importing/constructing test servers never reads operator env files or credentials by default.
- Server-only API key, verified OIDC signature/issuer/audience/expiry/nonce, browser-bound single-use expiring PKCE/state attempts, documented dynamic registration and stable host ID, granted inference permission checked independently of identity.
- Separate protected persisted registrations, atomic rotating refresh, logout/revocation and shutdown race safety. Local Host/Origin/CSRF policy, bounded bodies/admission/network response/timeouts.
- Minimal backend `/auth` landing page makes browser sign-in reachable; `/auth/status` sanitized, `/auth/chatgpt/start`, `/auth/callback`, `/auth/logout`. No inference or arbitrary token-upload endpoint.
- Deterministic isolated fake-provider/security/config/HTTP tests and baseline verification; inspect actual diff. Record live OAuth/inference as unrun, fresh-session review pending.

## Plan and delegation
OAuth/service/security tests delegated to an isolated agent; parent integrates config/HTTP/startup/docs and tests. Separate fresh agent reviews final auth changes. Preserve all prior tasks014/015 work and existing server processes. GitNexus `createDemoServer` pre-edit impact LOW (isolated server helper and dataset-check flows); new auth symbols not indexed, checked against source. No module ownership moves.

## Official contract
Rechecked official Markdown guides: [overview](https://developers.openai.com/siwc/token-sharing-open-source), [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [website/JWT](https://developers.openai.com/siwc/website), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Uses documented dynamic registration, never Codex client credentials/private endpoints. Paid/remotely hosted usage requires OpenAI approval.

## Status
Implemented and independently corrective-reviewed within the bounded auth scope. Final baseline225/225 and isolated fake-provider browser checks pass. Live sign-in, real-key validation and inference remain unrun; fresh whole-checkout review and complete graph/taint certification remain pending. No commits or changes to operator credentials/processes.

## Verification and review
Toolchain: Node22.23.3, pnpm10.34.6. Evidence under `/tmp/spatial-provider-auth-final/` (OS-temp artifacts, not durable repository fixtures).

| Exact command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm verify` |225/225 tests; package/test typechecks, Svelte0 errors/warnings and builds pass. Existing Vite >500kB chunk warning retained. | `final-verify.log` |
| `pnpm exec tsx --test tests/provider-auth.test.ts tests/provider-config.test.ts tests/auth-http.test.ts` |62/62 pass after final correction. | `post-confirmation-fix-tests.log`, independent `confirmation-fix-review-tests.log` |
| `node_modules/.bin/tsx /tmp/spatial-provider-auth-final/safe-browser/verify.mjs` |Pass: native sign-in303, locally fulfilled provider redirect, signed fake JWT/local JWKS callback/clean303, ready status, native logout/durable clearing, callback replay rejection, disabled/API-key pages. | `safe-browser/report.json`, `run.log`, DOM/ARIA snapshots and inspected `auth-before.png`, `auth-ready.png` |
| LSP diagnostics for `apps/server/src/provider-auth.ts` and `tests/provider-auth.test.ts` |Clean after final correction; CLI baseline is authoritative for whole workspace. | Recorded parent tool results |
| `git diff --check`; `git diff --no-index --check /dev/null <new auth source/test/env/doc file>` |Clean. Tracked auth integration/dependency delta and untracked auth source/tests inspected; prior tasks014/015 preserved. | Actual working diff, `auth-source.diff` |

Independent initial security review `/tmp/spatial-provider-auth-review.md` identified seven corrected issues: immediate durable logout before a blocked queue, lock lifetime through shutdown drain, rejected/rotated-token cleanup, provider CSP form target, OIDC authorized-party validation, inherited omitted refresh scopes, and nonblocking rejection of FIFOs. Rereview `rereview-browser.md` confirmed them and found native form Origin:null under no-referrer; only validated GET `/auth` now uses same-origin referrer policy. Callback/status retain no-referrer and Host/Origin checks are unchanged.

Final auth-only rereview `final-auth-review.md` found repeated logout falsely confirming a failed remote revocation. Corrected confirmation now requires a held renewable session for that call. Provider200/503 repeated-logout and restart regressions pass; guide documents per-call semantics and manual disconnection after failure. Fresh corrective review `confirmation-fix-review.md` reports no new findings; independent concurrent200/503 probes pass (`confirmation-fix-concurrent-probe.log`). This bounded result does not approve tasks014/015 or the entire dirty checkout.

### Browser safety record
An earlier fixture's Playwright `context.route` did not intercept a303 redirect hop; one inert authorization GET reached the provider. No sign-in, token exchange, inference or operator secrets were involved; old fixture launchers remain disabled. Final fixture instead installs fail-closed CDP Fetch request-stage interception **before navigation** and first proves per-hop handling with local303→302→synthetic destination plus denied-origin abort. Only exact owned ephemeral loopback origins are continued; provider-shaped destination is fulfilled locally with no remote IP. Incognito context, owned servers/temp credentials and locks were cleaned up; existing Chrome/operator3001/5173 remain untouched. Two fixture-only fail-closed attempts are retained under `safe-browser/attempt1/` and `attempt2/`; details in its `handoff.md`.

### Graph and remaining gates
Bound repository `cad-agent`, HEAD `4dc9c760be2ca3d0f31a6314c8b530dc42c2d097`. New auth context/impact remains not-found/**UNKNOWN**: source verified startup/auth-route/test callers, not treated as unused. Whole-checkout `detect_changes(scope:all)` and CLI rerun `node .gitnexus/run.cjs detect-changes --scope all --repo .` report aggregate **CRITICAL** risk with capped listings and omit unindexed/untracked auth; `graph-final.log` records the rerun. This is unresolved coverage, **not a clean graph gate**. No index refresh/complete PDG-taint certification or commit was attempted.

Next bounded action: fresh whole-checkout review/tooling reconciliation before any graph-certified commit. Live SIWC eligibility/consent/compatibility, real API-key validation and model inference require separately authorized credentials/budget and remain explicitly unrun. No model loop or product settings UI is implemented by this task.
