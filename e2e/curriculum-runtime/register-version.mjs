// cr-e2e (#1400) — §14 step 13 (CR-41): register the student's v1 as a product version of the
// Project, with the App's own code and no test started, and name it on the team's decision.
//
// The publish panel's one action registers a version AND starts a test of it. Step 13 needs v1
// in Venture Memory before the Weekly Review (step 14) without a Week 1 test of v1, which would
// make the review read v1 as the version Week 1 tested. No panel offers "register this version"
// alone, so this script runs the two calls the panel makes first, unchanged: the published file
// set built from the served root (`buildPublishSet`, the same walk, caps and secret scan) and its
// upload (`publishTestVersion`, PUT /v1/curriculum/projects/:id/versions/:digest). Same bytes,
// same id: a version the App later publishes for a test is this one. With `--link-decision`, the
// decision then names it (`POST /v1/curriculum/decisions/:id/version`, CR-41 resulting_version_id):
// `latest` is the Project's newest team or director decision that names no version yet.
//
//   node --experimental-strip-types e2e/curriculum-runtime/register-version.mjs <service /v1 URL> <token file> <project id>|latest <root> [--link-decision <id>|latest]
//
// Prints {"ok":true,"version":"sha256:…","created":…,"decision":…} or {"ok":false,…} and exits 1.
import { readFileSync } from "node:fs";
import { buildPublishSet } from "../../extensions/hypeproof-chat/src/publishSet.ts";
import { curriculumBase, curriculumRequest, publishTestVersion } from "../../extensions/hypeproof-chat/src/galleryPublish.ts";

const args = process.argv.slice(2);
const flag = args.indexOf("--link-decision");
const link = flag >= 0 ? args.splice(flag, 2)[1] : null;
const [proxyUrl, tokenFile, projectArg, root] = args;
if (!proxyUrl || !tokenFile || !projectArg || !root || (flag >= 0 && !link)) {
  console.error("usage: register-version.mjs <service /v1 URL> <token file> <project id>|latest <root> [--link-decision <id>|latest]");
  process.exit(2);
}
const stop = (out) => {
  console.log(JSON.stringify({ ok: false, ...out }));
  process.exit(1);
};
const client = { base: curriculumBase(proxyUrl), token: readFileSync(tokenFile, "utf8").trim() };
// `latest`: the newest Project the token's student is a member of (the kit's single team Project).
let projectId = projectArg;
if (projectArg === "latest") {
  const list = await curriculumRequest(client, "GET", "/projects");
  if (!list.ok) stop({ step: "projects", status: list.status, code: list.code });
  const newest = [...(list.body.projects ?? [])].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)).at(-1);
  if (!newest) stop({ step: "projects", code: "no_project" });
  projectId = newest.id;
}
const state = await curriculumRequest(client, "GET", `/projects/${encodeURIComponent(projectId)}`);
if (!state.ok) stop({ step: "project", status: state.status, code: state.code });
// The decision to name is settled before anything is uploaded, so a refusal leaves nothing behind.
let target = null;
if (link) {
  const mem = await curriculumRequest(client, "GET", `/projects/${encodeURIComponent(projectId)}/memory`);
  if (!mem.ok) stop({ step: "memory", status: mem.status, code: mem.code });
  const people = mem.body.memory.decisions.filter((d) => d.actor !== "ai");
  const d = link === "latest" ? people.filter((x) => x.resulting_version_id === null).at(-1) : people.find((x) => x.id === link);
  if (!d) stop({ step: "decision", code: link === "latest" ? "no_decision_without_version" : "unknown_decision" });
  if (d.resulting_version_id !== null) stop({ step: "decision", code: "version_already_linked", decision: d.id });
  target = d.id;
}
const built = await buildPublishSet(root, "/", [], { projectId, testOrigin: state.body.test_origin ?? null });
if (!built.ok) stop({ step: "set", refusal: built.refusal });
const up = await publishTestVersion(client, projectId, built.set);
if (!up.ok) stop({ step: "upload", status: up.status, code: up.code });
let decision = null;
if (target) {
  const linked = await curriculumRequest(client, "POST", `/decisions/${encodeURIComponent(target)}/version`, { version_id: up.body.version.id });
  if (!linked.ok) stop({ step: "link", status: linked.status, code: linked.code });
  decision = linked.body.decision.id;
}
console.log(JSON.stringify({ ok: true, project: projectId, version: up.body.version.id, created: up.body.created, files: built.set.files.map((f) => f.path), decision }));
