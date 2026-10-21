# Product-agent runtime skills

The product model loads scene-interface instructions on demand. These are application runtime skills, not Pi development skills or executable plugins. Task069 changes the guidance from prescribed task chains to model-owned exploration; [Task068](tasks/068-product-agent-runtime-skills.md) records the original loading mechanism and its verification limits.

## Runtime behavior

Every provider request retains core authority, coordinate/frame, untrusted-input, evidence and individual human-approval rules, plus a capability-filtered skill catalog. Detailed workflows are added only when loaded.

1. The model may call `scene.list_skills({})` to inspect the current catalog.
2. It calls `scene.load_skill({"skillId":"candidate-assessment"})`, for example. The response contains instructions, dependency IDs and currently available tool names.
3. The next provider request includes the loaded workflow instructions. Only then can its workflow tools execute. Loading and using a workflow in the same provider response does not authorize execution.

An unloaded workflow returns `runtime-skill-required` with recovery instructions and no side effects. Unknown/unavailable skill IDs return `runtime-skill-unavailable`. `inspect_scene` remains an always-available bootstrap operation. Readiness resets each user turn; retained history or user text cannot grant it. Loading instructions never grants capabilities: the bound scene and current authority still control tools on every round.

## Catalog

| ID | Workflow |
| --- | --- |
| `scene-inspection` | Bound scene, original-source nearest/radius/box queries at model-chosen coordinates, ground elevation, semantic source references |
| `visual-inspection` | Current/top-down/arbitrary-camera capture and visual-pixel grounding |
| `candidate-assessment` | Model-generated spatial hypotheses, revision-bound scene marks, evidence and uncertainty |
| `area-candidates` | Optional legacy numerical scan/subset-finalization interface, not the default discovery method |
| `scene-objects` | Authored objects and point-create proposals |
| `toronto-geometry` | Toronto point moves and kernel-solid proposals |
| `utility-box-placement` | Assessment before exact utility-box proposal |
| `placement-search` | Optional legacy explicit equipment-fit search and exact returned-site proposal |

Availability depends on scene mode and bound tools. Dependencies load together; they may include guidance for unavailable visual evidence but cannot expose unavailable tools. Loading does not approve any geometry change. Legacy scan/fit tools are opt-in through their respective skills, not a required candidate universe.

## Model-owned exploration

The model chooses task decomposition, views, coordinates, hypotheses, measurements, judgement and iteration. There is no fixed inspect → capture → assess → propose sequence. It may use supplied context, move between observations and hypothesis revisions, and ask only about ambiguity that materially changes the goal. Captures are useful observations, not a ritual that establishes suitability.

`scene-inspection` owns `query_points` (nearest/radius/box over original source geometry at chosen coordinates) and `ground_elevation({x,y})` (observed support and quality, or unavailable). These exclude accepted edits; missing evidence and capped samples are never proof of empty space or clearance. Follow advertised schemas, resource limits, frame and units; do not invent source IDs or measurements.

`candidate-assessment` owns `get_scene_marks({})` and `set_scene_marks({expectedRevision,marks:[{id?,position,rationale,uncertainty}]})`. The latter replaces the hypothesis set; an empty list clears it. New marks omit IDs, existing marks retain only actual server-returned IDs. The server assigns stable IDs and labels C1–Cn in submitted order; the model chooses count, locations and preference order. Read the current revision and recover from conflicts rather than assuming success. Marks are disposable hypotheses, not source records, authored points, CAD proposals or approved geometry. Latest image receipts attached by the server identify observations only; they do not prove the model inspected a location, certify geometry or grant authority.

Use returned images and spatial evidence honestly, distinguish facts/assumptions/unknowns, and revise hypotheses as evidence changes. Without actual visual or geometric support, disclose missing evidence and provisional judgement. Geometry still needs an explicit request, applicable assessment prerequisites and individual human approval. In particular, named utility-box placement retains `assess_utility_box` before `propose_utility_box` with the current-turn assessment ID; generic CAD tools cannot bypass it.

## Inspection and extension

The request inspector shows effective per-round instructions and tool schemas, subject to its existing redaction/truncation bounds. Skill tool events also flow through the ordinary validated browser protocol. There is no new permanent skill panel.

The catalog, dependencies and detailed instruction strings live in `apps/server/src/product-agent-skills.ts`; always-on rules and dispatch live in `apps/server/src/provider-model.ts`. To extend a workflow, keep cross-workflow safety in the core, register stable IDs/dependencies and tool ownership, retain independent capability/authority checks, and add gating, protocol and request-inspection fixtures. No filesystem discovery, arbitrary code loading or Pi runtime dependency is introduced.

Skill discovery/loading has a separate 16-call budget, preserving 64 scene actions per turn; both server and browser allow up to 81 provider rounds. A turn retains its 15-minute absolute deadline, 90-second provider-round timeout, 512 KiB text/tool history, 4 MiB provider-response budget and separate 16 MiB downstream stream budget. Existing image/output limits still apply, so reaching those maxima is not guaranteed. Mock-provider tests verify protocol behavior, not live-model skill selection or judgement quality.
