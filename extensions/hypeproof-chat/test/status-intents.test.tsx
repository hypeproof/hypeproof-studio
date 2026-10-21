// CGP-DS-R-006 (REQ-CGP-DS-05) — status is expressed as named intents. Every status family Studio draws
// (source state, task run, delegation, product test, help request) maps each of its states to Korean
// words, a stroke icon and one named intent, and every render site draws that as the one status chip.
// The CSS half (one edge pattern per intent, so a grayscale capture separates the intents; forced
// colours; one outer height) is check 6 of test/status-chip.smoke.mjs.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { ChatIcon } from '../webview-ui/src/ChatDetails';
import {
  DELEGATION_CHIPS, STATUS_CHIPS, STATUS_INTENTS, TASK_RUN_CHIPS, VERDICT_CHIPS, VERIFY_CHIPS, helpChip, verdictChip, verifyChip, type StatusChipView,
} from '../webview-ui/src/statusChipLogic';
import { TASK_RUN_STATE_LABELS } from '../src/taskRunState';
import { DELEGATION_STATUS_LABEL, type DelegationView } from '../src/delegationRow';
import { STATUS_LABEL as HELP_STATUS_LABEL, cardOf, type HelpView } from '../src/classroomHelp';
import { DelegationRow } from '../webview-ui/src/DelegationRow';
import { HelpRequest } from '../webview-ui/src/HelpRequest';
import { VerifyPanel } from '../webview-ui/src/VerifyPanel';
import { TaskWorkspace } from '../webview-ui/src/TaskWorkspace';

