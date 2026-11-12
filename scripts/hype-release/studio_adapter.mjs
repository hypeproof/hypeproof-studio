// Fixed protocol bridge into the reviewed Studio engine; no authority is reimplemented here.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const [root, command] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const load = name => import(pathToFileURL(path.join(root, 'scripts/release', name)).href);
try {
  const {digest} = await load('engine/core.mjs');
  let result;
  if (command === 'discover') {
    const {automationConfig} = await load('machine-publication.mjs');
    const config = automationConfig(JSON.parse(fs.readFileSync(path.join(root, 'config/release-automation.json'), 'utf8')));
    if (config.mode !== 'active') result = {status: 'NOT_APPLICABLE', reason: 'product remains shadow'};
    else {
      const repo = config.repository;
      const get = endpoint => JSON.parse(execFileSync('gh', ['api', '--method', 'GET', `repos/${repo}/${endpoint}`], {encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024}));
      const pulls = []; let page = 1;
      while (true) {
        const rows = get(`pulls?state=open&base=main&per_page=100&page=${page}`); pulls.push(...rows);
        if (rows.length < 100) break;
        if (++page > 10) throw Error('bounded release discovery exceeded');
      }
      const eligible = pulls.filter(p => /^release\/v\d+\.\d+\.\d+$/.test(p.head.ref) && p.labels.some(l => l.name === 'release'));
      eligible.sort((a, b) => {
        const numbers = p => p.head.ref.slice(9).split('.').map(Number), A = numbers(a), B = numbers(b);
        return B.reduce((found, n, i) => found || n - A[i], 0);
      });
      if (!eligible.length) result = {status: 'NOT_APPLICABLE', reason: 'no release PR exists'};
      else {
        if (eligible[1]?.head.ref === eligible[0].head.ref) throw Error('duplicate release PRs need reconciliation');
        const {gatherPromotion, promotionInputs, readImmutableSource} = await load('promote.mjs');
        const facts = gatherPromotion(eligible[0].number, repo), accepted = promotionInputs(facts);
        if (!accepted.allow) throw Error(accepted.reasons.join('; '));
        if (facts.rcTags.some(t => Number(t.name.split('-rc.')[1]) > Number(accepted.rcTag.split('-rc.')[1]))) throw Error('release record is superseded');
        const record = readImmutableSource(repo, `${facts.pr.head}:releases/${accepted.version}.md`);
        const baseline = /\| Range \| `([a-f0-9]{7,40})\.\.[a-f0-9]{7,40}`/.exec(record)?.[1];
        if (!baseline) throw Error('committed release range is missing');
        const comparison = get(`compare/${baseline}...${accepted.candidate}`);
        if (!comparison.commits?.length || comparison.commits.length !== comparison.total_commits || comparison.commits.length > 250) throw Error('complete bounded release range required');
        const sourcePrs = [...new Set(comparison.commits.map(c => /\(#([1-9]\d*)\)$/.exec(c.commit.message.split('\n')[0])?.[1]).filter(Boolean).map(Number))];
        if (!sourcePrs.length) throw Error('explicit source PRs missing from committed release range');
        const rollback = record.split(/^## 7\. Rollback\s*$/m)[1]?.split(/^## /m)[0].trim();
        if (!rollback) throw Error('committed rollback instructions missing');
        const release = get(`releases/tags/${accepted.rcTag}`);
        result = {status: 'RELEASE_CANDIDATE_READY', event: 'release-candidate-ready', releasePr: facts.pr.number,
          releaseHead: facts.pr.head, workflowHead: get('commits/main').sha, config,
          release: {id: release.id, tag_name: release.tag_name, draft: release.draft, prerelease: release.prerelease,
            assets: release.assets.map(a => ({id: a.id, name: a.name, size: a.size, digest: a.digest}))},
          candidate: {repository: repo, sourceSha: accepted.candidate, tag: accepted.rcTag, version: accepted.version,
            sourcePrs, changes: [{before: `Release baseline ${comparison.base_commit.sha}`, after: `Candidate ${accepted.candidate}; committed record ${facts.pr.head}:releases/${accepted.version}.md`}], rollback}};
      }
    }
  } else if (command === 'assemble') {
    const {prepareContext, assemble} = await load('native-producer.mjs');
    const publisherInput = JSON.parse(fs.readFileSync(input.input, 'utf8'));
    const context = prepareContext({input: publisherInput, product: input.product, packages: input.packages, store: input.store});
    result = assemble({input: publisherInput, context, packets: input.packets, packages: input.packages,
      store: input.store, attestorId: input.attestor, privateKey: fs.readFileSync(input.key, 'utf8'), out: input.out});
  } else if (command === 'verify') {
    const {verifyMachineBundle} = await load('machine-publication.mjs');
    const bundle = JSON.parse(fs.readFileSync(path.join(input.directory, 'bundle.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config/release-automation.json'), 'utf8'));
    if (config.mode !== 'active' || digest(config) !== digest(input.product.config)) throw Error('current active product enrollment required');
    const verified = verifyMachineBundle({bundle, config, contract: input.product.contract,
      packageDirectory: input.packages, evidenceDirectory: input.directory, serviceVersion: input.product.contract.service.version});
    if (!verified.allow) throw Error('existing engine refused machine bundle');
    result = {bundleDigest: digest(bundle)};
  } else if (command === 'prepare') {
    const {prepareCurrentProduct} = await load('machine-evidence.mjs');
    result = prepareCurrentProduct(input.pr, input.packages, input.sequence);
  } else throw Error('unsupported fixed Studio adapter command');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({status: 'BLOCKED', reason: error.message})); process.exitCode = 2;
}
