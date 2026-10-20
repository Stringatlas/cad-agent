# Scan-grounded placement search — persistent checklist

## Authoritative scope correction (Task065)
The user rejected task064's tiny-AOI/manual box-first flow. The primary acceptance target is now model scanning a LARGE area from chat intent and showing ranked candidate POINTS with evidence and numbered scene markers, without a selected box or manual trial patches. CAD is downstream only on explicit request. [Task065](../tasks/065-large-area-candidate-points.md), [testing guide](../area-candidate-search.md) and [engine measurements](../area-candidate-engine-evidence.md) own implementation evidence. The equipment-specific roadmap below remains follow-up groundwork, NOT the corrected feature definition.

## Vision — and why this exists

The product should help a person make a spatial design decision, not merely answer questions about individual scanned points. The user selects a street stretch in the live CAD scene and says: **“Find the best five spots for a 1 × 1 × 1.2 m utility box, with 1 m front access, at least 2 m from poles, on level ground.”** They should not have to guess five coordinates, manually inspect each one or translate their intent into a sequence of low-level queries.

The agent turns that intent into explicit constraints. Deterministic tools search the area and return a ranked, evidence-backed shortlist. Five numbered translucent boxes appear in context, showing orientation and access space. The person can compare them, inspect ground support/conflict counts and click witnesses to see what affected a result. An annotated top-down image lets the model add qualitative concerns—for example, “candidate 2 appears to obstruct a driveway”—without pretending that an image supplies verified measurements.

The person chooses a candidate; it becomes an exact geometry proposal, not an automatic edit. Only individual human Accept publishes it, with checked Undo available. Search previews, pending proposals and committed geometry must remain clearly distinct.

**Why:** bridge the gap between scan inspection and useful CAD design. The system should do the repetitive spatial search, expose why alternatives differ and reduce the human's verification burden without taking away judgment or hiding uncertainty. Scene and chat are equally important design channels: a prose list of guessed points is not this feature, and neither is an unexplained set of boxes.

**Division of responsibility:** the AI owns intent interpretation, tool orchestration and explanation; deterministic tools own numerical checks and reproducible ranking evidence; visual reasoning supplies explicitly qualitative observations; the human owns design choice and approval. “Best” always means best under disclosed constraints, ranking policy, search resolution and available evidence—not globally optimal, physically safe or regulatorily compliant.

## Goal
Deliver that AOI → constraints → search → numbered shortlist → evidence/visual comparison → chosen exact proposal → human approval/Undo workflow incrementally. Each checklist item below exists to close a specific gap in that experience, not to build standalone infrastructure for its own sake.

User initially requested item 1, then expanded authorization: continue until a connected user-facing feature can be tested and provide exact testing instructions. Task064 implements that first connected cardinal-yaw slice across items 2–6 and acceptance fixtures; it does not complete every roadmap item. No live/paid inference is authorized. Update checkboxes only with linked task evidence; implementation and fresh-session review are separate gates.

## Ordered checklist

- [ ] **1. Typed placement specification (start here).** Add a bounded shared, runtime-validated specification for dimensions, front access, pole separation, ground slope/relief, allowed orientations, AOI containment, hard constraints and ranking preferences. Carry explicit frame, units and revision bindings. Define box-boundary versus center distance, horizontal versus 3D distance, front direction, footprint/access containment and what “level” means. Preserve user values; unresolved requirements must be explicitly missing or disclosed assumptions, never invented standards. Distinguish normalized intent from an executable, fully resolved request. Add deterministic validation/normalization fixtures for the example and malformed/ambiguous inputs. Keep existing task044 semantics compatible; no search, UI or geometry mutation in this slice. Create a bounded task with acceptance criteria before coding.
  - Item 1 implementation: [Task063](../tasks/063-placement-specification.md) records the additive contracts, focused checks and verification limits. Fresh-session review is pending; checkbox remains open. No search or runtime tool is wired.
