# UX principles — scene first, details on demand

These are standing requirements for every agent changing product UI. Read alongside the [product vision](product-vision.md). User direction: **clean YAGNI, Apple-style restraint and clear information hierarchy**, not a diagnostic console with a scene behind it.

## Information hierarchy

1. **Primary:** the scene, the user's current selection, chat intent, pending changes and their Accept/Decline controls. A selected point should answer “what is it?” (semantic type) before explaining how its source record is stored. A visible derived cluster/layer must have discoverable meaning through a compact text-labeled key or focused inspection.
2. **Secondary, contextual:** only the controls/status needed for the current action. Reveal selection details when something is selected; show review when a change is pending; show progress while work is running. Routine success should become quiet, not leave a permanent panel.
3. **On demand:** coordinates, provenance, request/tool evidence, session IDs, revisions, point counts, fit diagnostics, frame mapping and implementation limits belong under named Details/Diagnostics/help disclosures, not persistent scene overlays. Keep these accessible and accurate; hiding engineering narration is not deleting evidence.
4. **Interruptive only when necessary:** actionable errors, stale/ambiguous authority, failed loading, destructive confirmations and human approval must remain visible with a concise recovery action. Do not hide failures merely to make the screenshot clean.

## Presentation rules

- Delete useless copy; do not merely relocate it into Details. Disclosure is for information a user may actually need, not a dumping ground for generated diagnostic summaries. Never automatically render backend `message` strings, aggregate fit scores/counts or repetitive correctness disclaimers as product copy.
- Give each surface one purpose. Default scene overlays should be small and task-relevant. Do not cover useful geometry with idle refresh cards, UUIDs, duplicate statuses or explanatory paragraphs.
- Put object identity/type next to the selected object/reference. Prefer “Point 3 · Pole” over provenance-first prose. Use authoritative source labels; Unknown/Loading/Unavailable is better than guessing from RGB or overlapping bounds. Preserve source/effective geometry distinctions internally and reveal them when relevant to a decision.
- Use progressive disclosure, familiar controls and concise human language. A tooltip can explain a control; a short help disclosure can teach a gesture. Internal invariants such as deleted-number reuse policy are not default product copy.
- Color needs a compact text label or accessible name. Distinguish semantic class from representation (cluster bounds, estimated fits, ground). Avoid adding an always-open legend for every possible class; show only relevant categories and details on demand.
- Keep action states legible and consistent: selected, pending, committed, unavailable, failure. Approximate fits can be labeled “Estimated” with methodology/quality in Details; do not repeat long non-CAD disclaimers throughout the workspace or imply estimates are verified solids.
- Preserve keyboard/focus accessibility, readable contrast, touch targets and desktop/mobile hierarchy. A clean UI is not an unlabeled icon collection. Review/recovery controls must not be obscured by chat drawers.
- YAGNI: reuse existing controls/components and solve the current user decision. Do not add speculative dashboards, generalized inspectors/settings frameworks, onboarding systems or permanent status badges without a concrete need.

## Before adding visible UI

Ask: What user question or next action does this answer? Why must it be visible now? Could selection, a tooltip or a named disclosure provide it? Does it duplicate another surface? If it only explains implementation correctness, move it out of the primary workspace.

## Acceptance for UI changes

Inspect actual desktop and mobile screenshots, not only source/DOM tests. Check the idle scene as well as selected/pending/error states. Confirm useful geometry remains visible, selected types and overlay meaning are discoverable, evidence remains accessible, and approval/recovery is not weakened. A passing build does not establish good hierarchy. Record task-specific evidence and leave fresh-session review pending.
