# Task022 — Bounded redacted live model diagnostics

Status: bounded implementation verified; live compatibility unresolved. Investigation paused for user's account-connection UI correction; fresh-session review pending.

## Authorization and acceptance

User approved bounded content-redacted diagnostics and diagnostic chats after actual task021 `provider-format-missing` reproduction. Implement now, not another permission loop. Preserve dirty014–021, operator configuration/accounts/services, strict SSE/EOF/identity validation, fixed format errors and no automatic retries/billing fallback. No raw credential, header, URL, body or exception logging. No endpoint changes without evidence.

- For wrong-MIME HTTP200 only, internally inspect at most1KiB/16reads/250ms with cancellation. Closed appearance tags only; never accept sniffed content or publish deltas/tools/history.
- Attribute actual backend failures with closed URL/type/redirect/body-presence tags and shape in private OS-temp artifacts: randomized0700 directory, exclusive0600 files, latest8 per writer/process, failures noninterfering. No HTTP/API contract added.
- UI no longer claims body uninspected; no completed answer accepted. Supersedes task021's unread-body criterion; prior evidence remains historical.
- Unit/integration tests: bounds, fragmentation, abort/errors/hostile streams, redaction, artifact privacy/rotation, exact fixed rejection/no retry/failed replay; CLI/LSP and actual browser diagnostic chat. Use evidence to guide any compatibility fix, not speculation.
- Record exact commands/evidence and remaining failures; independent incremental review, fresh-session/whole-checkout review remains pending.

## Risk and delegation

cad-agent index2026-10-16/4dc9c760 is stale for incremental edits; no index repair. readResponse upstream LOW (ProviderModel.turn → model-chat HTTP handle); ProviderModel LOW (factory/routes/scenes and test/script consumers). UI presenter UNKNOWN absent from index, source confirms ModelChat.svelte and client tests. Test file impacts UNKNOWN; package test script enumerates tests/*.test.ts. Parent owns integration/UI/task/browser; isolated child owns new helper/writer/tests; independent reviewer follows integration. No module boundary changes.

## Evidence

- `pnpm exec tsx --test tests/model-diagnostics.test.ts tests/provider-model.test.ts tests/model-chat.test.ts tests/model-chat-client.test.ts tests/model-chat-ui-context.test.ts` →196 passed,0failed (`/tmp/spatial-task022/focused.log`).
- `pnpm verify` →450 passed,0failed; CLI typechecks/Svelte/build pass (`/tmp/spatial-task022/verify.log`), existing Vite large-chunk warning. Workspace LSP remains discordant/stale (353cached diagnostics incl external harness files and missing existing exports); no unrelated source workaround.
- Independent incremental review: no blocking code/security findings; LOW stale docs corrected.176focused tests pass; wrong-MIME SSE/abort/slot-release synthetic probe pass. `/tmp/spatial-task022/independent-review.md`, `independent-tests.log`, `independent-probe.log`. Whole-checkout/fresh-session review pending.
- Exact incremental provider/UI diffs inspected against `/tmp/spatial-task022/*.before.ts`; `git diff --check` pass. Reviewer aggregate GitNexus reports HIGH114symbols/15flows/39files but truncated; untracked incremental targets not cleanly covered. Not clean graph certification; no rebuild/commit.
- Browser owned tab9B9578397BF7C47696177D841F3B52E1 at127.0.0.1:5173: repeated focus/account-change invalidation prevented catalog readiness, with no sends from those steps. Guarded explicit Send at2026-10-16T02:52:32Z, gpt-5.6-luna, prompt `Reply with exactly OK. Do not call any tools.`: resource turn count1→2, incomplete/noanswer, UI `stale-scene`. No automaticretry/fallback.
- Actual listening backend PID64419 has a closed record at OS tmp `spatial-model-diagnostics-FdStwt/diagnostic-64419-1.json`, timestamp02:51:58.849Z, HTTP200/missing, URLexpected/typebasic/notredirected/bodypresent/sse-like. This predates the guarded02:52:32Send, so cannot attribute it to that request; it suggests SSE-looking body without MIME, NOT protocol success/rootcause. Never relaxed acceptance. No rawcontent read.
- User then supplied account-state UI screenshot and said work was going in circles. Priority changed to truthful Continue/Connected/plan-enabled/Manage usage account UI; inference investigation remains unresolved. New default artifacts under Node OS tmp `spatial-model-diagnostics-*/diagnostic-<pid>-<sequence>.json`; fixture/test artifacts are not live evidence.
