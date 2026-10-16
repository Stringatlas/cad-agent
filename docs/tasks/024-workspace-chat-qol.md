# Task024 — Workspace chat and account QoL

Status: implemented and verified; independent incremental review complete. Whole-checkout fresh-session review remains pending.

## Scope / acceptance
- Preserve in-memory draft, selected model and displayed chat across browser focus/visibility and scene source tabs. Reload/closing workspace clears memory deliberately; no browser storage or credentials persistence.
- Automatically discover catalog on mount and return to workspace; select first returned available model, preserving a still-valid choice. Never auto-send or retry inference.
- Revalidate account generation without erasing ordinary-focus state. Actual generation/mode/model/scene changes drop server conversation handles, cancel stale turns and retain labelled display-only history. Fail closed while catalog unavailable/loading.
- Stateful ChatGPT connected/disconnected header and account panel; official Continue with ChatGPT treatment and gated plan-enabled / Manage usage UI. No invented identity, usage or inference success.
- Targeted regression tests, baseline verification and browser visual/interaction checks without paid inference.

## Boundaries
Preserve task023 dirty parser/tests/docs. No credentials/config/storage/raw provider logs, service restart, index repair or commit. No geometry/backend changes. Account UI delegated independently; controller/component work by parent; independent incremental review after implementation.

## Pre-edit risk
Repository cad-agent, worktree /Users/kevin/Coding/spatial-cad-harness. Index 4dc9c76 one commit behind HEAD. Graph impact ModelChatController/accountChanged/refreshModels/selectModel/ModelChat.svelte UNKNOWN (unresolved dynamic/Svelte callers), source corroborates ModelChat.svelte instantiated by Chat.svelte, tests and component method calls. No resolved graph processes; direct source flow is App → Chat → ModelChat → same-origin catalog/turn. Preserve transport validation and backend generation/scene checks.

## Completed criteria / evidence
- In-memory history/draft/model persist across ordinary focus/visible events and source tabs. Scene/model/account changes retain labelled display history, cancel stale work and disconnect conversation handles; no client transcript replay.
- Mount/return catalog discovery selects first provider-ordered available model, preserves valid selection and never sends inference. Separate discovery cancellation/generation gates preserve unchanged active turns. Send blocks during loading/error.
- Stateful Account header, official ChatGPT logo/button, connected/disconnected/identity-only/unavailable states, plan-enabled card and fixed Manage usage URL. No backend transport/status-whitelist changes. A persistent enabled-plan confirmation replaces first-ever welcome modal: sanitized status has no identity or first-login persistence.
- Official references: https://developers.openai.com/siwc/ui-ux-guidelines ; https://developers.openai.com/siwc/website ; https://chatgpt.com/settings/usage . Public evidence `/tmp/task024-siwc-*`, logo `/tmp/task024-chatgpt-logo-black.svg`.

### Checks
- `pnpm verify` final: PASS, 475 tests, typecheck (Svelte zero errors/warnings), web build and server typecheck. `/tmp/spatial-task024/verify-final.log`. Existing >500KB bundle advisory remains. Earlier `/tmp/spatial-task024/verify.log` failed 12 copy-specific assertions during notice wording adjustment; final wording/regressions pass without weakening checks.
- `pnpm exec tsx --test tests/model-chat-client.test.ts tests/model-chat-ui-context.test.ts tests/provider-account.test.ts`: independent follow-up PASS, 102 tests. `/tmp/spatial-task024/notice-followup-review.md` and referenced logs. Prior incremental review `/tmp/spatial-task024/independent-review.md` found only LOW stale banner wording; corrected with regression for continuation after reset and follow-up closed it.
- `git diff --check`: PASS. Actual source/test diff inspected; prior task023 changes retained. A late disappearance of the composer's memory-only helper span was treated as concurrent/unattributed and not overwritten; lifecycle behavior and docs remain explicit.
- LSP invoked for changed files: parent cache still reports known stale contracts exports in TS; no Svelte LSP configured. Actual CLI TypeScript + svelte-check pass; no source workaround for cached diagnostics.
- Browser harness setup failed daemon socket; fallback to Playwright existing Chrome CDP, owned static server and isolated context only. Fixture browser PASS, screenshots/AX `/tmp/spatial-task024/{desktop-*,mobile-plan.*}`, metrics `/tmp/spatial-task024/browser-metrics.json`, script/handoff `/tmp/spatial-task024/browser-handoff.md`. Inspected signed-out/identity/plan/loading/unavailable, desktop/mobile layout, first nonhardcoded model, selection/draft/history across events/source tabs, continuation and fresh scene/generation handles. Focus/visibility events dispatched, not a full OS tab-switch test. Four explicit fixture turns; no live inference/auth mutations. Dataset/project routes blocked (empty scene expected). CDP Fetch enabled before navigation, each-hop deny tested for 302/303 to operator port3001. Owned resources closed.
- Graph `detect_changes(all)` reports CRITICAL aggregate risk across this mixed dirty worktree (includes prior parser changes), not a Task024-specific low-risk verdict. MCP output was truncated; CLI re-run `node .gitnexus/run.cjs detect-changes --scope all --repo .` succeeded with summary-only display. Evidence `/tmp/spatial-task024/graph-changes{,-cli}.txt`; incomplete graph output is not a clean certification. No index repair or commit performed.

## Remaining / next action
Fresh-session whole-checkout review against tasks023/024 and actual diff before commit. No live provider/auth flow certification claimed. Reload/closing clears memory intentionally; durable browser persistence remains out of scope. Redacted completion handoff: `/tmp/spatial-task024/completion-handoff.md`.
