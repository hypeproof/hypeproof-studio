// Curriculum Runtime switch (CR-02, recon R3). Pure and vscode-free.
//
// One flag, `curriculum_runtime.enabled`, served on the cohort profile by the Service
// (/v1/profile). Absent or anything but `true` is off. The App mirrors it to the context
// key below so `package.json` can hide and disable CR commands, and every CR command
// handler re-checks the served profile, because a command can be executed without its
// menu. No setting, environment variable or build flag turns it on.
//
// `CR_SURFACES` is the CR-T02 switch-off inventory: every CR command, MCP tool, proxy
// tool, webview message and Worker route. Each later `cr-*` item appends its own
// surfaces here, and `test/cr-switch.smoke.mjs` walks the whole list with the switch off
// and on. A surface that is not listed is not checked, so listing is not optional.
//
// One exception is listed too, under `switchOffWhileStored` (CR-02's carve-out, MC-27 and
// Jay's decision 6 "a delete action exists"): the command that deletes the browser-result
// bytes an earlier switch-on stored stays reachable with the switch off while the signed-in
// person has bytes stored, and is hidden when they have none. It shows nothing of the
// results, only a count. `manifestStoredOnlyProblems` checks it is gated on exactly that.

export const CR_CONTEXT_KEY = "hypeproof-chat.curriculumRuntimeEnabled";

/** Context key: the signed-in person has browser-result bytes stored (CR-10). Never the CR switch. */
export const CR_BYTES_CONTEXT_KEY = "hypeproof-chat.crBrowserBytesStored";

/**
 * Context key (cr-review, CR-51/CR-53): the stored issuer token directs at least one cohort whose
 * profile has the CR switch on. A director signs in with an issuer token and has no served
 * student profile, so the switch reaches the App through the Service instead: the key is true
 * only while `GET /v1/curriculum/director/projects` answers that token (every CR route answers
 * the unknown route while the switch is off for all of the director's profiles, CR-02). The
 * director's commands are gated on this key exactly as the student's are on CR_CONTEXT_KEY.
 */
export const CR_DIRECTOR_CONTEXT_KEY = "hypeproof-chat.curriculumRuntimeDirector";
/** How often the App asks the Service again for CR_DIRECTOR_CONTEXT_KEY while the key is on: the longest the director's palette entry can outlive the switch. */
export const CR_DIRECTOR_REPROBE_MS = 5 * 60_000;

/** The five Experiment Browser tool names shared by both coach runtimes (CR-04, CR-06). */
export const CR_BROWSER_TOOL_NAMES = [
  "browser_observe",
  "browser_select",
  "browser_scroll",
  "browser_hover",
  "browser_reload",
] as const;
export type CrBrowserToolName = (typeof CR_BROWSER_TOOL_NAMES)[number];

export const isCrBrowserTool = (name: string): name is CrBrowserToolName =>
  (CR_BROWSER_TOOL_NAMES as readonly string[]).includes(name);

/** The AI Verify tool names shared by both coach runtimes (cr-verify; CR-12–CR-16). */
export const CR_VERIFY_TOOL_NAMES = ["verify_criterion", "verify_propose_criteria"] as const;
export type CrVerifyToolName = (typeof CR_VERIFY_TOOL_NAMES)[number];

export const isCrVerifyTool = (name: string): name is CrVerifyToolName =>
  (CR_VERIFY_TOOL_NAMES as readonly string[]).includes(name);

/** Workshop tiers; mirrors WORKSHOP_TIERS in sdkCoachHelpers.ts and curriculumRuntimeAllowed in the Worker. */
const CR_TIERS = new Set(["search-webapp", "website"]);

/**
 * Is the switch on for this served profile? Anything but an explicit `true` is off.
 *
 * It is also the App's one test for every CR surface (the SDK grant, element pick, the CR
 * executor, the context key): on only for the served switch and a web-app workshop tier,
 * fail-closed on an unknown or missing tier. It mirrors the Worker's
 * curriculumRuntimeAllowed. Age does not decide it (2026-10-05).
 */
export function isCurriculumRuntimeEnabled(
  profile: { curriculum_runtime?: { enabled?: unknown } | null; game?: { template_tier?: unknown } | null } | null | undefined,
): boolean {
  if (profile?.curriculum_runtime?.enabled !== true) return false;
  return CR_TIERS.has(String(profile.game?.template_tier ?? ""));
}

