# 050 — Agent inspection and human approval loop

Status: Ready for review

## Ownership
- Implementation: Pi development session, delegated runtime/camera/authority/UI/concurrency work.
- Review: Unassigned; fresh-session review pending. No commit created.

## Goal and scope
The product agent can inspect the live scene repeatedly, add its own original-point references, propose a change, wait for individual human Accept/Decline, and continue using the resulting authority. Approval remains human-only. Preserve unrelated tasks047–049/operator changes.

Included: current/top-down/explicit local-meter camera screenshot requests; numbered original-source reference selection; approval pause/resume for synthetic parameters, Toronto point overrides and native CAD candidates; compact combined bottom-right review with arrows/counter and Details; bounded cancellation/stale-state handling.

Excluded: autonomous approval, bulk acceptance, arbitrary CAD operations, persistence of Toronto state, unrestricted geometry queries, production-scale/provider certification.

## Acceptance
- [x] Agent-requested captures use a clone camera without navigating the live viewport; current/top-down/custom camera interface is extensible and validated.
- [x] Agent selects an original Toronto source key or synthetic entity/index without permission. Server independently rereads/verifies the exact added reference. Selection is not a geometry edit.
- [x] Proposals stream before turn EOF; only successful human authority decisions generate receipts. The loop waits, rebinds exact revisions and continues. Client RPC cannot approve.
- [x] Each change has individual Accept/Decline in a bottom-right navigable card, not hidden in Scene tools; pending mobile Chat/composer and review remain separately reachable.
- [x] Current typechecks, serial full tests and build pass; automated/browser evidence below.
- [x] Implementation diff inspected; unrelated dirty work preserved.
- [ ] Fresh-session review completed; aggregate graph coverage resolved before any commit.

## Implementation
- Contracts: `ModelCaptureRequest`, `ModelReferenceSelection`, nonce-scoped browser request/result and approval events. `/chat/browser-result` shares the local-only origin checks and active-turn admission; callback results confer no mutation rights.
- `model-agent-runtime.ts` wraps the existing bound scene. It validates selection against original authority, validates returned images, polls bounded authority-owned decision receipts and rebinds after exact expected revision changes. Unrelated mutations/session changes fail stale rather than becoming approval. Server read-only busy retries are abortable; proposal/approval mutations are never retried.
- `provider-model.ts` advertises `scene.capture_scene` and `scene.select_reference`; existing proposal tools pause until authority decision. Updated context and `humanDecision` are included in subsequent actual provider requests. Sixteen tools/seventeen rounds and a15-minute turn bound allow human review; provider calls retain a90-second round bound. Cancel/account/source/unrelated-selection changes stop continuation. Images remain turn-local and are excluded from retained conversations.
- All three authorities retain at most256 successful decision receipts. Failed, expired or invalidated operations do not fabricate decisions. Project Load/session lifecycle clears receipts; Undo does not rewrite past decisions.
- `ApprovalReview.svelte` combines Toronto point/CAD pending changes; synthetic uses the same card. Errors/Refresh stay visible. Accept/Decline work during model waiting; manual proposal/Undo/Save/Load gates remain separate.
- Capture adapters forward camera requests. Synchronous viewport sizing fixes a browser-discovered post-Accept remount race (default300×150 buffer before ResizeObserver delivery); invalid/zero-sized hosts reject rather than misrepresent captures.
- Toronto read-only snapshot HTTP transport retries only exact snapshot GET routes returning known429 busy, at most eight100ms retries, abortably. Mutation requests remain single-shot. This addresses real contention between runtime polling and browser refresh without retrying proposals.

## Verification evidence
| Exact command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm verify` | Typecheck passed; wrapper blocked at tsx IPC socket `EPERM`, so NOT a composite pass | `/tmp/task050-verify.log` |
| `pnpm typecheck` | Passed; Svelte0errors0warnings | `/tmp/task050-final-typecheck.log` |
| `node --import tsx --test --test-concurrency=1 tests/*.test.ts` |896/896 pass, no skips | `/tmp/task050-final-tests.log` |
| `pnpm build` | Passed; existing large-chunk warning | `/tmp/task050-final-build.log` |
| Earlier parallel `node --import tsx --test tests/*.test.ts` |883/885: obsolete source-wiring assertion corrected; unrelated timing-sensitive semantic-disk-storage staging cancellation failed under concurrency. Serial final suite passes unchanged storage tests | `/tmp/task050-tests.log` |
| `git diff --check` | Passed | Final working diff |
| LSP changed-source checks | Children/focused checks clean; aggregate cached workspace diagnostics contain stale cross-package exports/prior dirty adaptive-render types. Current compiler checks above pass | Individual child handoffs under `/tmp/task050-*-handoff.md` |
| `node --import tsx /tmp/task050-browser.mjs http://127.0.0.1:9222 /tmp/task050-browser-final` | Seven-round synthetic fixture browser loop passes, including Decline then Accept, original selection, screenshots and continued reply; postaccept viewport1080×842. Desktop/mobile idle/pending/selected/error and small-device layouts inspected | `/tmp/task050-browser-final/`, `/tmp/task050-mobile-approval-handoff.md` |
| `node --import tsx /tmp/task050-toronto-browser.mjs http://127.0.0.1:9222 /tmp/task050-readonly-browser` (and repeat with `...-repeat`) | Both pass: original Toronto reference selection, current/top-down captures, native box Decline, cylinder Accept, exact revision1 body and continued capture/final reply | `/tmp/task050-readonly-browser/`, `/tmp/task050-readonly-browser-repeat/` |
| GitNexus `detect_changes(scope:all)` / `node .gitnexus/run.cjs detect-changes --scope all --repo .` | Aggregate CRITICAL mixed dirty change set; index2commits behind. MCP output truncates mid-JSON even on repeat, CLI reports sampled symbols/flows. NOT clean graph certification; no commit | `/tmp/task050-graph-changes.txt`, `/tmp/task050-graph-cli.txt` |

Browser checks used already-running Chrome9222, owned temporary tabs and isolated tiny dataset/project/native-kernel/provider fixtures. No paid model requests, operator authority mutations or Chrome launches. Browser daemon socket was missing; the previously hanging setup was not retried. Transient local snapshot429 busy console entries recover as designed; intentional503 error fixture is expected. Earlier failed diagnostic runs are retained in browser child handoffs, not reported as passes.

## Review and next action
Fresh-session review against this task and actual mixed diff remains pending. Pay particular attention to proxy/rebind lifecycle, exact revision guards across polling, authority receipts, read-only retry scope, image/reference grounding and mobile hierarchy. Fixture provider success does not establish real-provider model behavior or78M-point performance. Refresh/re-run complete graph analysis before a commit; do not stage unrelated work. Handoff: `/tmp/task050-agent-loop-handoff.md`.
