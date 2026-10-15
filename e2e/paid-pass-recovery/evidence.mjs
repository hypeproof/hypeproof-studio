import fs from 'node:fs';
import path from 'node:path';

export const EVIDENCE_ALLOWLIST = [
  'receipt.json', 'failure.json', 'cleanup-failure.json', 'gateway.log', 'result.json',
  'grant-before.json', 'grant-during.json', 'grant-after.json',
  'service/api-evidence.json', 'service/grant-evidence.json',
];

const files = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath ?? entry.path, entry.name)) : [];

export function assertNoKnownSecrets(directory, secrets) {
  const known = secrets.filter(value => typeof value === 'string' && value.length >= 8);
  for (const file of files(directory)) {
    const value = fs.readFileSync(file, 'utf8');
    if (known.some(secret => value.includes(secret)) || /sk-ant-[\w-]+/.test(value) || /Bearer\s+(?!\[REDACTED\])[^\s"']+/i.test(value)) {
      throw new Error(`secret-like value found in evidence: ${path.relative(directory, file)}`);
    }
  }
}

export function stageEvidence(source, destination, secrets) {
  assertNoKnownSecrets(source, secrets);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of EVIDENCE_ALLOWLIST) {
    const from = path.join(source, relative);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destination, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  assertNoKnownSecrets(destination, secrets);
}
