// cr-e2e (#1400) — CR-T02, the whole switch-off inventory walked in the Studio APP at once.
//
// Every item from cr-browser to cr-review added its surfaces to `CR_SURFACES`
// (extensions/hypeproof-chat/src/curriculumRuntime.ts) and checked its own in-app. This spec walks
// the list as it stands, so a surface a later item adds is walked without editing the spec:
//   - every command (the student's, the director's and the stored-bytes exception) by its palette
//     title, read from the shipped manifest;
//   - every proxy tool, against the tool list the Service offered the App's first request;
//   - every Worker route, against the running Service the App talks to: with the switch off a CR
//     route must answer exactly as an unknown route of the same kind does (status, body, headers).
// With the switch on, every command (the director's with an issuer token stored) and every proxy
// tool appears. Webview messages and the SDK runtime's MCP tools are not reachable from outside the
// App; extensions/hypeproof-chat/test/cr-switch.smoke.mjs checks them (every handler re-checks the
// switch first; the SDK grant and server carry no CR tool with the switch off).
//
// Instrument controls, in the same run: a command and a route that exist regardless of the switch
// (the HTML preview, GET /v1/profile) and a tool always offered (browser_navigate) are planted into
// the walk and must be reported reachable; an existing command is found by the palette reader.
//
// Evidence class: live-host for the App, synthetic for the Service account (app-service.mjs).
// Needs an unlocked screen (recon F7): when locked the run is skipped as NOT RUN.
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import { type AppContext, closeApp, launchApp } from "../fixtures/app";
import { PORT, Service, paletteRows, repo, screenLocked, send } from "./app-helpers";

/** The inventory as the extension source defines it (a CommonJS package to this ESM spec, so read it in Node). */
const CR_SURFACES = JSON.parse(
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(path.join(repo, "extensions/hypeproof-chat/src/curriculumRuntime.ts")).href)}); console.log(JSON.stringify(m.CR_SURFACES));`], { encoding: "utf8" }),
) as { commands: string[]; directorCommands: string[]; mcpTools: string[]; proxyTools: string[]; webviewMessages: string[]; workerRoutes: string[]; switchOffWhileStored: string[] };

const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const svc = new Service();
let ctx: AppContext | undefined;
const record: Record<string, unknown> = {};

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

/** One request to the running Service, with an explicit Host (a test origin keeps its own). */
function call(method: string, p: string, headers: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: PORT, method, path: p, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
const headerShape = (h: Record<string, string | string[] | undefined>) => JSON.stringify(Object.entries(h).filter(([k]) => !["x-request-id", "date", "connection", "keep-alive", "transfer-encoding", "content-length"].includes(k)).sort());
const stripIds = (s: string) => s.replace(/"request_id":"[^"]*"/g, "");

/**
 * Problems of one inventoried route with the switch off: it must answer as an unknown route of
 * its kind does (cr-switch.test.mjs's rule, here against the Service the App uses).
 */
async function routeProblems(route: string, token: string): Promise<string[]> {
  const [method, raw] = route.split(" ") as [string, string];
  if (raw.startsWith("<test-origin>")) {
    const host = `prj-0000000000000000.test.invalid:${PORT}`;
    const p = raw.replace("<test-origin>", "").replace(":link", "AAAAAAAAAAAAAAAAAAAAAA").replace("*", "index.html");
    const got = await call(method, p, { host });
    const unknown = await call(method, "/cr-never-registered", { host });
    return got.status === unknown.status && got.body === unknown.body && unknown.status === 404 ? [] : [`${route}: ${got.status} differs from the test origin's unknown path (${unknown.status})`];
  }
  const problems: string[] = [];
  const unknownPath = raw.startsWith("/admin/") ? "/admin/cr-never-registered" : "/v1/cr-never-registered";
  const auths = raw.startsWith("/admin/") ? [{ authorization: `Bearer ${token}` }, { authorization: `Basic ${Buffer.from("admin:cr-e2e-not-the-password").toString("base64")}` }] : [{ authorization: `Bearer ${token}` }];
  for (const auth of auths) {
    const got = await call(method, raw, { host: `127.0.0.1:${PORT}`, ...auth });
    const unknown = await call(method, unknownPath, { host: `127.0.0.1:${PORT}`, ...auth });
    if (got.status !== unknown.status) problems.push(`${route}: ${got.status}, the unknown route answers ${unknown.status}`);
    if (stripIds(got.body).replace(raw, "<path>") !== stripIds(unknown.body).replace(unknownPath, "<path>")) problems.push(`${route}: body differs from the unknown route's`);
    if (headerShape(got.headers) !== headerShape(unknown.headers)) problems.push(`${route}: headers differ from the unknown route's`);
  }
  return problems;
}

