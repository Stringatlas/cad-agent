# Local server

Run from the workspace root:

- `pnpm --filter @spatial/server dev` watches TypeScript source.
- `pnpm --filter @spatial/server start` runs source with `tsx`.
- `build` / `typecheck` run `tsc --noEmit`; no emitted server bundle.

The server binds only to `127.0.0.1:3001`. It owns local project persistence and exact approved box edits, read-only dataset/inspection routes and a separate ephemeral CAD sandbox. See [architecture](../../docs/architecture.md) and [project editing](../../docs/project-editing.md).

## Provider configuration

Copy **`apps/server/.env.example` → `apps/server/.env`** and restrict permissions (`chmod 600 apps/server/.env`). This is the only automatic env file, resolved independently of cwd; process environment wins. No root/web `.env` or `.env.local` loading. Restart after changes.

- `SPATIAL_PROVIDER_MODE=disabled` (default): no credentials required.
- `SPATIAL_PROVIDER_MODE=api-key` + server-only `OPENAI_API_KEY`: separately billed OpenAI API credentials.
- `SPATIAL_PROVIDER_MODE=chatgpt`: visit **http://127.0.0.1:3001/auth**, Continue with ChatGPT; no key or Codex identity required. OAuth tokens stay in protected local storage.

The workspace Account panel uses this auth boundary. [Task019 scene chat](../../docs/model-chat.md) adds explicit `/chat/models` discovery and streamed `/chat/turn` inference with server-only credentials, bounded volatile history and a read-only scene tool. No paid-key fallback, model CAD/mutation tools or public-server authorization is provided. Live inference remains unverified. See [provider-auth guide](../../docs/provider-auth.md) for storage/permissions, callback/security, HTTP contract and limitations.
