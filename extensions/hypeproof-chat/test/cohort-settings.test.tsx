import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
import { ModelControl } from '../webview-ui/src/ModelControl';
import { EffortControl } from '../webview-ui/src/EffortControl';
import type { ChatConfig } from '../src/protocol';

const config = {
  model: 'fixed', cohortSettings: { model: true, effort: true },
  profile: { model_selection: { source: 'profile', choices: [{ alias: 'fixed', id: 'fixed', label: '수업 모델' }] } },
  effort: { value: 'high', allowed: ['high'] },
} as unknown as ChatConfig;
function render(c: ChatConfig, personal = false) {
  return new JSDOM(renderToStaticMarkup(<><ModelControl config={c} streaming={false}/><EffortControl config={c} post={() => {}} personal={personal}/></>)).window.document;
}
for (const personal of [false, true]) {
  const d = render(config, personal);
  const selects = [...d.querySelectorAll('select')];
  assert.equal(selects.length, 2);
  for (const [index, select] of selects.entries()) {
    assert.equal(select.disabled, true, `disabled ${index}`);
    assert.equal(select.getAttribute('aria-disabled'), 'true');
    assert.equal(select.value, index === 0 ? 'fixed' : 'high');
    assert.equal(select.selectedOptions[0].textContent, index === 0 ? '수업 모델' : '깊게');
    const reason = d.getElementById(select.getAttribute('aria-describedby')!);
    assert.ok(reason, 'description belongs to the control');
    assert.equal(reason.textContent?.trim(), '선생님이 정한 설정이에요');
    assert.equal(reason.querySelector('svg')?.getAttribute('data-icon'), 'lock');
    assert.equal(reason.querySelector('svg')?.getAttribute('width'), '20');
    assert.equal(reason.querySelector('svg')?.getAttribute('height'), '20');
    assert.equal(reason.closest('details'), null, 'reason remains readable without opening details');
  }
  assert.equal(new Set(selects.map(s => s.getAttribute('aria-describedby'))).size, 2);
}
// The host can remove the lock on refresh, task/seat switch or reconnect; no component-local latch.
const unlocked = structuredClone(config);
unlocked.cohortSettings = { model: false, effort: false };
unlocked.profile!.model_selection!.choices.push({ alias: 'other', id: 'other', label: '다른 모델' });
unlocked.effort!.allowed.push('low');
for (const c of [unlocked, { ...unlocked, cohortSettings: undefined }]) {
  const d = render(c);
  assert.ok([...d.querySelectorAll('select')].every(s => !s.disabled && !s.hasAttribute('aria-describedby')));
  assert.equal(d.querySelector('[data-icon="lock"]'), null);
  assert.ok(!d.body.textContent?.includes('선생님이 정한 설정이에요'));
}
const personalSingle = render({ ...config, cohortSettings: undefined }, true);
assert.ok([...personalSingle.querySelectorAll('select')].every(s => s.disabled));
assert.equal(personalSingle.querySelector('[data-icon="lock"]'), null, 'single available model is not teacher evidence');
const hostile = structuredClone(config);
hostile.profile!.model_selection!.choices[0].label = '<img src=x onerror=alert(1)>';
const safe = render(hostile);
assert.equal(safe.querySelector('img'), null);
assert.equal(safe.querySelector('option')!.textContent, '<img src=x onerror=alert(1)>');
console.log('cohort settings render OK');

const inconsistent = structuredClone(unlocked);
inconsistent.cohortSettings = { model: true, effort: true };
assert.ok([...render(inconsistent).querySelectorAll('select')].every(s => s.disabled), 'explicit host lock wins until next config');
inconsistent.profile!.model_selection!.choices.reverse();
inconsistent.effort!.allowed.reverse();
const current = [...render(inconsistent).querySelectorAll('select')];
assert.equal(current[0].value, 'fixed', 'current model is selected even when not the first option');
assert.equal(current[1].value, 'high', 'current effort is selected even when not the first option');
const noEffort = render({ ...config, effort: undefined });
assert.equal(noEffort.querySelector('.hps-effort')!.textContent, '', 'missing policy must not leave a stray lock reason');
