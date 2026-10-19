# Task061 — Candidate-assessment prompt

## Scope
User authorized reassessing and updating the product prompt, then reading back its exact effective wording. Optimize candidate-location work as inspect → capture → assess → propose, not an enforced new assessment subsystem.

## Acceptance criteria
- Proactively request useful scene captures before candidate recommendations when capture is advertised; disclose unavailable/insufficient evidence without inventing inspection or suitability.
- Keep AOI samples distinct from ranked recommendations, original source separate from current edits, image observation separate from geometric verification, and each proposal subject to human approval.
- Compose capability-specific instructions only where relevant; correct the overly broad prohibition on mutation without granting model publication authority.
- Verify actual outgoing mocked-provider requests, capability composition, inspector parity, and existing relevant tests; no paid/live inference.
- Read back exact instruction text and clearly identify conditional sections and separately supplied scene/tool context.

## Preservation / risk
Extensive unrelated dirty work (tasks047–060 and operator config) predates this task. No commit. Graph cad-agent at 6f9fce4 is one commit behind HEAD 0d8350e; exact ProviderModel.turn impact reports LOW, one direct chat-route caller and four route processes, with 14 unresolved receiver callsites. Constant impacts UNKNOWN/missing were supplemented with source searches confirming their use in turn. No clean whole-checkout graph certification implied.

## Implementation
- `apps/server/src/provider-model.ts`: revised common authority rules and inspection/approval loop; explicit candidate workflow; synthetic/object/placement instructions now conditional on advertised capabilities, Toronto instructions on mode. Capture/AOI tool descriptions reinforce visual + coordinate evidence without changing schemas, tool dispatch or approval enforcement.
- `docs/model-candidate-prompt.md`: exact instruction readback including conditional composition. Dynamic scene/history/image metadata and JSON-schema tools remain separate effective request inputs.
- `tests/candidate-assessment-prompt.test.ts`: six actual mocked-provider payload tests compare readback byte-for-byte, inspect tool descriptions, assert inspector parity/no forced tool choice, exercise full/reduced capabilities and capture success/unavailable continuation.

## Verification
Node v22.23.3, pnpm 10.34.6. No live inference, paid calls, browser/UI changes or commit.
- `node --import tsx --test tests/candidate-assessment-prompt.test.ts tests/provider-model.test.ts tests/model-request-inspection.test.ts tests/model-agent-runtime.test.ts tests/model-box-proposals.test.ts tests/model-toronto-proposals.test.ts tests/model-nearest-tool.test.ts tests/model-visual.test.ts tests/model-scene-objects.test.ts tests/utility-box-tools.test.ts tests/utility-box-placement.test.ts`: 185/185 passed (`/tmp/task061-tests.log`). First run exposed a new synthetic test fixture missing a project binding; corrected fixture without weakening assertions.
- `pnpm typecheck`: passed (`/tmp/task061-typecheck.log`). Initial new fixture coordinate literal errors corrected. LSP: new tests clean; provider only existing unused-import hint.
- `pnpm build`: passed (`/tmp/task061-build.log`); existing bundle-size advisory remains.
- Exact readback tests rerun after final wording preservation: 6/6 passed (`/tmp/task061-readback-tests.log`).
- `git diff --check`: passed. Inspected provider diff; pre-existing object/AOI additions are preserved, not task061 implementation claims (`/tmp/task061-provider-diff.patch`).
- `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 1000`: completed; whole dirty checkout reports CRITICAL, 35 files/215 symbols/129 affected processes (`/tmp/task061-graph.json`, CLI text). Symbol list expanded, process display still summarized; stale index/new-file coverage and unrelated dirty work mean this is NOT clean graph certification.

## Status / limits
Implemented and exact readback recorded. Mocked requests validate prompt composition and protocol, not live model adherence or improved candidate quality. Browser not run for this server-prompt-only change. Full suite not rerun (prior task060 records two existing unrelated UI-copy failures). Fresh-session review and live-model evaluation remain pending. Suggested next action: review task061-scoped changes, then user-authorized live candidate-assessment evaluation.
