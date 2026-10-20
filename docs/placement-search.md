# Equipment-specific placement search (Task064 groundwork)

**Not the primary large-area candidate-point workflow.** The user rejected manual tiny-AOI/box-first search as fulfillment of that request. Use [large-area candidate search](area-candidate-search.md) for model-driven point recommendations; the legacy equipment-fit instructions below remain separate.

## Start

Use Node 22 (`>=22.12 <23`) and pinned pnpm 10.34.6:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Restart an already-running backend to load the new routes. Open **http://127.0.0.1:5173** and use the Toronto scene. The direct flow below does not require an account/model and sends no inference requests.

The backend needs the prepared Toronto source, canonical prepared semantic disk index and matching complete preprocessing/ground manifest. These generated assets are not shipped in Git. This workstation's 78,320,210-point source/index and 13,394-cell ground artifact were checked as present and matching. For other machines follow [source preparation](toronto3d-preprocessing.md) (if unavailable, use the source/data guides linked from [clustering](semantic-instance-clustering.md)), [clustering](semantic-instance-clustering.md) and [ground preparation](street-testing-preprocessing.md). `SPATIAL_PREPROCESSING_PATH`, if set, is the manifest filename, not a directory. Search never prepares missing assets on demand.

## No-model UI test

1. Start with no accepted Toronto point/CAD edits. Finish pending proposals. Existing accepted edits block this original-source search; Undo them or restart the volatile backend and reload.
2. Navigate to an open street patch and **Shift-drag a small AOI**, initially about **6 × 6 m**. Wait for its snapshot to finish. AOI is an XY footprint at all elevations; the displayed reference elevation is not terrain.
3. Open **Find placement sites**. Open **Settings · illustrative, not standards** and inspect/edit dimensions, access, pole separation, slope, relief, spacing and front yaws. The example is 1 × 1 × 1.2 m, 1 m access, 2 m pole separation, 5° sampled slope, 0.1 m sampled relief, 2 m spacing, four cardinal fronts. These are disclosed test values, not design standards.
4. Click **Find sites**. Up to five cyan numbered boxes and access outlines appear. They are comparison previews, not pending edits. Select a site, **Focus site**, and expand its evidence and Search limits & ranking.
5. Click **Propose this site**. Only the chosen exact box becomes a native pending ghost. Use existing **Accept / Decline** review controls. Decline leaves no accepted body; Accept publishes that single body. Open **Scene tools → CAD** and use **Undo last CAD solid** to reverse the accepted change. Search again after Undo; old searches are not rebased.
6. Change the AOI or search settings: the old shortlist clears. A timeout/no-feasible result is not a clearance certificate. For incomplete searches choose a smaller area, larger spacing or fewer orientations; do not relax design constraints merely to obtain a result.

Production smoke found three sites in 10.10 s for an axis-aligned 6 × 6 m AOI **X124–130, Y950–956**, Toronto local meters, with the settings above. Two other 6 × 6 m locations exhausted 15 s. This is one demonstrated location, not a latency guarantee; a rotated user AOI changes the lattice/results. Navigation remains through existing scene controls, not an automatic jump to these bounds.

## Optional product-agent test

Only if you deliberately configure/select a provider model (normal inference/billing rules apply), select an AOI and send:

> Search this area for up to five utility-box sites: 1 × 1 × 1.2 m, front access 1 m at box height, horizontal box-boundary separation at least 2 m from observed pole points, sampled slope at most 5°, sampled relief at most 0.1 m. Require zero observed body/access conflicts and both footprints inside the area. Search at 2 m spacing with front yaws 0/90/180/270. Rank slope, then relief, then pole separation; explain limitations. Show the shortlist, do not propose yet.

The agent uses the same retained search and numbered UI previews. You may ask it to capture the numbered scene in RGB/type mode for **qualitative** comparison. Capture is the current rendered view, not a dedicated top-down orthographic assessment or a new measurement. Then explicitly ask “Propose site 2 from that retained shortlist.” Human Accept is still required. No development verification used live/paid inference; adherence with your configured live model remains unverified.

## Limits and recovery

- Cardinal yaw only. Search is an AOI-local lattice, at most 5,000 generated poses / 15 seconds, shortlist five with 2 m center diversity; latest search retained five minutes. Proposing reruns deterministic verification and may itself time out.
- Ranking is lexicographic slope minimum, relief minimum, pole separation maximum, then deterministic coordinate/yaw ties. Fewer than five sites can be correct.
- Counts cover complete relevant original-source volumes; evidence witnesses are capped, not the search domain. Missing/unsupported ground rejects a site. Five-point plane/relief over sparse ground minima is not continuous foundation support.
- Empty observed volumes do not prove physical clearance, access rights, safety, utilities or regulatory compliance. Pole distances are to observed labeled points, not fitted physical boundaries.
- Accepted point/CAD edits are unsupported. Source, terrain or authority changes invalidate retained results and approval. Refresh authority/search rather than retrying a stale candidate blindly.
- [Task064](tasks/064-connected-placement-search.md) owns verification evidence, known baseline failures and remaining review gates.
