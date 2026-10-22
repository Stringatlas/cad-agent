/** Trusted offline CLI: obtain the exact runtime binding rather than reimplement its fingerprint. */
import { resolve } from 'node:path';
import { createPreparedCloudRegistry } from '../apps/server/src/datasets/prepared-cloud';
const directory = resolve(process.argv[2]), id = process.argv[3];
console.log(JSON.stringify(await createPreparedCloudRegistry({ [id]: directory }).open(id).info()));
