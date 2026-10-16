# Task018 — Workspace provider account control

## Scope and acceptance

Authorized: make existing provider authentication discoverable from the main workspace. Preserve tasks014–017, scene selections/drafts and deterministic tools. No model loop, inference, live credentials/budget, backend security-policy changes or commits.

- Visible Account / Sign in with ChatGPT entry in workspace header and accessible account panel.
- Read sanitized `/auth/status` through exact same-origin Vite dev/preview proxy; show explicit loading, unavailable, disabled, API-key, ChatGPT signed-out, identity-only and credential-ready states. Credential readiness never implies model chat availability.
- ChatGPT sign-in opens the existing fixed `http://127.0.0.1:3001/auth` backend utility in a separate tab with noopener/noreferrer, preserving workspace. No browser OAuth token handling, arbitrary destinations, storage or key input. Clearly explain Continue with ChatGPT on that page and return/refresh.
- Same-origin explicit logout uses existing `/auth/logout`; disclose local clearing versus provider revocation confirmation without promising remote revocation. Refresh status on focus/visibility/manual request; prevent stale status after logout and bound/cancel requests on disposal.
- Disabled configuration instructions point only to `apps/server/.env`, mode `chatgpt`, server restart and 127.0.0.1 web origin. API key configuration remains server-only.
- Backend auth callback/start remain direct, not proxied. Existing Host/Origin/cookie/referrer safeguards remain unchanged.
- Typecheck/tests/build; existing workspace regression checks; isolated fake-provider browser states, interaction/accessibility/layout and failures, no operator auth/persistence access. Any browser provider navigation must be fail-closed guarded at every CDP Fetch redirect hop before navigation.
- Fresh bounded source review against actual task018 diff, exact artifacts and redacted OS-temp handoff. Whole-checkout review/graph completeness remain separate.

## Plan / delegation

1. Parent inspected actual App/Vite/auth routes/config/status/docs and graph impacts. Svelte/Vite impacts UNKNOWN; source confirms App mounted by main.ts and proxy shared by dev/preview, backend auth untouched.
2. Bounded implementation agent owns account component/client/tests, App integration, exact Vite proxy entries and provider guide update. Parent owns this task and index/documentation checkpoint.
3. Separate browser verification agent prepares isolated owned fixtures and per-hop fail-closed interception, then tests final built UI; no real provider/operator state.
4. Parent runs baseline and diff checks; fresh independent reviewer checks task018 files/diff. Correct findings with impact gates and rerun relevant checks.

## Status

Implemented; independent bounded product-source and fixture reviews complete with no remaining findings. Whole-checkout fresh review remains pending. No live authentication/model compatibility claimed.

## Implementation and corrective findings

- `apps/web/src/ProviderAccount.svelte` and `provider-account.ts`: visible accessible header account panel, fixed separate-tab native utility link, sanitized credential status and explicit logout. No browser keys/tokens, model connection or state/geometry mutation. Refresh on focus/visibility/manual action; bounded abort/generation guards and honest ambiguous logout/per-call revocation reporting.
- `apps/web/vite.config.ts`: only exact status/logout proxies, shared dev/preview, Host/Origin preserved. Auth preview requires canonical127.0.0.1:5173; native start/callback remain backend-only. Guide: `docs/provider-auth.md`.
- First independent browser run caught native Window.fetch receiver Illegal invocation. Corrected with a global forwarding wrapper, added receiver regression, rebuilt and reran. The initial Node-only pass did not establish browser correctness.
- All seven existing browser launchers explicitly override new exact auth proxies to their owned backends rather than inheriting operator3001. Fixture-only auth Host forwarding supports the read; Origin and non-auth forwarding remain unchanged. Workspace's last group now requires real200disabled, same-origin/query-free/body-free GET status and still forbids every other auth/model/CAD request and all console errors. Original first13 groups are byte-identical. Initial13/14 fixture failure is superseded by reviewed14/14; no backend policy or rendering/camera assertion weakened.

