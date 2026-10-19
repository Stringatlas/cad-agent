# Task057 — Chat composer and context recovery

## Scope / decisions
Fix repeated AOI image attachments, clear admitted messages immediately, and add small contextual edit/retry icons. Preserve task055 renderer rollback, task056 hierarchy, existing dirty work and human approval. No commit.

- Exact canonical images already retained in the active successful server conversation are not attached again. First thumbnail/history remains; changed observations are sent. Reset/failure/cancelled handles resend rather than relying on display-only history.
- Admitted send clears the draft and manual screenshot synchronously, before network/approval completion. A rejected submission keeps its draft; typing during a response is never cleared at completion. Failed admitted requests remain in history for edit/retry.
- Edit copies sent user text into the focused composer; the original stays visible. Retry is available on the latest user message and sends a new turn using current scene/context. Neither branches server history nor replays accepted mutations. All new proposals still require individual human approval.
- Icons are 14px within 30px buttons, revealed on hover/focus; no-hover devices expose 36px targets. Labels/tooltips retained. Existing nonempty composer text is not overwritten by message actions.

## Acceptance / status
- [x] Active-continuation image dedup, changed-image retention and reset/failure/cancel resend regression coverage.
- [x] Immediate clearing, rejected-send preservation and newer typing coverage.
- [x] Small accessible edit/retry actions; browser fixture verifies Edit focus and Retry continuation.
- [x] Typecheck/build and actual diff inspection.
- [ ] Fresh-session review and full selected/pending/error/mobile-touch acceptance; no claim of complete workspace visual certification.

## Verification
Node22.23.3, pnpm10.34.6.
- `pnpm typecheck`: pass, Svelte0 errors/0 warnings; `/tmp/task057-typecheck.log`.
- `pnpm build`: pass; existing bundle-size advisory; `/tmp/task057-build.log`.
- `node --import tsx --test tests/model-chat-ui-context.test.ts tests/model-visual-client.test.ts tests/historical-screenshot-wiring.test.ts`:29/30 pass; `/tmp/task057-focused.log`. Remaining existing historyNotice test expects reference changes to reset continuation, contrary to task051; reproduced before this task in task056. No assertion weakened.
- `node --import tsx --test --test-name-pattern='composer|model UI|deduplicates|resends' tests/model-chat-ui-context.test.ts tests/model-visual-client.test.ts`:4/4 pass; `/tmp/task057-regression.log`.
- `node --import tsx --test tests/model-chat-client.test.ts tests/model-visual-client.test.ts tests/model-proposal-client.test.ts tests/model-request-inspection-client.test.ts`:145/146 pass; `/tmp/task057-controller.log`. Existing UI assertion expects `inspection.source === 'client'`, absent before this assignment; same failure recorded in child baseline `/tmp/task057-image-context-handoff.md`.
- Initial `pnpm exec tsx --test ...` blocked by sandbox IPC EPERM; Node `--import tsx` runs above avoid that launcher. Initial compiler error using ES2023 findLastIndex corrected to ES2022 map/lastIndexOf.
- LSP: TS tests/controller clean; no Svelte LSP configured, covered by svelte-check. Final workspace cached diagnostics reports an unrelated `toronto-viewer.ts:486` argument-count error; authoritative `pnpm typecheck` passes. Viewer was not edited in this task. `git diff --check`:pass. Full suite not run.
- Browser on existing localhost:5173 with page-local mocked `/chat/models` and `/chat/turn`, no provider inference. Confirmed cleared composer while streaming, Edit copies and focuses textarea, Retry produces second request with fixture continuation, idle icons opacity0 and focus-revealed. Actual desktop1512×697 and mobile390×844 screenshots inspected; no horizontal mobile overflow. Compositor clicks did not submit in this browser session; DOM requestSubmit/click and keyboard focus used for deterministic fixture interaction. Real-device touch and full approval/error permutations not tested.
- Desktop screenshot: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-a2eee020-7c38-410d-aaa3-ec43e5a0e37c.jpeg`; mobile screenshot: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-56967a31-a4d4-4028-a05b-a700d26fbe38.jpeg`.

## Graph / preservation
Graph concept query performed; send impact UNKNOWN (Svelte handler unindexed, controller receiver calls unresolved). Actual form/Enter handlers and Chat→ModelChat imports checked against source before edits. Child handled only client dedup/tests, parent composer/actions/tests/docs. Global detect_changes reports **critical**,76 files/795 symbols/182 affected flows across accumulated dirty work; not task-only attribution or a clean graph certification. No commit.

Files: `apps/web/src/{ModelChat.svelte,model-chat-client.ts}`, `tests/{model-chat-ui-context,model-visual-client}.test.ts`, this task and index. Combined unstaged diff `/tmp/task057-combined-working-diff.patch` also contains earlier task051/056 edits; do not treat it as an isolated task057 patch. Child image-only patch `/tmp/task057-image-context-diff.patch`.
