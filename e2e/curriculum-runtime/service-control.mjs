// cr-e2e (#1400) — the local Service's control routes and recorders that cr-e2e's runs read, for
// app-service.mjs. Owned by cr-e2e and pinned in its verification inputs: loop-app.spec.ts (steps 8,
// 11 and 15) and switch-app.spec.ts (CR-T02) read what these answer and record, so an edit here
// reopens cr-e2e's evidence. app-service.mjs only calls in: `route()` from its control routes (which
// service-gate.mjs admits from this Mac only, never from a browser), `observe()` with every answer of
// the Service router. A call dropped there leaves the spec that reads it red (a 404 for a route,
// nothing recorded for a recorder), never green.
//
//   GET  /__cr/records?project=<id>    every object of that Project's measurement-core record with its
//                                      SHA-256 and, for a JSON object, its parsed body (read-only;
//                                      publish mode only)
//   POST /__cr/switch {"enabled": b}   the profile's CR switch, changed in this process, so records made
//                                      with it on are walked with it off (CR-T02)
//   POST /__cr/plant-deck {"slide": n} the next Deck Builder answer also patches slide n (§14 step 15's
//                                      planted defect, which the Service's output gate must refuse)
//
// Recorders, on app-service's shared `state`: `directorProbes`, every answer of the director route (a
// spec reads the director's palette only after the App's probe of the director's switch was answered);
// `skillOutputs`, every verdict of the Service's skill output gate.
import { createHash } from "node:crypto";

const SKILL_OUTPUT = /^\/v1\/curriculum\/projects\/[^/]+\/skills\/([^/]+)\/output$/;
/** Answer `value` as JSON; true, so a route can return it as "answered". */
const json = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  return true;
};
/** A route that changes something takes POST only, a read GET only (a page's <img> or link is a GET). */
const wrongMethod = (res, allow) => {
  res.writeHead(405, { allow }).end();
  return true;
};
const parse = (body) => {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return null;
  }
};

/** The state cr-e2e keeps on app-service's `state`, empty: the §14 coach's (loop-coach.mjs) and the recorders' and the plant's. */
export const freshE2eState = () => ({ observations: [], edits: [], directorProbes: [], skillOutputs: [], deckPlant: null, lastHtml: undefined });

/**
 * @param {{ state: Record<string, any>; profile: { curriculum_runtime?: unknown }; env: { HPS_TRACES?: { map?: Map<string, Uint8Array> } }; cohort: string; publish: boolean }} deps
 *   app-service's shared state, the served profile (changed in place), its env, the profile's cohort and whether the Service has its publish storage
 */
export function createServiceControl({ state, profile, env, cohort, publish }) {
  /** One of cr-e2e's control routes, answered; false when `path` is not one of them. */
  async function route(req, res, path, search, body) {
    if (path === "/__cr/records" && publish) {
      if (req.method !== "GET") return wrongMethod(res, "GET");
      // What the Service stored for one Project, read from the bucket itself.
      const project = new URLSearchParams(search).get("project") ?? "";
      const prefix = `curriculum/${encodeURIComponent(cohort)}/${encodeURIComponent(project)}/`;
      const records = [...env.HPS_TRACES.map.entries()].filter(([k]) => project && k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, bytes]) => {
        let parsed = null;
        try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* bytes, not JSON */ }
        return { key: key.slice(prefix.length), sha256: createHash("sha256").update(bytes).digest("hex"), json: parsed };
      });
      return json(res, 200, { prefix, records });
    }
    if (path === "/__cr/switch") {
      if (req.method !== "POST") return wrongMethod(res, "POST");
      const enabled = parse(body)?.enabled;
      if (typeof enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
      profile.curriculum_runtime = { enabled };
      return json(res, 200, { enabled });
    }
    if (path === "/__cr/plant-deck") {
      if (req.method !== "POST") return wrongMethod(res, "POST");
      const slide = parse(body)?.slide;
      state.deckPlant = Number.isInteger(slide) && slide >= 1 && slide <= 8 ? slide : null;
      return json(res, 200, { deckPlant: state.deckPlant });
    }
    return false;
  }

  /** What the Service router answered one request (`r`, not yet streamed to the client). */
  async function observe(method, path, r) {
    if (path === "/v1/curriculum/director/projects") state.directorProbes.push({ at: Date.now(), status: r.status });
    const skill = method === "POST" ? SKILL_OUTPUT.exec(path) : null;
    if (skill) {
      const answer = await r.clone().json().catch(() => null);
      state.skillOutputs.push({ at: Date.now(), skill: decodeURIComponent(skill[1]), status: r.status, slides: Array.isArray(answer?.output?.patches) ? answer.output.patches.map((p) => p.slide) : null, code: answer?.error?.code ?? null, problems: answer?.error?.problems ?? null });
    }
  }

  return { route, observe };
}
