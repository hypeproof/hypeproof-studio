// Fails the suite when a Studio launch of this session left anything behind: a
// live process, a temp dir, or a focus violation (scripts/lib/studio-launcher.mjs).
// What is found is cleaned before the failure is reported.
import { verifySession } from "../../scripts/lib/studio-launcher.mjs";

export default async function globalTeardown() {
  const session = process.env.HPS_LAUNCH_SESSION;
  if (!session) return;
  const problems = verifySession(session);
  if (problems.length > 0) {
    throw new Error(`Studio launches left resources behind (now cleaned):\n  ${problems.join("\n  ")}`);
  }
}