export interface CrSurfaceInventory {
  /** VS Code command ids contributed by package.json, gated on CR_CONTEXT_KEY. */
  commands: readonly string[];
  /** The director's command ids (cr-review), gated on CR_DIRECTOR_CONTEXT_KEY: the switch as the Service answers the issuer token. */
  directorCommands: readonly string[];
  /** Full SDK MCP tool names (`mcp__hypeproof__…`). */
  mcpTools: readonly string[];
  /** Proxy tool names the Worker injects (worker/src/lib/browser-tools.ts). */
  proxyTools: readonly string[];
  /** Webview → host message types that only exist for CR. */
  webviewMessages: readonly string[];
  /** Worker routes as `METHOD /path` (`<test-origin>` for the published runtime). `cr-browser` and `cr-verify` add none. */
  workerRoutes: readonly string[];
  /**
   * The allowed exception: commands that delete what an earlier switch-on stored. Shown
   * (switch on or off) only while CR_BYTES_CONTEXT_KEY is true, hidden otherwise.
   */
  switchOffWhileStored: readonly string[];
}

/** The published test runtime's routes, on a test origin (cr-publish; recon §6). */
export const CR_TEST_ORIGIN_ROUTE = "GET <test-origin>/l/:link/*";
/** The participant snippet opens the visit's session here, once (CR-21). */
export const CR_TEST_ORIGIN_SESSION_ROUTE = "POST <test-origin>/l/:link/__hp/session";
/** The participant snippet's events go here (cr-evidence; CR-23). */
export const CR_TEST_ORIGIN_EVENTS_ROUTE = "POST <test-origin>/l/:link/__hp/events";

export const CR_SURFACES: CrSurfaceInventory = {
  // cr-verify adds "Test my product" (CR-12); cr-publish adds "Publish for user test" (CR-17);
  // cr-evidence adds the experiment evidence panel (CR-24–CR-27, CR-69); cr-memory the Venture Memory panel (CR-35–CR-38);
  // cr-skills the curriculum skills panel (CR-43–CR-47); cr-review the Weekly Review (CR-48–CR-50).
  commands: ["hypeproof-chat.pickElement", "hypeproof-chat.browserResults", "hypeproof-chat.testMyProduct", "hypeproof-chat.publishTestVersion", "hypeproof-chat.experimentEvidence", "hypeproof-chat.ventureMemory", "hypeproof-chat.curriculumSkills", "hypeproof-chat.weeklyReview"],
  // cr-review: the director's review screen and four-team overview (CR-50, CR-51, CR-53).
  directorCommands: ["hypeproof-chat.weeklyReviewDirector"],
  mcpTools: [...CR_BROWSER_TOOL_NAMES, ...CR_VERIFY_TOOL_NAMES].map((n) => `mcp__hypeproof__${n}`),
  proxyTools: [...CR_BROWSER_TOOL_NAMES, ...CR_VERIFY_TOOL_NAMES],
  webviewMessages: ["annotationAction", "removeElementContext", "styleTweakSet", "verifyOpen", "verifyStart", "verifyRetest", "verifyFix", "verifyPark", "verifyResume", "publishOpen", "publishSubmit", "publishLink", "publishRevoke", "evidenceOpen", "evidenceNote", "evidenceDraft", "evidenceReview", "evidenceDelete", "memoryOpen", "memoryDiff", "memoryDecision", "skillsOpen", "skillRun", "reviewOpen", "reviewPrepare", "reviewDirectorOpen", "reviewDecision"],
  // cr-verify adds no Worker route. cr-publish adds the Publish for User Test routes
  // (worker/src/routes/curriculum.ts `CURRICULUM_ROUTES`) and the test origin's.
  workerRoutes: [
    "GET /v1/curriculum/projects",
    "POST /v1/curriculum/projects",
    "GET /v1/curriculum/projects/:id",
    "PUT /v1/curriculum/projects/:id/members",
    "PUT /v1/curriculum/projects/:id/versions/:digest",
    "POST /v1/curriculum/experiments",
    "GET /v1/curriculum/experiments/:id/channels",
    "POST /v1/curriculum/experiments/:id/links",
    "POST /v1/curriculum/links/:id/revoke",
    CR_TEST_ORIGIN_ROUTE,
    CR_TEST_ORIGIN_SESSION_ROUTE,
    // cr-evidence: participant evidence, manual records, drafts, deletion, and the admin's cohort controls.
    "GET /v1/curriculum/experiments/:id/evidence",
    "POST /v1/curriculum/experiments/:id/notes",
    "POST /v1/curriculum/experiments/:id/drafts",
    "POST /v1/curriculum/experiments/:id/drafts/:draft/review",
    "DELETE /v1/curriculum/experiments/:id",
    "DELETE /v1/curriculum/experiments/:id/sessions/:sid",
    CR_TEST_ORIGIN_EVENTS_ROUTE,
    "GET /admin/curriculum/cohorts/:cohort/controls",
    "PUT /admin/curriculum/cohorts/:cohort/controls",
    // cr-memory: Venture Memory reads (member or in-scope director), the director's project list, and the team's writes.
    "GET /v1/curriculum/projects/:id/memory",
    "GET /v1/curriculum/projects/:id/memory/diff",
    "GET /v1/curriculum/director/projects",
    "PUT /v1/curriculum/projects/:id/problem",
    "POST /v1/curriculum/projects/:id/hypotheses",
    "POST /v1/curriculum/projects/:id/hypotheses/:hid/revisions",
    "POST /v1/curriculum/projects/:id/stakeholders",
    "POST /v1/curriculum/experiments/:id/stakeholder",
    "POST /v1/curriculum/projects/:id/metrics",
    "POST /v1/curriculum/projects/:id/decisions",
    "POST /v1/curriculum/decisions/:id/version",
    "PUT /v1/curriculum/projects/:id/slides/:n",
    // cr-skills: the skill registry and one run's prepare and output gate.
    "GET /v1/curriculum/skills",
    "POST /v1/curriculum/projects/:id/skills/:skill/prepare",
    "POST /v1/curriculum/projects/:id/skills/:skill/output",
    // cr-review: the Weekly Review Pack (open, prepare, commit), the director's decision and overview.
    "GET /v1/curriculum/projects/:id/review",
    "POST /v1/curriculum/projects/:id/review/prepare",
    "POST /v1/curriculum/projects/:id/review/commit",
    "POST /v1/curriculum/projects/:id/review/decision",
    "GET /v1/curriculum/reviews",
  ],
  switchOffWhileStored: ["hypeproof-chat.clearBrowserResultBytes"],
};

