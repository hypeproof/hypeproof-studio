// Release casebook loader (docs/operations/release-casebook/, REQ-STUDIO-RELEASE-CASEBOOK).
//
// journeys.yaml and cases.yaml are read without a YAML dependency: release-cut runs on a bare
// runner with no npm install. The parser below accepts the subset those two files use and
// throws on anything else, so a file it cannot read fails loudly instead of being half-read:
//   - block mappings and block sequences (two-space indentation, "- key: value" items)
//   - plain, "double-quoted" (JSON escapes) and 'single-quoted' scalars
//   - flow sequences of scalars: [a, "b c"]
//   - literal block scalars: key: |
//   - full-line comments (# ...). A plain value containing " #" or ": " must be quoted.
// null/~, true/false and integers are typed; every other plain scalar is a string.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const CASEBOOK_DIR = fileURLToPath(new URL('../../docs/operations/release-casebook/', import.meta.url));
export const PRIORITIES = ['P0', 'P1', 'P2'];
export const ORIGINS = ['design', 'escaped-bug'];
export const STATUSES = ['active', '자동화됨'];
// Requirement id families a case may link (REQ-, TUX-, US-, PRA- plus NAT-, AB- and CGP- from the
// requirement docs). select-cases.mjs extracts touched ids with the same pattern.
export const REQ_ID = /\b(?:REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*|TUX-[A-Z0-9]+(?:-[A-Z0-9]+)*|US-\d{2,}|PRA-\d{2,}|NAT-\d{2,}|AB-\d{2,}|CGP-[A-Z]+-R-\d{3})\b/g;

function scalar(raw, where) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new Error(`${where}: unterminated double-quoted scalar`);
    return JSON.parse(s);
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error(`${where}: unterminated single-quoted scalar`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[')) return flow(s, where);
  // Other YAML readers turn these into a comment or a date object; quoting keeps every reader equal.
  if (s.startsWith('#')) throw new Error(`${where}: quote a value that starts with # ("${s}")`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${where}: quote the date "${s}"`);
  if (/ #|: /.test(s)) throw new Error(`${where}: quote a value containing " #" or ": " ("${s.slice(0, 30)}")`);
  if (/^(yes|no|on|off|y|n)$/i.test(s)) throw new Error(`${where}: quote "${s}" (a YAML 1.1 boolean elsewhere)`);
  if (/^[{&*!%@`|>]/.test(s)) throw new Error(`${where}: unsupported YAML construct "${s.slice(0, 20)}"`);
  return s;
}

function flow(s, where) {
  if (!s.endsWith(']')) throw new Error(`${where}: unterminated flow sequence`);
  const body = s.slice(1, -1).trim();
  if (!body) return [];
  const items = [];
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur);
      cur = '';
    } else if (ch === '[' || ch === '{') {
      throw new Error(`${where}: nested flow collections are not supported`);
    } else {
      cur += ch;
    }
  }
  if (quote) throw new Error(`${where}: unterminated quote in flow sequence`);
  items.push(cur);
  return items.map(i => scalar(i, where));
}

// Splits "key: rest" at the first ": " (or a trailing ":"), outside quotes.
function keyValue(text) {
  const m = text.match(/^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/);
  return m ? {key: m[1], rest: m[2] ?? ''} : null;
}

