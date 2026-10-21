// Read-only actual-data assessment plus independent exhaustive page oracle. No provider calls or edits.
// node --import tsx scripts/check-utility-box-placement.ts [prepared-dataset-directory]
import assert from 'node:assert/strict';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/datasets/dataset-routes';
import { SemanticArtifact } from '../apps/server/src/spatial/semantic-artifact';
import { loadPreparedSemanticDiskIndex, recordBytes } from '../apps/server/src/spatial/semantic-disk-index';
import { SpatialPageIndex } from '../apps/server/src/spatial/spatial-page-index';
import { readPreprocessing } from '../apps/server/src/preprocessing/preprocessing-summary';
import { assessUtilityBox, type UtilityBoxAssessment } from '../apps/server/src/placement/utility-box-placement';
async function main() {
  const signal = AbortSignal.timeout(180000), snapshot = await SemanticArtifact.open(process.argv[2] ?? DEFAULT_DATASET_ROOT, signal);
  try {
    const index = await loadPreparedSemanticDiskIndex(snapshot, signal); assert.ok(index, 'Prepared index required');
    const spatial = await SpatialPageIndex.create(snapshot, index, signal), terrain = await readPreprocessing(snapshot.dataset, undefined, signal);
    let assessment: Extract<UtilityBoxAssessment, { status: 'assessed' }> | undefined, attempts = 0;
    const started = performance.now();
    for (const cell of terrain.ground.cells) {
      if (cell.points < terrain.ground.minimumSupport) continue;
      if (++attempts > 100) break;
      const nearest = await spatial.nearest([(cell.x + .5) * terrain.ground.cellMeters, (cell.y + .5) * terrain.ground.cellMeters, cell.elevation], { signal, maxMilliseconds: 10000 });
      if (!nearest.point) continue;
      const p = nearest.point;
      const result = await assessUtilityBox(snapshot, { name: 'Point 1', artifactRevision: snapshot.dataset.revision, key: p.source, position: p.position },
        { pointName: 'Point 1', dimensions: [1.2, .6, 1.5], frontAccessMeters: 1 }, signal);
      if (result.status === 'assessed') { assessment = result; break; }
    }
    assert.ok(assessment, 'No supported full-preset placement in first 100 seeds');
    const assessedMilliseconds = performance.now() - started, auditStarted = performance.now();
    const volumes = [assessment.body, assessment.access!];
    const oracle = volumes.map(() => ({ total: 0, support: 0, labels: Array<number>(9).fill(0), witnesses: 0 }));
    let checkedPoints = 0;
    // No BVH, page bounds, radius, or model reductions: every record, every inclusive coordinate test.
    for (const page of index.pages) {
      const bytes: Buffer = await index.readPage(page, signal);
      for (let n = 0; n < page.count; n++) {
        checkedPoints++; const at = n * recordBytes;
        const xyz: number[] = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)], label = bytes.readUInt32LE(at + 36);
        for (let v = 0; v < volumes.length; v++) {
          const volume = volumes[v], result = oracle[v];
          if (!xyz.every((c, axis) => c >= volume.bounds.min[axis] && c <= volume.bounds.max[axis])) continue;
          result.total++; result.labels[label]++;
          if ((label === 1 || label === 2) && xyz[2] <= assessment.baseElevation + .1) result.support++;
          const witness = volume.points.find(p => p.source.preparedRecordIndex === page.start + n);
          if (witness) {
            assert.deepEqual(witness.position, xyz); assert.equal(witness.label, label);
            assert.equal(witness.source.sourceFileId, bytes.readUInt32LE(at + 24)); assert.equal(witness.source.sourceRow, bytes.readUInt32LE(at + 28)); result.witnesses++;
          }
        }
      }
    }
    assert.equal(checkedPoints, snapshot.dataset.totalPoints);
    volumes.forEach((v, i) => { const o = oracle[i]; assert.equal(v.totalCount, o.total); assert.equal(v.supportingGroundCount, o.support);
      assert.equal(v.obstructionCount, o.total - o.support); assert.deepEqual(v.countsByLabel, o.labels); assert.equal(o.witnesses, v.points.length); });
    await snapshot.check(signal); await index.check(signal);
    console.log(JSON.stringify({ status: 'passed', checkedPoints, checkedPages: index.pages.length, attempts, assessedMilliseconds,
      oracleMilliseconds: performance.now() - auditStarted, assessment }, null, 2));
  } finally { await snapshot.close(); }
}
main().catch(() => { console.error('Utility placement audit failed; no result certified.'); process.exitCode = 1; });
