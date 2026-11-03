// CGP-LEARN-D-013: the real GET /manage route must serve the safety signal. The unit tests call
// renderSafetySignal on manage.html directly; this one goes through the Worker's fetch(), so
// dropping renderSafetySignal from the route fails here (without it manage.html would reference
// an undefined `safetySignal` and break the whole console).
//
// Run: node --experimental-strip-types chalk/test/safety-signal-route.test.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import "@hypeproof/service-testkit/test/harness/loader.mjs";

const { default: chalk } = await import("../src/index.ts");
const res = await chalk.fetch(new Request("https://chalk.test/manage"), {}, { waitUntil() {}, passThroughOnException() {} });
assert.equal(res.status, 200);
const html = await res.text();

assert.ok(!html.includes("SAFETY_SIGNAL_CSS") && !html.includes("SAFETY_SIGNAL_SCRIPT"), "no placeholder is left in the served page");
assert.match(html, /id="ops-safety"[^>]*role="region"[^>]*hidden/, "the safety region is served, hidden by default");
assert.match(html, /id="ops-safety-list"/);
assert.match(html, /\.safety-item\b/, "the safety CSS is served");

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const owner = scripts.find((s) => /const safetySignal\s*=/.test(s));
assert.ok(owner, "an inline script defines safetySignal");
assert.match(owner, /safetySignalUI/);
// The definition parses and exposes the API the console calls.
const ctx = vm.createContext({ document: { createElement() { throw new Error("not used"); } } });
const start = owner.indexOf("const safetySignal");
const end = owner.indexOf("})();", start) + 5;
vm.runInContext(owner.slice(start, end) + "\nthis.__s = safetySignal;", ctx);
for (const fn of ["update", "render", "reset"]) assert.equal(typeof ctx.__s?.[fn], "function", fn + " is exposed");

console.log("✓ GET /manage serves the safety signal (region, CSS, script)");
