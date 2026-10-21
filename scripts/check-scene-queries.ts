// Task042: composed HTTP routes, fixed operator artifact, and an exhaustive bounded-memory audit.
// Usage: node --import tsx scripts/check-scene-queries.ts [prepared-dataset-directory]
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { DatasetInfo, Vec3 } from '@spatial/contracts';
import { createDatasetRoutes, DEFAULT_DATASET_ROOT } from '../apps/server/src/datasets/dataset-routes';
import { readPreprocessing } from '../apps/server/src/preprocessing/preprocessing-summary';
import { createGroundSurface } from '../apps/server/src/spatial/ground-surface';
import { SemanticArtifact } from '../apps/server/src/spatial/semantic-artifact';
import { getSemanticDiskIndex, recordBytes } from '../apps/server/src/spatial/semantic-disk-index';
import type { SpatialNearestResult, SpatialRadiusResult, SpatialPoint } from '../apps/server/src/spatial/spatial-page-index';

type HttpResult = { domain: string; independentVerification: boolean; cadVerification: boolean; operation: string };

async function checkSceneQueries() {
  const started = performance.now(), timings: Record<string, number> = {};
  const report: Record<string, unknown> = { status: 'failed' };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Smoke budget exceeded')), 225000);
  const stop = () => controller.abort(new Error('Smoke interrupted'));
  process.once('SIGINT', stop);
  let snapshot: SemanticArtifact | undefined;
  const routes = createDatasetRoutes(process.argv[2] ?? DEFAULT_DATASET_ROOT);
  // No product server, provider, external listener, or global fetch modification.
  const server = createServer((request, response) => {
    void routes(request, response).then(handled => {
      if (!handled) { response.statusCode = 404; response.end(); }
    }).catch(() => { response.statusCode = 500; response.end(); });
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/datasets/toronto3d`;
    const get = async <T>(path = ''): Promise<T> => {
      const response = await fetch(base + path, { signal: controller.signal });
      const value = await response.json();
      assert.equal(response.status, 200, `HTTP ${path.split('?')[0]}: ${JSON.stringify(value)}`);
      return value as T;
    };
    const dataset = await get<DatasetInfo>();
    const summary = await get<{ status: string; artifactRevision: string }>('/preprocessing');
    assert.notEqual(summary.status, 'unavailable', 'Fixed operator preprocessing artifact is unavailable');
    assert.equal(summary.artifactRevision, dataset.revision);
    const artifact = await readPreprocessing(dataset, undefined, controller.signal);
    const surface = createGroundSurface(artifact.ground), ground = artifact.ground, h = ground.cellMeters;
    const supported = ground.cells.find(cell => cell.points >= ground.minimumSupport);
    assert.ok(supported, 'No supported ground cell');
    const center = (x: number, y: number): [number, number] => [(x + .5) * h, (y + .5) * h];
    const observed = center(supported.x, supported.y);
    const queryGround = async (xy: [number, number]) => {
      const expected = surface.elevationAt(...xy);
      const result = await get<{ binding: unknown; ground: unknown; domain: string; independentVerification: boolean; cadVerification: boolean }>(
        '/ground-elevation?' + new URLSearchParams({ revision: dataset.revision, x: String(xy[0]), y: String(xy[1]) }));
      assert.deepEqual(result.binding, artifact.binding); assert.deepEqual(result.ground, expected);
      assert.equal(result.domain, 'original-source-ground');
      assert.equal(result.independentVerification, false); assert.equal(result.cadVerification, false);
      return expected;
    };
    const observedResult = await queryGround(observed); assert.equal(observedResult.status, 'available');
    if (observedResult.status !== 'available') throw new Error('Supported observation unavailable');
    assert.equal(observedResult.elevation, supported.elevation);
    let interpolated: [number, number] | undefined;
    // Midpoint between four adjacent cell centers, only if all corners/slope are accepted.
    for (const cell of ground.cells) {
      const xy: [number, number] = [(cell.x + 1) * h, (cell.y + 1) * h];
      const value = surface.elevationAt(...xy);
      if (value.status === 'available' && value.method === 'cell-center-triangulation-v1') { interpolated = xy; break; }
    }
    if (interpolated) assert.equal((await queryGround(interpolated)).status, 'available');
    const xs = ground.cells.map(cell => cell.x), ys = ground.cells.map(cell => cell.y);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < xs.length; i++) { minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
    const occupied = new Set(ground.cells.map(cell => `${cell.x},${cell.y}`));
    let hole: [number, number] | undefined;
    for (const cell of ground.cells) {
      for (const [x, y] of [[cell.x + 1, cell.y], [cell.x - 1, cell.y], [cell.x, cell.y + 1], [cell.x, cell.y - 1]]) {
        if (x > minX && x < maxX && y > minY && y < maxY && !occupied.has(`${x},${y}`)) { hole = center(x, y); break; }
      }
      if (hole) break;
    }
    assert.ok(hole, 'No interior missing-cell probe found');
    assert.equal((await queryGround(hole)).status, 'unavailable');
    assert.equal((await queryGround(center(maxX + 2, maxY + 2))).status, 'unavailable');
    timings.groundMilliseconds = performance.now() - started;

    snapshot = await SemanticArtifact.open(process.argv[2] ?? DEFAULT_DATASET_ROOT, controller.signal);
    assert.deepEqual(snapshot.dataset, dataset);
    await snapshot.check(controller.signal);
    const { index, cache } = await getSemanticDiskIndex(snapshot, controller.signal);
    await index.check(controller.signal);
    assert.equal(index.hash, artifact.binding.indexHash); assert.equal(index.sourceHash, artifact.binding.sourceHash);
    // Prefer an interior supported square over an edge cell, so radius witnesses are useful.
    const spatialXY = interpolated ?? observed, spatialGround = surface.elevationAt(...spatialXY);
    assert.equal(spatialGround.status, 'available');
    if (spatialGround.status !== 'available') throw new Error('Spatial ground seed unavailable');
    const position: Vec3 = [spatialXY[0], spatialXY[1], spatialGround.elevation + .25];
    const spatial = async <T>(operation: string, extra = {}) => {
      const at = performance.now();
      const result = await get<T & HttpResult>('/spatial-query?' + new URLSearchParams({ request: JSON.stringify({ revision: dataset.revision, operation, position, ...extra }) }));
      timings[`${operation}Milliseconds`] = performance.now() - at;
      assert.equal(result.operation, operation); assert.equal(result.domain, 'original-source-points');
      assert.equal(result.independentVerification, false); assert.equal(result.cadVerification, false);
      return result;
    };
    const nearest = await spatial<SpatialNearestResult>('nearest');
    const radius = await spatial<SpatialRadiusResult>('radius', { radiusMeters: 1, maxResults: 5 });
    const distance = await spatial<SpatialNearestResult & { distanceMeters: number | null }>('point-distance');
    const binding = { artifactRevision: dataset.revision, indexHash: index.hash, sourceHash: index.sourceHash,
      frameId: 'toronto3d-local-v1', units: 'm', coordinates: dataset.coordinates };
    for (const value of [nearest, radius, distance]) {
      assert.equal(value.complete, true); assert.deepEqual(value.binding, binding);
      assert.equal(value.statistics.totalPages, index.pages.length);
    }
    assert.ok(nearest.point); assert.deepEqual(distance.point, nearest.point);
    assert.equal(distance.distanceMeters, nearest.point.distanceMeters);
    assert.equal(radius.maxResults, 5); assert.equal(radius.points.length, Math.min(5, radius.totalCount));
    assert.equal(radius.truncated, radius.totalCount > 5);

    // Independent brute-force distance reduction over EVERY validated disk record page.
    // No SpatialPageIndex methods, page-bound pruning, or full coordinate arrays.
    const auditStarted = performance.now();
    let points = 0, pages = 0, count = 0, best: SpatialPoint | null = null;
    const witnesses = new Map(radius.points.map(point => [point.source.preparedRecordIndex, point]));
    assert.equal(witnesses.size, radius.points.length);
    let matchedWitnesses = 0;
    for (const page of index.pages) {
      controller.signal.throwIfAborted(); assert.equal(page.start, points);
      const bytes = await index.readPage(page, controller.signal); pages++;
      for (let n = 0; n < page.count; n++) {
        const at = n * recordBytes;
        const x = bytes.readDoubleLE(at), y = bytes.readDoubleLE(at + 8), z = bytes.readDoubleLE(at + 16);
        const sourceFileId = bytes.readUInt32LE(at + 24), sourceRow = bytes.readUInt32LE(at + 28);
        const physical = bytes.readUInt32LE(at + 32), label = bytes.readUInt32LE(at + 36);
        if (physical !== page.start + n || sourceFileId < 1 || sourceFileId > 4 || sourceRow >= snapshot.sourceCounts[sourceFileId] || label > 8 ||
          !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('Invalid source record binding');
        const meters = Math.hypot(x - position[0], y - position[1], z - position[2]);
        if (meters <= 1) count++;
        const witness = witnesses.get(physical);
        if (!best || meters < best.distanceMeters || witness) {
          const point: SpatialPoint = { position: [x, y, z], distanceMeters: meters, label,
            source: { sourceFileId, sourceRow, preparedRecordIndex: physical }, artifactRevision: dataset.revision, frameId: 'toronto3d-local-v1', units: 'm' };
          // Ascending physical traversal means equal-distance candidates retain the first physical record.
          if (!best || meters < best.distanceMeters) best = point;
          if (witness) { assert.ok(meters <= 1); assert.deepEqual(witness, point); matchedWitnesses++; }
        }
      }
      points += page.count;
    }
    await snapshot.check(controller.signal); await index.check(controller.signal);
    assert.equal(points, dataset.totalPoints); assert.equal(points, index.totalPoints); assert.equal(pages, index.pages.length);
    assert.equal(matchedWitnesses, witnesses.size); assert.deepEqual(nearest.point, best); assert.equal(radius.totalCount, count);
    timings.exhaustiveAuditMilliseconds = performance.now() - auditStarted;
    Object.assign(report, { status: 'passed', dataset: { id: dataset.id, revision: dataset.revision, points, pages },
      preprocessing: { status: summary.status, groundCells: ground.cells.length },
      ground: { observed, interpolated: interpolated ?? null, interpolationSkipped: !interpolated, hole },
      spatial: { position, radiusMeters: 1, count, retained: radius.points.length, nearest: best,
        statistics: { nearest: nearest.statistics, radius: radius.statistics, pointDistance: distance.statistics } },
      audit: { method: 'exhaustive-disk-pages-direct-Math.hypot-physical-ties', cache, points, pages, matchedWitnesses } });
  } catch (error) {
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown failure';
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); process.off('SIGINT', stop);
    try { await snapshot?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      report.timings = { ...timings, totalMilliseconds: performance.now() - started };
      console.log(JSON.stringify(report, null, 2));
    }
  }
}

await checkSceneQueries();
