# Tests

Tests are grouped by the behavior they protect, including client/server coverage
within the same feature. Shared fixture builders live in `fixtures/`; provider
transport helpers live in `helpers/`.

| Folder | Coverage |
| --- | --- |
| `agent/` | Active tool interface, provider runtime, skills, evidence and proposals |
| `auth/` | Credentials, OAuth, local HTTP guards and account lifecycle |
| `cad/` | Native kernel operations and retained CAD approval/undo |
| `chat/` | Streaming, history, request inspection, image transport and safe Markdown |
| `datasets/` | Prepared-cloud loading, observation/binary transport and server smoke checks |
| `placement/` | Manual placement/search engines, constraints and result validation |
| `preprocessing/` | Offline dataset conversion, clustering, fits and ground surface |
| `scene/` | Point/object authority, provenance, marks, approval and undo |
| `spatial/` | Exact queries, disk indexes, crops, HTTP admission and cancellation |
| `viewer/` | Camera math, capture, picking, render caches and resource lifecycle |

Run all TypeScript tests with `pnpm test`; its quoted recursive glob discovers
tests at any depth. Run a group with `pnpm exec tsx --test "tests/cad/**/*.test.ts"`.
`pnpm typecheck` includes every nested TypeScript test.

Python preprocessing tests are separate from `pnpm test`:

```sh
python3 tests/preprocessing/dataset-recipe.test.py
data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/toronto3d-preprocessing.test.py
data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/dales2-preprocessing.test.py
```

See the dataset preprocessing docs for Python dependency setup. Browser checks
remain in `scripts/browser-*.mjs` and run separately.

Keep tests for observable behavior and consequential regressions. Prefer a few
representative cases plus real boundaries over Cartesian products. Avoid source
substring checks, copied prompt prose, exact UI copy/style assertions, extracted
Svelte handlers and tests that simply repeat an implementation. When a model
workflow is removed, keep its rejection check and delete its old success tests.
Manual engine compatibility can still have behavioral coverage.

The deletion rationale and validation for this cleanup are recorded in
[task 079](../docs/tasks/079-test-suite-cleanup.md). Historical tasks retain the
paths used when their evidence was recorded.
