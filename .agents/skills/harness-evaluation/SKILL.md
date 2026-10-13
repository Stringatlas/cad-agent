---
name: harness-evaluation
description: Design product-agent tools, inspection interfaces and reproducible benchmarks that separate model proposals from verified geometry outcomes.
---

# Harness evaluation

## Current facts

`packages/agent-harness/src/index.ts` defines `AgentContext`, `InspectionResult` and `InspectionAgent` only. Geometry access is an adapter interface. No product model loop, tool execution, benchmark runner or verified CAD edit exists. Pi is development tooling outside the product. The browser and read-only HTTP server independently seed demo state; neither is a synchronization service.

## Procedure

1. Read the task, `docs/architecture.md`, contracts, project-state, geometry and agent-harness interfaces. Use GitNexus for cross-module exploration if available; verify source and index freshness before relying on results.
2. Define a bounded tool/evaluation task with acceptance criteria before adding runtime behavior. Keep viewer/kernel implementation types outside agent interfaces.
3. Specify input state revision, authoritative entity IDs, units/frame, preconditions and result schema. Reject unknown IDs and stale geometry revisions. Selection is not a geometry edit.
4. Separate observations, proposed changes, executed operations and verified outcomes. Never equate a model assertion, rendered mesh or analytic bound with successful CAD verification.
5. For future benchmarks, define deterministic fixtures, success/failure criteria, geometry postconditions, revision handling and artifact retention before running models. Record model/tool configuration, exact commands, logs and failure categories; distinguish infrastructure failures from product failures.
6. Add tests at the contract/adapter boundary and run `pnpm verify`. Use Node tests for deterministic checks; inspect/use `pi-browser-harness` for visual interactions. Record blocked/unrun checks honestly, inspect the diff and require fresh-session review.

## Next steps, not implemented

First review the foundation against its task evidence in a fresh session. A later revision-checked box parameter update without CAD can exercise state transitions before adding a model or kernel. Persistent state, tool execution and benchmarks need separate designs/tasks.

## Authoritative references

- [Node 22 test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html)
- [pnpm 10 workspaces](https://pnpm.io/10.x/workspaces)
- [TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
