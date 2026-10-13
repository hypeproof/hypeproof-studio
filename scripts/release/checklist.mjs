// Release checklist builder (#1608).
// PR numbers → GitHub GraphQL (title, author, body, files, closing issues) → three groups:
//   dependency/deploy — touched Service pins, build/deploy/release workflows, migrations or wrangler config
//   feature           — feat / fix / perf / revert, except ci/build/deps/test/docs scopes
//   automatic         — everything else (chore, ci, build, docs, test, refactor, dependency updates)
// A dependency/deploy PR that is also a feature is listed under dependency/deploy only.
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

// The author's own check: a "Release check" section, else a filled "manual:" line under Tested. null when absent.
export function howToCheck(body = '') {
  const section = body.match(/^#{2,}\s*(?:Release check|릴리스 확인)[^\n]*\n([\s\S]*?)(?=\n#{2,}\s|$)/im);
  if (section && section[1].trim()) return section[1].trim().split('\n')[0].slice(0, 160);
  const manual = body.match(/-\s*\[[ xX]\]\s*manual:\s*(.+)/i);
  if (manual && !manual[1].includes('<!--')) return manual[1].trim().slice(0, 160);
  return null;
}

export function classify(prs) {
  const groups = {dependency: [], features: [], automatic: []};
  const authors = new Set();
  for (const pr of prs) {
    const t = parseTitle(pr.title);
    const files = pr.files?.nodes?.map(f => f.path) ?? [];
    const login = pr.author?.login ?? 'unknown';
    if (!/dependabot/.test(login)) authors.add(login);
    const issues = (pr.closingIssuesReferences?.nodes ?? []).map(i => `#${i.number}`).join(', ');
    const item = {...t, number: pr.number, title: pr.title, login, issues, check: howToCheck(pr.body ?? '')};
    const depFiles = files.filter(f => DEPENDENCY_PATHS.some(re => re.test(f)));
    if (depFiles.length) groups.dependency.push({...item, depFiles});
    else if (FEATURE_TYPES.has(t.type) && !AUTOMATIC_SCOPES.has(t.scope)) groups.features.push(item);
    else groups.automatic.push(item);
  }
  return {groups, authors: [...authors].sort()};
}

export function render({groups}) {
  const dependency = groups.dependency.length
    ? groups.dependency.map(d => `- [ ] #${d.number} ${d.title} — @${d.login}\n  - files: ${d.depFiles.map(f => `\`${f}\``).join(', ')}`).join('\n')
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
      lines.push(`- [ ] #${f.number} ${f.title} — @${f.login}${f.issues ? ` · closes ${f.issues}` : ''}`);
      lines.push(`  - how to check: ${f.check ?? '_not given by the author_'}`);
    }
    lines.push('\n</details>\n');
  }

  const byType = new Map();
  for (const a of groups.automatic) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  const automatic = groups.automatic.length
    ? [`<details><summary>${groups.automatic.length} PRs</summary>\n`,
      ...[...byType.entries()].sort((a, b) => b[1].length - a[1].length)
        .map(([type, items]) => `- **${type}** ${items.length}: ${items.map(i => `#${i.number}`).join(' ')}`),
      '\n</details>'].join('\n')
    : 'None.';

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
