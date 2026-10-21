# Task075 — Agent scene-scope audit

## Scope / acceptance
User requested concise inspection of product-agent skills, tools and prompt for
multi-scene compatibility, small safe adjustments only, and consultation before
large changes. Preserve Task074 and other working-tree edits. No broad tests.

- Inspect effective instructions, runtime skill catalog, tool schemas and authority bindings.
- Clarify scene-scoped evidence and Toronto-only semantics without claiming runtime support.
- Keep prompt readback synchronized; run only focused prompt/skill checks.
- Report broader contract/binding migration as a decision, not an authorized implementation.

## Findings / changes
Agent backend is not yet generic/multi-dataset: `ModelScene` reference/AOI
contracts, `bindModelScene`, semantic queries and editing authorities remain
Toronto-bound. Modes `toronto`/`pole` describe existing workflows, not a dataset
registry. Tools have no scene listing/switching capability. Source IDs 1–4,
Toronto label classes and explicit Toronto coordinate frame remain correct for
current advertised tools; simply removing guards would weaken authority checks.

Small adjustments: base prompt scopes all tools to the current bound dataset,
frame and revision; prohibits cross-scene reuse of IDs, coordinates, AOIs, marks
or approval authority; distinguishes historical evidence; disallows inventing
scene switching or transferring Toronto semantics/capabilities. Scene-inspection
skill explicitly identifies its current AOI taxonomy as Toronto-only. Exact prompt
documentation updated. No tool schema, contract or authority migration performed.

Impact for instruction constants UNKNOWN (bare constant reads unresolved),
confirmed by source: base feeds `buildAgentInstructions` used by runtime and Tools
preview; AOI instructions feed `PRODUCT_SKILLS` and loaded inspection guidance.
No clean graph-certification claim; prior graph coverage limits remain.

## Verification / next decision
`node --import tsx --test tests/candidate-assessment-prompt.test.ts tests/product-agent-skills.test.ts`: **22/22 pass**, including exact effective prompt/skill readback parity; log `/tmp/task075-agent-scope-tests.log`. `git diff --check` passes. LSP: skills clean; provider has only an unrelated unused `MODEL_VISUAL_LIMITS` import hint. No provider calls, browser checks, full suite or major tests run for these instruction-only changes.

Broader work requires user approval: dataset-neutral scene/context contracts,
per-selected-dataset tool binding and capability/taxonomy gating, continuation and
scene-switch isolation, plus browser/reference/proposal lifecycle wiring. First
choose single-active-scene switching versus simultaneous cross-scene operation.
Fresh-session review pending; no commit.
