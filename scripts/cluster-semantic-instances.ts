import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { prepareSemanticInstances, DEFAULT_INSTANCE_CLASSES, type InstanceClass, type InstanceOptions } from '../apps/server/src/preprocessing/semantic-instances';

export function parseInstanceArguments(args: readonly string[]) {
  if (args.length < 2 || (args.length - 2) % 2) throw new Error('Usage: cluster-semantic-instances.ts DATASET_ROOT NEW_OUTPUT_DIR [--classes 6:0.25,7:0.5,8:0.35] [--max-cells N] [--max-output-bytes N] [--max-manifest-bytes N] [--max-ms N]');
  const options: { classes: readonly InstanceClass[]; limits: NonNullable<InstanceOptions['limits']> } = { classes: DEFAULT_INSTANCE_CLASSES, limits: {} };
  const seen = new Set<string>();
  for (let i = 2; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1]; if (seen.has(flag)) throw new Error(`Duplicate option ${flag}`); seen.add(flag);
    if (flag === '--classes') {
      options.classes = value.split(',').map(part => {
        if (!/^(4|6|7|8):(?:\d+(?:\.\d+)?|\.\d+)$/.test(part)) throw new Error('Invalid --classes; expected label:voxelMeters');
        const [label, voxelMeters] = part.split(':').map(Number); return { label: label as InstanceClass['label'], voxelMeters };
      });
    } else {
      const name = ({ '--max-cells': 'maxCells', '--max-output-bytes': 'maxMembershipBytes', '--max-manifest-bytes': 'maxManifestBytes', '--max-ms': 'maxMilliseconds' } as const)[flag as '--max-cells'];
      if (!name || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`Invalid option ${flag}`);
      Object.assign(options.limits, { [name]: Number(value) });
    }
  }
  return { datasetRoot: resolve(args[0]), output: resolve(args[1]), options };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), abort = () => controller.abort(new Error('Instance clustering cancelled'));
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const start = performance.now();
  try {
    const { datasetRoot, output, options } = parseInstanceArguments(process.argv.slice(2));
    const manifest = await prepareSemanticInstances(datasetRoot, output, { ...options, signal: controller.signal });
    console.log(JSON.stringify({ status: 'complete', output, instances: manifest.instances.length, ...manifest.statistics,
      milliseconds: performance.now() - start, peakRSSBytes: process.resourceUsage().maxRSS * 1024 }));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', error: String(error), cancelled: controller.signal.aborted })); process.exitCode = 1; }
  finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
