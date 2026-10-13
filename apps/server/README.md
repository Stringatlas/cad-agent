# Read-only server scaffold

From the workspace root:

- `pnpm --filter @spatial/server dev` watches TypeScript source.
- `pnpm --filter @spatial/server start` runs source using the workspace's `tsx`.
- `pnpm --filter @spatial/server build` / `typecheck` perform `tsc --noEmit` only.

This private development workspace exports TypeScript source. There is no emitted
production server bundle or `dist` artifact; `start` requires development tooling.

The server binds only to `127.0.0.1:3001`. `GET /health` returns `{"status":"ok"}`;
`GET /project` returns a deterministic demo project. Each server instance creates
its own independent snapshot. It does **not** reflect browser selection or edits,
persist state, synchronize clients, or provide CAD edit endpoints. Other requests
return 404. Geometry coordinates in `/project` are local meters; the explicit
project metadata supplies the world-space origin.
