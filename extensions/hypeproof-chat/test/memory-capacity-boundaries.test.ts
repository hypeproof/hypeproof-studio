import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryCapacity, memoryCleanupCount } from '../src/activityMemoryView.ts';

test('test_tc_0181_levels_split_at_89_90_100_of_100', () => {
  assert.equal(memoryCapacity(89, 100).level, 'ok');
  assert.equal(memoryCapacity(90, 100).level, 'near');
  assert.equal(memoryCapacity(99, 100).level, 'near');
  assert.equal(memoryCapacity(100, 100).level, 'full');
});

test('test_tc_0182_limit_15_rounds_near_threshold_up', () => {
  assert.equal(memoryCapacity(13, 15).level, 'ok');
  assert.equal(memoryCapacity(14, 15).level, 'near');
});

test('test_tc_0183_invalid_limit_is_treated_as_one', () => {
  assert.deepEqual(memoryCapacity(0, 0), { used: 0, limit: 1, level: 'ok', percent: 0 });
  assert.equal(memoryCapacity(1, 0).level, 'full');
  assert.equal(memoryCapacity(0, -4).limit, 1);
  assert.equal(memoryCapacity(0, 2.5).limit, 1);
});

test('test_tc_0184_used_is_floored_to_non_negative_integer', () => {
  assert.equal(memoryCapacity(-5, 100).used, 0);
  assert.equal(memoryCapacity(2.7, 100).used, 2);
});

test('test_tc_0185_percent_is_rounded_and_capped_at_100', () => {
  assert.equal(memoryCapacity(1, 3).percent, 33);
  assert.equal(memoryCapacity(2, 3).percent, 67);
  assert.equal(memoryCapacity(150, 100).percent, 100);
});

test('test_tc_0186_cleanup_count_returns_to_80_percent_min_one', () => {
  assert.equal(memoryCleanupCount(90, 100), 10);
  assert.equal(memoryCleanupCount(80, 100), 1);
  assert.equal(memoryCleanupCount(100, 15), 88);
});
