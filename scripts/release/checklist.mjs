// Release checklist builder (#1608).
// PR numbers → GitHub GraphQL (title, author, body, files, closing issues) → three groups:
//   dependency/deploy — touched Service pins, build/deploy/release workflows, migrations or wrangler config
//   feature           — feat / fix / perf / revert, except ci/build/deps/test/docs scopes
//   automatic         — everything else, including any PR with an explicit "Release manager check: no"
// A dependency/deploy PR that is also a feature is listed under dependency/deploy only.
// "Release manager check: no" overrides title type and paths and forces the PR into automatic (#1869).
import {execFileSync} from 'node:child_process';

export const DEPENDENCY_PATHS = [
  /^config\/service-packages\.json$/,
  /^\.github\/workflows\/(build-|deploy-|verify-unified|release|mirror-release)/,
  /(^|\/)migrations?\//,
  /wrangler(\.[a-z]+)?\.toml$/,
];
const FEATURE_TYPES = new Set(['feat', 'fix', 'perf', 'revert']);
const AUTOMATIC_SCOPES = new Set(['ci', 'build', 'deps', 'deps-dev', 'test', 'tests', 'docs']);

export function parseTitle(title) {
  const m = title.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.*)$/);
  return m ? {type: m[1].toLowerCase(), scope: (m[2] ?? '').toLowerCase(), text: m[3]} : {type: 'other', scope: '', text: title};
}

const PLACEHOLDER = /<[^<>\n]+>/;

