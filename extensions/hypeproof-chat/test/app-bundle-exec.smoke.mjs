// #3221 — running a program from inside another app's bundle is refused with a Korean reason, because
// macOS asks for (or denies) App Management on Studio when it does (TCC, 2026-10-29 18:14:39 KST).
// Listing or reading a bundle, Launch Services (`open -a`) and ordinary commands keep running as before.
import assert from "node:assert/strict";
import { runsAppBundleProgram } from "../src/appBundleExec.ts";
import { evaluateSdkToolUse, APP_BUNDLE_PROGRAM_REASON } from "../src/sdkCoachHelpers.ts";

const ws = "/Users/someone/HypeProofTrial";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// The command recorded on 2026-10-29, and the spellings a coach or a wrapper produces.
const refused = [
  `"${CHROME}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=${ws}/out.pdf file://${ws}/report-src.htm`,
  `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --headless --print-to-pdf=out.pdf x.html`,
  `cd ${ws} && "${CHROME}" --headless --print-to-pdf=a.pdf a.html 2>&1 | tail -3`,
  `CHROME_LOG=1 "${CHROME}" --version`,
  `timeout 30 "${CHROME}" --headless --dump-dom x.html`,
  `env -i HOME=/tmp nohup "${CHROME}" --headless x.html`,
  `bash -c '"${CHROME}" --headless x.html'`,
  `echo $("${CHROME}" --version)`,
  `"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless x.html`,
  `~/Applications/Foo.app/Contents/Resources/bin/tool --x`,
  `"/System/Applications/TextEdit.app/Contents/MacOS/TextEdit"`,
];
const allowed = [
  `ls "/Applications/Google Chrome.app/Contents/MacOS/" 2>&1 | head -2; which wkhtmltopdf cupsfilter python3`,
  `cat "/Applications/Google Chrome.app/Contents/Info.plist"`,
  `open -a "Google Chrome" ${ws}/index.html`,
  `python3 -c "import reportlab"`,
  `ls -lt ~/Downloads | head -50`,
  `npm test`,
  `git status`,
  `echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`,
  `grep -r "Contents/MacOS" notes.md`,
  `node build.js`,
];

for (const c of refused) assert.equal(runsAppBundleProgram(c), true, `refused: ${c}`);
for (const c of allowed) assert.equal(runsAppBundleProgram(c), false, `allowed: ${c}`);

const gate = (command) => evaluateSdkToolUse({ toolName: "Bash", input: { command }, permittedTools: ["Bash"], workspaceRoot: ws, canonicalize: (p) => p, audience: "solo" });
for (const c of refused) {
  const v = gate(c);
  assert.equal(v.decision, "deny", c);
  assert.equal(v.source, "safety", "a platform rule, labelled 안전 규칙");
  assert.ok(v.friendly.includes(APP_BUNDLE_PROGRAM_REASON), "the coach is told why, in Korean");
  assert.match(v.friendly, /^\[안전 규칙\] /);
  assert.doesNotMatch(v.friendly, /Applications|Contents|TCC/, "no path or plumbing in the learner's words");
}
for (const c of allowed) assert.notEqual(gate(c).decision, "deny", `still runs (or asks as before): ${c}`);

console.log("app-bundle-exec: ok");
