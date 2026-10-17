import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { parseSourcePointRequest, readSourcePoint } from '../apps/server/src/source-point';
import { createDatasetRoutes } from '../apps/server/src/dataset-routes';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-point-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [-3,-3,119], max: [3,3,123] }, scale: [.001,.001,.001], offset: [0,0,120], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [-3,-3,119], max: [3,3,123] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(56);
  for (let i = 0; i < 2; i++) { payload.writeInt32LE(-1234 + i, i * 28); payload.writeInt32LE(137, i * 28 + 8); payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(1 - i, i * 28 + 20); payload.writeFloatLE(i === 0 ? 7 : 6, i * 28 + 24); }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(2, 2); hierarchy.writeBigUInt64LE(56n, 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285,4841948,0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1,2,3,4].map(file => ({ source_file_id: file, file: `L00${file}.ply`, points: file === 1 ? 2 : 0 })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root); let cache: string | undefined;
  return { root, artifact, request: { revision: artifact.dataset.revision, key: { sourceFileId: 1, sourceRow: 1 } }, async prepare() { cache = (await getSemanticDiskIndex(artifact)).index.directory; }, async clean() { await artifact.close(); await rm(root, { recursive: true, force: true }); if (cache) await rm(cache, { recursive: true, force: true }); } };
}

test('exact source point request has bounded strict keys, revision and original source range', () => {
  const valid = `revision=${'a'.repeat(64)}&sourceFileId=4&sourceRow=4294967295`;
  assert.equal(parseSourcePointRequest(new URLSearchParams(valid)).key.sourceRow, 0xffffffff);
  for (const invalid of [valid + '&label=7', valid + '&sourceRow=1', valid.replace('4294967295', '4294967296'), valid.replace('sourceFileId=4', 'sourceFileId=0'), valid.replace('sourceRow=4294967295', 'sourceRow=01'), valid.replace('a'.repeat(64), 'x'.repeat(64))]) assert.throws(() => parseSourcePointRequest(new URLSearchParams(invalid)));
});

test('source metadata never builds on a cold click; prepared lookup rereads exact original binary64 record', async () => {
  const f = await fixture();
  try {
    await assert.rejects(readSourcePoint(f.root, f.request), { code: 'unavailable' });
    // Preparation is explicit/offline, never initiated by readSourcePoint.
    assert.equal(f.artifact.sourceReads.payloadBytes, 0);
    await f.prepare();
    const result = await readSourcePoint(f.root, f.request);
    assert.equal(result.semanticLabel, 7); assert.deepEqual(result.position, [-1234 * .001, 0, 137 * .001 + 120]);
    assert.deepEqual(result.key, f.request.key); assert.equal(result.frameId, 'toronto3d-local-v1'); assert.equal(result.units, 'm'); assert.equal(result.artifactRevision, f.request.revision);
    await assert.rejects(readSourcePoint(f.root, { ...f.request, revision: '0'.repeat(64) }), { code: 'stale-revision' });
    await assert.rejects(readSourcePoint(f.root, { ...f.request, key: { sourceFileId: 1, sourceRow: 2 } }), { code: 'unknown-point' });
    const abort = new AbortController(); abort.abort(); await assert.rejects(readSourcePoint(f.root, f.request, abort.signal), { name: 'AbortError' });
    // Replacing a bound source invalidates the old revision, never serves an old label.
    await writeFile(join(f.root, 'octree/octree.bin'), Buffer.alloc(56));
    await assert.rejects(readSourcePoint(f.root, f.request), { code: 'stale-revision' });
  } finally { await f.clean(); }
});

test('source point HTTP inherits local access, method, range, strict request and admission route safety', async () => {
  const f = await fixture(); const routes = createDatasetRoutes(f.root);
  const server = createServer((request, response) => { void routes(request, response).then(handled => { if (!handled) { response.statusCode = 404; response.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/datasets/toronto3d/point?revision=${f.request.revision}&sourceFileId=1&sourceRow=1`;
  try {
    assert.equal((await fetch(url)).status, 503);
    await f.prepare();
    const result = await fetch(url); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal((await result.json()).semanticLabel, 7);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    assert.equal((await fetch(url, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url, { headers: { range: 'bytes=0-27' } })).status, 416);
    assert.equal((await fetch(url + '&path=octree.bin')).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
});
