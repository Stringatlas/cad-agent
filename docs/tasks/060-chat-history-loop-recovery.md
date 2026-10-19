# Task060 — Reliable chat history and tool-loop continuation

## User request / acceptance
Implement working cross-send chat history and iterative tool calls; verify actual provider inputs rather than a cosmetic transcript. Preserve human approval and existing scene/account boundaries. No paid requests, persistent storage, commits or unrelated rendering changes.

## Implementation
- Existing server history already replays full completed user/assistant/tool items. Root issues fixed in `apps/web/src/model-chat-client.ts`: temporary catalog transport/validation failure no longer discards the handle or interrupts a live inference; sending stays blocked until successful revalidation.
- Validated terminal server error plus clean EOF retains the last completed server checkpoint. The server only commits successful turns, so failed user/assistant/tool items are not replayed. Stale account/conversation/model errors, malformed/network interruptions, cancellation and timeout still reset continuation. No automatic retry or mutation replay.
- Image dedup now considers only completed turn pairs, not images from failed turns. Successfully retained historical images remain available through a confirmed failed followup.
- Accept advertised Toronto `query_aoi_points` tool events. Previously the client rejected them as unsupported, interrupting the loop and losing the history handle.
- `ModelChat.svelte` shows conditional recovery/history notices rather than silently leaving old messages disconnected. Ordinary successful chat adds no status panel.
- New `tests/model-chat-history-integration.test.ts`: real controller, NDJSON client, local HTTP routes, provider parser, scene tools and project authority; only upstream inference is mocked. Covers three sends/full POST replay, multiple tool rounds, catalog/error recovery without failed-turn replay, human approval pause/receipt, invented approval rejection and real tiny-source AOI query/history.
- Updated stale tests expecting idle scene changes to reset, historical captures to disappear and successful image proposals not to retain history. These match existing task051 behavior; two runtime expectations failed even with HEAD's client (isolated proof `/tmp/spatial-runtime-diagnosis.o5WuCL/`).

## Verification
- `node --import tsx --test tests/model-chat-history-integration.test.ts tests/model-chat-client.test.ts tests/model-visual-client.test.ts tests/model-chat-ui-context.test.ts tests/provider-model.test.ts tests/model-agent-runtime.test.ts` — **219 passed**, `/tmp/task060-focused-tests.log`.
- `pnpm typecheck` — pass, including Svelte 0 errors/warnings; `/tmp/task060-typecheck.log`.
- `pnpm build` — pass; existing web chunk-size warning; `/tmp/task060-build.log`.
- `pnpm test` blocked before executing tests by sandbox EPERM creating tsx IPC socket (`/tmp/task060-all-tests.log`). Equivalent `node --import tsx --test tests/*.test.ts`: **956/958 pass**, `/tmp/task060-all-tests-direct.log`. Remaining existing source/copy checks: `model-request-inspection-client.test.ts` expects removed `inspection.source === 'client'` markup; `safe-markdown.test.ts` expects removed credentials explanatory copy. This task only adds conditional history-notice markup, not changes to inspector content; those unrelated failures remain.
- LSP clean for changed TypeScript; no Svelte LSP configured (CLI Svelte check passes).
- `git diff --check` passes. Pre-edit graph: client stream/validation/ModelTurnFailure LOW; controller send/refresh UNKNOWN dynamic callers, confirmed against UI/tests via literal search. Index one commit behind plus existing dirty changes. `detect_changes(all)` reports whole dirty checkout **critical**, 35 files/202 symbols/128 affected processes; MCP output truncated. Re-ran CLI `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 1000`: all changed symbols, summarized process display; `/tmp/task060-graph-cli.log`. Not a clean whole-checkout certification; no commit.
- Managed fresh headless browser, localhost:5173, inference/catalog fetch mocks only. Desktop: two sends, catalog outage/recovery, third send retained same handle, failed followup retained history notice; composer cleared. Mobile 390×844: completed → confirmed failure → completed retained same handle and empty composer. No browser console errors. `/tmp/task060-browser/{desktop-error.png,mobile-error.png,mobile-complete.png,mobile-report.json}`. Screenshots inspected; mobile history requires scrolling to newest messages. Selected/pending browser matrix and live inference not run (approval checked through real-authority integration).
- Standalone Playwright launch blocked by OS sandbox; `/tmp/task060-browser.log`. Browser tool fresh backend succeeded; `/tmp/task060-browser.mjs` is the uncompleted standalone attempt, not passing evidence.

## Boundaries / status
History remains volatile and bounded (16 turns, 256 KiB text/tool history, separate image budget); reload/server restart/expiry loses it. Same scene/account identity gates remain. Actual-request inspector unchanged and reflects effective provider bodies. No commits; preserve extensive unrelated dirty tasks047–059 and operator config.

Implementation verified; fresh-session review pending. Review scoped client/UI changes and new integration tests, especially clean-error checkpoint retention versus ambiguous disconnect behavior. Suggested skills: harness-evaluation, gitnexus-review, browser-policy. Handoff: `/tmp/task060-chat-history-handoff.md`.
