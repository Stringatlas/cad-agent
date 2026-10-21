# Server source layout

`index.ts` composes HTTP routes, authorities and server lifecycle.

| Folder | Responsibility |
| --- | --- |
| `agent/` | Model runtime, provider transport, tool adapters, scene bindings, inspection and visual/browser brokers. |
| `auth/` | Provider credentials, account routes and server configuration. |
| `cad/` | Kernel worker/client and Toronto CAD authority/routes. |
| `datasets/` | Prepared-cloud/Potree readers, dataset routes, display/crop streams and source-point lookup. |
| `spatial/` | Semantic indexes, nearest-point verification, ground and spatial queries/routes. |
| `preprocessing/` | Offline semantic instances, scene derivation and read-only summaries. |
| `placement/` | Candidate search, judgement, utility-box assessment and placement session/routes. |
| `scene/` | Point-override and authored-object authorities/routes. |

Keep route handlers with their feature and import concrete modules directly.
These folders preserve the existing contracts and authority boundaries; they are
not new packages. The CAD worker and bootstrap stay together. Paths resolved from
`import.meta.url` must account for folder depth and retain their operator-owned
configuration/dataset targets.
