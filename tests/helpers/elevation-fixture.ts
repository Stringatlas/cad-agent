import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPreparedCloudRegistry } from '../../apps/server/src/datasets/prepared-cloud';

/** Real Rasterio-generated GeoTIFFs; no Python or ignored real data required by TS tests. */
export async function elevationFixture(t: { after(callback: () => unknown): void }, withModel = true) {
  const fixture = resolve('tests/fixtures/elevation'), root = await mkdtemp(join(tmpdir(), 'elevation-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  await Promise.all([copyFile(join(fixture, 'cloud.json'), join(root, 'cloud.json')), copyFile(join(fixture, 'octree/metadata.json'), join(root, 'octree/metadata.json')),
    copyFile(join(fixture, 'points.bin'), join(root, 'octree/octree.bin')), copyFile(join(fixture, 'hierarchy.bin'), join(root, 'octree/hierarchy.bin'))]);
  const id = 'elevation-fixture', reader = createPreparedCloudRegistry({ [id]: root }).open(id), info = await reader.info();
  if (withModel) {
    await mkdir(join(root, 'elevation'));
    for (const name of ['dtm.tif', 'dsm.tif', 'support.tif', 'ground-range.tif']) await copyFile(join(fixture, name), join(root, 'elevation', name));
    const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
    manifest.source = info; // Equivalent synthetic source content, new runtime file identities.
    await writeFile(join(root, 'elevation/manifest.json'), JSON.stringify(manifest));
  }
  return { root, id, reader, info };
}
