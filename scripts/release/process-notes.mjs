#!/usr/bin/env node
// Release-process lines in the release notes (#3429), between hps-process:v1 markers.
//
//   gh release view T --json body --jq .body \
//     | node scripts/release/process-notes.mjs --gate-line "$LINE" [--reuse-reason "$REASON"] > notes.md
//
// --gate-line   the publish gate's notes_line: which path let the release out (casebook run,
//               release manager override, or hotfix). Required: a stable publish always has one.
// --reuse-reason the second line of `promote.mjs reuse-acceptance`. When the rc's acceptance was
//               not reused because the public Service changed after it, one line says so.
// Idempotent: a rerun replaces the block instead of adding a second one.
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

export const BEGIN = '<!-- hps-process:v1 -->';
export const END = '<!-- /hps-process:v1 -->';

// "the public Service is service-v2, the rc was accepted against service-v1; acceptance runs."
export function serviceLine(reason = '') {
  const m = String(reason).match(/the public Service is (\S+), the rc was accepted against ([^\s;]+)/);
  return m ? `Acceptance re-ran at publish: the public Service changed from ${m[2]} to ${m[1]} after the rc's acceptance.` : null;
}

export function withProcessLines(body = '', lines = []) {
  let text = String(body ?? '');
  const start = text.indexOf(BEGIN);
  const stop = text.indexOf(END);
  if (start >= 0 && stop > start) text = text.slice(0, start) + text.slice(stop + END.length);
  text = text.trimEnd();
  const kept = lines.filter(Boolean).map(l => `- ${String(l).replace(/\s+/g, ' ').trim()}`);
  if (!kept.length) return `${text}\n`;
  return `${text ? `${text}\n\n` : ''}${BEGIN}\n${kept.join('\n')}\n${END}\n`;
}

function main() {
  const {values} = parseArgs({options: {'gate-line': {type: 'string'}, 'reuse-reason': {type: 'string'}}, strict: true});
  if (!values['gate-line']) { console.error('process-notes: --gate-line is required (the publish gate notes_line)'); process.exit(2); }
  process.stdout.write(withProcessLines(fs.readFileSync(0, 'utf8'), [values['gate-line'], serviceLine(values['reuse-reason'])]));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
