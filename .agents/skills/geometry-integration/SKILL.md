---
name: geometry-integration
description: Work on geometry adapters, analytic bounds, future CAD operations and tessellation while preserving explicit units, frames, IDs and revisions.
---

# Geometry integration

## Current facts

`packages/geometry/src/index.ts` contains `GeometryAdapter.bounds` and analytic `boxBounds`. Contracts describe an axis-aligned box proposal. There is no concrete adapter, OpenCascade body, CAD edit or tessellation pipeline. Three.js mesh creation is rendering, not CAD validation.

## Procedure

1. Read the task, `docs/architecture.md`, `docs/decisions/001-coordinate-conventions.md`, contracts, geometry source and relevant tests before changing boundaries. Use GitNexus for cross-module impact when available; verify against source and do not invent index results.
2. Keep adapter inputs/outputs independent of Three.js and kernel types. Declare meters, local right-handed Z-up, entity IDs and source revision explicitly. Convert external units/frames at the boundary, never implicitly.
3. Validate finite vectors and strictly positive dimensions. Test bounds at varied centers, malformed inputs and local/world round trips with numeric tolerances.
4. For planned edits, first define revision preconditions, atomic state transition, failure behavior and postconditions in a task. Do not implement unrelated kernel features. The next candidate is a revision-checked box parameter update without CAD.
5. For an actual future kernel integration, distinguish declarative proposal, kernel shape, tessellation and verified result; record kernel errors and geometric checks separately from render success. Do not call analytic bounds or a visible mesh a valid solid.
6. Run `pnpm verify`; add operation-specific tests without weakening existing checks. For tessellation/render changes inspect/use `pi-browser-harness` and collect browser evidence. Inspect the diff, record exact checks/artifact paths and leave fresh review pending until performed.

## Authoritative references

- [OpenCascade modeling data](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html) — future integration reference, not an installed dependency.
- [TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [Node 22 test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
