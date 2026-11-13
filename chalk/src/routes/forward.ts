// Instructor WRITE forwarder — Chalk → Service.
//
// The console and issuer pages call session open/close, roster append and
// student-token mint with relative URLs (/admin/…). Those endpoints did not
// move: they write the KV keys the participant chat gate reads on every
// request, and they sign tokens, so they stay in the Service artifact
// (worker/src/routes/admin.ts). Chalk forwards them server-side, which keeps
// the pages same-origin (no CORS opened on the participant runtime) and keeps
// the Service byte-identical on /admin/*.
//
// Allowlist = the Service's own isIssuerAllowedEndpoint (shared.ts): exactly
// the set an instructor Bearer may reach over there. Not a second list.
//
// Forwarded headers are a whitelist: Authorization and Content-Type. For an
// instructor call the Authorization is the issuer from the Lab login connection
// (src/lib/connect.ts), never a header the request brought: a request carrying
// its own Authorization is refused, so a pasted issuer has no way in. Student
// share/profile routes keep forwarding the student's own Bearer. Basic is never
// forwarded (Chalk is never a path to the admin password), and neither is
// `cf-access-authenticated-user-email`, which the Service's admin middleware trusts.

import type { Context } from "hono";
import { resolveChalkVersion, resolveLabOrigin, resolveServiceOrigin, type ChalkEnv } from "../env.ts";
import { isIssuerAllowedEndpoint } from "../shared.ts";
import { completionProblems } from "../lib/completion-checklist.ts";
import { CONNECT_SECRET_HEADER, connectSecret, instructorAuthorization } from "../lib/connect.ts";

const SECTION_REVISION = /^\/admin\/chalk\/cohorts\/[^/]+\/courses\/[^/]+\/plan\/section-revision$/;
export const isSectionRevision = (pathname: string, method: string) => method === "POST" && SECTION_REVISION.test(pathname);
// The section revision waits on one Haiku call (Service timeout 30 s); every other forward keeps its short budget.
export function forwardTimeoutMs(pathname: string, method: string, distribution: boolean): number {
  if (distribution && method === "POST") return 60_000;
  if (isSectionRevision(pathname, method)) return 45_000;
  return 8_000;
}

type Ctx = Context<{ Bindings: ChalkEnv; Variables: { requestId: string } }>;

