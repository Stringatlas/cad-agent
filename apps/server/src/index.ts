import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createDemoProject } from '@spatial/project-state';
import { createDatasetRoutes } from './dataset-routes';

/**
 * Read-only scaffold. Each server owns an independent demo snapshot: this is not
 * the browser's state, a persistence service, or a client synchronization API.
 */
export function createDemoServer(options: { datasetRoot?: string } = {}): Server {
  const project = createDemoProject();
  const datasetRoutes = createDatasetRoutes(options.datasetRoot);
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (await datasetRoutes(request, response)) return;
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:3001').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.method === 'GET' && pathname === '/project') {
      response.end(JSON.stringify(project));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoServer();
  server.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  server.listen(3001, '127.0.0.1', () => {
    console.log('Read-only demo server listening at http://127.0.0.1:3001 (independent snapshot; no client sync)');
  });
}
