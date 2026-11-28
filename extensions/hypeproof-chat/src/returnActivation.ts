// #4548 — after a completed rehearsal return, the instructor Chalk surface activates once, without a chat view.
// The reopened window ends a return with the outcome "done" (resumeOnActivation). "reloading" means the home folder
// is about to reopen, so the decision waits for that window. Every other outcome leaves the window alone.

/** True only for the outcome that ends a return in the reopened window. */
export function shouldActivateAfterReturn(outcome: string): boolean {
  return outcome === "done";
}

/** Runs the instructor decision once for a completed return. Returns whether it ran. */
export async function activateAfterReturn(provider: { refreshAfterReturn(): Promise<void> }, outcome: string): Promise<boolean> {
  if (!shouldActivateAfterReturn(outcome)) return false;
  await provider.refreshAfterReturn();
  return true;
}
