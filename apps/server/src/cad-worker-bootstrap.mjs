// Node 22 workers do not inherit tsx's registered loader. Register explicitly in this worker.
import { register } from 'tsx/esm/api';
register();
await import('./cad-worker.ts');