const HANGUL = /[가-힣]/;
const FOUR = ['info', 'caution', 'danger', 'success'];
let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok   ${name}`); };

/** The drawn shape of an icon kind: its paths/circles/rects, as a grayscale capture would see it. */
const shapeOf = (kind: StatusChipView['icon']) => {
  const svg = renderToStaticMarkup(<ChatIcon kind={kind} size={16} />);
  return svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
};

const HELP_STATES = Object.keys(HELP_STATUS_LABEL);
const FAMILIES: Record<string, Record<string, StatusChipView>> = {
  source_state: STATUS_CHIPS,
  task_run: TASK_RUN_CHIPS,
  delegation: DELEGATION_CHIPS,
  verify: VERIFY_CHIPS,
  verdict: VERDICT_CHIPS,
  help: Object.fromEntries([...HELP_STATES, 'withdrawn'].map((s) => [s, helpChip(s, HELP_STATUS_LABEL[s] ?? '상태 확인 불가')])),
};

t('the intents: info / caution / danger / success, plus neutral for "no evidence yet"', () => {
  assert.deepEqual([...STATUS_INTENTS].sort(), [...FOUR, 'neutral'].sort());
});

t('every state of every family: Korean words, a drawn icon, a named intent', () => {
  for (const [family, chips] of Object.entries(FAMILIES)) {
    for (const [state, chip] of Object.entries(chips)) {
      assert.match(chip.label, HANGUL, `${family}.${state}: Korean label`);
      assert.ok(chip.label.trim().length >= 2, `${family}.${state}: label is words, not a mark`);
      assert.ok(shapeOf(chip.icon).length > 10, `${family}.${state}: icon ${chip.icon} draws nothing`);
      assert.ok(STATUS_INTENTS.includes(chip.intent), `${family}.${state}: intent ${chip.intent}`);
    }
  }
});

t('grayscale: within a family no two states share an icon shape or words', () => {
  for (const [family, chips] of Object.entries(FAMILIES)) {
    const shapes = Object.values(chips).map((c) => shapeOf(c.icon));
    const words = Object.values(chips).map((c) => c.label);
    assert.equal(new Set(shapes).size, shapes.length, `${family}: two states draw the same icon`);
    assert.equal(new Set(words).size, words.length, `${family}: two states read the same`);
  }
});

t('the families are complete: every state their source knows has a chip', () => {
  assert.deepEqual(Object.keys(TASK_RUN_CHIPS).sort(), Object.keys(TASK_RUN_STATE_LABELS).sort());
  for (const [s, c] of Object.entries(TASK_RUN_CHIPS)) {
    const src = TASK_RUN_STATE_LABELS[s as keyof typeof TASK_RUN_STATE_LABELS];
    assert.deepEqual([c.label, c.icon], [src.label, src.icon], `task_run.${s}: words and icon come from taskRunState.ts`);
  }
  assert.deepEqual(Object.keys(DELEGATION_CHIPS).sort(), Object.keys(DELEGATION_STATUS_LABEL).sort());
  for (const [s, c] of Object.entries(DELEGATION_CHIPS)) assert.equal(c.label, DELEGATION_STATUS_LABEL[s as keyof typeof DELEGATION_STATUS_LABEL]);
  assert.deepEqual(Object.keys(VERIFY_CHIPS).sort(), ['failed', 'incomplete', 'needs_recheck', 'not_verified', 'verified']);
});

t('severity reads right: failures are danger, waiting on the learner is caution, finished is success', () => {
  const want: Array<[string, string, string]> = [
    ['task_run', 'error', 'danger'], ['task_run', 'approval', 'caution'], ['task_run', 'done', 'success'], ['task_run', 'running', 'info'], ['task_run', 'stopped', 'neutral'],
    ['delegation', 'failed', 'danger'], ['delegation', 'done', 'success'], ['delegation', 'running', 'info'], ['delegation', 'stopped', 'neutral'],
    ['verify', 'failed', 'danger'], ['verify', 'verified', 'success'], ['verify', 'needs_recheck', 'caution'], ['verify', 'incomplete', 'caution'], ['verify', 'not_verified', 'neutral'],
    ['verdict', 'pass', 'success'], ['verdict', 'fail', 'danger'], ['verdict', 'warning', 'caution'], ['verdict', 'not_verified', 'neutral'], ['verdict', 'non_reproducible', 'danger'],
    ['help', 'answered', 'caution'], ['help', 'resolved', 'success'], ['help', 'received', 'info'], ['help', 'reviewing', 'info'], ['help', 'withdrawn', 'neutral'],
    ['source_state', 'real', 'success'], ['source_state', 'unverified', 'neutral'],
  ];
  for (const [f, s, intent] of want) assert.equal(FAMILIES[f]![s]!.intent, intent, `${f}.${s}`);
  // Every one of the four status intents is spoken by some family.
  const used = new Set(Object.values(FAMILIES).flatMap((c) => Object.values(c).map((x) => x.intent)));
  for (const i of STATUS_INTENTS) assert.ok(used.has(i), `${i} is never used`);
});

t('hostile or unknown states never read as a good one', () => {
  for (const odd of ['__proto__', 'constructor', 'toString', 'VERIFIED', 'verified\u202e', '', 3, null, undefined]) {
    assert.equal(verifyChip(odd), VERIFY_CHIPS.not_verified, `verify ${String(odd)}`);
    assert.equal(verdictChip(odd), VERDICT_CHIPS.not_verified, `verdict ${String(odd)}`);
    const h = helpChip(odd, '상태 확인 불가');
    assert.deepEqual([h.intent, h.icon, h.label], ['neutral', 'help', '상태 확인 불가'], `help ${String(odd)}`);
  }
  // The help chip keeps the card's words; it never invents a reassuring one.
  assert.equal(helpChip('resolved', '해결됐다고 내가 확인함').label, '해결됐다고 내가 확인함');
});

/** One status chip in markup: class, data-status, data-intent, a 16px hidden icon, then the words. */
const chipRe = (cls: string, status: string, chip: StatusChipView) => new RegExp(
  `<span [^>]*class="hp-status-chip ${cls}"[^>]* data-status="${status}" data-intent="${chip.intent}"><svg [^>]*width="16" height="16"[^>]*data-icon="${chip.icon}"[^>]*aria-hidden="true">(?:(?!</svg>)[\\s\\S])*</svg><span class="hp-status-chip-label">${chip.label.replace(/[()]/g, '\\$&')}</span></span>`,
);

t('product test panel: the verification state is the chip of its intent, with its test hooks', () => {
  for (const state of Object.keys(VERIFY_CHIPS)) {
    const view = { available: true, reason: null, version: 'v', verification: { state, open: [] }, report: null, held: [], run: null, proposals: [], running: false, notice: null } as any;
    const html = renderToStaticMarkup(<VerifyPanel view={view} error={null} busy={false} onStart={() => {}} onRetest={() => {}} onFix={() => {}} onClose={() => {}} />);
    const chip = VERIFY_CHIPS[state as keyof typeof VERIFY_CHIPS];
    assert.match(html, chipRe(`hps-verify-state hps-verify-state-${state}`, state, chip), `verify ${state}`);
    assert.match(html, new RegExp(`data-testid="verify-status" data-state="${state}"`), `verify ${state}: e2e hooks kept`);
  }
  // Each criterion's verdict is a chip too; an unknown verdict reads 확인 안 됨, never its raw token.
  const crit = (id: string, status: string) => ({ id, text: `${id} 조건`, status, method: 'dom', reproducible: true, steps: [], cites: [], expectations: [], errors: [], result_ref: id, test_ref: id, test_kind: 'test_observed' });
  const statuses = [...Object.keys(VERDICT_CHIPS), 'mystery'];
  const report = { format: 'hps-verification/1', run_id: 'r', artifact_version_id: 'v', tested_at: new Date(0).toISOString(), viewport: { width: 800, height: 600 }, criteria: statuses.map((s) => crit(s, s)), runtime_errors: [], network_errors: [], screenshots: [], steps: [] };
  const view = { available: true, reason: null, version: 'v', verification: { state: 'failed', open: [] }, report, held: [], run: null, proposals: [], running: false, notice: null } as any;
  const html = renderToStaticMarkup(<VerifyPanel view={view} error={null} busy={false} onStart={() => {}} onRetest={() => {}} onFix={() => {}} onClose={() => {}} />);
  for (const s of statuses) assert.match(html, chipRe('hps-verify-badge', s, verdictChip(s)), `verdict ${s}`);
  assert.doesNotMatch(html, />mystery</, 'a raw verdict token is drawn');
});

t('delegation row: the status is the chip of its intent and stays a live region', () => {
  for (const status of Object.keys(DELEGATION_CHIPS)) {
    const view: DelegationView = { id: 'd1', helper: '조사 도우미', task: '자료 찾기', result: null, status: status as DelegationView['status'], children: [] };
    const html = renderToStaticMarkup(<DelegationRow view={view} renderChild={() => null} />);
    const chip = DELEGATION_CHIPS[status as keyof typeof DELEGATION_CHIPS];
    assert.match(html, chipRe('hps-delegation-status', status, chip), `delegation ${status}`);
    assert.match(html, /<span role="status" class="hp-status-chip hps-delegation-status"/, `delegation ${status}: role=status kept`);
  }
});

t('help request card: every status (and an unknown one) is the chip of its intent with the card words', () => {
  const now = 1_800_000_000;
  const shares = [...HELP_STATES, 'withdrawn'].map((status, n) => ({ id: `h${n}`, session_id: 's', status, revision: 1, recipient_id: 'teacher', created_at: now, expires_at: now + 3600, content: { question: '질문' }, feedback: '', next_action: '' }));
  const cards = shares.map(cardOf);
  const view = { generation: 1, draft_key: 'c|p|u|r', availability: { state: 'unknown' }, seat: null, draft: { question: '', turnId: null, duration: 60 }, turns: [], envelope: null, current: cards, history: [], refresh: { state: 'ok', at: now }, note: null } as unknown as HelpView;
  const html = renderToStaticMarkup(<HelpRequest view={view} post={() => {}} />);
  for (const c of cards) {
    const chip = helpChip(c.status, c.label);
    assert.match(html, chipRe('hp-help-status', c.status, chip), `help ${c.status}`);
  }
  assert.equal(cards.at(-1)!.label, '상태 확인 불가');
});

t('task heading: the live run note draws the run state as the same intent chip as the rail', () => {
  const view = { scope: 's', revision: 1, activeTaskId: 'a', sourceSelection: null, tasks: [{ id: 'a', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 1 }] } as any;
  for (const [runState, shown] of [['approval', 'approval'], ['running', 'running'], ['preparing', 'running']] as const) {
    const html = renderToStaticMarkup(<TaskWorkspace view={view} messages={[]} busy runState={runState} error={null} onDismissError={() => {}}><p>대화</p></TaskWorkspace>);
    const note = /<span class="tw-run-note" role="status"[^>]*>([\s\S]*?)<\/span><button[^>]*tw-sources-toggle/.exec(html)?.[1] ?? '';
    assert.match(note, chipRe('tw-run-chip', shown, TASK_RUN_CHIPS[shown]), `heading ${runState}`);
    assert.match(note, /<span class="tw-run-help">입니다\./, `heading ${runState}: the sentence for screen readers stays`);
  }
  const idle = renderToStaticMarkup(<TaskWorkspace view={view} messages={[]} busy={false} runState={null} error={null} onDismissError={() => {}}><p>대화</p></TaskWorkspace>);
  assert.match(idle, /<span class="tw-run-note" role="status" aria-live="polite"><\/span>/, 'idle: the live region is empty');
});

console.log(`status-intents: ${passed} passed`);
