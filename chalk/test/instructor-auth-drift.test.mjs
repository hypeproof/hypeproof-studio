// The same installed Service authorizes direct instructor writes and HTTP reads
// through Chalk. Expired, tampered, revoked, student and out-of-scope tokens keep
// their original status and error prose. Chalk has no token verifier, signing key
// or participant store; only the public routing predicate is shared code.
// Administrator Basic remains a direct Service capability and is refused here.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, createMockEnv, makeCtx, TEST_SECRET } from "@hypeproof/service-testkit/test/harness/index.mjs";

const service = await bootApp();                                   // worker/src/index.ts
const { default: localChalk } = await import("../src/index.ts");
const { bridgeStateToService } = await import("./harness/service-state.mjs");
const chalk = bridgeStateToService(localChalk);        // chalk/src/index.ts
const tokens = await import("@hypeproof/service-testkit/src/lib/tokens.ts");
const auth = await import("@hypeproof/service-testkit/src/lib/instructor-auth.ts");
const shared = await import("../src/shared.ts");

// --- identity: re-export, not copy ------------------------------------------
assert.equal("verify" in shared, false, "Chalk has no verifier: the Service makes the HTTP authorization verdict");
assert.equal("authorizeIssuerForCohort" in shared, false, "Chalk does not implement issuer authorization");
// A self-contained private testkit has its own installed contracts instance.
// Object identity is therefore not a drift control across these package roots:
// require the exact canonical module bytes and both explicit re-export boundaries.
const serviceAuthUrl = import.meta.resolve("@hypeproof/service-testkit/src/lib/instructor-auth.ts");
const candidates = createRequire(serviceAuthUrl).resolve.paths("@hypeproof/service-contracts");
const packageRoot = candidates.map(path => join(path, "@hypeproof/service-contracts"))
  .find(path => existsSync(join(path, "package.json")));
assert.ok(packageRoot, "Service uses an installed canonical contracts package");
const contractManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const canonical = join(packageRoot, contractManifest.exports["./instructor-endpoints"].import);
const localCanonical = fileURLToPath(import.meta.resolve("@hypeproof/service-contracts/instructor-endpoints"));
assert.deepEqual(readFileSync(localCanonical), readFileSync(canonical), "Chalk and Service use identical canonical predicate implementation bytes");
const reexport = /^export \{ isIssuerAllowedEndpoint \} from ["']@hypeproof\/service-contracts["'];$/m;
assert.match(readFileSync(new URL("../src/shared.ts", import.meta.url), "utf8"), reexport, "Chalk explicitly re-exports the canonical predicate");
assert.match(readFileSync(new URL(serviceAuthUrl), "utf8"), reexport, "Service explicitly re-exports the canonical predicate");
assert.equal(shared.isIssuerAllowedEndpoint.toString(), auth.isIssuerAllowedEndpoint.toString(), "Both module instances expose the same canonical implementation");
assert.equal("TokenError" in shared, false, "Token verification errors stay in the Service");
console.log("✓ drift-lock: one public routing predicate; token verifier and cohort authorization remain in the Service");

// --- one Service store, two HTTP request paths ------------------------------------------------------
const { listProfiles } = await import("@hypeproof/service-testkit/src/profiles/index.ts");
const { serviceProfiles } = await import("../../test/fixtures/service-profiles.mjs");
const SP = serviceProfiles(listProfiles);
const COHORT = SP.pilotCohort;
const PROFILE = SP.copyclone.id;
const OTHER_COHORT = SP.kidsCohort;
const ADMIN_PW = "drift-admin-pw";

const serviceEnv = createMockEnv({ withSession: false, withRoster: false, adminPassword: ADMIN_PW });
const chalkEnv = {
  HPS_SIGNING_SECRET: TEST_SECRET,
  ENVIRONMENT: "production",
  HPS_SERVICE_ORIGIN: "https://service.test",
  HPS_KV: serviceEnv.HPS_KV,      // the SAME store: a revocation written once is seen by both
  HPS_DB: serviceEnv.HPS_DB,
};

async function viaService(headers) {
  const r = await service.fetch(
    new Request(`https://api.test/admin/cohorts/${COHORT}/roster/append`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ users: ["drift-probe"] }),
    }),
    serviceEnv,
    makeCtx(),
  );
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { /* html/plain */ }
  return { status: r.status, error: json?.error ?? null, text };
}
async function viaChalk(headers) {
  const r = await chalk.fetch(
    new Request(`https://chalk.test/admin/cohorts/${COHORT}/state`, { headers }),
    chalkEnv,
    makeCtx(),
  );
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { /* html/plain */ }
  return { status: r.status, error: json?.error ?? null, text };
}