/** The learner's App: one chat turn (the Service builds its tool list), then the student's commands. */
async function learnerApp(): Promise<{ tools: string[] }> {
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  await send(ctx.win, "안녕");
  await expect.poll(async () => (await svc.state()).requests.length, { timeout: 60_000 }).toBeGreaterThan(0);
  return { tools: (await svc.state()).requests[0]!.tools };
}
/** The same person's App with a director's issuer token stored too (it opens on the start page). */
async function directorApp(issuer: string): Promise<void> {
  if (ctx) await closeApp(ctx);
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" }, preseedIssuerToken: issuer, stayOnStart: true });
  // The director's key is asked once the issuer token is read; give the probe its time.
  await ctx.win.waitForTimeout(3_000);
}

test("CR-T02 full inventory, switch off: no command, tool or route of any item is reachable", async () => {
  await svc.start(false, "publish");
  const issuer = fs.readFileSync(`${process.env.HPS_E2E_TOKEN_FILE}.issuer`, "utf8").trim();
  const token = fs.readFileSync(process.env.HPS_E2E_TOKEN_FILE!, "utf8").trim();
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

  // Worker routes, against the same Service.
  const routes: Record<string, string[]> = {};
  for (const r of CR_SURFACES.workerRoutes) routes[r] = await routeProblems(r, token);
  const reachable = Object.entries(routes).filter(([, p]) => p.length).map(([r, p]) => `${r}: ${p.join("; ")}`);
  const plantedRoute = await routeProblems("GET /v1/profile", token);
  const unknownControl = await routeProblems("GET /v1/cr-never-registered-either", token);

  // The director's command, with an issuer token stored as well.
  await directorApp(issuer);
  const director = await commandsShown(ctx!.win, [...CR_SURFACES.directorCommands, ...CR_SURFACES.commands]);
  const directorControl = await commandsShown(ctx!.win, ["hypeproof-chat.previewActiveFile"]);

  record["off"] = { commands: ids, shown: walk.shown, rows: walk.rows, tools, offered, routes_walked: CR_SURFACES.workerRoutes.length, reachable, director: { shown: director.shown, control: directorControl.shown }, planted: { command: planted.shown, tool: plantedTool, route: plantedRoute }, unknown_control: unknownControl };

  expect(previewShown, "instrument: a planted command that is always there is reported shown").toBe(true);
  expect(directorControl.shown, "instrument: the director's App palette is read too").toEqual(["hypeproof-chat.previewActiveFile"]);
  expect(plantedTool, "instrument: a tool always offered is reported offered").toEqual(["browser_navigate"]);
  expect(plantedRoute.length, "instrument: a route that always answers is reported reachable").toBeGreaterThan(0);
  expect(unknownControl, "instrument: an unregistered path passes the route check").toEqual([]);
  expect(walk.shown, "no CR command is in the palette with the switch off").toEqual([]);
  expect(director.shown, "no CR command, the director's included, with an issuer token stored").toEqual([]);
  expect(offered, "no CR tool is offered with the switch off").toEqual([]);
  expect(reachable, "every CR route answers as an unknown route").toEqual([]);
  expect(CR_SURFACES.workerRoutes.length, "the inventory is not empty").toBeGreaterThan(30);
});

test("CR-T02 full inventory, switch on: every command (the director's with an issuer token) and every tool appears", async () => {
  await svc.start(true, "publish");
  const issuer = fs.readFileSync(`${process.env.HPS_E2E_TOKEN_FILE}.issuer`, "utf8").trim();
  const { tools } = await learnerApp();
  const walk = await commandsShown(ctx!.win, CR_SURFACES.commands);
  const exception = await commandsShown(ctx!.win, CR_SURFACES.switchOffWhileStored);
  await directorApp(issuer);
  // The director's key follows the Service's answer for the issuer token; it may take one probe.
  await expect.poll(async () => (await commandsShown(ctx!.win, CR_SURFACES.directorCommands)).shown.length, { timeout: 60_000, intervals: [3_000] }).toBe(CR_SURFACES.directorCommands.length);
  record["on"] = { shown: walk.shown, tools, exception_shown: exception.shown, director: CR_SURFACES.directorCommands };
  expect([...walk.shown].sort(), "every student CR command is in the palette with the switch on").toEqual([...CR_SURFACES.commands].sort());
  expect(CR_SURFACES.proxyTools.filter((t) => !tools.includes(t)), "every CR tool is offered").toEqual([]);
  expect(exception.shown, "the delete exception stays hidden while nothing is stored, switch on or off").toEqual([]);
});