export function parseYaml(src, name = 'yaml') {
  const lines = src.replace(/\r\n/g, '\n').split('\n').map((text, i) => ({text, no: i + 1}));
  for (const l of lines) if (/^\s*\t/.test(l.text)) throw new Error(`${name}:${l.no}: tab indentation`);
  let i = 0;
  const indentOf = t => t.match(/^ */)[0].length;
  const skip = () => {
    while (i < lines.length && (/^\s*$/.test(lines[i].text) || /^\s*#/.test(lines[i].text))) i++;
  };

  function block(indent) {
    skip();
    if (i >= lines.length) return null;
    const first = lines[i].text;
    if (indentOf(first) !== indent) throw new Error(`${name}:${lines[i].no}: expected indentation ${indent}`);
    return first.slice(indent).startsWith('- ') || first.slice(indent) === '-' ? seq(indent) : map(indent);
  }

  function literal(parentIndent) {
    const out = [];
    let ind = null;
    while (i < lines.length) {
      const t = lines[i].text;
      if (/^\s*$/.test(t)) { out.push(''); i++; continue; }
      const n = indentOf(t);
      if (n <= parentIndent) break;
      if (ind === null) ind = n;
      if (n < ind) throw new Error(`${name}:${lines[i].no}: literal block dedent`);
      out.push(t.slice(ind));
      i++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  // value after "key:" on the same line, or a nested block below it.
  function value(rest, indent, no) {
    if (rest === '|') return literal(indent);
    if (rest !== '') return scalar(rest, `${name}:${no}`);
    skip();
    if (i >= lines.length) return null;
    const n = indentOf(lines[i].text);
    // A sequence may sit at the same indentation as its key ("key:\n- a").
    if (n > indent || (n === indent && lines[i].text.slice(n).startsWith('- '))) return block(n);
    return null;
  }

  function map(indent, seed) {
    const obj = {};
    const put = (key, v, no) => {
      if (Object.hasOwn(obj, key)) throw new Error(`${name}:${no}: duplicate key "${key}"`);
      obj[key] = v;
    };
    if (seed) put(seed.key, seed.v, seed.no);
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const {text, no} = lines[i];
      const n = indentOf(text);
      if (n < indent) break;
      if (n > indent) throw new Error(`${name}:${no}: unexpected indentation`);
      if (text.slice(n).startsWith('- ')) break;
      const kv = keyValue(text.slice(n));
      if (!kv) throw new Error(`${name}:${no}: expected "key: value"`);
      i++;
      put(kv.key, value(kv.rest, indent, no), no);
    }
    return obj;
  }

  function seq(indent) {
    const arr = [];
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const {text, no} = lines[i];
      const n = indentOf(text);
      if (n < indent) break;
      if (n > indent) throw new Error(`${name}:${no}: unexpected indentation`);
      const after = text.slice(n);
      if (!after.startsWith('- ') && after !== '-') break;
      const item = after.slice(2);
      i++;
      const kv = keyValue(item);
      if (kv && !/^["']/.test(item)) {
        // "- key: value" opens a mapping whose further keys sit at indent + 2.
        const v = value(kv.rest, n + 2, no);
        arr.push(map(n + 2, {key: kv.key, v, no}));
      } else if (item.trim() === '') {
        arr.push(block(n + 2));
      } else {
        arr.push(scalar(item, `${name}:${no}`));
      }
    }
    return arr;
  }

  const doc = block(0);
  skip();
  if (i < lines.length) throw new Error(`${name}:${lines[i].no}: trailing content`);
  return doc;
}

// Structural checks. Returns a list of problems; empty means the casebook is usable.
export function validateCasebook({journeys, cases}) {
  const problems = [];
  const journeyIds = new Set();
  if (!Array.isArray(journeys) || journeys.length === 0) problems.push('journeys: empty');
  for (const j of journeys ?? []) {
    if (!/^CUJ-\d+$/.test(j?.id ?? '')) problems.push(`journey ${j?.id}: id must be CUJ-<n>`);
    if (journeyIds.has(j.id)) problems.push(`journey ${j.id}: duplicate`);
    journeyIds.add(j.id);
    for (const f of ['title', 'goal']) if (!j[f]) problems.push(`journey ${j.id}: missing ${f}`);
  }
  const caseIds = new Set();
  if (!Array.isArray(cases) || cases.length === 0) problems.push('cases: empty');
  for (const c of cases ?? []) {
    const at = `case ${c?.id}`;
    if (!/^BB-\d{3}$/.test(c?.id ?? '')) problems.push(`${at}: id must be BB-<nnn>`);
    if (caseIds.has(c.id)) problems.push(`${at}: duplicate`);
    caseIds.add(c.id);
    if (!journeyIds.has(c.journey)) problems.push(`${at}: unknown journey ${c.journey}`);
    if (!PRIORITIES.includes(c.priority)) problems.push(`${at}: priority must be one of ${PRIORITIES.join('/')}`);
    if (!c.title) problems.push(`${at}: missing title`);
    if (!Array.isArray(c.requirements) || c.requirements.length === 0) problems.push(`${at}: requirements must list at least one id`);
    for (const r of c.requirements ?? []) {
      if (typeof r !== 'string' || !new RegExp(`^${REQ_ID.source}$`).test(r)) problems.push(`${at}: requirement "${r}" is not a known id form`);
    }
    if (!Array.isArray(c.steps) || c.steps.length === 0 || c.steps.some(s => typeof s !== 'string' || !s)) problems.push(`${at}: steps must be non-empty strings`);
    if (!Array.isArray(c.expect) || c.expect.length === 0 || c.expect.some(s => typeof s !== 'string' || !s)) problems.push(`${at}: expect must be non-empty strings`);
    const o = c.origin;
    if (!o || !ORIGINS.includes(o.kind)) problems.push(`${at}: origin.kind must be design or escaped-bug`);
    else if (o.kind === 'escaped-bug') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? '')) problems.push(`${at}: escaped-bug origin needs date YYYY-MM-DD`);
      if (!o.ref) problems.push(`${at}: escaped-bug origin needs ref (the fix PR or issue)`);
    }
    if (c.status !== undefined && !STATUSES.includes(c.status)) problems.push(`${at}: status must be one of ${STATUSES.join('/')}`);
    if (c.status === '자동화됨' && !c.automated_by) problems.push(`${at}: 자동화됨 needs automated_by`);
  }
  return problems;
}

export function loadCasebook(dir = CASEBOOK_DIR) {
  const read = f => parseYaml(fs.readFileSync(path.join(dir, f), 'utf8'), f);
  const journeys = read('journeys.yaml')?.journeys ?? [];
  const cases = read('cases.yaml')?.cases ?? [];
  const book = {journeys, cases};
  const problems = validateCasebook(book);
  if (problems.length) throw new Error(`release casebook is invalid:\n- ${problems.join('\n- ')}`);
  return book;
}
