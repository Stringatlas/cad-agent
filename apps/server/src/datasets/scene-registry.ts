import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Operator-owned scenes. IDs are selected by clients; paths never are. */
export const DEFAULT_PREPARED_ROOT = fileURLToPath(new URL('../../../../data/processed/stpls3d/', import.meta.url));
export function preparedCloudRegistrations(root = DEFAULT_PREPARED_ROOT, realworldRoot = join(root, '../stpls3d_realworld')): Readonly<Record<string, string>> {
  return Object.fromEntries([
    ...Array.from({ length: 25 }, (_, index) => [`stpls3d-${index + 1}`, join(root, String(index + 1))]),
    ...['occc', 'ra', 'usc', 'wmsc'].map(scene => [`stpls3d-realworld-${scene}`, join(realworldRoot, scene)]),
  ]);
}
export function preparedCloudName(id: string): string {
  if (/^stpls3d-realworld-(occc|ra|usc|wmsc)$/.test(id)) return `STPLS3D Real-world · ${id.slice('stpls3d-realworld-'.length).toUpperCase()}`;
  return /^stpls3d-\d+$/.test(id) ? `STPLS3D · Scene ${id.slice(8)}` : id;
}
