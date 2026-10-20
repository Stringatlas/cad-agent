# Product TODO queue

## Direction and safety

The [product vision](product-vision.md) is authoritative: a CAD-first Toronto workspace with chat and live scene interaction, visible pending ghosts and individual human Accept/Decline before authoritative changes. Preserve explicit provenance, units, frames and revisions. A model claim, sampled display or rendered mesh is not geometric verification. Pi is development tooling, not the product runtime.

This queue records current direction, not historical test counts or approval-by-implementation. Detailed scope, commands, results and review status belong in the linked task artifacts. The original [seven-item harness roadmap](plans/2026-10-13-harness-must-haves.md) remains the approved capability baseline.

## Required scene understanding — must-haves

| Capability | Required outcome / current gate |
| --- | --- |
| **Semantic instance clustering** | Individual poles, cars and fences (optionally buildings), with stable derived instance IDs and original source-point memberships. Connected components or DBSCAN are sufficient initially. [Task037](tasks/037-semantic-instance-clustering.md) implements bounded full-resolution offline class-specific voxel components now; [operator guide](semantic-instance-clustering.md). Components are provisional hypotheses, not guaranteed physical objects. [Task038](tasks/038-street-testing-preprocessing.md) exposes instance bounds/fits in the scene; model integration and segmentation quality assessment remain follow-ups. |
| **Ground surface** | TIN or gridded DTM from road/ground-ish points; query elevation at `(x,y)` for base heights, clearance and solid placement. Task038 implements sparse 2m observed Ground/Road_markings minima and support-aware elevation lookup; no interpolation/extrapolation. Assess low outliers and surface quality before placement/clearance claims. |
| **Primitive fitting** | Per-cluster cylinders for poles, oriented boxes for cars, building footprints extruded to estimated roof height. Report fit quality, residuals and coverage; do not silently promote an estimate to a verified CAD solid or publish without approval. Task038 adds approximate vertical pole cylinders, PCA car boxes and optional rectangular building footprint-height extrusions with actual surface residual/coverage and heuristic scores. Robust partial-scan fitting, arbitrary footprints and CAD proposals remain future work. |
| **Fast spatial indexing** | KD-tree or octree supporting nearest, within-radius and clearance operations at roughly 78M points with explicit source/revision/effective-position semantics and resource bounds. Production exact label queries remain independently verified and unchanged. Task038 adds a library-only median-split page KD-tree/BVH for exact original-point nearest/radius/point-clearance; broad overlapping pages limit pruning. Point-level indexing, model/HTTP tools, edited-position integration and solid-clearance verification remain separate gates. |

Libraries are allowed when useful. Keep implementation YAGNI: task037 starts clustering; task038 supplies the next bounded testing/derived-data slice, not broad CAD/model tooling. Derived artifacts never mutate source points or CAD authority. Scene references/fits retain source memberships, coordinate bindings, settings and uncertainty.

## Capability backlog and implementation references

| Capability | Existing bounded slices / next gate |
| --- | --- |
| Versioned tools and replayable evidence | [Task011](tasks/011-tool-protocol-evidence.md), deterministic inspection integration [task012](tasks/012-shared-project-chat.md). Broader evaluation/replay stays bounded by explicit contracts. |
| Reproducible visual observations and grounding | Local fixed-view capture [task027](tasks/027-visual-observations.md), explicit image transport/pixel grounding [task028](tasks/028-model-visual-grounding.md), catalog admission [task029](tasks/029-catalog-model-image-input.md), compressed crop UX [task030](tasks/030-chat-screenshot-crop.md). Browser-observed provenance is not an independently verified source record. |
| Evaluation runner and failure taxonomy | Still queued: deterministic fixtures, operation-specific postconditions and failure classes before budgeted model runs. |
| Bounded model orchestration | [Task019](tasks/019-model-chat-loop.md) and subsequent model/visual/nearest-label/proposal slices. Effective request transparency [task025](tasks/025-model-request-inspector.md). No model self-approval or silent paid-provider fallback. |
| Authoritative sessions and persistence | Synthetic local sessions and explicit Save/Load [task014](tasks/014-project-sessions.md). Toronto point/CAD authorities are separately bound and volatile; durable CAD documents remain future work. |
| Exact approval and checked edits | Synthetic box parameters [task015](tasks/015-approved-box-edits.md), verified Toronto point overrides [task031](tasks/031-verified-point-overrides.md), synthetic ghosts [task033](tasks/033-ai-ghost-proposals.md), Toronto-native point/CAD proposals [task034](tasks/034-toronto-cad-workspace.md). Latest point-move UX and small fixes: [task035](tasks/035-chat-point-move-review.md), [task036](tasks/036-small-workspace-fixes.md). |
| Concrete CAD and postconditions | Real OpenCascade sandbox [task013](tasks/013-cad-engine.md); Toronto-native box/cylinder workflow [task034](tasks/034-toronto-cad-workspace.md). Channels, broader modification/booleans in the workspace, durable CAD bodies and approval-gated use of fitted estimates remain separately scoped. |

## Scan-grounded placement search — ordered checklist

[Persistent vision, rationale and feature checklist](plans/2026-10-19-scan-grounded-placement-search.md): turn a selected street AOI and design intent into five ranked, numbered, evidence-backed placement previews; let the human compare, choose and approve one exact CAD proposal. This closes the gap between inspecting scan points and making a spatial design decision, without model-owned measurements or automatic edits.

Start with **item 1: typed placement specification**. Search, ranking, scene shortlist, annotated visual assessment, product-agent workflow, ground/effective-scene support and benchmarks remain individually tracked in that checklist. Implementation is not review approval.

## Next checkpoint

Fresh-session review remains pending for task037 and [task038](tasks/038-street-testing-preprocessing.md), including their actual untracked additions. Do not equate membership validation with object-separation quality or implementation with review approval. Next assess the visible street chunk with the operator: tune instance separation/fit quality, ground support/outliers and page-query latency before adding model tools or approval-gated fitted CAD proposals. Initial full-resolution view and eye-toggle browser evidence belong to task038.

Current APIs and boundaries: [architecture](architecture.md), [project editing](project-editing.md), [model chat](model-chat.md), [provider authentication](provider-auth.md), [CAD kernel](cad-engine.md). Provider credentials remain backend-only; local ChatGPT-plan and API-key modes have distinct capabilities and no paid fallback. No live-provider check is implied by baseline tests.
