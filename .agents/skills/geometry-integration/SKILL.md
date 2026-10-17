---
name: geometry-integration
description: Work on geometry adapters, analytic bounds, future CAD operations and tessellation while preserving explicit units, frames, IDs and revisions.
---

# Geometry integration

## Durable boundaries

Read `docs/architecture.md`, `docs/cad-engine.md` and the assigned task for current adapters and authority ownership; do not infer implementation status from this skill. Kernel objects stay behind kernel-independent contracts and geometry adapters. Sandbox bodies, approved workspace bodies and synthetic parameter meshes have different authority/lifecycle semantics. Three.js mesh creation and analytic bounds are not native solid validation; a tessellation cannot replace its authoritative kernel body.

## Procedure

1. Read the task, `docs/architecture.md`, `docs/decisions/001-coordinate-conventions.md`, contracts, geometry source and relevant tests before changing boundaries. Use GitNexus for cross-module impact when available; verify against source and do not invent index results.
2. Keep adapter inputs/outputs independent of Three.js and kernel types. Declare meters, local right-handed Z-up, entity IDs and source revision explicitly. Convert external units/frames at the boundary, never implicitly.
3. Validate finite vectors and strictly positive dimensions. Test bounds at varied centers, malformed inputs and local/world round trips with numeric tolerances.
4. For planned edits, first define revision preconditions, exact candidate retention, deliberate human approval, atomic state transition, failure behavior and operation-specific postconditions in a task. Do not implement unrelated kernel features or silently map Toronto and synthetic frames.
5. For kernel integrations, distinguish declarative proposal, kernel shape, tessellation and verified result; record native validity, application postconditions and kernel errors separately from render success. Invalidation/reset must fail closed rather than restore solid authority from a mesh. Do not call analytic bounds or a visible mesh a valid solid.
6. Run `pnpm verify`; add operation-specific tests without weakening existing checks. For tessellation/render changes inspect/use `pi-browser-harness` and collect browser evidence. Inspect the diff, record exact checks/artifact paths and leave fresh review pending until performed.

## Authoritative references

- [OpenCascade modeling data](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html) — upstream kernel reference; consult current package manifests for installed bindings.
- [TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [Node 22 test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
