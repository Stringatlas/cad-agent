import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScenePreprocessing } from '../apps/server/src/preprocessing/scene-preprocessing';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Preprocessing cancelled'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const started = performance.now();
  try {
    if (process.argv.length !== 5) throw new Error('Usage: prepare-scene-preprocessing.ts DATASET_ROOT INSTANCE_DIRECTORY OUTPUT_DIRECTORY');
    const result = await prepareScenePreprocessing(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4]), { signal: controller.signal });
    console.log(JSON.stringify({ status: 'complete', output: resolve(process.argv[4]), milliseconds: performance.now() - started,
      binding: result.binding, statistics: result.statistics, groundCells: result.ground.cells.length, groundPoints: result.ground.points,
      byLabel: [...new Set(result.instances.map(i => i.label))].map(label => ({ label, instances: result.instances.filter(i => i.label === label).length,
        fitted: result.instances.filter(i => i.label === label && i.fit?.status === 'fitted').length })), memory: process.memoryUsage() }));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', error: String(error) })); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
