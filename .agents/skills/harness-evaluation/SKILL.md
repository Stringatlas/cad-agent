---
name: harness-evaluation
description: Design product-agent tools, inspection interfaces and reproducible benchmarks that separate model proposals from verified geometry outcomes.
---

# Harness evaluation

## Durable boundaries

Read `docs/architecture.md` and the assigned task for current capabilities and authority ownership; do not infer implementation status from this skill. The product is a CAD-first live scene/chat workspace, not a headless harness. Product-agent geometry access stays behind adapter interfaces; Pi is development tooling, not product runtime. Viewer caches and model output are not authoritative geometry. Keep synthetic parameter edits, Toronto source-record overrides, native CAD candidates and their verification claims distinct.

## Procedure

1. Read the task, `docs/architecture.md`, contracts, project-state, geometry and agent-harness interfaces. Use GitNexus for cross-module exploration if available; verify source and index freshness before relying on results.
2. Define a bounded tool/evaluation task with acceptance criteria before adding runtime behavior. Keep viewer/kernel implementation types outside agent interfaces.
3. Specify input state revision, authoritative entity IDs, units/frame, preconditions and result schema. Reject unknown IDs and stale geometry revisions. Selection is not a geometry edit.
4. Separate observations, proposed changes, executed operations and verified outcomes. Never equate a model assertion, rendered mesh or analytic bound with successful CAD verification.
5. For future benchmarks, define deterministic fixtures, success/failure criteria, geometry postconditions, revision handling and artifact retention before running models. Record model/tool configuration, exact commands, logs and failure categories; distinguish infrastructure failures from product failures.
6. Add tests at the contract/adapter boundary and run `pnpm verify`. Use Node tests for deterministic checks; inspect/use `pi-browser-harness` for visual interactions. Record blocked/unrun checks honestly, inspect the diff and require fresh-session review.

## Scope and review

Choose the next bounded task from current repository plans and user authorization, not historical baseline assumptions. A model/tool integration does not authorize approval bypass or unrelated geometry features. Implementation checks and fixture inference are not fresh-session review or live-provider certification; keep those claims separate.

## Authoritative references

- [Node 22 test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html)
- [pnpm 10 workspaces](https://pnpm.io/10.x/workspaces)
- [TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
