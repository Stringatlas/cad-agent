# Task071 — Agent tools inspector

## Scope and acceptance
User requested a frontend `/tools` URL to inspect all product-agent tools, instructions and available interfaces. Read-only; no paid inference, credentials or opaque reasoning. Preserve unrelated work and individual geometry approval.

## Implemented
- `/tools` and `/tools/` isolated frontend route; workspace header Tools link.
- Searchable registered catalog: 21 tools with descriptions, capability requirements and complete parameter schemas.
- Shared core instruction preview and six full runtime skill bodies, sourced from the same registry/builders as provider requests.
- Explicit distinction: catalog is not live scene availability; unbound instructions are a preview, not a specific outgoing request. Existing chat request inspector remains the actual per-round record.
- GET `/chat/tools` uses existing local HTTP policy, without provider authentication or inference.
- Removed stale legacy decision skills/prompt reference as continuation of Task070; legacy internal/manual engines remain separate.
- Loading/error/retry and keyboard/mobile disclosure support.

## Verification
- `pnpm typecheck`: pass, Svelte zero errors/warnings.
- `pnpm build`: pass; existing workspace chunk-size warning.
- `node --import tsx --test tests/agent-tools-inspection.test.ts tests/agent-tools-client.test.ts tests/candidate-assessment-prompt.test.ts tests/agent-interface-removal.test.ts tests/product-agent-skills.test.ts`: 45/45 pass.
- Full `node --import tsx --test tests/*.test.ts`: 1229/1241 pass, 12 failures. Log `/tmp/task071-full-tests.log`. Failures include legacy area-candidate/placement/utility-box provider tests still expecting deliberately removed interfaces, plus pre-existing request-inspector/chat UI assertions. Full suite is NOT green; follow-up must migrate obsolete integration fixtures without restoring removed tools.
- LSP workspace cache reports 15 area-candidate type errors despite successful fresh CLI typecheck, plus two hints; not represented as clean.
- Frontend child's actual-endpoint headless desktop1440/mobile390 verification passed search, schemas, instruction/skill disclosures, keyboard, error/retry, no overflow and no workspace geometry-module loading. Artifacts/screenshots/report: `/tmp/task071-tools-frontend/`; runner `/tmp/task071-tools-frontend-smoke.mjs`. Child visually inspected desktop/mobile screenshots.
- Independent bounded review found no concrete Task071 issues; its focused tests 8/8 pass. Fresh-session whole-checkout review remains pending.
- Graph pre-edit UNKNOWN entrypoints confirmed against source; backend impacts recorded in `/tmp/task071-backend-tools-inspector-handoff.md`. Whole-checkout detect_changes reports CRITICAL with stale/incomplete coverage; not a clean certification. No commit.

## Next
Use `http://127.0.0.1:5173/tools` with dev servers running. Migrate removed-workflow tests separately, then fresh-session whole-checkout review. No live-provider or production-scale certification claimed.
