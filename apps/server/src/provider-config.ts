import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { ProviderAuthOptions, ProviderMode } from './provider-auth';

/** This is the only automatically loaded .env file; never use process.cwd(). */
export const SERVER_ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
export interface ServerConfiguration { provider: ProviderAuthOptions; projectPath?: string }

/** Pure merge, no process.env writes. Only the executable entrypoint calls this. */
export function loadServerConfiguration(options: {
  env?: NodeJS.ProcessEnv; envPath?: string; home?: string;
} = {}): ServerConfiguration {
  const envPath = options.envPath ?? SERVER_ENV_PATH;
  let file: NodeJS.ProcessEnv = {};
  let fd: number | undefined;
  try {
    // Reject non-files without blocking on a FIFO before fstat can run.
    fd = openSync(envPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536 || stat.nlink !== 1) throw new Error();
    file = parseEnv(readFileSync(fd, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to read server environment configuration');
  } finally { if (fd !== undefined) closeSync(fd); }
  const env = { ...file, ...(options.env ?? process.env) };
  const mode = env.SPATIAL_PROVIDER_MODE ?? 'disabled';
  if (!['disabled', 'api-key', 'chatgpt'].includes(mode)) throw new Error('Invalid SPATIAL_PROVIDER_MODE');
  const provider: ProviderAuthOptions = { mode: mode as ProviderMode };
  if (mode === 'api-key') {
    const key = env.OPENAI_API_KEY;
    if (!key || key.length > 32_768 || /[\s\u007f]/u.test(key)) throw new Error('API-key mode requires a valid server-side OPENAI_API_KEY');
    provider.apiKey = key;
  }
  if (mode === 'chatgpt') {
    const path = env.SPATIAL_AUTH_PATH || join(options.home ?? homedir(), '.spatial-cad-harness', 'auth', 'credentials.json');
    if (!isAbsolute(path)) throw new Error('SPATIAL_AUTH_PATH must be an absolute path');
    provider.credentialPath = path;
    // The executable server listens on this fixed port. Injected test runtimes can use another port.
    if (env.SPATIAL_AUTH_REDIRECT_URI && env.SPATIAL_AUTH_REDIRECT_URI !== 'http://127.0.0.1:3001/auth/callback') {
      throw new Error('SPATIAL_AUTH_REDIRECT_URI must match http://127.0.0.1:3001/auth/callback');
    }
    provider.redirectUri = 'http://127.0.0.1:3001/auth/callback';
  }
  const projectPath = env.SPATIAL_PROJECT_PATH;
  return { provider, ...(projectPath ? { projectPath } : {}) };
}