- [ ] **2. Deterministic AOI pose search.** Generate positions between source points and explicit orientations; evaluate ground support, body/access observed-point conflicts and pole separation. Extend beyond task044's named-point/fixed +Y assessment. Use complete relevant original-source index queries, never capped AOI witnesses as the search domain. Declare search resolution, coverage, resource bounds, cancellation and incomplete outcomes. “Best evaluated at this resolution” is not a global-optimum claim.
- [ ] **3. Ranking and retained evidence.** Reject hard failures, preserve unknowns, then rank with disclosed deterministic criteria/tie-breaking and spatial diversity. Retain exact candidate poses, constraint specification, metric breakdown, exhaustive counts/capped clickable witnesses, ground limitations and source/terrain/authority revisions. Invalidate stale results. Ranking weights and trade-offs must be inspectable rather than model-invented scores.
- [ ] **4. Scene shortlist and exact-candidate approval.** Render numbered non-authoritative previews with front/access footprints, distinct from actionable proposals. Compare/select without triggering five proposal approval pauses. Revalidate the chosen exact candidate, then retain one CAD proposal for individual Accept/Decline and checked Undo. No silent rebasing or model publication. Preserve clean progressive-disclosure UI; check desktop/mobile idle, selected, pending and error states.
- [ ] **5. Annotated visual assessment.** Bind top-down candidate numbers/outlines/access regions to retained IDs and capture metadata; support useful RGB/type views without disturbing the live viewport. Model observations such as a possible driveway remain qualitative and provisional, never replace deterministic metrics or claim unimplemented semantics.
- [ ] **6. Product-agent placement workflow.** Extend product harness instructions/tool schemas for normalize → search → capture/compare → explain → chosen proposal. Clarify only material ambiguity, separate measurements/visual judgments/unknowns and handle incomplete results truthfully. Pi development skills do not supply product runtime capabilities. Existing task061 instructions are groundwork, not a search implementation.
- [ ] **7. Ground quality and effective-scene support.** Establish support/quality limits for slope and continuous footprint claims beyond sparse observed minima. Define assessment of accepted CAD/point edits; until implemented, explicitly reject unsupported edited scenes as task044 does. Empty scan volumes never certify physical clearance, foundation suitability, safety or regulatory compliance. Real-world access/ownership/utility information may require independent input.
- [ ] **8. Benchmarks and end-to-end acceptance.** Build independent fixtures/oracles for feasible/no-feasible sites, missing ground, rotated footprints/access, exact pole-distance boundaries, AOI edges, ranking/diversity, budgets/cancellation and stale selection/approval. Measure production-scale latency and deterministic repeatability. Verify shortlist → chosen proposal → human approval/decline → Undo in the browser. Mocked provider tests first; live-model evaluation only with authorization. Record exact commands/artifacts, outstanding failures and fresh-session review separately.

## Implementation discipline

Proceed through the smallest connected user-facing slice under the expanded authorization. Prefer compatible helpers and progressive disclosure; do not add a framework, speculative tool or silently change existing placement behavior. Ask only when ambiguity materially changes observable behavior and cannot be represented as unresolved specification data. Use graph-first source exploration and pre-edit symbol impact analysis; preserve unrelated work.

## Existing foundation / evidence

- [Architecture](../architecture.md) and [product vision](../product-vision.md).
- [Task044](../tasks/044-utility-box-placement.md): single named-point, fixed +Y, original-source assessment and approval-gated native box; sparse ground and edited-scene restrictions.
- [Task059](../tasks/059-aoi-point-query.md): exact AOI counts with capped deterministic witnesses, not ranked sites; verification limits are recorded there.
- [Task061](../tasks/061-candidate-assessment-prompt.md) and [effective instructions](../model-candidate-prompt.md): candidate workflow groundwork, not live adherence certification.
- [Task062](../tasks/062-agent-capture-color-mode.md): RGB/type capture support and bounded browser evidence; fresh review pending.
- [Preprocessing/query guide](../street-testing-preprocessing.md): observed ground/interpolation and spatial-index capabilities/limits.

## Connected testable slice

[Task064](../tasks/064-connected-placement-search.md) records the implemented cardinal-yaw search, retained evidence, numbered previews, chosen native proposal, shared agent tools and acceptance checks. [Testing instructions](../placement-search.md) explain the direct no-inference UI and optional agent prompts. Independent incremental reviews found issues now covered by regression tests; final fresh-session integrated review remains pending. Checkboxes stay open until their entire criteria/review gates are satisfied: arbitrary yaw, dedicated top-down capture with retained-ID annotations, stronger terrain/effective-scene support and broad production benchmarks are not complete.

This checklist is a roadmap, not evidence that every unchecked feature is wholly absent or complete; use the linked task's scope and limitations.
