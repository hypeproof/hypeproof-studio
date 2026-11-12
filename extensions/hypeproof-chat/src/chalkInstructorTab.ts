// #3563 — the Studio chat points an instructor to the Chalk tab when the Chalk runtime
// verified them. The flag is sent only when it is true, so legacy and student configs
// stay byte-identical to what they were before.

export const CHALK_INSTRUCTOR_TAB_COMMAND = "hypeproof.chalk.openInstructorPanel";

// Same rule as resolveInstructorRuntime in chalkContract.ts: only this exact value selects Chalk.
export function chalkInstructorTabField(runtime: unknown, instructor: boolean): { chalkInstructorTab?: true } {
  return runtime === "chalk-extension" && instructor ? { chalkInstructorTab: true } : {};
}
