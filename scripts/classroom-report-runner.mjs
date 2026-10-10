// Compatibility entrypoint; canonical runner belongs to Service.
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export * from '@hypeproof/service-testkit/tools/classroom-report-runner.mjs';
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
 const entry = fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/tools/classroom-report-runner.mjs'));
 const run = spawnSync(process.execPath, ['--import', '@hypeproof/service-testkit/test/harness/loader.mjs', entry, ...process.argv.slice(2)], { stdio:'inherit', env:process.env });
 process.exit(run.status ?? 1);
}
