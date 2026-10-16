# 029 — Catalog-listed models may attempt image input

Status: Implemented and verified; fresh independent incremental review READY.

## Bug and bounded fix
User reported that actual VLMs were blocked by the supported-vision-model list. Task028 introduced a shared hardcoded name regex, enforced in UI, browser client and provider adapter; provider discovery was not the source of the restriction. Remove the utility and all name gates rather than invent model capabilities or add names. Any model admitted by the configured provider catalog may attempt an explicitly attached image, for API-key and ChatGPT-plan modes. Catalog membership is not image-capability verification. Provider rejection remains an incomplete error, without automatic retry, stripping or fallback.

Preserve existing dirty tasks025–028 and AGENTS.md. No live inference, auth/config changes, operator service restarts, graph rebuild or commit. No CAD/geometry mutation, default image, or image-history retention.

## Acceptance criteria
- [x] Remove name-based vision admission across contracts/server/client/UI; retain provider catalog admission.
- [x] UI explains unverified image capability and possible provider rejection; explicit attach/send only.
- [x] Preserve PNG/CRC/hash/dimensions/budgets, source/revision binding, fresh isolated image turns, nonce-bound read-only pixel tool and safe request inspection.
- [x] Fake API-key and ChatGPT catalogs admit an unfamiliar fixture model and transmit actual input_image/data URL. Forged noncatalog models reject before dispatch; provider rejection causes no strip/retry/history commit.
- [x] Baseline and guarded existing-Chrome browser checks, diff inspection and redacted temp handoff.
- [x] Fresh independent incremental review READY; no actionable defects. `/tmp/spatial-task029/independent-review.md`; independent targeted201/201 PASS.

## Verification
- `pnpm exec tsx --test tests/model-visual.test.ts tests/model-visual-client.test.ts`: PASS27/27; `/tmp/spatial-task029/scoped-tests.log`.
- `lsp_diagnostics(path: "*")`: no cached diagnostics across one running TypeScript server. Not a substitute for Svelte/CLI typechecks.
- GitNexus repo cad-agent, this checkout, index one commit behind; no refresh authorized. Provider turn/stream indexed LOW; absent new functions and Svelte/controller references UNKNOWN, verified by source search. Full graph certification is not claimed.

- `pnpm verify > /tmp/spatial-task029/final-verify.log 2>&1`: PASS596/596, workspace/test typechecks, Svelte0errors0warnings, server typecheck/build and web build. Existing >500kB Vite chunk warning remains. Initial run595/596 failed the old unsupported-notice source assertion; updated to assert capability uncertainty/catalog selection instead, then reran the full command successfully (`verify.log` retains first failure).
- `node /tmp/spatial-task029/browser.cjs > /tmp/spatial-task029/browser.log 2>&1`: PASS72 guarded checks, built app, existingCDP9222, isolated ephemeral fixture origin/context only. Two arbitrary catalog models attach/send in Toronto and demo, four pixel-tool roundtrips; explicit default/opt-out, image isolation, stale cancellation, mobile overflow and redirect-to-live-origin denial checks preserved. No application console errors, interceptor/server errors, nonowned traffic after denial proof, or geometry mutation requests. Owned context/server closed; existing Chrome untouched. Metrics: `/tmp/spatial-task029/browser-metrics.json`; desktop/mobile attachment PNGs and AX snapshots under the same directory. Visually inspected desktop demo attachment panel.
- `git diff --check`: PASS. Inspected `/tmp/spatial-task029/incremental-tracked.diff` against pre-task dirty diff; only intended task029 tracked changes. Untracked visual contracts/tests and task028 supersession note inspected during precise edits. Existing AGENTS.md and unrelated025–028 edits preserved.
- Aggregate `gitnexus_detect_changes({scope:all,repo:cad-agent})` reports CRITICAL233 changed symbols/107 affected processes across28 tracked files (includes prior tasks/user edits); output truncates. Reran `node .gitnexus/run.cjs detect-changes --scope all --repo . > /tmp/spatial-task029/graph-changes.txt 2>&1`: same aggregate risk, CLI lists only10/107 affected processes. Stale/untracked graph coverage and truncated process listing remain unresolved; not a clean graph certification. No commit/reindex.
- Redacted continuation: `/tmp/spatial-task029/completion-handoff.md`.

Fresh independent incremental review completed against task and actual code: READY. Whole-checkout review and complete graph certification remain pending separately. No live model compatibility claim from fixtures.
