import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
export const serviceWorkerRoot = dirname(fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/wrangler.toml')));
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
 const part = process.argv[2];
 console.log(part ? fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/' + part)) : serviceWorkerRoot);
}
