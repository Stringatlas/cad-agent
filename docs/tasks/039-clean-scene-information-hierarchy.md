# 039 — Clean scene information hierarchy

Status: Implemented; fresh-session review pending. No commit.

## User request
The workspace is cluttered with implementation narration, session IDs and irrelevant technical caveats while selected-point types and cluster meaning are hard to discover. Explicitly establish clean YAGNI/Apple-style information hierarchy for all future agents, and improve the actual UI—not merely its documentation.

## Acceptance
- Scene/chat/current task remain primary; no idle point-authority diagnostic card over the scene.
- Selected points show their semantic type or truthful Unknown when unavailable. Keep provenance exact internally.
- Derived layers have a compact accessible color key; distinguish semantic class from layer representation without permanent paragraphs or unlabeled color-only meaning.
- Routine session/revision/provenance/safety explanations are removed from primary surfaces or tucked into purposeful disclosure. Preserve actionable errors, human proposal review and recovery controls.
- Repository agent instructions, product vision and reusable UX rules explicitly enforce hierarchy/progressive disclosure/YAGNI. No extra speculative UI framework or blanket removal of verification data.
- Verify selection/legend/approval/recovery behavior, desktop/mobile rendering and baseline checks; record commands/artifacts and limitations. Fresh-session review remains separate.

## Work allocation
Frontend agent owns bounded UI changes and focused browser/test evidence. Parent owns shared agent/product UX guidance, task tracking, integrated checks/diff inspection and handoff. Preserve all existing task037/038 working changes. No backend authority/provenance protocol redesign. A bounded read-only source-label lookup was added to finish semantic typing for full-resolution selections absent from sampled observations.

## Delivered

- Standing agent rules in `AGENTS.md`, `docs/product-vision.md` and new `docs/ux-principles.md`: scene/selection/approval first, progressive disclosure, text-labeled meaning, no permanent diagnostic narration or speculative dashboards. User preference also saved durably.
- `Chat.svelte` displays **Point N · semantic type** immediately in references. Number-reuse/unmapped/GPU/provenance paragraphs removed from primary copy; exact coordinates, source keys/frame/revision and full local evidence remain in Details. UI-only metadata is stripped from strict model payloads.
- `PointEdits.svelte` no longer leaves an idle bottom-right UUID/status/refresh panel. Manual/Undo/Refresh live in Scene tools; the same controller stays mounted. Pending per-change Confirm/Reject, busy and actionable stale/failure recovery remain prominent and usable above the mobile chat.
- `PreprocessingLegend.svelte` and `preprocessing-overlays.ts` replace the long overlay panel with compact class-colored wire bounds and text keys for present semantic classes, amber Fits and green Ground. Estimated status remains short; methodology/quality/provenance are disclosed on demand. Toronto routine completed-detail toast is quiet; full dataset navigation is in Navigation tools.
- New `point-presentation.ts` uses exact source-observation witnesses/validated nearest evidence, never RGB/bounds inference. Full-resolution picks absent from overview use new `point-type-client.ts` and server `source-point.ts` via `GET /datasets/toronto3d/point?revision=<sha256>&sourceFileId=<1..4>&sourceRow=<uint32>`.
- Additive `loadPreparedSemanticDiskIndex` export reuses/loads a bound canonical index, **never builds on a click**. One original record is reread and key/revision/coordinates checked. Existing method/Host/Origin/range/two-request limits and a3s cancellation deadline apply. Labels are UI-only and original-source-bound, unaffected by overrides; missing/unprepared lookup yields Unknown. One client request at a time,3.5s timeout, exact frame/key/binary64 position checks and cancellation/revision gates prevent stale publication without changing selections/proposals/model context.

## Verification / artifacts

