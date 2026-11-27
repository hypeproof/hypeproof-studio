// #3563 — the Studio chat points an instructor to the Chalk tab when the Chalk contract verified them.
// The flag is sent only when it is true, so student configs stay byte-identical.
// C-5: the Chalk runtime is the only instructor runtime, so the flag depends on the instructor alone.

export const CHALK_INSTRUCTOR_TAB_COMMAND = "hypeproof.chalk.openInstructorPanel";

export function chalkInstructorTabField(instructor: boolean): { chalkInstructorTab?: true } {
  return instructor ? { chalkInstructorTab: true } : {};
}
