import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createDatasetRoutes, DEFAULT_DATASET_ROOT } from './dataset-routes';
import { createChatRoutes } from './chat-routes';
import { createCadRoutes } from './cad-routes';
import { ProjectSession } from './project-session';
import { createProjectRoutes } from './project-routes';
import { ProviderAuth, type ProviderAuthOptions } from './provider-auth';
import { createAuthRoutes } from './auth-routes';
import { loadServerConfiguration } from './provider-config';
import { createModelChatRoutes } from './model-chat-routes';
import type { ModelTransport } from './provider-model';
import { createPointOverrideRoutes } from './point-override-routes';

/** One single-user authority. View selections are disposable; CAD remains a separate sandbox. */
export function createDemoServer(options: { datasetRoot?: string; projectPath?: string; provider?: ProviderAuthOptions; modelTransport?: ModelTransport } = {}): Server {
  const authority = new ProjectSession(options.projectPath ?? process.env.SPATIAL_PROJECT_PATH);
  // Factory callers/tests never load the operator's .env or authentication store implicitly.
  const auth = new ProviderAuth(options.provider ?? { mode: 'disabled' });
  const authRoutes = createAuthRoutes(auth, options.provider?.redirectUri);
  const projectRoutes = createProjectRoutes(authority);
  const modelRoutes = createModelChatRoutes(auth, authority, options.datasetRoot ?? DEFAULT_DATASET_ROOT, options.modelTransport);
  const datasetRoutes = createDatasetRoutes(options.datasetRoot);
  const pointOverrideRoutes = createPointOverrideRoutes(options.datasetRoot ?? DEFAULT_DATASET_ROOT);
  const chatRoutes = createChatRoutes(() => authority.snapshot(), authority.snapshot().sessionId, options.datasetRoot ?? DEFAULT_DATASET_ROOT);
  // The sandbox is bound at startup; edit/load explicitly invalidates it until restart.
  const cadSource = () => { const b = authority.binding(); return { sessionId: b.sessionId, projectRevision: b.projectRevision, frameId: b.frameId }; };
  const cadRoutes = createCadRoutes(cadSource(), cadSource);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    // Validate before any authority route: malformed network-path targets (e.g. //)
    // can throw in URL(), and EventEmitter does not await async listeners.
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://127.0.0.1:3001').pathname; }
    catch {
      response.statusCode = 400;
      response.setHeader('Connection', 'close');
      response.end(JSON.stringify({ error: 'Invalid request target' }));
      return;
    }
    const dispatch = async () => {
      if (await authRoutes(request, response)) return;
      if (await projectRoutes(request, response)) return;
      if (await modelRoutes.handle(request, response)) return;
      if (await chatRoutes(request, response)) return;
      if (await cadRoutes.handle(request, response)) return;
      if (await pointOverrideRoutes.handle(request, response)) return;
      if (await datasetRoutes(request, response)) return;
      if (request.method === 'GET' && pathname === '/health') {
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
    };
    void dispatch().catch(() => {
      // Never expose paths/exception text or attempt a second response after
      // streaming started. A failed request must not kill unsaved authority.
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.destroy(); return; }
      response.statusCode = 500;
      response.setHeader('Connection', 'close');
      response.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });
  // Abort streaming requests when shutdown STARTS, not only after all sockets drain.
  const close = server.close.bind(server);
  server.close = (...args: Parameters<Server['close']>) => { modelRoutes.close(); void pointOverrideRoutes.close(); return close(...args); };
  server.once('close', () => { modelRoutes.close(); auth.close(); void cadRoutes.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configuration = loadServerConfiguration();
    const server = createDemoServer(configuration);
    const shutdown = () => { server.close(); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    server.on('error', () => {
      // Do not print configuration, credentials, callback URLs or provider exception bodies.
      console.error('Local server failed to listen');
      server.close(); process.exitCode = 1;
    });
    server.listen(3001, '127.0.0.1', () => {
      console.log('Local demo server listening at http://127.0.0.1:3001 (provider settings: /auth; authoritative project; separate CAD sandbox)');
    });
  } catch {
    console.error('Server startup failed; check server configuration and protected local storage (see docs/provider-auth.md)');
    process.exitCode = 1;
  }
}
