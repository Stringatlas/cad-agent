# Product vision — a CAD workspace with AI harness capabilities

## North star
This product is a **CAD tool**, not a headless harness with a UI layered on top. The live 3D scene and chat form one interactive design workspace. People inspect point clouds, select spatial references, describe intent, review proposed geometry in place, and deliberately accept or decline each change. Harness capabilities make these interactions inspectable, reproducible and verifiable; they serve the CAD workflow rather than define the product.

Example end-state: select Point 1 and Point 2, ask “build a channel between these points,” resolve missing design parameters, inspect a ghost channel in the scene, and accept or decline the exact proposed change. This example is a goal, not a claim that channel modeling is implemented.

## Invariants
- **Human control:** AI may inspect and propose create/modify operations. AI cannot approve its own changes. Each change has its own explicit Accept/Decline; no hidden auto-accept or bulk approval by implication.
- **Visible limbo:** pending geometry appears as a distinguishable, non-authoritative ghost. Committed geometry remains visible. Decline removes the candidate without changing geometry; Accept publishes only the reviewed retained candidate after checks.
- **One authority:** the scene projects project state; render buffers and model text never own geometry. Changes publish atomically after revision preconditions and operation-specific postconditions. Undo is an explicit checked inverse, not a model promise.
- **Explicit spatial meaning:** stable entity/source IDs, units, coordinate frames, origins and revisions accompany references and proposals. Imported Toronto coordinates are not implicitly synthetic-project coordinates. Unsupported mappings must be requested or rejected.
- **Truthful verification:** a mesh, successful rendering, analytic bound or model assertion is not a verified CAD solid. Kernel validation, application postconditions, publication and rendering are separately reported outcomes.
- **Transparent interactions:** show effective provider inputs and tool evidence without credentials or opaque reasoning. Clearly separate observations, proposals, approvals and committed results.
- **CAD-first architecture:** shared contracts and adapter boundaries keep viewer and kernel implementation types outside the agent API. Pi is development tooling, not the product agent.

## Product experience — clean by default

Follow the standing [UX principles](ux-principles.md): **YAGNI, Apple-style restraint, clear information hierarchy and progressive disclosure**. The scene, selected object/type, chat intent and per-change approval are primary. Session IDs, revisions, provenance narration, routine status and methodological caveats remain accessible on demand—not permanent paragraphs/panels over the scene. Selected points expose semantic types; derived clusters/layers have compact accessible meaning through a key or contextual inspection. Preserve actionable failures/recovery and truthful estimate labels without turning safety into repetitive engineering copy. Validate the idle workspace as carefully as pending/error states, on desktop and mobile. Every future agent must follow this guidance, not merely copy the current UI.

[Task086](tasks/086-workspace-ui-restraint.md) makes the workspace chrome unbranded. Toronto controls live above the canvas: Objects for scene references and datum tools, View for framing and navigation help, and Display for colors and point size. Advanced detail settings remain disclosed. A selected source point shows its semantic type even with chat closed; per-change approval and actionable recovery remain contextual.

## Dataset workspace
[Task081](tasks/081-shared-cloud-workspace.md) makes STPLS3D the default scene
and deletes the DALES viewer code. Its 25 independently bound scenes offer RGB,
native-instance and semantic display, original-source queries, captures and
numbered references through shared viewer/agent interfaces. Task082 adds four
real-world scenes, and Task083 adds camera-driven native octree refinement within
a bounded point budget. Exact source queries operate independently of display LOD.
[Task087](tasks/087-capture-camera-lod.md) gives agent images their own bounded
camera-dependent detail demand without navigating or changing the user’s display.
Capture coverage remains an observation of admitted LOD, never whole-source evidence.
[Task088](tasks/088-distance-lod-budget.md) prioritizes camera-distance detail after
coarse visible coverage, with a 3M default point cap and persistent custom caps.
Changing a display cap preserves the person’s camera, selection, colors and layer. Toronto remains an
explicit alternative with its existing human-approved editing capabilities.
Prepared-cloud editing is not implemented; no scene inherits another scene's
taxonomy, frame or authority. Scene switching clears old references and continuation.

Toronto3D is the actual editing workspace. Synthetic geometry is a development/test fixture, not the destination for CAD product features. [Task034](tasks/034-toronto-cad-workspace.md) implements the authorized first Toronto slice: AI-proposed source-point translations and real OpenCascade box/cylinder solid candidates, visible in place with individual human Accept/Decline and checked Undo. Implementation and verification status live in that task. Toronto geometry uses its own local-meter frame directly; no synthetic-project mapping is implied. Volatile state and unsupported broader modeling must remain explicit.

## Model-directed scene interaction

The product agent owns decomposition, visual/spatial exploration, hypotheses, candidate generation, measurement choices, judgement and iteration. Tools should be composable scene interfaces—not prepackaged decision algorithms wrapped in chat narration. Deterministic computation is appropriate for factual measurements, efficient source access, geometry verification and authority checks, not a mandatory candidate universe. Runtime skills explain these interfaces and evidence limits without prescribing a fixed task chain.

