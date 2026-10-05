import type { Profile } from './types';
import { profile as nativeTrial } from './studio-native-trial';

// SYNTHETIC — release acceptance cohort (#1404). No human is ever on this
// roster: `synthetic: true` makes every roster write and token mint on it
// refuse a handle outside the `synthetic-` namespace (lib/synthetic-cohort.ts).
//
// Why it exists: `verify-unified-release.yml` checks the candidate App against
// the public Service in both activities. It used long-lived codes on
// `studio-native-trial`, and neither survives a second release: a trial code's
// one-hour window and request allowance start on first use and a reissue to the
// same handle does not reset them, and a classroom code needs an open session
// that the live-session freeze then reads as a class, blocking the same run's
// publish job and every worker deploy. So acceptance gets its own cohort, mints
// a fresh handle's trial and classroom codes per run, opens and closes its own
// short session, and the freeze ignores this cohort because the worker reports
// it as synthetic. Same pattern as `canary-sdk-contract`; blast radius zero.
//
// FIDELITY IS THE POINT — everything but identity is the trial profile, so the
// candidate App is checked against what a trial or classroom seat on
// `studio-native-trial` is actually served (prompt, models, tools, observation).
// The serving snapshot pins that: this cohort's rows equal the trial's.
const trial = structuredClone(nativeTrial);
export const profile: Profile = {
  ...trial,
  id: 'synthetic-release-acceptance',
  display_name: '내부 합성 — 릴리스 인수 검사',
  synthetic: true,
  // Never offered in the instructor console: this is not a track anyone teaches.
  dashboard_hidden: true,
  session: { ...trial.session, cohort_id: 'synthetic-release-acceptance' },
};
