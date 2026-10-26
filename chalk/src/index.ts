import { renderBoardStatusPage } from "./lib/board-status.ts";
import { renderSafetySignal } from "./lib/safety-signal.ts";
// @ts-ignore — bundled as text by wrangler rules.
import budgetsHtml from './ui/budgets.html';
// Chalk — the instructor surface (docs/plan/vessel-and-modules.md §1, layer
// "Surface", tag prefix c*). Its own Cloudflare Worker (plan task F).
//
// Routes:
//   GET /health                      — { ok, service, version } (c* tag via HPS_CHALK_VERSION)
//   GET /                            — 302 → /console
//   GET /console                     — instructor session console (#352)
//   GET /issuer                      — self-service student-token mint page
//   GET /board                       — instructor live board page (#674)
//   GET /admin/cohorts/:id/state     — read-only cohort state (issuer Bearer)   src/routes/state.ts
//   GET /admin/cohorts/:id/board     — live board JSON (issuer Bearer)          src/routes/board.ts
//   GET /admin/cohorts/:id/logs      — studio-logs arrival + roster diff (issuer)  src/routes/logs-admin.ts
//   GET /admin/cohorts/:id/logs/:seat            — per-session rows (issuer)        src/routes/logs-admin.ts
//   GET /admin/cohorts/:id/logs/:seat/:day/:session/:file — retrieval (OPERATOR)    src/routes/logs-admin.ts
//   *   /admin/*  (instructor writes) — forwarded to the Service                  src/routes/forward.ts
//
// What is NOT here, on purpose: any write to session/roster/pause/revocation
// state, any token signing, any admin-password path, any cron. Those are the
// Service's. The public HTTP contract keeps participant state and keys
// outside the instructor surface.

import { Hono } from "hono";
import { withCopyFeedback } from "./lib/copy-feedback.ts";
import { withListRows } from "./lib/list-rows.ts";
import { withTooltips } from "./lib/tooltips.ts";
import { withDesignTokens } from "./lib/design-tokens.ts";
import { resolveChalkVersion, type ChalkEnv } from "./env.ts";
import { makeErrorBody, requestId } from "./middleware.ts";
import { state } from "./routes/state.ts";
import { board } from "./routes/board.ts";
import { labTokens } from './routes/lab-tokens.ts';
import { logsAdmin } from "./routes/logs-admin.ts";
import { forwardInstructorWrite } from "./routes/forward.ts";
// @ts-ignore — bundled as text by wrangler rules.
import consoleHtml from "./ui/console.html";
// @ts-ignore — bundled as text by wrangler rules.
import issuerHtml from "./ui/issuer.html";
// @ts-ignore — bundled as text by wrangler rules.
import boardHtml from "./ui/board.html";
// @ts-ignore — bundled as text by wrangler rules.
import authoringHtml from "./ui/authoring.html";
import { INSTRUCTION_DIFF_SCRIPT } from "./lib/instruction-diff.ts";
import { COMPLETION_CHECKLIST_SCRIPT } from "./lib/completion-checklist.ts";
import { ROSTER_CSV_SCRIPT } from "./lib/roster-csv.ts";
// @ts-ignore — bundled as text by wrangler rules.
import manageHtml from "./ui/manage.html";
// @ts-ignore — bundled as text by wrangler rules.
import sharingHtml from "./ui/sharing.html";
// @ts-ignore — bundled as text by wrangler rules.
import startHtml from "./ui/start.html";
// @ts-ignore — bundled as text by wrangler rules.
import learnHtml from './ui/learn.html';

const app = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();

app.use("*", requestId);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "hypeproof-chalk",
    version: resolveChalkVersion(c.env),
    env: c.env.ENVIRONMENT,
  }),
);

const page = (html: unknown) =>
  new Response(withCopyFeedback(withTooltips(withDesignTokens(withListRows(html as string)))), { headers: { "content-type": "text/html; charset=utf-8" } });

app.get("/", (c) => c.redirect("/console", 302));
// Pages are public; every API call they make carries the instructor's Bearer
// issuer token and is scope-checked by the Service for reads and writes.
// Pages remain reachable when Service configuration is unavailable.
// The roster CSV kit (parse, preview, per-row results) is shared with the tests; it is inlined in place of its marker.
const consolePage = (consoleHtml as unknown as string).replace("/*@roster-csv*/", () => ROSTER_CSV_SCRIPT);
app.get("/console", () => page(consolePage));
app.get("/start", () => page(startHtml));
app.get("/issuer", () => page(issuerHtml));
app.get("/board", () => page(renderBoardStatusPage(boardHtml)));
// The confirm step's instruction diff is a pure helper shared with the tests; it is inlined in place of its marker.
// The completion checklist kit (CGP-LEARN-R-015) is inlined the same way; the forwarder runs the same kit server-side.
const authoringPage = (authoringHtml as unknown as string).replace("/*@instruction-diff*/", () => INSTRUCTION_DIFF_SCRIPT).replace("/*@completion-checklist*/", () => COMPLETION_CHECKLIST_SCRIPT);
app.get("/authoring", () => page(authoringPage));
app.get("/manage", () => page(renderSafetySignal(renderBoardStatusPage(manageHtml))));
app.get("/budgets", () => page(budgetsHtml));
app.get("/sharing", () => page(sharingHtml));
app.get('/learn', () => page(learnHtml));
app.get('/v1/profile', forwardInstructorWrite);
app.post('/workshop/boa-tokens', forwardInstructorWrite);
app.get('/workshop/boa-tokens', forwardInstructorWrite);
app.all("/v1/classroom/*", forwardInstructorWrite);

app.route("/admin", state);
app.route("/admin", board);
app.route('/admin', labTokens);
// #680 — studio-logs read path. Mounted before the forwarder so these reads are
// forwarded through the dedicated read contract before instructor writes.
app.route("/admin", logsAdmin);
app.all("/admin/*", forwardInstructorWrite);

app.notFound((c) =>
  c.json(makeErrorBody(c, "not_found", "endpoint not found", { path: c.req.path }), 404),
);
app.onError((err, c) => {
  const rid = c.get("requestId") ?? "no-request-id";
  console.error(`[${rid}] chalk error:`, err);
  return c.json(
    makeErrorBody(c, "internal", "unexpected server error — quote this request_id to the operator"),
    500,
  );
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<ChalkEnv>;
