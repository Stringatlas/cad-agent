import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createDemoProject } from '@spatial/project-state';
import { createDatasetRoutes, DEFAULT_DATASET_ROOT } from './dataset-routes';
import { randomUUID } from 'node:crypto';
import { PROJECT_FRAME_ID } from '@spatial/contracts';
import { createChatRoutes } from './chat-routes';
import { createCadRoutes } from './cad-routes';

/**
 * One read-only demo snapshot per server instance; clients fetch it without a local seed.
 * Selection/camera are disposable browser state. CAD is an ephemeral sandbox,
 * never a publication, persistence or mutation API for this project snapshot.
 */
export function createDemoServer(options: { datasetRoot?: string } = {}): Server {
  const project = createDemoProject();
  const sessionId = randomUUID();
  const datasetRoutes = createDatasetRoutes(options.datasetRoot);
  const chatRoutes = createChatRoutes(project, sessionId, options.datasetRoot ?? DEFAULT_DATASET_ROOT);
  const cadRoutes = createCadRoutes({ sessionId, projectRevision: project.revision, frameId: PROJECT_FRAME_ID });
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (await chatRoutes(request, response)) return;
    if (await cadRoutes.handle(request, response)) return;
    if (await datasetRoutes(request, response)) return;
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:3001').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.method === 'GET' && pathname === '/project') {
      response.setHeader('X-Spatial-Session', sessionId);
      response.setHeader('X-Spatial-Frame', PROJECT_FRAME_ID);
      response.end(JSON.stringify(project));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  server.once('close', () => { void cadRoutes.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoServer();
  server.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  server.listen(3001, '127.0.0.1', () => {
    console.log('Local demo server listening at http://127.0.0.1:3001 (read-only project; ephemeral CAD sandbox)');
  });
}