// The "Release check" section without the template's guidance comments. null when absent.
export function releaseSection(body = '') {
  const m = body.match(/^#{2,}\s*(?:Release check|릴리스 확인)[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im);
  return m ? m[1].replace(/<!--[\s\S]*?-->/g, '') : null;
}

function field(section, name) {
  const m = section.match(new RegExp(`^\\s*(?:[-*]\\s*)?${name}\\s*:\\s*(.*)$`, 'im'));
  return m ? m[1].trim() : null;
}

// The author's own check: the first line of a "Release check" section (its "How to verify:"
// label dropped), else a filled "manual:" line under Tested. null when absent or still a placeholder.
export function howToCheck(body = '') {
  const section = releaseSection(body);
  if (section && section.trim()) {
    const first = section.trim().split('\n')[0].trim().replace(/^(?:[-*]\s*)?How to verify\s*:\s*/i, '');
    if (first && !PLACEHOLDER.test(first)) return first.slice(0, 160);
  }
  const manual = body.match(/-\s*\[[ xX]\]\s*manual:\s*(.+)/i);
  if (manual && !manual[1].includes('<!--')) return manual[1].trim().slice(0, 160);
  return null;
}

// The author's release manager check decision from the Release check section (#1869). null when absent.
export function managerCheckOf(body = '') {
  const section = releaseSection(body);
  const m = (section && field(section, 'Release manager check') || '').match(/^(yes|no)\b\s*(?:[—–:-]+\s*)?(.*)$/i);
  if (!m) return null;
  return {answer: m[1].toLowerCase(), reason: m[2].trim()};
}

// The author's smoke decision from the Release check section (#1608 follow-up). null when absent.
export function smokeOf(body = '') {
  const section = releaseSection(body);
  const m = (section && field(section, 'Smoke') || '').match(/^(yes|no)\b\s*(?:[—–:-]+\s*)?(.*)$/i);
  if (!m) return null;
  const check = field(section, 'Smoke check');
  return {answer: m[1].toLowerCase(), reason: m[2].trim(), check: check && !PLACEHOLDER.test(check) ? check : null};
}

function smokeLine(smoke) {
  if (!smoke) return '_not given by the author_';
  return `${smoke.answer}${smoke.reason ? ` — ${smoke.reason}` : ''}${smoke.check ? ` (check: ${smoke.check})` : ''}`.slice(0, 200);
}

const linked = item => (item.issues ? ` · closes ${item.issues}` : ' · _no linked issue_');

export function classify(prs) {
  const groups = {dependency: [], features: [], automatic: []};
  const authors = new Set();
  for (const pr of prs) {
    const t = parseTitle(pr.title);
    const files = pr.files?.nodes?.map(f => f.path) ?? [];
    const login = pr.author?.login ?? 'unknown';
    if (!/dependabot/.test(login)) authors.add(login);
    const issues = (pr.closingIssuesReferences?.nodes ?? []).map(i => `#${i.number}`).join(', ');
    const managerCheck = managerCheckOf(pr.body ?? '');
    const item = {...t, number: pr.number, title: pr.title, login, issues, check: howToCheck(pr.body ?? ''), smoke: smokeOf(pr.body ?? ''), managerCheck};
    if (managerCheck?.answer === 'no') {
      groups.automatic.push(item);
    } else {
      const depFiles = files.filter(f => DEPENDENCY_PATHS.some(re => re.test(f)));
      if (depFiles.length) groups.dependency.push({...item, depFiles});
      else if (FEATURE_TYPES.has(t.type) && !AUTOMATIC_SCOPES.has(t.scope)) groups.features.push(item);
      else groups.automatic.push(item);
    }
  }
  return {groups, authors: [...authors].sort()};
}

export function render({groups}) {
  const dependency = groups.dependency.length
    ? groups.dependency.map(d => [
      `- [ ] #${d.number} ${d.title} — @${d.login}${linked(d)}`,
      `  - files: ${d.depFiles.map(f => `\`${f}\``).join(', ')}`,
      `  - how to check: ${d.check ?? '_not given by the author_'}`,
      `  - smoke: ${smokeLine(d.smoke)}`,
    ].join('\n')).join('\n')
    : 'None.';

  const byScope = new Map();
  for (const f of groups.features) {
    const key = f.scope || '(no scope)';
    byScope.set(key, [...(byScope.get(key) ?? []), f]);
  }
  const lines = [];
  if (groups.features.length > 40) {
    const filled = groups.features.filter(f => f.check).length;
    lines.push(`> ${groups.features.length} items, folded by scope. ${filled} of them carry the author's check.\n`);
  }
  for (const [scope, items] of [...byScope.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`<details><summary><b>${scope}</b> — ${items.length}</summary>\n`);
    for (const f of items) {
      lines.push(`- [ ] #${f.number} ${f.title} — @${f.login}${linked(f)}`);
      lines.push(`  - how to check: ${f.check ?? '_not given by the author_'}`);
      lines.push(`  - smoke: ${smokeLine(f.smoke)}`);
    }
    lines.push('\n</details>\n');
  }

  const noCheck = groups.automatic.filter(a => a.managerCheck?.answer === 'no');
  const rest = groups.automatic.filter(a => a.managerCheck?.answer !== 'no');
  const byType = new Map();
  for (const a of rest) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  const autoLines = [];
  if (noCheck.length) {
    autoLines.push('**No release manager check needed:**');
    for (const a of noCheck) autoLines.push(`- #${a.number} ${a.title} — @${a.login}${a.managerCheck.reason ? ` (${a.managerCheck.reason})` : ''}`);
    autoLines.push('');
  }
  if (rest.length) {
    autoLines.push(`<details><summary>${rest.length} PRs</summary>\n`);
    for (const [type, items] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length))
      autoLines.push(`- **${type}** ${items.length}: ${items.map(i => `#${i.number}`).join(' ')}`);
    autoLines.push('\n</details>');
  }
  const automatic = groups.automatic.length ? autoLines.join('\n') : 'None.';

  return {dependency, features: lines.join('\n') || 'None.', automatic};
}

export function fetchPrs(repo, numbers) {
  const [owner, name] = repo.split('/');
  const prs = [];
  for (let i = 0; i < numbers.length; i += 40) {
    const batch = numbers.slice(i, i + 40);
    const fields = batch.map(n => `p${n}: pullRequest(number: ${n}) { number title body author { login }
      files(first: 100) { nodes { path } } closingIssuesReferences(first: 5) { nodes { number } } }`).join('\n');
    const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
    const raw = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], {encoding: 'utf8', maxBuffer: 64 << 20});
    const data = JSON.parse(raw).data.repository;
    for (const n of batch) if (data[`p${n}`]) prs.push(data[`p${n}`]);
  }
  return prs;
}
