# Web source layout

`main.ts` selects the page; `App.svelte` composes the workspace.

| Folder | Responsibility |
| --- | --- |
| `auth/` | Provider account UI and lifecycle. |
| `chat/` | Conversation UI, model transport, draft references and tool inspector. |
| `chat/visual/` | Screenshot attachments, cropping and visual-observation UI. |
| `components/` | Shared Markdown and human-approval UI. |
| `viewer/` | Shared point-cloud viewport, RGB/semantic/instance colors, camera, orbit and capture helpers. |
| `scenes/point-cloud/` | Dataset-aware prepared-cloud workspace, client and adaptive native-node viewer; STPLS3D inventory. |
| `scenes/toronto/` | Toronto workspace/viewer composition and authority transport. |
| `scenes/toronto/cad/` | CAD client, controls and disposable render cache. |
| `scenes/toronto/points/` | Point edits, semantic presentation and previews. |
| `scenes/toronto/objects/` | Authored object hierarchy, client and rendering. |
| `scenes/toronto/placement/` | Area selection, candidate search, evidence and previews. |
| `scenes/toronto/inspection/` | Closest-point queries, scene marks and preprocessing overlays. |
| `scenes/toronto/display/` | Observations, crop/adaptive streaming, buffers and point colors. |

Keep a feature's components, clients and render helpers together. Promote helpers
to `viewer/` or `components/` when they are shared. Import concrete modules directly;
these folders organize implementation and do not introduce new state authorities.
Geometry remains owned by the existing server/package boundaries.