Final parent commands:
- `pnpm typecheck > /tmp/spatial-task039-typecheck.log 2>&1`: pass; Svelte zero errors/warnings.
- `node --import tsx --test tests/*.test.ts > /tmp/spatial-task039-tests.log 2>&1`: **731/731 passed**, no failures/skips/cancellations.
- `pnpm build > /tmp/spatial-task039-build.log 2>&1`: pass; existing large-chunk advisory.
- `node --import tsx scripts/browser-scene-hierarchy-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task039-browser`: pass after final build. Existing Chrome, own tab/ephemeral authority, fixture-only source/layers. Native detail-only Car deliberately omitted from overview resolves exact source type; overview Pole remains correct. Idle hidden controls, desktop/mobile legend/selection, pending review when tools closed, mobile hit-test, Reject no mutation, deliberate stale-approval recovery and explicit Refresh/Undo all pass. Intentional409 resource-console message only; no page errors. Report/AX/screenshots in that directory; parent visually inspected equivalent final child screenshots in `/tmp/task039-point-types-browser/` and actual layers in `/tmp/task039-actual-street/`.
- `node --import tsx scripts/browser-street-testing-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task039-street-browser`: pass against actual3,217,790-point street crop/12bounds/9fits/368ground tiles. Real summary+eye/hide/orbit behavior; labeled fixture empty/unavailable/503 states. Intentional503 resource-console message only; no page errors. `/tmp/spatial-task039-street-browser/{report.json,actual-preprocessing.png,street.png,*.ax.txt}`.
- Child existing point-edit browser regression passed: `/tmp/task039-point-regression/report.json`; exact uploads, approval, repeated moves/stale replay/Refresh/two Undo/source bytes unchanged. Production exact source lookup1:123456 measured~110ms; this is a source-read check, not production-cloud browser selection proof.
- `git diff --check` passes. Parent inspected actual changed sources and tracked diff. Added-file diagnostics clean in child; parent cached workspace LSP retains20 pre-existing unrelated stale errors and one deprecated hint in untouched files; fresh full CLI typecheck passes. No clean cached-workspace claim.

Earlier child full runs twice hit an unrelated timing-sensitive storage cancellation assertion (`tests/semantic-disk-storage.test.ts:181`,724/725), isolated retry passed7/7. Final child and parent full runs both pass731/731; no storage test/code weakened. Composite `pnpm verify` not rerun by parent because prior task038 exposed tsx CLI IPC EPERM; component checks above were run directly, not claimed as a composite pass.

Graph: pre-edit source lookup route LOW; additive load-only index export file MEDIUM. Shared provenance pick cache HIGH warning respected by leaving caches unchanged. Svelte/new symbols UNKNOWN source-confirmed. Final detect_changes over all dirty work reports aggregate HIGH,29 tracked symbols/15 processes; stale index misattributes the added accessor to adjacent getSemanticDiskIndex and misses untracked additions. Not a clean graph certificate; refresh/review complete additions before commit. Earlier task037/038 changes preserved.

## Remaining / next action

Fresh-session review pending against task039 and actual tracked/untracked diff. No live-provider calls, broad inspector framework, cluster picking, model-tool semantic changes or CAD mutation added. Semantic type is an original dataset label, not verified object identity; missing/preparation-unavailable metadata falls back to Unknown without blocking selection. Review retry behavior for optional label failures and cold-cache lookup latency if operator testing finds gaps. Older browser scripts not listed above may need purposeful disclosure navigation; do not call unrun suites passing.

## User corrective follow-up — remove, do not relocate

User correctly rejected the verbose derived-bounds/fit-quality/ground-count paragraph still retained under legend Details. Removed its generation from `Toronto.svelte` and removed the legend Details entirely, rather than merely collapsing it. Ready state is now only the text-labeled layer/class key plus Estimated (and limited-results when applicable), with no count badges or backend message text. Empty/unavailable/failure states use short user-facing recovery copy. Future-agent UX guide explicitly prohibits using Details as a dump for useless diagnostics or directly displaying backend messages.

Follow-up checks: `pnpm typecheck`, `pnpm build`, `node --import tsx --test tests/*.test.ts` all pass (731/731), logs `/tmp/task039-copy-{typecheck,build,tests}.log`. Actual existing-Chrome `node --import tsx scripts/browser-street-testing-smoke.mjs http://127.0.0.1:9222 /tmp/task039-copy-browser` passes, now asserts the diagnostic phrases and legend Details are absent, while labeled classes/layers and recovery states remain. Screenshot `/tmp/task039-copy-browser/actual-preprocessing.png` visually inspected. Svelte LSP unavailable; fresh svelte-check passes. UNKNOWN graph impacts source-confirmed for Svelte functions/components. No authority/provenance changes. Fresh review still pending.

Handoff: `/tmp/spatial-task039-handoff.md`, corrective addendum `/tmp/task039-copy-handoff.md`. Suggested next task is operator assessment of the clean idle/selected/pending scenes, not automatic UI expansion.
