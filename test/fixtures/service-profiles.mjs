// Picks the Service profiles a test needs by what they are, not by their IDs.
//
// Customer cohort and profile IDs exist only in the private Service package.
// Studio source must not name them, so tests resolve them at run time from the
// testkit's registry. Pass the test's own `listProfiles` so the selection uses
// the same package copy the test exercises. Each role must match exactly one
// profile; a new profile that makes a role ambiguous fails loudly here instead
// of silently changing what a test covers.
export function serviceProfiles(listProfiles) {
  const all = listProfiles().filter((p) => !p.synthetic);
  const one = (role, test) => {
    const found = all.filter(test);
    if (found.length !== 1) {
      throw new Error(`service profile "${role}": expected exactly one match, found ${found.length}`);
    }
    return found[0];
  };
  const tier = (p) => p.game?.template_tier;
  const ages = (p) => p.audience?.age_range ?? [];

  const kidsLower = one("kids quest, lower grades", (p) => tier(p) === "kids-quest" && ages(p)[1] <= 10);
  const kidsUpper = one("kids quest, upper grades", (p) => tier(p) === "kids-quest" && ages(p)[0] >= 11);
  const searchTeaser = one("search web app teaser", (p) => tier(p) === "search-webapp");
  // The copy-clone profile shares its cohort with the search teaser and is
  // told apart from it by profile ID only.
  const copyclone = one(
    "website copy-clone in the teaser's cohort",
    (p) => tier(p) === "website" && p.session?.cohort_id === searchTeaser.session.cohort_id,
  );

  return {
    kidsLower,
    kidsUpper,
    searchTeaser,
    copyclone,
    kidsCohort: kidsLower.session.cohort_id,
    pilotCohort: copyclone.session.cohort_id,
  };
}
