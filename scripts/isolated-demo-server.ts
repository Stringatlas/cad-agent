import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../apps/server/src/index';

/** Acceptance fixtures must never load or write the operator's persisted project. */
export function createIsolatedDemoServer(options: { datasetRoot?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spatial-owned-project-'));
  const clean = () => rmSync(root, { recursive: true, force: true });
  try {
    const server = createDemoServer({ ...options, projectPath: join(root, 'project.json') });
    server.once('close', clean);
    return server;
  } catch (error) { clean(); throw error; }
}
