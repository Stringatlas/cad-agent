---
name: spatial-rendering
description: Implement or verify Three.js scene rendering, picking, camera controls, coordinate transforms and viewer lifecycle in this project.
---

# Spatial rendering

## Current facts

`apps/web/src/viewer.ts` owns Three.js resources and controls; `entities.ts` builds render caches and resolves picked IDs against project state. `App.svelte` owns locally seeded browser state. The viewer updates selection only, not geometry. Repeatable browser checks are in `scripts/browser-smoke.mjs`; evidence/status belongs in the task file, not a build result.

## Procedure

1. Read the assigned task, `docs/architecture.md`, `docs/decisions/001-coordinate-conventions.md` and the relevant viewer/UI source. For cross-module changes use GitNexus if indexed, verify findings against source and refresh stale indexes; do not claim an index exists without checking.
2. Keep meters, right-handed Z-up and explicit local/world frames. Render local coordinates; never add the demo world origin `[1000, 2000, 10]` to GPU positions. Keep `camera.up` Z and the grid on XY.
3. Treat state IDs/dimensions/positions as authority. Resolve pick hints back to existing IDs. Selection must preserve geometry revision; render caches must not become state or CAD ownership.
4. Bound changes to the task. Check pointer click-versus-drag behavior, resize, controls and disposal of listeners, animation frames, materials and geometry.
5. Run `pnpm verify`. Inspect/use the `pi-browser-harness` skill for browser checks; ensure daemon/CDP availability before claiming success. Verify orientation, orbit/zoom, cloud/box visibility, picking, list selection, clearing and resize; collect screenshots and console diagnostics with paths.
6. Inspect the diff, update the task with exact evidence/blockers and request fresh-session review. Preserve blocked checks as blocked, not passing.

## Future work, not current behavior

Geometry updates, imports, frame rotations and CAD tessellation require their own bounded task and explicit state/adapter decisions. The box mesh is not a verified solid.

## Authoritative references

- [Three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster)
- [Three.js OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls)
- [Svelte 5](https://svelte.dev/docs/svelte/overview)
- [Vite 7](https://v7.vite.dev/guide/)
