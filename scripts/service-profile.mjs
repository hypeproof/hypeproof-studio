// Prints the ID of a Service profile or cohort by role, read from the private
// Service testkit registry. Studio source does not name customer cohorts, so
// scripts that need a default profile or cohort ask this helper.
//
// Usage (from the repository root, after the Service packages are installed):
//   node --import @hypeproof/service-testkit/test/harness/loader.mjs \
//     --experimental-strip-types --no-warnings scripts/service-profile.mjs <role>
// Roles: kids-lower, kids-upper, search-teaser, copyclone, kids-cohort, pilot-cohort
import { serviceProfiles } from '../test/fixtures/service-profiles.mjs';

const { listProfiles } = await import('@hypeproof/service-testkit/src/profiles/index.ts');
const sp = serviceProfiles(listProfiles);
const roles = {
  'kids-lower': sp.kidsLower.id,
  'kids-upper': sp.kidsUpper.id,
  'search-teaser': sp.searchTeaser.id,
  copyclone: sp.copyclone.id,
  'kids-cohort': sp.kidsCohort,
  'pilot-cohort': sp.pilotCohort,
};
const role = process.argv[2];
if (!(role in roles)) {
  console.error(`usage: service-profile.mjs <${Object.keys(roles).join('|')}>`);
  process.exit(2);
}
console.log(roles[role]);
