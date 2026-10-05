// cr-e2e (#1400) — CR-T02, the whole switch inventory walked at once: in the Studio APP and against the
// Service it uses.
//
// Every item from cr-browser to cr-review added its surfaces to `CR_SURFACES`
// (extensions/hypeproof-chat/src/curriculumRuntime.ts). This spec walks the list as it stands, so a
// surface a later item adds is walked without editing the spec:
//   - every Worker route, against the running Service (app-service.mjs: the real router), with the
//     switch ON and then OFF, on the same records and with the same requests. Each route is asked as
//     each kind of caller it may have: the student's token and the director's issuer token for /v1
//     routes; a student token, a wrong password and this run's admin credential for /admin routes; a
//     link that does not exist and a live link published with the switch on for the test-origin
//     routes. Ids are the route's literal params and, where a route needs one to reach the switch, the
//     seeded Project's id and the cohort. With the switch ON every route must answer at least one of
//     those requests unlike an unknown route of its kind (status, body or headers; the unknown route is
//     an unregistered path under the same prefix, asked with the same credential), or it is not
//     covered. With the switch OFF every one of those requests must answer exactly as an unknown route
//     does (an unregistered path outside the CR prefixes).
//   - every command (the student's, the director's and the stored-bytes exception) by its palette
//     title, read from the shipped manifest, in the App with the switch off and on. The director's is
//     read with an issuer token stored, and only after the App's probe of the director route was
//     answered by the Service;
//   - every proxy tool, against the tool list the Service offered the App's first request.
// Webview messages and the SDK runtime's MCP tools are not reachable from outside the App;
// extensions/hypeproof-chat/test/cr-switch.smoke.mjs checks them (every handler re-checks the switch
// first; the SDK grant and server carry no CR tool with the switch off).
//
// Instrument controls, in the same run: a route that always answers (GET /v1/profile) is told apart
// with the switch on and reported reachable with it off; an unregistered path passes the off check;
// inventory entries naming routes the router never registered (under /v1/curriculum, /admin/curriculum
// and a test origin's /l/) are reported as not covered by the on check; the flip is read back from the
// served profile; a command and a tool that exist regardless of the switch are reported shown and
// offered.
//
// Evidence class: live-host for the App, synthetic for the Service account (app-service.mjs).
// Needs an unlocked screen (recon F7): when locked the run is skipped as NOT RUN.
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type AppContext, closeApp, launchApp } from "../fixtures/app";
import { PORT, Service, paletteRows, repo, screenLocked, send } from "./app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures/kiosk-practice");

/** The inventory as the extension source defines it (a CommonJS package to this ESM spec, so read it in Node). */
const CR_SURFACES = JSON.parse(
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(path.join(repo, "extensions/hypeproof-chat/src/curriculumRuntime.ts")).href)}); console.log(JSON.stringify(m.CR_SURFACES));`], { encoding: "utf8" }),
) as { commands: string[]; directorCommands: string[]; mcpTools: string[]; proxyTools: string[]; webviewMessages: string[]; workerRoutes: string[]; switchOffWhileStored: string[] };

const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const svc = new Service();
let ctx: AppContext | undefined;
const record: Record<string, unknown> = {};
type SwitchState = { requests: Array<{ tools: string[] }>; directorProbes: Array<{ at: number; status: number }> };
const st = async (): Promise<SwitchState> => (await svc.state()) as unknown as SwitchState;

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}; the integrated browser paints no frames then (recon F7)`);
});
test.afterEach(async () => {
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/cr-app/switch-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

/** The tokens and the admin credential the Service wrote for this run. */
function credentials(): { student: string; issuer: string; admin: string } {
  const file = process.env.HPS_E2E_TOKEN_FILE!;
  const read = (f: string) => fs.readFileSync(f, "utf8").trim();
  return { student: read(file), issuer: read(`${file}.issuer`), admin: read(`${file}.admin`) };
}

// ── commands ──────────────────────────────────────────────────────────────────

/** Palette titles of the inventory's commands, from the manifest the App ships. */
function titles(): Record<string, string> {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, "extensions/hypeproof-chat/package.json"), "utf8")) as { contributes: { commands: Array<{ command: string; title: string; category?: string }> } };
  const out: Record<string, string> = {};
  for (const c of manifest.contributes.commands) out[c.command] = c.category ? `${c.category}: ${c.title}` : c.title;
  return out;
}

