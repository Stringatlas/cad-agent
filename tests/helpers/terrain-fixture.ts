import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { elevationFixture } from './elevation-fixture';

export async function terrainFixture(t: { after(callback: () => unknown): void }) {
  const f = await elevationFixture(t), directory = join(f.root, 'elevation/terrain');
  await mkdir(directory);
  const fixture = resolve('tests/fixtures/elevation/terrain');
  await copyFile(join(fixture, 'slope.tif'), join(directory, 'slope.tif'));
  const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
  manifest.elevationRevision = createHash('sha256').update(await readFile(join(f.root, 'elevation/manifest.json'))).digest('hex');
  manifest.sourceRevision = f.info.revision;
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return f;
}
