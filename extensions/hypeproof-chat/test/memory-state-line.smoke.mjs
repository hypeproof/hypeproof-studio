// CGP-KNOW-D-022 (DES-KNOW-40) — the memory state line "AI 기억: 켜짐" with the memory folder, as the host serves it in the
// chat config: present exactly where the seat has the memory store (personal and trial activities, minors and every cohort
// included, DEC-02), absent for class, lesson, instructor and unknown seats; the same words everywhere, no off value, no
// "선생님이 정해요", and no profile field can change it (there is no switch). The real provider and task store (VS Code stubbed).
//   node --experimental-strip-types test/memory-state-line.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MEMORY_FOLDER_LABEL, MEMORY_STATE_LABEL } from '../src/activityMemoryView.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-state-line-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, game: { template_tier: 'website' } };

try {
  const work = path.join(top, 'activity'); fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  const record = f.connections.active;
  const as = (seat, fn) => {
    const saved = { profile: h.cachedProfile, record: f.connections.active, instructor: h._instructorMode };
    h.cachedProfile = seat.profile;
    if (seat.record) f.connections.active = seat.record;
    if (seat.instructor) h._instructorMode = { isInstructor: true };
    try { return fn(); } finally { h.cachedProfile = saved.profile; f.connections.active = saved.record; h._instructorMode = saved.instructor; }
  };

  await t('copy: one fixed line, the state and the folder; no off wording, no teacher wording', () => {
    assert.equal(MEMORY_STATE_LABEL, 'AI 기억: 켜짐');
    assert.equal(MEMORY_FOLDER_LABEL, '.hypeproof/memory/');
    const view = fs.readFileSync(new URL('../src/activityMemoryView.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(view, /AI 기억: 꺼짐|선생님이 정해요/, 'no off state and no teacher wording exist to show');
  });

  await t('seats: every cohort with the store gets the same line, minors included; profile fields that look like a switch change nothing', () => {
    for (const [label, profile, rec] of [
      ['adult personal', PERSONAL],
      ['trial', { ...PERSONAL, activity_kind: 'trial' }, { ...record, kind: 'trial' }],
      ['minor cohort', { ...PERSONAL, minor_cohort: true, game: { template_tier: 'kids' } }],
      ['teen tier', { ...PERSONAL, game: { template_tier: 'teen' } }],
      ['unknown tier', { ...PERSONAL, game: undefined }],
      ['a "memory off" field', { ...PERSONAL, memory: { enabled: false }, ai_memory: false, memory_enabled: false }],
      ['a teacher-decides field', { ...PERSONAL, memory: { decided_by: 'instructor' } }],
    ]) {
      as({ profile, record: rec }, () => assert.equal(JSON.stringify(h.memoryStateView), JSON.stringify({ folder: MEMORY_FOLDER_LABEL }), label));
    }
  });

  await t('seats: no store, no line (class, lesson, enforced binding, instructor, no profile)', () => {
    for (const [label, seat] of [
      ['classroom profile', { profile: { ...PERSONAL, activity_kind: 'classroom' } }],
      ['activity made as a class', { profile: PERSONAL, record: { ...record, kind: 'classroom' } }],
      ['lesson served now', { profile: { ...PERSONAL, lesson: { sha256: 'abc', content: { steps: [] } } } }],
      ['enforced lesson binding', { profile: { ...PERSONAL, lesson_binding: { enforced: true } } }],
      ['instructor', { profile: PERSONAL, instructor: true }],
      ['no profile loaded', { profile: null }],
    ]) as(seat, () => assert.equal(h.memoryStateView, undefined, label));
  });

  await t('config: the posted chat config carries the line exactly where the getter does', async () => {
    const source = fs.readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
    assert.match(source, /\.\.\.\(!isInstructor && this\.memoryStateView \? \{ memoryState: this\.memoryStateView \} : \{\}\)/, 'the config reads the getter (secondary: source)');
    // No setting anywhere turns memory off.
    const contributes = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).contributes ?? {};
    const settings = [contributes.configuration ?? []].flat().flatMap(c => Object.keys(c.properties ?? {}));
    assert.deepEqual(settings.filter(key => /memor|기억/i.test(key)), [], 'no memory setting');
  });

  console.log(`memory state line: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