export async function forwardInstructorWrite(c: Ctx): Promise<Response> {
  const rid = c.get("requestId") ?? "no-request-id";
  const url = new URL(c.req.url);
  const method = c.req.method.toUpperCase();

  // #1013 adds `response`: the learner's revise/keep/hold after a person's feedback (the Service answers 404 while it is off).
  const studentShare = (method === 'GET' && /^\/v1\/classroom\/shares(?:\/[^/]+\/audit)?$/.test(url.pathname)) || (method === 'POST' && /^\/v1\/classroom\/shares(?:\/[^/]+\/(?:confirm|response))?$/.test(url.pathname)) || (method === 'DELETE' && /^\/v1\/classroom\/shares\/[^/]+$/.test(url.pathname));
  const studentProfile = method === 'GET' && url.pathname === '/v1/profile';
  // Lab registers this batch in the participant distribution board; the Service
  // still authorizes, rosters and signs every student token behind that adapter.
  const distribution = (method === 'POST' || method === 'GET') && url.pathname === '/workshop/boa-tokens';
  // CGP-ART-R-004 — revise one marked plan section (instructor write). The Service admits it in service-contracts 0.1.6
  // (hypeproof-service#433); until Chalk's pin moves past 0.1.5 it is named here. The Service re-checks the issuer,
  // course ownership, the draft revision and the authoring assistant's money cap, and answers 404 while the flag is off.
  const sectionRevision = isSectionRevision(url.pathname, method);
  // CGP-SHELL-R-003 — the cohort's Studio update freeze (instructor write). The Service admits it in its service-contracts
  // source after 0.1.5 (the pinned 0.1.5 tarball does not); until Chalk's pin includes it, it is named here. Same issuer-from-connection path as every write;
  // the Service re-checks the issuer and can_start_session on the cohort.
  const updateFreeze = (method === 'PUT' || method === 'DELETE') && /^\/admin\/cohorts\/[^/]+\/update-freeze$/.test(url.pathname);
  if (!isIssuerAllowedEndpoint(url.pathname, method) && !studentShare && !studentProfile && !distribution && !sectionRevision && !updateFreeze) {
    return c.json(
      { error: { type: "not_found", message: "not an instructor endpoint", request_id: rid, path: url.pathname } },
      404,
    );
  }
  // Public routing metadata needs no instructor credential at the Lab origin.
  const metadata = distribution && method === 'GET';
  let auth = "";
  if (studentShare || studentProfile) {
    auth = (c.req.header("authorization") ?? "").trim();
    if (!/^Bearer\s+\S/i.test(auth)) {
      return c.json({ error: { type: "auth", message: "student token required (Authorization: Bearer …)", request_id: rid } }, 401);
    }
  } else if (!metadata) {
    const instructor = await instructorAuthorization(c);
    if (!instructor.ok) {
      return c.json({ error: { type: "auth", reason: instructor.reason, message: instructor.message, request_id: rid } }, instructor.status);
    }
    auth = instructor.authorization;
  }
  // The Lab takes a Bearer only from this server, proven by the shared secret.
  const labSecret = distribution && !metadata ? connectSecret(c.env) : null;
  if (distribution && !metadata && !labSecret) {
    return c.json({ error: { type: "config", message: "Lab 연결이 설정되지 않았습니다. 운영진에게 알려주세요.", request_id: rid } }, 503);
  }

  const origin = distribution ? resolveLabOrigin(c.env) : resolveServiceOrigin(c.env);
  const target = distribution ? `${origin}/api/workshop/boa-tokens` : `${origin}${url.pathname}${url.search}`;
  const headers = new Headers(metadata ? {} : { authorization: auth });
  if (labSecret) headers.set(CONNECT_SECRET_HEADER, labSecret);
  const ct = c.req.header("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("x-hps-forwarded-by", `chalk/${resolveChalkVersion(c.env)}`);
  headers.set("x-request-id", rid);

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > 0) body = buf;
  }

  // CGP-LEARN-R-015: a lesson draft's completion checklist carries no points or grade levels (OUT-05, SX-35). The page
  // refuses them before sending; this is the same kit on the server, so a direct API call cannot store them either.
  // A body that is not JSON is passed on unchanged: the Service validator answers it.
  if (method === "PUT" && body && /^\/admin\/cohorts\/[^/]+\/authoring\/[^/]+$/.test(url.pathname)) {
    let draft: unknown = null;
    try { draft = JSON.parse(new TextDecoder().decode(body)); } catch { draft = null; }
    const problems = completionProblems((draft as { content?: unknown } | null)?.content);
    if (problems.length) {
      const [index, message] = problems[0]!;
      return c.json(
        { error: { type: "validation", field: `content.learning.completion[${index}].text`, message, request_id: rid } },
        422,
      );
    }
  }

  let upstream: Response;
  try {
    // workerd rejects redirect: "error" (it throws before sending), so take
    // "manual" and refuse any 3xx ourselves.
    upstream = await fetch(target, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(forwardTimeoutMs(url.pathname, method, distribution)) });
    if (upstream.status >= 300 && upstream.status < 400) throw new Error(`upstream redirect ${upstream.status}`);
  } catch (err) {
    console.error(`[${rid}] forward to ${origin} failed:`, err instanceof Error ? err.name : 'upstream error');
    return c.json(
      { error: { type: "upstream", message: distribution
        ? "배부 결과를 확인하지 못했습니다. 내 토큰 받기 보드를 먼저 확인하고, 표시되지 않으면 강사에게 문의하세요."
        : "service unreachable — instructor write not applied", request_id: rid } },
      502,
    );
  }

  // Pass the Service's verdict through untouched (status + JSON body): the
  // pages already map its error prose, and a 401/403 from the Service IS the
  // authorization decision — Chalk does not second-guess it.
  const out = new Headers({
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "x-request-id": rid,
    "x-hps-forwarded-to": new URL(origin).host,
  });
  const upstreamRid = upstream.headers.get("x-request-id");
  if (upstreamRid) out.set("x-hps-service-request-id", upstreamRid);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
