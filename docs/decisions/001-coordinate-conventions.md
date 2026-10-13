# 001 — Coordinate conventions

Status: Accepted for the foundation

## Decision

Project coordinates use meters (`m`), a right-handed frame and Z-up. Vectors are ordered `[X, Y, Z]`. Entity positions, point-cloud samples, box dimensions and analytic bounds are local-frame values.

`localOrigin` is the local origin's position in world coordinates. Local and world share units and orientation; conversion is translation only:

```text
world = local + localOrigin
local = world - localOrigin
```

The deterministic demo uses `localOrigin = [1000, 2000, 10]`. Its box has dimensions `[1.8, 1.2, 1.5]` and local center `[0, 0, 0.75]`, so its world center is `[1000, 2000, 10.75]` and local bottom is Z = 0.

## Rendering consequences

Render local geometry directly; do not add the large world origin to GPU positions. World coordinates are available for metadata/display and explicit conversions. Three.js camera up is `(0, 0, 1)`; its default XZ grid is rotated by `π/2` around X into the XY ground plane. Axis colors remain X red, Y green, Z blue.

State entity IDs, not Three object identities, identify geometry. Units and frames accompany state rather than being inferred from a camera, mesh or imported file. The demo box is an axis-aligned declarative proposal rendered as a mesh, not a CAD body.

## Validation and limits

`packages/contracts/src/index.ts` validates supported metadata, finite triples, positive box dimensions, unique entity IDs and selection references. `packages/project-state/src/index.ts` implements translation helpers. `tests/core.test.ts` checks conversions, tolerance-based round trips and bounds.

Rotated frames, alternate units, georeferencing/CRS conversion and imported geometry are not implemented. Introduce explicit conversions and a new decision before supporting them; do not silently reinterpret this frame. Future CAD adapters must declare unit/frame conversions and return local-frame results.

## Rationale

One explicit convention prevents axis/unit ambiguity and large-offset rendering precision loss while retaining a recoverable world placement. It does not claim geospatial accuracy or CAD validity.

References: [architecture](../architecture.md), [Three.js OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls), [future OpenCascade modeling data](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html).
