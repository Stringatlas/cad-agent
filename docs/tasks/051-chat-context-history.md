# Task051 — Chat context and message screenshots

## Scope / acceptance
- Screenshot sends and subsequent text replay the existing server conversation, including images.
- Retain user screenshots and model-requested captures on their messages; render inline.
- Keep completed history across idle scene-selection, area and revision changes within the same mode/project session/frame. Each turn still binds current scene tools; preserve approval gates.
- Remove redundant Chat heading and You/Assistant author labels. Preserve failures and inspection access.
- No auth changes, disk persistence or unrelated task047–050 refactors.

## Implementation
Implemented in `apps/web/src/model-chat-client.ts`, `ModelChat.svelte`, `Chat.svelte`, `apps/server/src/provider-model.ts` and shared model-chat limits. Server history owns replay, including prior assistant/tool items. Image bytes have a separate 12 MiB encoded-history ceiling, not the 256 KiB text/tool budget. Old images never acquire live pixel-grounding permissions. Account/model/mode/project-session/frame changes and interruptions still reset continuation; history is volatile.

## Verification
- `pnpm typecheck` passed (including Svelte, server and tests); `/tmp/chat-context-typecheck.log`.
- `node --import tsx --test tests/model-visual-client.test.ts tests/model-visual.test.ts tests/provider-model.test.ts tests/model-chat-client.test.ts` — 199 passed; `/tmp/chat-context-tests.log`.
- `git diff --check` passed.
- LSP cached missing task050 contract exports; current compiler checks above passed.
- Browser at localhost:5173: idle desktop inspected; redundant heading/author elements absent, capture/crop/attachment preview worked. Mocked inference endpoints only, no paid requests. Sending via this browser fixture did not produce a turn; inline historical-image browser check and mobile/selected/pending/error visual checks remain unverified. Do not interpret source/unit checks as a completed browser interaction check.
- Graph impact: provider turn/stream paths LOW; controller/Svelte unresolved graph edges confirmed against literal callers. Index stale by 2 commits. No commit.

## Follow-up — reactive screenshot freeze regression
User reported `state_descriptors_fixed`: retaining the composer screenshot directly made controller history freezing recurse into Svelte `$state` proxies. Both submitted and agent-captured observations now pass through `canonicalModelVisualObservation` to validate/detach before entering immutable message history; live pixel resolver adapters remain separate.

- `node --import tsx --test tests/model-visual-client.test.ts` — 17 passed, including reactive-proxy user/agent attachment regressions; `/tmp/chat-context-proxy-tests.log`.
- `pnpm typecheck` passed again; `git diff --check` clean.
- Real Chrome/Vite Svelte `proxy` reproduced the original freeze error; the fixed controller completed screenshot + follow-up with the same handle, retained a detached screenshot and left the original proxy mutable. Fetch was local mocked inference only. This verifies the runtime freeze fix, not the previously pending inline-image layout checks.

## Status / next action
Implementation complete; fresh-session review pending. Review only task051 changes within the shared dirty checkout, preserving tasks047–050. Finish isolated browser send/history/inline-image checks and review continuation reset behavior. See `docs/model-chat.md` for behavior and limits.
