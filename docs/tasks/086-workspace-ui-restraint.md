# Task086 — Scene-first workspace UI

User request: remove branding and taglines; simplify clunky Toronto overlays using Apple-style restraint and YAGNI.

Acceptance criteria:
- Unbranded workspace header; no promotional empty-chat copy.
- Toronto navigation, display and object access share a compact toolbar outside the canvas.
- Display settings and gesture help are disclosed on demand; selections, errors and individual Accept/Decline remain accessible.
- Desktop and mobile visual verification covers idle, selected, pending and error states.
- Preserve existing unrelated staged changes. Fresh-session review remains pending.

Status: implemented and verified; fresh-session review pending.

Completed criteria:
- Removed header wordmark, decorative logo, initial page-title branding, and empty-chat tagline.
- Moved Toronto controls above the canvas. Objects opens source/datum tools; Street view returns to the street; View exposes Fit scene and gesture help; Display exposes colors, semantic key and point size, with detail tuning nested.
- Selected datum/source identity stays contextual; source semantic types remain visible with chat closed. Area selection has a clear action even when Objects is closed. Selection, object contents and recovery stack without absolute-position collisions.
- Preserved explicit individual approval and recovery; checked mobile chat stays clear of approval.

Verification:
- `pnpm typecheck` — passed. After final presentation edits, `pnpm --filter @spatial/web typecheck` — passed, zero errors/warnings (`/tmp/task086-web-typecheck.log`).
- `pnpm build` — passed, existing bundle-size advisory remains (`/tmp/task086-build.log`).
- `pnpm test` — 1014 passed, 1 failed of 1015; semantic disk-storage cancellation cleanup expected no additional staging directory. Full output: `/tmp/task086-tests.log`.
- `node --import tsx --test tests/spatial/semantic-disk-storage.test.ts` — 14/14 passed on isolated rerun (`/tmp/task086-storage-retry.log`). No storage code changed.
- `node --import tsx scripts/browser-workspace-ui-smoke.mjs` — passed against built UI, isolated backend/context, actual Toronto dataset, synthetic model catalog only; no inference requests. Evidence: `/tmp/task086-browser/report.json`, 14 PNGs and accessibility snapshots covering 1440×900 desktop and 390×844 mobile. Inspected idle, selected source/datum, display, pending with/without chat, and object error/recovery screenshots. No page errors.
- `git diff --check` — passed. Inspected task-owned diff; unrelated staged and unstaged edits preserved. No commit.

Graph scope and limitations:
- GitNexus pre-edit file impacts returned UNKNOWN, index one commit behind. Verified App → Toronto → SceneObjects and Chat/CloudChat → ModelChat imports directly. Presentation changes do not alter authority/controller contracts.
- `detect_changes({scope: "all", repo: "cad-agent"})` reports critical risk for the combined working tree (56 changed symbols, 39 affected, 26 files), including existing server/provider/terrain changes outside this task. This is not a clean isolated UI impact verdict. Saved response: `/tmp/task086-graph-changes.json`.
- Requested `pi-browser-harness` skill was absent from installed skill paths; used installed visual-qa/playwright-handoff guidance and the repo's isolated Playwright harness pattern. Native Chrome screenshot also inspected.

Next action: fresh-session review of this task against its actual UI diff and screenshot matrix; investigate storage cancellation timing independently if the suite failure recurs. No implementation changes remain for these criteria.