[Task069](tasks/069-model-directed-scene-exploration.md) implements bounded coordinate queries, observed ground elevation and lightweight C1–Cn hypotheses that the model can generate/revise/reorder independently of scan pools. These annotations do not create geometry or certify suitability. Mock-provider browser evidence establishes transport/rendering, not real-model exploration quality; geometry proposals still require each human approval.

[Task089](tasks/089-agentic-scene-exploration.md) tracks the long-running implementation of composable scene agency: reliable conversation continuation, capture-scoped grounding, region/reference view framing, shared spatial evidence and hypotheses, entity inspection, geometry measurements, resilient exploration and evaluated model behavior. Cloud conversation continuity, bounded single-pixel capture grounding, prepared-cloud disposable hypotheses and source-reference/region framing with current-turn relative views are implemented and independently reviewed; the checklist distinguishes these accepted slices from pending work. The model chooses its observations and reasoning sequence; geometry publication retains individual human approval.

## Required scene understanding

These are **must-haves**, not optional viewer polish:

1. **Semantic instance clustering:** separate poles, cars and fences (optionally buildings) into stable derived individual IDs with original source-point memberships. Connected components or DBSCAN are sufficient to start; preserve artifact revision, settings, units and frame. Components remain hypotheses until separation quality is assessed.
2. **Ground surface:** derive a TIN or gridded DTM from road/ground-ish points and expose elevation at `(x,y)` for object bases, clearance and solid placement.
3. **Per-cluster primitive fitting:** cylinders for poles, oriented boxes for cars, and building footprints extruded to roof height. Include quality, residual and coverage evidence. Fits are proposals/estimates, not automatic CAD edits or proof of valid solids.
4. **Fast spatial queries:** KD-tree or octree support for nearest, within-radius and clearance work at roughly 78M points. Bind queries to explicit source/effective positions and revisions. Production exact label queries retain disk-page per-label AABBs and independent verification. Task038 adds a separate page KD-tree/BVH library, not a point-level tree or a replacement for verified tools; the Potree display octree is not a general geometry-query service.

Begin with clustering: [task037](tasks/037-semantic-instance-clustering.md) and its [offline artifact contract](semantic-instance-clustering.md) add bounded full-resolution class-specific voxel components with exact source memberships. [Task038](tasks/038-street-testing-preprocessing.md) follows with a focused full-resolution testing view, an eye toggle for derived observations, sparse observed ground, approximate quality-reported fits and a bounded page-tree spatial-query library. These are not verified CAD solids; holes/outliers, fit bias, overlapping-page performance and model-tool integration remain explicit follow-up gates. Libraries are allowed when useful; prefer the smallest scalable implementation over speculative infrastructure. Scene integration must keep the same CAD-first approval and provenance invariants.

## Prior bounded implementation

[Task084](tasks/084-dtm-dsm.md) begins gridded elevation for prepared STPLS3D:
observed classified-ground DTM and upper-surface DSM, viewer layers and
scene-bound agent queries. Library-backed GeoTIFF artifacts retain support and
NoData; ground under buildings and suitability are not inferred.
[Methods and limits](elevation-models.md) distinguish source cells from the
disposable preview. Toronto integration and evaluated terrain filtering remain
future work.

[Task085](tasks/085-terrain-agent-analysis.md) adds composable regional elevation
and slope measurements, caller-controlled connected-region filters, profiles and
coordinate-bound raster images. The agent chooses hypotheses and thresholds;
these tools do not rank terrain as suitable or publish geometry. Coverage,
resolution and NoData remain explicit in every regional result.
Task033 exposes model `scene.propose_box_create` and `scene.propose_box_update` for the bound synthetic project. Exact retained proposals appear as translucent scene ghosts with individual Accept/Decline. Parameter checks, stale-revision rejection, explicit Save and checked Undo reuse project authority. Acceptance invalidates other proposals from the old revision; they are never silently rebased. Ghosts are excluded from authoritative picking and remain non-authoritative in screenshot observations. Task045 permits mixed-scene captures and historical images without cancelling chat on camera motion; capture-time metadata and conservative pixel grounding never replace current tool/approval bindings.

These synthetic edits remain **box parameter edits, not OpenCascade solids**. Task034 now adds separate Toronto-native OpenCascade box/cylinder candidates and AI source-point proposals with human approval; the original sandbox remains independent. Toronto uses its own authority and local frame, with no Toronto-to-synthetic mapping. Channels, booleans in the workspace, durable CAD bodies and broader verified modification tools remain future milestones.

[Task044](tasks/044-utility-box-placement.md) adds the bounded “utility box at Point 1” integration: explicit hypothetical dimensions/access, source-grounded base and exact observed-point volume checks, evidence selection, then a retained native box ghost for individual human approval. It does not certify free space, foundation suitability or regulatory clearance, remove obstacles, or assess edited effective geometry.

## How agents extend this vision
All agents should read this document before planning product-facing changes. Extend it through repository changes, not private prompts alone: distinguish implemented behavior from goals, link a bounded task and evidence, preserve the invariants above, and record material design decisions in `docs/decisions/`. Do not silently redefine the product as headless, relax approval, imply an absent frame mapping, or advertise unverified geometry. Ask the operator when a proposed change materially alters these commitments.

See [architecture](architecture.md), [task033](tasks/033-ai-ghost-proposals.md), [project editing](project-editing.md), and [kernel sandbox](cad-engine.md).