/** Is `title` a row of the palette? Exact title, so "주간 리뷰" is not "주간 리뷰 (디렉터)". */
function hasTitle(rows: string[], title: string): boolean {
  return rows.some((r) => r === title || (r.startsWith(`${title} `) && !r.slice(title.length).trimStart().startsWith("(")));
}

async function commandsShown(win: Page, ids: readonly string[]): Promise<{ shown: string[]; rows: Record<string, string[]> }> {
  const t = titles();
  const shown: string[] = [];
  const rows: Record<string, string[]> = {};
  for (const id of ids) {
    const title = t[id] ?? id;
    rows[id] = await paletteRows(win, title);
    if (hasTitle(rows[id]!, title)) shown.push(id);
  }
  return { shown, rows };
}

// ── Worker routes ─────────────────────────────────────────────────────────────

type Answer = { status: number; body: string; headers: Record<string, string | string[] | undefined> };

/** One request to the running Service, with an explicit Host (a test origin keeps its own). */
function call(method: string, p: string, headers: Record<string, string>, body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: PORT, method, path: p, headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const headerShape = (h: Record<string, string | string[] | undefined>) => JSON.stringify(Object.entries(h).filter(([k]) => !["x-request-id", "date", "connection", "keep-alive", "transfer-encoding", "content-length"].includes(k)).sort());
const stripIds = (s: string) => s.replace(/"request_id":"[^"]*"/g, "");

/** How a route's answer differs from the unknown route's, for the same request (empty: it answers as one). */
function differences(got: Answer, unknown: Answer, gotPath: string, unknownPath: string): string[] {
  const out: string[] = [];
  if (got.status !== unknown.status) out.push(`status ${got.status}, the unknown route's ${unknown.status}`);
  if (stripIds(got.body).split(gotPath).join("<path>") !== stripIds(unknown.body).split(unknownPath).join("<path>")) out.push("body differs");
  if (headerShape(got.headers) !== headerShape(unknown.headers)) out.push("headers differ");
  return out;
}

/** What the walk knows: this run's callers and the records seeded with the switch on. */
interface Walk {
  student: string;
  issuer: string;
  admin: string;
  project: string;
  cohort: string;
  liveHost: string;
  liveLink: string;
}
interface Probe {
  label: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  /** The unknown route of this probe's kind: switch on (same prefix), switch off (outside the CR prefixes). */
  unknown: { on: string; off: string };
}

const DUMMY_HOST = `prj-0000000000000000.test.invalid:${PORT}`;
const DUMMY_LINK = "AAAAAAAAAAAAAAAAAAAAAA";
const basic = (password: string) => ({ authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}` });

/**
 * Every request one inventoried route is asked: each kind of caller it may have, with its literal
 * params and, when the seeded Project or the cohort changes the path, with those too (never for a
 * DELETE: the seeded records stay for the switch-off walk).
 */
function probesOf(route: string, w: Walk): Probe[] {
  const [method, raw] = route.split(" ") as [string, string];
  if (raw.startsWith("<test-origin>")) {
    // A test origin's POST routes read a JSON body before anything else; `{}` gets past that.
    const body = method === "POST" ? "{}" : undefined;
    const at = (link: string) => raw.replace("<test-origin>", "").replace(":link", link).replace("*", "index.html");
    return [
      { label: "no such link", method, path: at(DUMMY_LINK), headers: { host: DUMMY_HOST }, body, unknown: { on: "/cr-never-registered", off: "/cr-never-registered" } },
      { label: "live link", method, path: at(w.liveLink), headers: { host: w.liveHost }, body, unknown: { on: "/cr-never-registered", off: "/cr-never-registered" } },
    ];
  }
  const seeded = raw.replace(/^(\/v1\/curriculum\/projects\/):id\b/, `$1${w.project}`).replace(":cohort", w.cohort);
  const paths = method === "DELETE" || seeded === raw ? [["literal ids", raw]] : [["literal ids", raw], ["seeded ids", seeded]];
  const local = `127.0.0.1:${PORT}`;
  const prefix = raw.split("/").slice(0, 3).join("/");
  const callers: Array<[string, Record<string, string>]> = raw.startsWith("/admin/")
    ? [["student token", { authorization: `Bearer ${w.student}` }], ["wrong password", basic("cr-e2e-not-the-password")], ["admin", basic(w.admin)]]
    : [["student", { authorization: `Bearer ${w.student}` }], ["director", { authorization: `Bearer ${w.issuer}` }]];
  const off = raw.startsWith("/admin/") ? "/admin/cr-never-registered" : "/v1/cr-never-registered";
  return paths.flatMap(([pl, p]) => callers.map(([cl, h]) => ({ label: `${cl}, ${pl}`, method, path: p!, headers: { host: local, ...h }, unknown: { on: `${prefix}/cr-never-registered`, off } })));
}

interface RouteWalk {
  route: string;
  probes: Array<{ label: string; status: number; differs: string[] }>;
}
async function walkRoutes(routes: readonly string[], w: Walk, on: boolean): Promise<RouteWalk[]> {
  const out: RouteWalk[] = [];
  for (const route of routes) {
    const probes: RouteWalk["probes"] = [];
    for (const p of probesOf(route, w)) {
      const unknownPath = on ? p.unknown.on : p.unknown.off;
      const got = await call(p.method, p.path, p.headers, p.body);
      const unknown = await call(p.method, unknownPath, p.headers, p.body);
      probes.push({ label: p.label, status: got.status, differs: differences(got, unknown, p.path, unknownPath) });
    }
    out.push({ route, probes });
  }
  return out;
}
/** The requests a route answered unlike an unknown route. */
const toldApart = (r: RouteWalk) => r.probes.filter((p) => p.differs.length > 0);

/** The records the switch-on walk reaches and the switch-off walk must not: a Project, a version, a running experiment and a live link. */
async function seed(student: string): Promise<{ project: string; cohort: string; liveHost: string; liveLink: string }> {
  const api = async (method: string, p: string, body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/curriculum${p}`, { method, headers: { authorization: `Bearer ${student}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  const made = await api("POST", "/projects", { title: "스위치 점검 프로젝트" });
  expect(made.status, "seed: a Project").toBe(201);
  const project = made.json.project.id as string;
  // The App's own set builder and upload (register-version.mjs), from the kiosk as handed out.
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(here, "register-version.mjs"), `http://127.0.0.1:${PORT}/v1`, process.env.HPS_E2E_TOKEN_FILE!, project, FIXTURE], { cwd: repo, encoding: "utf8" });
  const up = JSON.parse(out.trim().split("\n").at(-1)!);
  expect(up.ok, `seed: a version (${out})`).toBe(true);
  const exp = await api("POST", "/experiments", { project_id: project, product_version_id: up.version, week: 1, question: "도움 없이 주문을 마칠 수 있나?", method: "task_test", success_criteria: ["5명 중 3명이 도움 없이 주문 완료"], hypothesis: "처음 쓰는 사람도 혼자 주문할 수 있다" });
  expect(exp.status, "seed: a running experiment").toBe(201);
  const link = await api("POST", `/experiments/${exp.json.experiment.id}/links`, { expires_at: Date.now() + 3600_000 });
  expect(link.status, "seed: a live link").toBe(201);
  return { project, cohort: made.json.project.cohort_id, liveHost: new URL(link.json.share_url).host, liveLink: link.json.link.id };
}

test("CR-T02 Worker routes: with the switch on every route answers some caller unlike an unknown route; with it off every request answers as one", async () => {
  await svc.start(true, "publish");
  const w: Walk = { ...credentials(), ...(await seed(credentials().student)) };
  const page = await call("GET", `/l/${w.liveLink}/index.html`, { host: w.liveHost });

  const on = await walkRoutes(CR_SURFACES.workerRoutes, w, true);
  // Planted: inventory entries naming routes the router never registered (a typo of each kind).
  const typos = await walkRoutes(["GET /v1/curriculum/projects/:id/cr-typo-never-registered", "PUT /admin/curriculum/cohorts/:cohort/cr-typo-never-registered", "POST <test-origin>/l/:link/__hp/cr-typo-never-registered"], w, true);
  const onControl = await walkRoutes(["GET /v1/profile"], w, true);

  const flip = await fetch(`http://127.0.0.1:${PORT}/__cr/switch`, { method: "POST", body: JSON.stringify({ enabled: false }) });
  const served = (await (await fetch(`http://127.0.0.1:${PORT}/v1/profile`, { headers: { authorization: `Bearer ${w.student}` } })).json()) as { curriculum_runtime?: unknown };

  const off = await walkRoutes(CR_SURFACES.workerRoutes, w, false);
  const offControl = await walkRoutes(["GET /v1/profile"], w, false);
  const offUnknown = await walkRoutes(["GET /v1/cr-never-registered-either"], w, false);

  const reachable = off.flatMap((r) => toldApart(r).map((p) => `${r.route} [${p.label}]: ${p.differs.join("; ")}`));
  const uncovered = on.filter((r) => toldApart(r).length === 0).map((r) => r.route);
  record["routes"] = {
    seeded: { project: w.project, cohort: w.cohort, live_link: w.liveLink, live_host: w.liveHost, page_status: page.status },
    walked: CR_SURFACES.workerRoutes.length,
    probes_per_walk: on.reduce((n, r) => n + r.probes.length, 0),
    on: on.map((r) => ({ route: r.route, told_apart_by: toldApart(r).map((p) => `${p.label} → ${p.status}`) })),
    uncovered,
    off_reachable: reachable,
    planted: { typos: typos.map((r) => ({ route: r.route, told_apart_by: toldApart(r).map((p) => p.label) })), on_control: toldApart(onControl[0]!).map((p) => p.label), off_control: toldApart(offControl[0]!).map((p) => p.label), off_unknown: toldApart(offUnknown[0]!).map((p) => p.label) },
    served_after_flip: served.curriculum_runtime,
  };

  expect(page.status, "instrument: the live link serves its page with the switch on").toBe(200);
  expect(flip.status).toBe(200);
  expect(served.curriculum_runtime, "instrument: the served profile reads the switch off after the flip").toEqual({ enabled: false });
  expect(toldApart(onControl[0]!).length, "instrument: a route that always answers is told apart with the switch on").toBeGreaterThan(0);
  expect(typos.filter((r) => toldApart(r).length > 0).map((r) => r.route), "instrument: an inventory entry the router never registered is reported as not covered").toEqual([]);
  expect(toldApart(offControl[0]!).length, "instrument: a route that always answers is reported reachable with the switch off").toBeGreaterThan(0);
  expect(toldApart(offUnknown[0]!), "instrument: an unregistered path passes the switch-off check").toEqual([]);
  expect(uncovered, "switch on: every inventoried route answers at least one caller unlike an unknown route (else the switch-off check says nothing about it)").toEqual([]);
  expect(reachable, "switch off: every request to every inventoried route answers as an unknown route").toEqual([]);
  expect(CR_SURFACES.workerRoutes.length, "the inventory is not empty").toBeGreaterThan(30);
});

// ── the App ───────────────────────────────────────────────────────────────────

/** The learner's App: one chat turn (the Service builds its tool list), then the student's commands. */
async function learnerApp(): Promise<{ tools: string[] }> {
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  await send(ctx.win, "안녕");
  await expect.poll(async () => (await st()).requests.length, { timeout: 60_000 }).toBeGreaterThan(0);
  return { tools: (await st()).requests[0]!.tools };
}
/**
 * The same person's App with a director's issuer token stored too (it opens on the start page). The
 * director's key is decided by the App's probe of the director route; the palette is read only after
 * the Service answered that probe, then once more the context key had time to settle.
 */
async function directorApp(issuer: string): Promise<{ status: number }> {
  if (ctx) await closeApp(ctx);
  const before = (await st()).directorProbes.length;
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" }, preseedIssuerToken: issuer, stayOnStart: true });
  await expect.poll(async () => (await st()).directorProbes.length, { timeout: 60_000, message: "the App asked the Service about the director's switch" }).toBeGreaterThan(before);
  const probe = (await st()).directorProbes.at(-1)!;
  await ctx.win.waitForTimeout(1_500);
  return { status: probe.status };
}

test("CR-T02 in the App, switch off: no command or tool of any item is reachable", async () => {
  await svc.start(false, "publish");
  const { issuer } = credentials();
  const { tools } = await learnerApp();

  // Commands: the student's and the stored-bytes exception (nothing is stored).
  const ids = [...CR_SURFACES.commands, ...CR_SURFACES.switchOffWhileStored];
  const walk = await commandsShown(ctx!.win, ids);
  // Planted: a command that is not gated on the switch, walked as if it were in the inventory.
  const planted = await commandsShown(ctx!.win, ["hypeproof-chat.previewActiveFile"]);
  const previewShown = titles()["hypeproof-chat.previewActiveFile"] === PREVIEW && planted.shown.length === 1;

  // Proxy tools in the request the Service built for the App.
  const offered = CR_SURFACES.proxyTools.filter((t) => tools.includes(t));
  const plantedTool = ["browser_navigate"].filter((t) => tools.includes(t));

  // The director's command, with an issuer token stored as well: read twice after the App's probe was answered.
  const probe = await directorApp(issuer);
  const director = await commandsShown(ctx!.win, [...CR_SURFACES.directorCommands, ...CR_SURFACES.commands]);
  await ctx!.win.waitForTimeout(2_000);
  const directorAgain = await commandsShown(ctx!.win, CR_SURFACES.directorCommands);
  const directorControl = await commandsShown(ctx!.win, ["hypeproof-chat.previewActiveFile"]);

  record["off"] = { commands: ids, shown: walk.shown, rows: walk.rows, tools, offered, director: { probe_status: probe.status, shown: director.shown, shown_2s_later: directorAgain.shown, control: directorControl.shown }, planted: { command: planted.shown, tool: plantedTool } };

  expect(previewShown, "instrument: a planted command that is always there is reported shown").toBe(true);
  expect(directorControl.shown, "instrument: the director's App palette is read too").toEqual(["hypeproof-chat.previewActiveFile"]);
  expect(plantedTool, "instrument: a tool always offered is reported offered").toEqual(["browser_navigate"]);
  expect(probe.status, "the App's probe of the director route was answered, as an unknown route").toBe(404);
  expect(walk.shown, "no CR command is in the palette with the switch off").toEqual([]);
  expect(director.shown, "no CR command, the director's included, with an issuer token stored").toEqual([]);
  expect(directorAgain.shown, "and still none two seconds later").toEqual([]);
  expect(offered, "no CR tool is offered with the switch off").toEqual([]);
});

test("CR-T02 in the App, switch on: every command (the director's with an issuer token) and every tool appears", async () => {
  await svc.start(true, "publish");
  const { issuer } = credentials();
  const { tools } = await learnerApp();
  const walk = await commandsShown(ctx!.win, CR_SURFACES.commands);
  const exception = await commandsShown(ctx!.win, CR_SURFACES.switchOffWhileStored);
  const probe = await directorApp(issuer);
  // The director's key follows the Service's answer for the issuer token.
  await expect.poll(async () => (await commandsShown(ctx!.win, CR_SURFACES.directorCommands)).shown.length, { timeout: 60_000, intervals: [3_000] }).toBe(CR_SURFACES.directorCommands.length);
  record["on"] = { shown: walk.shown, tools, exception_shown: exception.shown, director: { probe_status: probe.status, commands: CR_SURFACES.directorCommands } };
  expect(probe.status, "the App's probe of the director route was answered").toBe(200);
  expect([...walk.shown].sort(), "every student CR command is in the palette with the switch on").toEqual([...CR_SURFACES.commands].sort());
  expect(CR_SURFACES.proxyTools.filter((t) => !tools.includes(t)), "every CR tool is offered").toEqual([]);
  expect(exception.shown, "the delete exception stays hidden while nothing is stored, switch on or off").toEqual([]);
});