// --- fixtures -------------------------------------------------------------------
const scoped = { cohort: COHORT, profiles: [PROFILE], max_hours: 12, can_start_session: true, max_session_hours: 4 };
const valid = await tokens.issueIssuer({ issuer: "drift-ok", scopes: [scoped] }, 24, TEST_SECRET);
const otherCohort = await tokens.issueIssuer({ issuer: "drift-other", scopes: [{ ...scoped, cohort: OTHER_COHORT }] }, 24, TEST_SECRET);
const student = await tokens.issue({ u: "kid", c: COHORT, p: PROFILE }, 1, TEST_SECRET);
const expired = await tokens.issueIssuer({ issuer: "drift-expired", scopes: [scoped] }, -1, TEST_SECRET);
const foreignSecret = await tokens.issueIssuer({ issuer: "drift-foreign", scopes: [scoped] }, 24, "another-secret-0123456789abcdef");
const revoked = await tokens.issueIssuer({ issuer: "drift-revoked", scopes: [scoped] }, 24, TEST_SECRET);
await serviceEnv.HPS_KV.put(`revoked:${revoked.jti}`, JSON.stringify({ ts: new Date().toISOString(), reason: "drift fixture" }));
// Tampered signature — mutate a DECODED byte and re-encode. Flipping the last
// base64url character does not work: the 43rd char of a 32-byte signature
// carries only 2 significant bits, so for last chars A–D a "different"
// character decodes to the SAME bytes and the token is not tampered at all
// (measured: 2 red runs in 15). XOR of one bit in byte 0 always changes the
// bytes; the assertions below fail loudly if this ever stops being a tamper.
const b64uDecode = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64uEncode = (buf) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const [validPayloadB64, validSigB64] = valid.token.split(".");
const sigBytes = b64uDecode(validSigB64);
assert.equal(sigBytes.length, 32, "sanity: HMAC-SHA256 signature is 32 bytes");
const tamperedBytes = Buffer.from(sigBytes);
tamperedBytes[0] ^= 0x01;
assert.notEqual(Buffer.compare(tamperedBytes, sigBytes), 0, "tampered signature must differ from the original AFTER decoding");
const tampered = `${validPayloadB64}.${b64uEncode(tamperedBytes)}`;
assert.notEqual(Buffer.compare(b64uDecode(tampered.split(".")[1]), sigBytes), 0, "re-encoded tampered signature still decodes to different bytes");
assert.notEqual(tampered, valid.token, "tampered token string differs from the valid one");

const bearer = (t) => ({ authorization: `Bearer ${t}` });
// { label, headers, expected, credential } — `credential:false` marks the
// no-credential cases. There the verdict (401) must still match, but the
// wording legitimately differs: the Service falls through to its Basic realm
// ("Auth required", text/plain) because it HAS an admin path, Chalk names the
// Bearer because it has none. Every case where a token was actually presented
// is decided by the shared helper on both sides and must match byte-for-byte.
// Note "Bearer " with no token lands here too: the Fetch spec trims header
// values, so both workers see a bare "Bearer" and neither finds a token.
const fixtures = [
  { label: "valid issuer scoped to the cohort", headers: bearer(valid.token), expected: 200, credential: true },
  { label: "issuer scoped to a different cohort", headers: bearer(otherCohort.token), expected: 403, credential: true },
  { label: "student token (no issuer role)", headers: bearer(student.token), expected: 403, credential: true },
  { label: "expired issuer", headers: bearer(expired.token), expected: 401, credential: true },
  { label: "issuer signed with a foreign secret", headers: bearer(foreignSecret.token), expected: 401, credential: true },
  { label: "tampered signature", headers: bearer(tampered), expected: 401, credential: true },
  { label: "revoked issuer (revocation written once, in the shared KV)", headers: bearer(revoked.token), expected: 401, credential: true },
  { label: "garbage Bearer", headers: bearer("not.atoken"), expected: 401, credential: true },
  { label: "Bearer with no token", headers: { authorization: "Bearer " }, expected: 401, credential: false },
  { label: "no Authorization at all", headers: {}, expected: 401, credential: false },
];

// --- parity ------------------------------------------------------------------------
let mismatches = 0;
for (const { label, headers, expected, credential } of fixtures) {
  const s = await viaService(headers);
  const c = await viaChalk(headers);
  const proseSame = s.status < 400 || !credential || s.error === c.error;
  const same = s.status === c.status && proseSame;
  const okExpected = s.status === expected;
  if (!same || !okExpected) mismatches++;
  console.log(
    `${same && okExpected ? "✓" : "✗"} ${label}: service=${s.status} chalk=${c.status}` +
      (s.status >= 400 ? ` | "${s.error}" vs "${c.error}"${credential ? "" : " (no credential — status only)"}` : ""),
  );
  assert.equal(s.status, expected, `${label}: Service status`);
  assert.equal(c.status, expected, `${label}: Chalk status`);
  if (s.status >= 400 && credential) {
    assert.equal(c.error, s.error, `${label}: rejection prose must match`);
  }
}
assert.equal(mismatches, 0, "every fixture must yield the same verdict on both workers");
console.log("✓ drift-lock: identical verdicts on both workers for all fixtures");

// Positive control sanity: the 200 case really did the write on the Service
// side (so the parity above compared real authorization, not a stub).
const roster = await serviceEnv.HPS_KV.get(`cohort:${COHORT}:roster`, "json");
assert.ok(roster?.users.includes("drift-probe"), "Service actually admitted the valid issuer and wrote the roster");

// --- the asserted asymmetry: Basic auth -----------------------------------------------
{
  const basic = { authorization: "Basic " + Buffer.from(`admin:${ADMIN_PW}`).toString("base64") };
  const s = await viaService(basic);
  const c = await viaChalk(basic);
  assert.equal(s.status, 200, "Service: admin Basic is an auth path (operator surface stays there)");
  assert.equal(c.status, 401, "Chalk: admin Basic is NOT an auth path — Chalk holds no admin password");
}
console.log("✓ drift-lock: admin Basic accepted by the Service, refused by Chalk (deliberate boundary)");

console.log("All instructor-auth drift-lock tests passed.");
