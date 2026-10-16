# 030 — Chat camera, crop modal and compressed image

Status: Implemented and verified; final independent corrective sign-off READY.

## Request and scope
Replace the bulky screenshot panel with a small camera icon in chat, a crop modal and a compressed JPEG/WebP attachment. User authorized immediate implementation and optional libraries. Native dialog/canvas implement the UI; pinned server jpeg-js 0.4.4 validates JPEG bytes. Preserve unrelated dirty tasks025–029 and AGENTS.md. No live provider calls, auth/config changes, existing-service restarts, reindex or commit.

## Acceptance
- [x] Accessible camera icon in composer opens a native modal immediately, with loading/error states; no automatic send.
- [x] Drag or numeric source-pixel crop, whole-image reset, Cancel/Escape and camera focus restoration; desktop/mobile fit.
- [x] JPEG quality78%, longest edge1280 without upscaling; compact removable thumbnail shows actual dimensions/KB. Original PNG remains local, up to12MiB; sent image capped at2MiB.
- [x] Preserve original observation ID, viewport/camera, source/revision/frame/coverage. Separate crop/output dimensions and source PNG hash/size; transmit only JPEG bytes.
- [x] Model/tool coordinates refer to sent-image integer pixels, mapped by pixel center to original source pixels; returned tool coordinates remain in sent space. Stale scene/view/model/account/lifecycle and compression races fail closed.
- [x] Server checks actual byte MIME/hash/dimensions and bounded strict JPEG decode; original PNG path retains CRC/decompression checks. Inspector omits bytes and truthfully shows sent/source metadata. Catalog admission, no model-name allowlist, nonce/history/read-only protections retained.
- [x] Automated checks, guarded built-browser checks, diff inspection and temporary redacted handoff.
- [x] Final independent corrective sign-off READY; whole-checkout review remains separate.

## Verification and artifacts
All artifacts under `/tmp/spatial-task030/` (temporary, not repository dependencies).
- `pnpm verify > /tmp/spatial-task030/final-verify.log 2>&1`: PASS607/607, workspace/test typechecks, Svelte0errors0warnings, web/server builds. Existing Vite >500kB chunk warning remains. Parent sandbox attempts hit tsx IPC EPERM; isolated child successfully ran the exact baseline command. Earlier transport test helper typing and extracted-modal static assertions were updated to match the new transport type/component, without relaxing behavior.
- `pnpm exec tsx /tmp/spatial-task030/browser-run.mts`: PASS36/36, existingChromeCDP9222, isolated context/ephemeral static fixture, guarded local API interception, two explicit fixture turns, zero unexpected requests/runtime errors. Desktop/mobile demo and synthetic Toronto fixture: crop numeric/drag/reset, JPEG-only send, original viewport/transform, preview/remove, no automatic inference/fallback, stale attach/send, scene/model changes, Escape/Cancel focus. Initial32/36 found focus restoration defect; tick-based restoration fixed all four. `browser-results.json`, `browser-report.md`, eight browser PNGs/AX snapshots; independently visually inspected.
- Independent initial review: `independent-review.md`; focused211/211 tests. Found LOW near2MiB JPEG HTTP prefix boundary, corrected in route using MIME-specific prefix lengths. Real HTTP JPEG cap−1/cap acceptance and cap+1 rejection regression tests pass; actual fake-provider dispatch, pixel callback and inspector checked. `corrective-tests.log`:16/16; `corrective-review.md` is implementer reread. Fresh independent final sign-off `final-independent-review.md`: READY, scoped16/16 rerun, actual correction and HTTP regressions reviewed; no remaining bounded findings.
- Individual LSP calls: TS syntax diagnostics clean; no configured Svelte LSP, covered by svelte-check. `git diff --check`: PASS. Pre-edit graph: route LOW9 affected, provider known candidates LOW but aggregate ambiguous UNKNOWN; new crop/visual/Svelte symbols missing/UNKNOWN, confirmed actual references in source. Index one commit behind; no refresh. Aggregate all-dirty graph CRITICAL234/107 and truncated includes earlier tasks, not clean certification.

## Limitations and next action
No live provider compatibility/auth claim. Browser Toronto uses synthetic displayed samples, not actual dataset performance; browser asserts payload transform, while automated client/HTTP tests cover pixel mapping/roundtrip. Source hash/provenance supplied by browser is not independently server-verified original-record evidence or CAD. JPEG decoding is synchronous bounded work, not a peak-resource/security proof. Whole-checkout review and complete graph certification remain pending. Final bounded independent correction review completed; whole-checkout review is the separate next review; handoff at `/tmp/spatial-task030/completion-handoff.md`.
