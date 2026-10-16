# Task026 — Numbered scene points

## Authorized scope
Replace A/B picks with append-only Point 1, Point 2, … references in Toronto and synthetic scenes. Show an individually removable list and include all active points in model context. Preserve provenance/frame/revision and read-only model authority. Preserve existing task025 work; no provider/account/config/service changes or commits.

## Acceptance
- Each successful Cmd/Ctrl-click appends a fresh point, including repeat picks of the same record.
- One mounted-workspace counter across sources; removal, clear, source/artifact/project reset never reuse allocated numbers. Reload starts fresh (no persistence).
- Individually remove list items and matching overlays/context; changed context invalidates pending model work/continuation through existing binding gates.
- At most32 retained points per scene; explicit rejection, no silent replacement. Positive safe-integer names, no leading zeros, duplicate names rejected.
- Original coordinates, source keys, units, frames and revisions preserved. Hidden scene references excluded; no Toronto→project conversion or expanded editing authority.
- Unit/contract/controller tests, baseline verification, isolated fixture browser checks and independent incremental review. Whole-checkout review remains separate.

## Risk/ownership
GitNexus cad-agent at this checkout, index7d9c297 one commit behind HEAD; no rebuild authorized. Shared model canonical validator HIGH and synthetic context validator CRITICAL reported before narrow edits. Svelte/picking impacts UNKNOWN supplemented by source caller searches. Backend/contracts and synthetic frontend delegated with explicit file ownership; parent owns integration, Toronto/list and verification. No clean graph certification claimed.

## Completion / verification
All implementation criteria complete. New numbered-only contract replaces A/B (old A/B API payloads now reject). Counter may consume numbers on rejected attempts, never reuses allocated numbers. Synthetic technical controls retain independently held synthetic references across source switches, but only the active source enters model context. Toronto source switches clear its references as before.

Exact checks:
- `pnpm verify > /tmp/spatial-task026/verify.log 2>&1`: exit0; typecheck incl svelte-check0 errors/0 warnings;541 tests passed; web build and server typecheck passed. Existing bundle-size advisory remains.
- `node --check /tmp/spatial-task026/browser.cjs && node /tmp/spatial-task026/browser.cjs > /tmp/spatial-task026/browser-run.log 2>&1`: exit0;31 isolated fixture browser assertions. Actual Ctrl/Meta picking, >2/repeated points, monotonic removal/clear/source switch, cap32 rejection, list/marker/context removal, fake-provider payloads, pending model invalidation/late-frame suppression, desktop/mobile overflow verified. No console errors. Metrics/screenshots/AX and safety/visual limits: `/tmp/spatial-task026/browser-handoff.md`, `browser-metrics.json`, `browser*.png`, `browser*.ax.yml`.
- Independent incremental fresh-agent review found no actionable task026 defects: `/tmp/spatial-task026/independent-review.md`; independently reran33 focused tests (`review-tests.log`). This does not certify task025 or the entire checkout. Whole-checkout fresh-session review remains pending.
- `git diff --check`: passed. Parent inspected task026 diff for unintended changes; task025 files preserved.
- GitNexus `detect_changes(scope=all, repo=cad-agent)`:147 symbols/21 tracked files, critical whole-dirty-tree exposure blending025/026. Stale index and Svelte/untracked coverage mean no clean graph certification. No commit made.
- Parent LSP retains stale contracts exports (and unrelated cached diagnostics); Svelte LSP unavailable. Fresh CLI typecheck is clean. Delegated isolated LSP checks clean.

Remaining limitations: coincident point sprites overlap; mobile camera can put edge markers outside frustum while list/context remains correct. No collision avoidance/automatic reframing added. Browser did not exercise actual prepared Toronto/full-resolution detail, real provider inference, synthetic cap, reload or artifact/project reset; reset nonreuse verified by allocator ownership/unit tests/review. GPU disposal source-reviewed, not long-run leak measured. No live account/provider/config/service mutation performed.

Next action: user acceptance; whole-checkout review separately. Completion handoff `/tmp/spatial-task026/completion-handoff.md`.
