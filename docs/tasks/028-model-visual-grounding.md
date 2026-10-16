# 028 — Opt-in model screenshots and pixel grounding

Status: Implemented; independent incremental review READY

Historical model-name allowlist/unsupported-model UI below is superseded by [task029](029-catalog-model-image-input.md). Current admission is catalog membership, not inferred vision capability; provider rejection stays explicit.

## Ownership
- Implementation: parent UI, isolated backend/contracts and client agents.
- Review: independent fresh child review READY, no actionable defects (`/tmp/spatial-task028/independent-review.md`); whole-checkout review remains pending separately.

## Goal and scope
User authorized “Add an option to attach screenshot to model and create the next priority tool for the cad agent”, then Proceed. Bounded interpretation: opt-in fixed-view screenshot in existing chat and read-only `scene.resolve_visual_pixel` grounding back to original browser point provenance. Preserve dirty025–027 and user AGENTS.md. No live model calls, auth/config changes, service restarts, graph rebuild or commit. No CAD edits, autonomous navigation, segmentation, nearest-label dispatch or evaluation runner.

## Acceptance criteria
- [x] Both viewers supply disposable capture adapters; attachment opt-in with preview/remove/current-state and unsupported-model UI. Ordinary text sends contain no image.
- [x] PNG/hash/camera/coverage/revision/units/frame validated and supplied as real input_image for conservatively supported vision models, API-key and ChatGPT modes. Explicit errors, never stripping/fallback.
- [x] Image turns are isolated new conversations; no images or stale pixel evidence retained for later turns.
- [x] Read-only pixel tool uses strict integer top-left drawing-buffer coordinates, request/tool/observation nonce binding, one-use local-only reply admission, abort/deadline/cleanup gates and current-view checks. No hit/ambiguity is not fabricated identity. Browser provenance is not independently server-verified CAD/original record evidence.
- [x] Request inspector exposes image identity/dimensions/hash with image bytes explicitly omitted; credentials/reasoning remain excluded.
- [x] Deterministic fake-provider/contracts/client tests, baseline verification and isolated built-browser checks pass; diff inspected and fresh incremental review performed.

## Implementation checkpoint
Backend/contracts and client implemented; UI integrated. Model PNG cap2MiB/request3MiB, unchanged text/history bounds; local panel cap12MiB remains. Server validates actual PNG signature/chunks/CRC/bounded inflate/dimensions/hash and authority binding. Pixel requests stream to the originating browser; `/chat/tool-result` requires correct active nonce/identity/origin and rejects replay.15s tool deadline. Each screenshot Send starts fresh and discards returned continuation. Image capture stays local until Send.

## Sources and evidence
Official image guide https://developers.openai.com/api/docs/guides/images-vision and SIWC preview limits https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations checked: text/images/files supported when selected model accepts them. Conservative allowlist excludes codex/audio/search models; unknown models fail explicitly rather than infer capability from catalog discovery.

- Final `pnpm verify > /tmp/spatial-task028/final-verify.log 2>&1`: PASS595/595, all workspace typechecks, Svelte0errors0warnings, tests typecheck and builds. Existing >500kB Vite chunk warning retained.
- `node /tmp/spatial-task028/browser.cjs > /tmp/spatial-task028/browser.log 2>&1`: PASS64 checks against built app; guarded ephemeral fixture and existingCDP9222 only. No live API or mutation calls; 302/303 redirect denial proved. `/tmp/spatial-task028/browser-verification.md`, `browser-metrics.json`; `{desktop,mobile}-{toronto,demo}-attachment{,-panel}.png` plus accessibility snapshots. Owned context/server cleaned up. Parent visually inspected desktop demo panel.
- `pnpm build > /tmp/spatial-task028/build.log 2>&1`: PASS before browser. `git diff --check`: PASS. Full dirty diff inspected for intended scope; unrelated025–027/AGENTS preserved.
- Aggregate `gitnexus_detect_changes({repo:cad-agent,scope:all})` repeated: CRITICAL235 changed/107 affected across28 tracked dirty files, tool output truncates at changed-symbol list. Includes prior tasks/user changes and misses new files; NOT a clean graph check; no index rebuild/commit. `/tmp/spatial-task028/graph-changes.txt` captures degraded output.
- Backend focused152/152 PASS: `/tmp/task028-backend-tests.log`.
- Client focused133 PASS: `/tmp/task028-web-client-tests.log`.
- First integrated `pnpm verify`: typechecks PASS;594/595 tests, failed exact source-string assertion after deliberate prop plumbing. Updated assertion to require visualSource plus attachment controls, not weakened behavior.
- Parent LSP cache is stale (old exports across existing files); Svelte LSP unavailable. Actual CLI typechecks are authoritative verification; do not call stale LSP clean.
- GitNexus cad-agent bound to this checkout; index one commit behind. Shared canonicalization/client reader HIGH warning; Svelte UNKNOWN confirmed main→App→Demo/Toronto/Chat→ModelChat in source. New symbols absent index. No graph cleanliness certification.

## Remaining / review
All scoped criteria complete. Independent fresh review READY, no actionable defects; reviewer154 targeted tests PASS (`/tmp/spatial-task028/independent-review-tests.log`, see review report for command). Whole-checkout fresh review, live-provider compatibility and complete graph certification remain pending independently. No changes committed; operator work preserved. Next bounded action: user acceptance or separately scoped evaluation/broader verified tools, not automatic CAD expansion.
