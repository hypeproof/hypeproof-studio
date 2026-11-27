import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeComment } from '../src/annotationLimits.ts';

test('test_tc_0172_zero_width_between_e_and_accent_is_not_composed', () => {
  const out = neutralizeComment('e​́');
  assert.equal(out, 'é');
  assert.notEqual(out, 'é');
  assert.equal(out.length, 2);
});

test('test_tc_0173_fullwidth_a_with_zero_width_becomes_plain_a', () => {
  assert.equal(neutralizeComment('Ａ​'), 'A');
});

test('test_tc_0174_invisible_char_does_not_use_up_the_300_limit', () => {
  const out = neutralizeComment('a'.repeat(299) + '​' + 'b');
  assert.equal(out.length, 300);
  assert.equal(out, 'a'.repeat(299) + 'b');
  assert.equal(out.at(-1), 'b');
});

test('test_tc_0175_exactly_300_kept_and_301_cut_to_300', () => {
  assert.equal(neutralizeComment('a'.repeat(300)), 'a'.repeat(300));
  assert.equal(neutralizeComment('a'.repeat(301)), 'a'.repeat(300));
});

test('test_tc_0176_control_and_bidi_override_characters_are_removed', () => {
  assert.equal(neutralizeComment('a‮b\u0007c'), 'abc');
  assert.equal(neutralizeComment('a\u007fb'), 'ab');
});
