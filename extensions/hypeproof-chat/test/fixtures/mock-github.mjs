// A scripted GitHub for the one-click publish: the REST endpoints src/publish/ calls, the
// Actions run that a pushed pages workflow triggers, and a fake Pages host that serves what a
// successful run deployed. Used in-process by test/publish-*.smoke.mjs (via `fetch`) and over
// HTTP by e2e/one-click-publish/ (via `listen()`).
//
// It models the behaviours the pipeline's correctness depends on, not GitHub in general:
//   - the Git Data API refuses an empty repository; blob ids are real git blob ids;
//   - a ref update carrying a workflow file needs the `workflow` scope;
//   - a pushed `.github/workflows/pages.yml` starts a run, which FAILS (as configure-pages did
//     in #500) if Pages was not already on `build_type: workflow` when it started;
//   - Pages provisioning is async: GET /pages reads `workflow` only after `pagesReadyAfter` reads;
//   - the site goes live only after the run succeeds, and (optionally) after a CDN lag.
// Faults are switches on `faults`; every request is logged on `log` for assertions.

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const blobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const objSha = (kind, value) => createHash("sha1").update(kind + JSON.stringify(value)).digest("hex");

export function createMockGitHub(options = {}) {
  const login = options.login ?? "octo-clinic";
  const state = {
    login,
    token: options.token ?? "gho_mocktoken000000000000000000000000",
    scopes: options.scopes ?? "repo, workflow",
    repos: new Map(),
    log: [],
    runSeq: 1,
    faults: {
      createRepo422: false, // POST /user/repos → 422 while the name stays invisible (taken elsewhere)
      repoOwner: null, // GET /repos/<login>/<name> answers a repo owned by this login (a redirect)
      pagesNeverWorkflow: false,
      runConclusion: "success", // or "failure"
      neverServeNonce: false, // the host keeps serving an old deployment
      rateLimitOnce: null, // { match: RegExp, kind: "retry-after" | "reset" }
      createRepo403: null, // message for a 403 on repo creation
      healthStatus: [200], // per-call statuses for /pages/health (last one repeats)
      healthDomain: { dns_resolves: false, is_valid: false },
      certState: "new",
      ...(options.faults ?? {}),
    },
    lastPush: 0, // pushed_at only moves forward, so "most recent first" is well defined
    pagesReadyAfter: options.pagesReadyAfter ?? 1, // GET /pages reads before build_type flips
    runPollsToComplete: options.runPollsToComplete ?? 2,
    cdnLagPolls: options.cdnLagPolls ?? 1, // nonce reads after deploy before the new version shows
    origin: "http://mock-github.invalid",
    /** The clock `x-ratelimit-reset` is computed from; tests point it at their fake clock. */
    now: options.now ?? (() => Date.now()),
  };

  const json = (status, body, headers = {}) =>
    new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const notFound = () => json(404, { message: "Not Found" });

  const pushedNow = () => {
    state.lastPush = Math.max(state.now(), state.lastPush + 1);
    return new Date(state.lastPush).toISOString();
  };

  function newRepo(name, { autoInit, description = null }) {
    const repo = {
      owner: login,
      name,
      description,
      pushed_at: pushedNow(),
      default_branch: "main",
      archived: false,
      blobs: new Map(),
      trees: new Map(),
      commits: new Map(),
      refs: new Map(),
      pages: null,
      pagesReads: 0,
      runs: [],
      deployed: null, // { files: Map<path, Buffer>, at }
      deployReads: 0,
    };
    if (autoInit) commitFiles(repo, [{ path: "README.md", bytes: Buffer.from(`# ${name}\n`) }], "Initial commit");
    state.repos.set(`${login}/${name}`.toLowerCase(), repo);
    return repo;
  }

  function putBlob(repo, bytes) {
    const sha = blobSha(bytes);
    repo.blobs.set(sha, bytes);
    return sha;
  }

  function commitFiles(repo, files, message) {
    const entries = files.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: putBlob(repo, f.bytes) }));
    const tree = objSha("tree", entries);
    repo.trees.set(tree, entries);
    const parent = repo.refs.get(repo.default_branch);
    const sha = objSha("commit", { tree, parents: parent ? [parent] : [], message, n: repo.commits.size });
    repo.commits.set(sha, { tree, parents: parent ? [parent] : [], message });
    repo.refs.set(repo.default_branch, sha);
    repo.pushed_at = pushedNow();
    return sha;
  }

  function treeFiles(repo, commitSha) {
    const c = repo.commits.get(commitSha);
    const entries = c ? repo.trees.get(c.tree) ?? [] : [];
    return new Map(entries.map((e) => [e.path, repo.blobs.get(e.sha)]));
  }

  function startRun(repo, headSha, event) {
    const files = treeFiles(repo, headSha);
    if (!files.has(".github/workflows/pages.yml")) return;
    // The #500 failure: the run started before Pages was provisioned as `workflow`.
    const provisioned = repo.pages?.build_type === "workflow" && repo.pagesReads >= state.pagesReadyAfter;
    repo.runs.push({
      id: state.runSeq++,
      head_sha: headSha,
      event,
      path: ".github/workflows/pages.yml",
      status: "queued",
      conclusion: null,
      polls: 0,
      willFail: !provisioned || state.faults.runConclusion !== "success",
      html_url: `https://github.com/${login}/${repo.name}/actions/runs/${state.runSeq - 1}`,
    });
  }

  function advanceRuns(repo) {
    for (const run of repo.runs) {
      if (run.status === "completed") continue;
      run.polls++;
      run.status = run.polls >= state.runPollsToComplete ? "completed" : "in_progress";
      if (run.status === "completed") {
        run.conclusion = run.willFail ? "failure" : "success";
        if (!run.willFail) {
          repo.deployed = { files: treeFiles(repo, run.head_sha) };
          repo.deployReads = 0;
        }
      }
    }
  }

  function repoFor(owner, name) {
    return state.repos.get(`${owner}/${name}`.toLowerCase()) ?? null;
  }

  function repoJson(repo) {
    const owner = state.faults.repoOwner ?? repo.owner;
    return {
      name: repo.name,
      full_name: `${owner}/${repo.name}`,
      owner: { login: owner },
      html_url: `https://github.com/${owner}/${repo.name}`,
      description: repo.description,
      fork: false,
      has_pages: !!repo.pages,
      pushed_at: repo.pushed_at,
      default_branch: repo.default_branch,
      archived: repo.archived,
      private: false,
      permissions: { admin: owner === login, push: owner === login },
    };
  }

  function pagesJson(repo) {
    repo.pagesReads++;
    const p = repo.pages;
    const ready = !state.faults.pagesNeverWorkflow && repo.pagesReads >= state.pagesReadyAfter;
    return {
      build_type: p.build_type === "workflow" && !ready ? "legacy" : p.build_type,
      cname: p.cname ?? null,
      https_enforced: !!p.https_enforced,
      https_certificate: p.cname ? { state: state.faults.certState } : undefined,
      html_url: p.cname ? `http://${p.cname}/` : `https://${login}.github.io/${repo.name}/`,
    };
  }

  async function api(method, url, headers, bodyText) {
    const u = new URL(url);
    const p = u.pathname;
    state.log.push(`${method} ${p}${u.search}`);
    const rl = state.faults.rateLimitOnce;
    if (rl && rl.match.test(`${method} ${p}`)) {
      state.faults.rateLimitOnce = null;
      return rl.kind === "retry-after"
        ? json(403, { message: "You have exceeded a secondary rate limit." }, { "retry-after": "1" })
        : json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil(state.now() / 1000) + 1) });
    }
    if ((headers.authorization ?? "") !== `Bearer ${state.token}`) return json(401, { message: "Bad credentials" });
    const body = bodyText ? JSON.parse(bodyText) : {};

    if (method === "GET" && p === "/user") return json(200, { login }, state.scopes === null ? {} : { "x-oauth-scopes": state.scopes });
    if (method === "GET" && p === "/user/repos") {
      // affiliation=owner, sort=pushed, direction=desc (what githubContinue.ts asks for).
      if (state.faults.listRepos500) return json(500, { message: "Server Error" });
      const own = [...state.repos.values()].filter((r) => r.owner === login).sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1));
      return json(200, own.map(repoJson));
    }
    if (method === "POST" && p === "/user/repos") {
      if (state.faults.createRepo403) return json(403, { message: state.faults.createRepo403 });
      if (state.faults.createRepo422 || repoFor(login, body.name)) return json(422, { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] });
      return json(201, repoJson(newRepo(body.name, { autoInit: body.auto_init === true, description: body.description ?? null })));
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
    if (!m) return notFound();
    const repo = repoFor(m[1], m[2]);
    const rest = m[3] ?? "";
    if (!repo) return notFound();
    if (method === "GET" && rest === "") return json(200, repoJson(repo));

    // Pages
    if (rest === "/pages") {
      if (method === "GET") return repo.pages ? json(200, pagesJson(repo)) : notFound();
      if (method === "POST") {
        if (repo.pages) return json(409, { message: "GitHub Pages is already enabled." });
        repo.pages = { build_type: body.build_type ?? "legacy" };
        repo.pagesReads = 0;
        return json(201, { build_type: repo.pages.build_type });
      }
      if (method === "PUT") {
        if (!repo.pages) return notFound();
        if (body.build_type) {
          if (body.build_type !== repo.pages.build_type) repo.pagesReads = 0;
          repo.pages.build_type = body.build_type;
        }
        if ("cname" in body) repo.pages.cname = body.cname;
        if (body.https_enforced === true) {
          if (!["approved", "issued"].includes(state.faults.certState)) return json(422, { message: "The certificate does not exist yet" });
          repo.pages.https_enforced = true;
        }
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && rest === "/pages/health") {
      const seq = state.faults.healthStatus;
      const status = seq.length > 1 ? seq.shift() : seq[0];
      return status === 200 ? json(200, { domain: state.faults.healthDomain }) : json(status, {});
    }

    // Git Data
    let g;
    if (method === "GET" && (g = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      if (repo.commits.size === 0) return json(409, { message: "Git Repository is empty." });
      const sha = repo.refs.get(g[1]);
      return sha ? json(200, { ref: `refs/heads/${g[1]}`, object: { sha, type: "commit" } }) : notFound();
    }
    if (method === "GET" && (g = /^\/git\/commits\/([a-f0-9]+)$/.exec(rest))) {
      const c = repo.commits.get(g[1]);
      return c ? json(200, { sha: g[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : notFound();
    }
    if (method === "GET" && (g = /^\/git\/trees\/([a-f0-9]+)$/.exec(rest))) {
      const t = repo.trees.get(g[1]);
      return t ? json(200, { sha: g[1], tree: t.map((e) => ({ ...e, size: repo.blobs.get(e.sha)?.length })), truncated: false }) : notFound();
    }
    if (method === "GET" && (g = /^\/git\/blobs\/([a-f0-9]+)$/.exec(rest))) {
      const bytes = repo.blobs.get(g[1]);
      if (!bytes) return notFound();
      const served = state.faults.corruptBlob === g[1] ? Buffer.concat([bytes, Buffer.from("!")]) : bytes;
      return json(200, { sha: g[1], size: served.length, content: served.toString("base64"), encoding: "base64" });
    }
    if (method === "POST" && rest === "/git/blobs") {
      if (repo.commits.size === 0) return json(409, { message: "Git Repository is empty." });
      return json(201, { sha: putBlob(repo, Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) });
    }
    if (method === "POST" && rest === "/git/trees") {
      if (body.base_tree) return json(400, { message: "mock: base_tree not supported (the pipeline must not use it)" });
      for (const e of body.tree) if (!repo.blobs.has(e.sha)) return json(422, { message: `tree entry ${e.path} points to a missing blob` });
      const sha = objSha("tree", body.tree);
      repo.trees.set(sha, body.tree);
      return json(201, { sha });
    }
    if (method === "POST" && rest === "/git/commits") {
      if (!repo.trees.has(body.tree)) return json(422, { message: "tree missing" });
      const sha = objSha("commit", { ...body, n: repo.commits.size });
      repo.commits.set(sha, { tree: body.tree, parents: body.parents ?? [], message: body.message });
      return json(201, { sha });
    }
    if (method === "PATCH" && (g = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      const c = repo.commits.get(body.sha);
      if (!c) return json(422, { message: "Object does not exist" });
      const head = repo.refs.get(g[1]);
      if (!body.force && head && !c.parents.includes(head)) return json(422, { message: "Update is not a fast forward" });
      const files = treeFiles(repo, body.sha);
      const touchesWorkflow = [...files.keys()].some((k) => k.startsWith(".github/workflows/"));
      if (touchesWorkflow && !/\bworkflow\b/.test(state.scopes ?? "workflow")) {
        return json(404, { message: "refusing to allow an OAuth App to create or update workflow `.github/workflows/pages.yml` without `workflow` scope" });
      }
      repo.refs.set(g[1], body.sha);
      repo.pushed_at = pushedNow();
      startRun(repo, body.sha, "push");
      return json(200, { ref: `refs/heads/${g[1]}`, object: { sha: body.sha } });
    }

    // Contents (seeding an empty repo; reading the nonce)
    if ((g = /^\/contents\/(.+)$/.exec(rest))) {
      if (method === "PUT") {
        commitFiles(repo, [...treeFiles(repo, repo.refs.get(repo.default_branch)).entries()].map(([path, bytes]) => ({ path, bytes })).filter((f) => f.path !== g[1]).concat([{ path: g[1], bytes: Buffer.from(body.content, "base64") }]), body.message);
        return json(201, { content: { path: g[1] } });
      }
      if (method === "GET") {
        const head = repo.refs.get(u.searchParams.get("ref") ?? repo.default_branch);
        const bytes = head ? treeFiles(repo, head).get(g[1]) : undefined;
        return bytes ? json(200, { content: bytes.toString("base64"), encoding: "base64" }) : notFound();
      }
    }

    // Actions
    if (method === "GET" && rest === "/actions/runs") {
      advanceRuns(repo);
      const sha = u.searchParams.get("head_sha");
      const runs = repo.runs.filter((r) => !sha || r.head_sha === sha).map(({ polls, willFail, ...r }) => r);
      return json(200, { total_count: runs.length, workflow_runs: runs.reverse() });
    }
    if (method === "POST" && rest === "/actions/workflows/pages.yml/dispatches") {
      startRun(repo, repo.refs.get(body.ref ?? repo.default_branch), "workflow_dispatch");
      return new Response(null, { status: 204 });
    }
    return notFound();
  }

  /** Fake `<login>.github.io` host: GET /site/<login>/<repo>/<path>. */
  function site(url) {
    const u = new URL(url);
    const m = /^\/site\/([^/]+)\/([^/]+)\/(.*)$/.exec(u.pathname);
    state.log.push(`SITE ${u.pathname}`);
    if (!m) return new Response("404", { status: 404 });
    const repo = repoFor(m[1], m[2]);
    if (!repo?.deployed) return new Response("404 There isn't a GitHub Pages site here.", { status: 404 });
    let path = decodeURIComponent(m[3]);
    if (path === "" || path.endsWith("/")) path += "index.html";
    if (path === "hps-build.txt") {
      repo.deployReads++;
      if (state.faults.neverServeNonce || repo.deployReads <= state.cdnLagPolls) return new Response("old-deployment\n", { status: 200 });
    }
    const bytes = repo.deployed.files.get(path);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("404", { status: 404 });
  }

  async function handle(url, init = {}) {
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    const u = new URL(url);
    if (u.pathname.startsWith("/site/")) return site(url);
    return api(init.method ?? "GET", url, headers, typeof init.body === "string" ? init.body : "");
  }

  return {
    state,
    /** In-process fetch: point apiBase at `${state.origin}/api` and pagesBase at `${state.origin}/site`. */
    fetch: (url, init) => {
      const u = new URL(String(url));
      if (u.pathname.startsWith("/api/")) return handle(String(url).replace("/api/", "/"), init);
      return handle(String(url), init);
    },
    apiBase: () => `${state.origin}/api`,
    pagesBase: () => `${state.origin}/site`,
    repo: (name) => repoFor(login, name),
    /** Test setup: a repository holding `files` ({path: text}) at main; `pages` turns Pages on. */
    seedRepo(name, files, { description = null, pages = false } = {}) {
      const repo = newRepo(name, { autoInit: false, description });
      commitFiles(repo, Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text) })), "seed");
      if (pages) repo.pages = { build_type: "workflow" };
      return repo;
    },
    /** Serve over HTTP on 127.0.0.1 (e2e). Returns the origin. */
    async listen(port = 0) {
      const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks).toString("utf8");
        const url = `http://127.0.0.1${req.url}`;
        const r = await (url.includes("/api/") ? handle(url.replace("/api/", "/"), { method: req.method, headers: req.headers, body }) : handle(url, { method: req.method, headers: req.headers, body }));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
      state.origin = `http://127.0.0.1:${server.address().port}`;
      state.server = server;
      return state.origin;
    },
    close() {
      state.server?.close();
    },
  };
}
