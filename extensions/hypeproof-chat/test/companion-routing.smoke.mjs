import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCompanionRoute, COMPANION_CAPABILITIES } from '../src/companionRouting.ts';

const fixture = (capability = 'build_web') => ({
  request: { workspaceId: 'workspace-a', projectId: 'quiz-a', version: 3, capability },
  context: { workspaceId: 'workspace-a', projectId: 'quiz-a', version: 3,
    access: 'active', host: 'online', allowedCapabilities: [...COMPANION_CAPABILITIES] },
});

test('DMC-T04: distinguish local interaction, host execution and desktop continuation without granting authority', () => {
  const expected = { read_cached: 'local_mobile', edit_draft: 'local_mobile',
    create_web: 'host_execution', build_web: 'host_execution', edit_desktop: 'desktop_handoff' };
  for (const [capability, route] of Object.entries(expected)) {
    const input = fixture(capability), original = structuredClone(input);
    const result = planCompanionRoute(input);
    assert.equal(result.route, route);
    assert.equal(result.executionAuthorized, false);
    assert.deepEqual(input, original, 'planning cannot modify workspace or request');
  }
  assert.equal(planCompanionRoute({ ...fixture(), context: null }).route, 'setup_required');
});

test('DMC-T05: offline/unknown host preserves local work but never implies background or cloud execution', () => {
  for (const host of ['offline', 'unknown']) {
    for (const capability of COMPANION_CAPABILITIES) {
      const input = fixture(capability); input.context.host = host;
      const result = planCompanionRoute(input);
      assert.equal(result.route, ['read_cached', 'edit_draft'].includes(capability) ? 'local_mobile' : 'wait_for_host');
      assert.equal(result.executionAuthorized, false);
    }
  }
  const expired = fixture(); expired.context.access = 'expired';
  assert.equal(planCompanionRoute(expired).route, 'renew_connection');
  expired.request.capability = 'edit_draft';
  assert.equal(planCompanionRoute(expired).route, 'local_mobile');
});

test('DMC-T07/T12: foreign scope, revoked/denied capabilities and changed versions cannot turn into a desktop workaround', () => {
  for (const capability of COMPANION_CAPABILITIES) {
    for (const host of ['online', 'offline']) {
      for (const mutate of [
        i => { i.request.workspaceId = 'other-workspace'; },
        i => { i.request.projectId = 'other-project'; },
        i => { i.context.access = 'revoked'; },
        i => { i.context.allowedCapabilities = []; },
      ]) {
        const input = fixture(capability); input.context.host = host; mutate(input);
        assert.equal(planCompanionRoute(input).route, 'denied');
      }
    }
  }
  for (const v of [2, 4]) {
    const input = fixture(); input.request.version = v;
    assert.equal(planCompanionRoute(input).route, 'review_version');
  }
});

test('DMC-T12: malformed and unknown inputs fail closed without reading files, exposing paths or accepting new tools', () => {
  for (const mutate of [
    i => { i.request.capability = 'shell'; }, i => { i.context.host = 'probably-online'; },
    i => { i.context.access = 'admin'; }, i => { i.context.allowedCapabilities = ['shell']; },
    i => { i.context.allowedCapabilities = null; }, i => { i.request.version = NaN; },
    i => { i.request.version = -1; }, i => { i.request.version = 1.5; },
    i => { i.request.workspaceId = '../../private'; }, i => { i.context.projectId = ''; },
    i => { i.context.version = Infinity; }, i => { delete i.context; },
  ]) {
    const input = fixture(); mutate(input);
    const result = planCompanionRoute(input);
    assert.equal(result.route, 'denied'); assert.equal(result.executionAuthorized, false);
    assert.equal(JSON.stringify(result).includes('../../private'), false);
  }
  for (const input of [null, undefined, {}, { request: null }]) {
    assert.equal(planCompanionRoute(input).route, 'denied');
  }
});
