import { readFileSync } from 'node:fs';

// Consumer fixtures contain data only. Server validation and signing execute in
// the independently tested Service repository, never in the App test process.
export const SERVICE_CONTRACT_FIXTURES = JSON.parse(
  readFileSync(new URL('./samples.json', import.meta.url), 'utf8'),
);
