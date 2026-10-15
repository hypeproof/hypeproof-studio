#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const output = process.argv[2];
const pin = JSON.parse(readFileSync(new URL('./service-harness.json', import.meta.url), 'utf8'));
if (!output || pin.repository !== 'hypeproof/hypeproof-service' || !/^[a-f0-9]{40}$/.test(pin.sha)) {
  throw new Error('invalid hosted recovery Service pin or output path');
}
appendFileSync(output, `sha=${pin.sha}\n`, { encoding: 'utf8', mode: 0o600 });
