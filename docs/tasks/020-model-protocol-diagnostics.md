# Task020 — Redacted provider protocol diagnostics

Status: implemented and independently bounded-reviewed; actual live rejection remains unidentified. Whole-checkout/fresh-session review and live compatibility remain pending.

## Scope and acceptance

User reported successful model discovery followed by `provider-protocol` on Send and authorized investigation. Add backend parser diagnostics that identify fixed rejection checks without logging credentials, prompts, response text, ciphertext, raw errors, arbitrary field names, headers, account identifiers or provider payloads. Do not make live inference calls, inspect credentials, restart operator services, repair the graph, retry/fallback automatically or commit.

- Emit at most one fixed diagnostic line for a parser rejection, containing only a closed check tag and the known HTTP status (200). Browser error codes/protocol stay unchanged; diagnostics go to the backend terminal, not browser console.
- Preserve framing, EOF/completion, identity/index/type, complete-snapshot reconciliation, history, cancellation, bounds and read-only tool safeguards. Do not relax snapshot equality speculatively.
- Fix the independently demonstrated public-schema gap: accumulate `response.refusal.delta` alongside text deltas, with identical output budgets and terminal reconciliation. This is not established as the user's live root cause.
- Fake-provider tests cover distinct checks, adversarial payload/header redaction, logger failure, unchanged failures/no history/no retry, mixed text/refusal streaming and full replay in both billing modes. Only injected fake-provider transports are used by tests.
- Run focused tests, baseline verification, diagnostics, incremental diff/preservation checks and independent fresh-context review. Record exact evidence and leave whole-checkout/fresh-session review and live compatibility pending.

## Investigation and delegation

Parent owns diagnostics, tests and integration. Isolated read-only reviewer compared the parser to public Responses/SIWC docs; a separate fresh-context reviewer will inspect the actual incremental diff and run focused checks. Public references: [Responses events](https://developers.openai.com/api/reference/resources/responses/streaming-events.md), [create schema](https://developers.openai.com/api/reference/resources/responses/methods/create.md), [SIWC inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md). Refusal delta omission is demonstrable; terminal null/done ciphertext differences remain speculative and must not justify weakening conflict checks.

GitNexus binds `cad-agent` at this checkout, index2026-10-15/commit4dc9c760. Initial query/context failed read-only shadow replay; retries recovered. `readResponse`, `outputItem`, `identity` and `frame` resolved LOW; exact `readResponse.line` resolved HIGH (warned before editing). Direct/upstream path is frame → line → readResponse → ProviderModel.turn → HTTP handle, verified against source. Shared ModelError rated CRITICAL and is deliberately not edited. No clean whole-checkout graph certification implied. Initial fingerprints and task-local baselines: `/tmp/spatial-task020/initial-sha256.json`, `initial-status.txt`, `before/`. Public review notes: `/tmp/provider-parser-public-compatibility-handoff.md`.

## Completion and exact evidence

Delivered fixed closed parser-check tags and numeric HTTP status only in backend stderr. One line per parser rejection; sink exceptions cannot replace the original failure. No raw provider or exception data is logged. Browser codes are unchanged. Complete-item and terminal conflict checks, identity, framing, EOF, limits, history commit and tool gates are preserved. Refusal deltas share text accumulation/budget/backpressure/reconciliation; no speculative snapshot relaxation.

Commands at repository root with Node v22.23.3 / pnpm10.34.6:

- `pnpm exec tsx --test tests/provider-model.test.ts` → **83 passed,0 failed**; `/tmp/spatial-task020/provider-focused.log`. Initial added diagnostic fixtures failed2 assertions because their constructed payload reached an earlier size boundary, not the intended validation; corrected fixtures now exercise exact copy/frame checks without changing production safeguards.
- `pnpm --filter @spatial/server typecheck` → exit0; `typecheck-initial.log`.
- `pnpm verify` → exit0, **397 passed,0 failed**, Svelte0 errors/0 warnings, production build and server typecheck pass; `/tmp/spatial-task020/verify.log`. Existing Vite >500KiB chunk warning remains. No UI source/protocol changes; browser tests not rerun.
- Independent fresh-context read-only incremental review → **READY**, no actionable findings; independently reran83 fake-provider tests and server typecheck. `/tmp/spatial-task020/independent-review.md`, `independent-focused.log`, `independent-server-typecheck.log`. This is bounded review, not a new-session or whole-checkout verdict.
- `git diff --check` → exit0; `diff-check.log`. Actual incremental source/tests/guide diffs inspected separately because source/tests/guide are already untracked relative to HEAD. Parent source/test diffs: `provider-model.diff`, `provider-model-tests.diff`; independent reviewer also compared saved baselines directly. Preservation: **192 of196 initial files unchanged**,4 intentional source/test/docs changes,1 new task file,0 missing; `preservation.json`.
- `lsp_diagnostics` on changed TS files and `*` remain discordant with passing CLI typechecks: parent cache reports287 diagnostics (281 errors,6 other), largely stale missing exports/signatures. No unrelated source workaround. Full captured response is referenced by `/tmp/spatial-task020/lsp-note.md`.
- GitNexus MCP `detect_changes({scope:'all',repo:'cad-agent'})` reports39 tracked files,114 symbols,15 flows, HIGH aggregate risk but **its returned output is truncated mid-JSON**, saved `detect-changes.txt`. Reran `node .gitnexus/run.cjs detect-changes --scope all --repo .` and `--limit 1000` → exit0 same HIGH totals, CLI still elides99 symbols/5 flows. Logs `detect-changes-cli.log` / `detect-changes-expanded-cli.log`. Task020 provider source is untracked relative to HEAD and omitted from this git-diff scan. These are **not clean/full graph certification**; pre-edit indexed-symbol impacts plus source/diff/independent review cover this bounded increment. No graph repair or commit.

## Next action / unresolved

The reported catalog-success/Send-failure root cause remains unknown. The refusal fix demonstrates a schema gap, not proof it caused that failure. Fixed tags identify the rejected check; they do not alone establish why provider output differed. No live ChatGPT/API-key call, account/credential inspection, operator restart, browser run or commit performed. Unrelated dirty tasks014–019 and operator account/services preserved. Whole-checkout/fresh-session review remains pending.

User can deliberately restart their backend and, only if willing to consume usage, choose one manual Send to capture the fixed `[model-provider]` line plus UI code. Do not share raw payloads, headers or credentials. No agent live budget/retry is authorized. Final redacted handoff: `/tmp/spatial-task020/completion-handoff.md`; suggested skills there.
