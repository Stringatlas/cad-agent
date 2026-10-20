import { fileURLToPath } from 'node:url';
import type { AreaCandidateSettings, ModelAreaOfInterest } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { searchAreaCandidates } from '../apps/server/src/area-candidate-search';
import { candidateSource, denseGround } from '../tests/fixtures/area-candidate-source';

const settings: AreaCandidateSettings = { spacingMeters: 2, clearanceRadiusMeters: 1, maxGroundReliefMeters: .2, minPoleDistanceMeters: 1, ranking: 'flat-ground' };
const authorities = { pointAuthority: { sessionId: 'benchmark-source-only', revision: 0 }, cadAuthority: { sessionId: 'benchmark-no-cad', revision: 0 } };
const signal = AbortSignal.timeout(180000);
const fixtureStarted = performance.now(), synthetic = await candidateSource(denseGround(100));
const syntheticPreparationMilliseconds = performance.now() - fixtureStarted;
try {
  const result = await searchAreaCandidates(synthetic.snapshot, synthetic.area(100), settings, authorities, signal);
  console.log(JSON.stringify({ benchmark: 'synthetic-100x100m', sourcePoints: synthetic.snapshot.dataset.totalPoints, preparationMilliseconds: syntheticPreparationMilliseconds, result }));
  if (result.status !== 'complete' || result.candidates.length !== 5 || result.evidence.areaPoints !== 120000) process.exitCode = 1;
} finally { await synthetic.close(); }
if (!process.argv.includes('--synthetic-only')) {
  const root = process.argv[2] ?? fileURLToPath(new URL('../data/processed/toronto3d/prepared/', import.meta.url));
  const snapshot = await SemanticArtifact.open(root, signal);
  try {
    const preparationStarted = performance.now(), { index, cache } = await getSemanticDiskIndex(snapshot, signal), preparationMilliseconds = performance.now() - preparationStarted;
    const x = Number(process.env.AREA_BENCH_X ?? 250), y = Number(process.env.AREA_BENCH_Y ?? 400);
    const area: ModelAreaOfInterest = { datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[x,y,0],[x+100,y,0],[x+100,y+100,0],[x,y+100,0]] };
    const result = await searchAreaCandidates(snapshot, area, settings, authorities, signal);
    console.log(JSON.stringify({ benchmark: 'toronto-original-source-100x100m', sourcePoints: index.totalPoints, totalPhysicalPages: index.pages.length, cache, preparationMilliseconds, result }));
    if (result.status !== 'complete') process.exitCode = 1;
  } finally { await snapshot.close(); }
}