interface ManifestCommand {
  command?: string;
  enablement?: string;
}
interface ManifestMenuItem {
  command?: string;
  when?: string;
}
export interface ExtensionManifestLike {
  contributes?: {
    commands?: ManifestCommand[];
    menus?: Record<string, ManifestMenuItem[] | undefined>;
  };
}

/**
 * Which inventory commands the manifest would show or run with the switch off.
 *
 * A command passes only when its `enablement` requires the context key and every menu
 * entry for it (the command palette included, which needs an explicit entry) has a `when`
 * that requires it too. Returns the problems; empty means the manifest gates every one.
 * `key` is CR_CONTEXT_KEY for the student's commands and CR_DIRECTOR_CONTEXT_KEY for the
 * director's (`CR_SURFACES.directorCommands`).
 */
export function manifestSwitchProblems(
  manifest: ExtensionManifestLike,
  commands: readonly string[] = CR_SURFACES.commands,
  key: string = CR_CONTEXT_KEY,
): string[] {
  const problems: string[] = [];
  const requiresKey = (expr: string | undefined): boolean => {
    if (!expr) return false;
    // The key must be a required conjunct: `a && key`, never `a || key` or `!key`.
    if (/\|\|/.test(expr)) return false;
    return expr
      .split("&&")
      .map((part) => part.trim())
      .some((part) => part === key);
  };
  const declared = manifest.contributes?.commands ?? [];
  const menus = manifest.contributes?.menus ?? {};
  for (const id of commands) {
    const cmd = declared.find((c) => c.command === id);
    if (!cmd) {
      problems.push(`${id}: not declared`);
      continue;
    }
    if (!requiresKey(cmd.enablement)) problems.push(`${id}: enablement does not require ${key}`);
    const palette = (menus.commandPalette ?? []).filter((m) => m.command === id);
    if (palette.length === 0) problems.push(`${id}: no commandPalette entry, so the palette shows it`);
    for (const [menu, items] of Object.entries(menus)) {
      for (const item of items ?? []) {
        if (item.command === id && !requiresKey(item.when)) problems.push(`${id}: ${menu} entry is visible with the switch off`);
      }
    }
  }
  return problems;
}

/**
 * Which `switchOffWhileStored` commands are not gated on exactly "bytes are stored": the
 * enablement and every menu entry (an explicit palette entry included) must be
 * CR_BYTES_CONTEXT_KEY alone, so the command is hidden when nothing is stored and never
 * shown by anything else. Empty means every one is gated.
 */
export function manifestStoredOnlyProblems(
  manifest: ExtensionManifestLike,
  commands: readonly string[] = CR_SURFACES.switchOffWhileStored,
): string[] {
  const problems: string[] = [];
  const exact = (expr: string | undefined) => expr?.trim() === CR_BYTES_CONTEXT_KEY;
  const declared = manifest.contributes?.commands ?? [];
  const menus = manifest.contributes?.menus ?? {};
  for (const id of commands) {
    const cmd = declared.find((c) => c.command === id);
    if (!cmd) {
      problems.push(`${id}: not declared`);
      continue;
    }
    if (!exact(cmd.enablement)) problems.push(`${id}: enablement is not ${CR_BYTES_CONTEXT_KEY}`);
    if (!(menus.commandPalette ?? []).some((m) => m.command === id)) problems.push(`${id}: no commandPalette entry, so the palette shows it`);
    for (const [menu, items] of Object.entries(menus)) {
      for (const item of items ?? []) {
        if (item.command === id && !exact(item.when)) problems.push(`${id}: ${menu} entry is not gated on ${CR_BYTES_CONTEXT_KEY}`);
      }
    }
  }
  return problems;
}
