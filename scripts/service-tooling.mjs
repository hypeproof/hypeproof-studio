import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
export const serviceWorkerRoot = dirname(fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/wrangler.toml')));
// Keep developer state outside the immutable package installation: npm ci may
// replace that installation. An explicit path also supports isolated dev kits.
export const serviceDevVars = resolve(process.env.HPS_SERVICE_DEV_VARS || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'hypeproof-studio', 'service.dev.vars'));
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const part = process.argv[2];
 console.log(part === '--dev-vars' ? serviceDevVars : part ? fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/' + part)) : serviceWorkerRoot);
}
