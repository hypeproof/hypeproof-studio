// Controls for the release-process lines in the release notes (#3429). No network.
//   node --test scripts/release/test/process-notes.test.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {BEGIN, END, serviceLine, withProcessLines} from '../process-notes.mjs';

const script = fileURLToPath(new URL('../process-notes.mjs', import.meta.url));
const GATE = 'Release casebook: hps-blackbox-run/1 result on #3422 (v2026.1103.0-rc.3) passed all 9 P0 cases.';

test('serviceLine: only a Service change produces the line', () => {
  assert.equal(serviceLine('the public Service is service-v2026.11.03-1, the rc was accepted against service-v2026.11.02-2; acceptance runs.'),
    "Acceptance re-ran at publish: the public Service changed from service-v2026.11.02-2 to service-v2026.11.03-1 after the rc's acceptance.");
  assert.equal(serviceLine('no published rc release at this commit; acceptance runs.'), null);
  assert.equal(serviceLine(''), null);
  assert.equal(serviceLine(undefined), null);
});

test('withProcessLines appends one block and is idempotent', () => {
  const body = '## Install\n\ncurl ...\n';
  const once = withProcessLines(body, [GATE, null]);
  assert.equal(once, `## Install\n\ncurl ...\n\n${BEGIN}\n- ${GATE}\n${END}\n`);
  const twice = withProcessLines(once, [GATE, 'Acceptance re-ran at publish: x']);
  assert.equal(twice.split(BEGIN).length, 2);
  assert.match(twice, /- Acceptance re-ran at publish: x\n/);
  assert.equal(withProcessLines('', [GATE]), `${BEGIN}\n- ${GATE}\n${END}\n`);
});

test('CLI: refuses without a gate line, writes the block with one', () => {
  const none = spawnSync(process.execPath, [script], {input: 'body', encoding: 'utf8'});
  assert.equal(none.status, 2);
  const ok = spawnSync(process.execPath, [script, '--gate-line', GATE, '--reuse-reason', 'the public Service is s2, the rc was accepted against s1; acceptance runs.'],
    {input: 'body\n', encoding: 'utf8'});
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^body\n\n<!-- hps-process:v1 -->\n- Release casebook: .*\n- Acceptance re-ran at publish: the public Service changed from s1 to s2/);
});
