import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createDatasetRoutes, DEFAULT_DATASET_ROOT } from './datasets/dataset-routes';
import { ProviderAuth, type ProviderAuthOptions } from './auth/provider-auth';
import { createAuthRoutes } from './auth/auth-routes';
import { loadServerConfiguration } from './auth/provider-config';
import { createModelChatRoutes } from './agent/model-chat-routes';
import type { ModelTransport } from './agent/provider-model';
import { createPointOverrideRoutes } from './scene/point-override-routes';
import { PointOverrideSession } from './scene/point-overrides';
import { TorontoCadSession } from './cad/toronto-cad-session';
import { createTorontoCadRoutes } from './cad/toronto-cad-routes';
import { SceneObjectSession } from './scene/scene-object-session';
import { createSceneObjectRoutes } from './scene/scene-object-routes';
import { PlacementSearchSession } from './placement/placement-search-session';
import { createPlacementSearchRoutes } from './placement/placement-search-routes';
import { createPreparedCloudRoutes } from './datasets/prepared-cloud-routes';

/** Toronto dataset, point, authored-object and CAD authorities. */
export function createDemoServer(options: { datasetRoot?: string; preparedClouds?: Readonly<Record<string, string>>; provider?: ProviderAuthOptions; modelTransport?: ModelTransport } = {}): Server {
  // Factory callers/tests never load the operator's .env or authentication store implicitly.
  const auth = new ProviderAuth(options.provider ?? { mode: 'disabled' });
  const authRoutes = createAuthRoutes(auth, options.provider?.redirectUri);
  const directory = options.datasetRoot ?? DEFAULT_DATASET_ROOT;
  const points = new PointOverrideSession(directory);
  const cad = new TorontoCadSession(directory);
  const placement = new PlacementSearchSession(directory, points, cad);
  const placementRoutes = createPlacementSearchRoutes(placement);
  const objects = new SceneObjectSession(directory, points);
  const objectRoutes = createSceneObjectRoutes(directory, points, objects);
  const modelRoutes = createModelChatRoutes(auth, directory, options.modelTransport, { points, cad, objects, placement });
  const datasetRoutes = createDatasetRoutes(options.datasetRoot);
  const preparedRoutes = createPreparedCloudRoutes(options.preparedClouds);
  const pointOverrideRoutes = createPointOverrideRoutes(directory, points);
  const torontoCadRoutes = createTorontoCadRoutes(directory, cad);
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
      if (await preparedRoutes(request, response)) return;
      if (await authRoutes(request, response)) return;
      if (await modelRoutes.handle(request, response)) return;
      if (await pointOverrideRoutes.handle(request, response)) return;
      if (await torontoCadRoutes.handle(request, response)) return;
      if (await objectRoutes.handle(request, response)) return;
      if (await placementRoutes.handle(request, response)) return;
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
  server.close = (...args: Parameters<Server['close']>) => {
    // Abort/drain placement before closing the point and CAD authorities it uses.
    const placementClosed = placementRoutes.close(); modelRoutes.close();
    void placementClosed.then(() => { void pointOverrideRoutes.close(); void torontoCadRoutes.close(); void objectRoutes.close(); });
    return close(...args);
  };
  server.once('close', () => { modelRoutes.close(); auth.close(); });
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
      console.log('Local server listening at http://127.0.0.1:3001 (provider settings: /auth; Toronto workspace)');
    });
  } catch {
    console.error('Server startup failed; check server configuration and protected local storage (see docs/provider-auth.md)');
    process.exitCode = 1;
  }
}
