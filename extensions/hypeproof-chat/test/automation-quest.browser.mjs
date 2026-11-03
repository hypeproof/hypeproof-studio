import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createQuest, renderQuestHtml, transitionQuest } from '../src/automationQuest.ts';
const e2eRequire = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium } = e2eRequire('@playwright/test');
const out = process.env.HPS_QUEST_EVIDENCE_DIR || '/tmp/hps-email-mvp/quest-graph';
await mkdir(out, { recursive: true });
let quest = createQuest({ title: '자료 요청 메일 자동화', nodes: [
  { id: 'goal', label: '업무 정하기', description: '자료 종류와 마감일을 확인합니다.', dependsOn: [] },
  { id: 'read', label: '시트 읽기', description: '연결한 계정으로 명단을 확인합니다.', dependsOn: ['goal'] },
  { id: 'draft', label: '메일 초안', description: '메일 내용을 다시 확인해 주세요.', dependsOn: ['goal'] },
  { id: 'grant', label: '구글 실행 설정', description: '구글 프로젝트 연결 설정이 필요합니다.', dependsOn: ['goal'] },
  { id: 'code', label: '코드 작성', description: '질문에 답하며 실행 흐름을 구체화합니다. 요청할 자료와 회신 방법, 마감일을 확인하고 수신자마다 알맞은 메일을 준비합니다. 작성한 코드는 구글에서 실행되며 발송 전에는 내용을 직접 확인할 수 있습니다.', dependsOn: ['goal'] },
  { id: 'run', label: '확인 후 실행', description: '앞 단계가 확인되면 실행 내용을 보여드립니다.', dependsOn: ['read', 'draft', 'grant', 'code'] },
] });
quest = transitionQuest(transitionQuest(quest, 'goal', 'running'), 'goal', 'succeeded');
quest = transitionQuest(quest, 'read', 'running');
quest = transitionQuest(transitionQuest(quest, 'draft', 'running'), 'draft', 'failed');
quest = transitionQuest(quest, 'grant', 'blocked');
const html = renderQuestHtml(quest);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const network = [], errors = [];
page.on('request', request => network.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
const results = [];
try {
  for (const [width, height] of [[1280, 800], [360, 540], [320, 540]]) {
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    assert.equal(await page.locator('.node').count(), 6);
    assert.equal(await page.locator('.edge').count(), 8);
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '17');
    for (const status of ['pending', 'current', 'running', 'succeeded', 'failed', 'blocked'])
      assert.equal(await page.locator(`.node.${status}`).count(), 1, `distinct ${status} state remains visible`);
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.node')];
      const markers = [...document.querySelectorAll('.node-marker')];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        edges: [...document.querySelectorAll('.edge')].map(edge => {
          const box = edge.getBoundingClientRect();
          const source = document.querySelector(`[data-node-id="${edge.dataset.from}"]`).getBoundingClientRect();
          const target = document.querySelector(`[data-node-id="${edge.dataset.to}"]`).getBoundingClientRect();
          return { start: Math.abs(box.top - source.top - 32), end: Math.abs(box.bottom - target.top - 32) };
        }),
        cards: cards.map((card, index) => {
          const box = card.getBoundingClientRect(), marker = markers[index].getBoundingClientRect();
          const label = card.querySelector('h2'), description = card.querySelector('p');
          return { width: box.width, readable: label.scrollWidth <= label.clientWidth && description.scrollHeight <= description.clientHeight,
            connectorOffset: Math.abs(marker.top + marker.height / 2 - box.top - 32),
            overlapsNext: index < cards.length - 1 && box.bottom > cards[index + 1].getBoundingClientRect().top };
        }),
      };
    });
    assert.equal(geometry.overflow, false, 'the algorithm graph must fit a narrow preview');
    assert(geometry.cards.every(card => card.readable && card.width >= 180 && !card.overlapsNext));
    assert(geometry.cards.every(card => card.connectorOffset <= 1.5), 'step markers align with dependency paths');
    assert(geometry.edges.every(edge => edge.start < 1 && edge.end < 1), 'dependency edges follow variable-height cards without losing either endpoint');
    await page.locator('.node').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.node').last().isVisible(), true, 'later steps remain reachable by scrolling');
    await page.screenshot({ path: `${out}/graph-${width}.png`, fullPage: true });
    results.push({ width, height, pass: true, geometry });
  }
  assert.deepEqual(network, [], 'rendering never contacts external services');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ pass: true, scope: 'static quest HTML in actual Chromium; synthetic host states; not native Studio acceptance', results }, null, 2));
  console.log('PASS automation quest: 1280/360/320px geometry, six distinct states, readable cards, dependency edges, scroll and no network');
} finally { await browser.close(); }