## Exact verification and artifacts

Node22.23.3, pnpm10.34.6, repository root. No commits or live credentials/model requests.

- `pnpm verify` — typechecks/Svelte0errors0warnings, **253/253 tests**, web build and server typecheck pass. `/tmp/spatial-task018/final-verify.log`; existing Vite >500kB chunk warning remains.
- `pnpm exec tsx --test tests/provider-account.test.ts` — **23/23 pass**; `/tmp/spatial-task018/fixture-modernization/focused-tests.log`, independently rerun in `review/fixture-checks/focused-tests.log`.
- Seven changed browser scripts `node --check` pass; exact proxy/source contract test passes; `git diff --check` passes. `fixture-modernization/node-check.log`, `diff-check.log`.
- `pnpm exec tsx /tmp/spatial-task018/browser-final/verify.mjs` — **15/15 scenario groups pass**. Exact command/output, screenshots/ARIA, guarded native fake-provider flow, source/build preservation and cleanup: `browser-final/findings.md`, `report.json`, `run.log`, `preservation.txt`. Built UI served by owned static fixture with per-hop guarded fulfillment to owned real backend; actual Vite dev/preview tested separately over owned HTTP with canonical virtual Host/Origin. This is not browser-through-Vite/live-provider certification.
- `node /tmp/spatial-task018/workspace-final/guarded-workspace.mjs http://127.0.0.1:9222 /tmp/spatial-task018/workspace-final` — **14/14 workspace groups pass** against real prepared data/owned authority: original binary64 overview/detail provenance, picks/markers, Shift crop cancellation, scene/draft separation, deterministic tools, exact approved edits/Undo/Save/Load, failure fixtures and desktop/mobile focus/layout. `workspace-final/report.json`, `run.log`, `harness-only.patch`; exact groups and commands in `fixture-modernization/findings.md`.
- Fresh independent source review: `/tmp/spatial-task018/review/report.md`; fresh fixture review with empirical owned proxy/Origin rejection probe: `review/fixture-review.md`. No remaining concrete introduced findings. These are bounded reviews, not approval of earlier dirty tasks.
- Post-edit focused LSP diagnostics clean. Parent workspace cached LSP reports221missing-export/related errors in24files, discordant with passing direct typechecks (prior cache limitation persists); no clean workspace-LSP certification.
- `node .gitnexus/run.cjs detect-changes --scope all --repo .` rerun: `graph-final-cli.log`. Mixed dirty checkout aggregateCRITICAL125symbols/39files/22flows, capped listing and unindexed new/Svelte code; not a clean certification. Pre-edit impacts UNKNOWN were source-confirmed; no routine index refresh/PDG certification or commit.

## Safety, exclusions and next action

Existing Chrome9222 only, fresh incognito contexts, fail-closed request-stage CDP Fetch interception before navigation at every redirect hop;303→302→synthetic fulfillment and deny proof precede fake-provider navigation. No operator3001/5173 request continued, no live provider transport or inference. Owned contexts/fixture ports/temp credentials/persistence cleaned; existing services preserved. Reports redact navigation query strings. Scope preservation and current hashes: `/tmp/spatial-task018/final-preservation.json`, `final-source-sha256.json`.

Actual fixed-port target=_blank click deliberately **unrun** because first-popup interception was not proven; fixed link semantics and a separately guarded native flow passed. Live sign-in/eligibility, real-key validation, inference and six other legacy browser suites were not rerun. Historical Toronto post-release exact-camera numeric failure remains unchanged (task017), not silently passed or weakened.

Next bounded action: user may configure `apps/server/.env`, restart backend/Vite as needed and manually sign in from the Account panel. Model integration requires a separate authorized task. Whole-checkout graph reconciliation and fresh-session review remain pending; completion handoff `/tmp/spatial-task018/completion-handoff.md`.
