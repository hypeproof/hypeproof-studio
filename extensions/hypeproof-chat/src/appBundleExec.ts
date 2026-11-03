// #3221 — the coach must not run a program from inside another app's bundle
// (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless …`).
// macOS treats that as Studio touching another app and asks for, or denies,
// "App Management" (TCC kTCCServiceSystemPolicyAppBundles); on 2026-10-29 it was
// denied on a free seat while the coach printed an HTML report to PDF.
//
// This is a steer, not a security boundary: TCC is the boundary. It reads the
// command word of every simple command (after assignments and wrappers), the
// bodies of `$(…)`/backticks, and the `-c` script of a shell. Listing or reading
// a bundle (`ls "/Applications/Google Chrome.app/Contents/MacOS/"`) is not
// running it and stays allowed; `open -a "Google Chrome"` goes through Launch
// Services and stays allowed. A command this reader cannot parse is left to the
// existing fail-closed confirm (shellUnreadable).
//
// Pure: no vscode, no Node imports.

import { parseShell } from "./shellWords.ts";

/** A path inside an app bundle's contents: `<anything>.app/Contents/<anything>`. */
const APP_BUNDLE_INNER = /\.app\/Contents\//i;
const WRAPPERS = new Set([
  "env", "command", "builtin", "exec", "time", "nice", "nohup", "timeout", "caffeinate", "xargs",
  "stdbuf", "ionice", "unbuffer", "chronic", "sudo", "arch",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const MAX_DEPTH = 6;

/** True when the command runs a program that lives inside some `.app/Contents/`. */
export function runsAppBundleProgram(command: string, depth = 0): boolean {
  if (!command || depth > MAX_DEPTH) return false;
  const parsed = parseShell(command);
  if (parsed.uncertain) return false;
  for (const nested of parsed.nested) if (runsAppBundleProgram(nested, depth + 1)) return true;
  for (const cmd of parsed.commands) {
    const words = cmd.words;
    let i = 0;
    while (i < words.length && words[i].assignment) i++;
    while (i < words.length) {
      const word = words[i];
      if (APP_BUNDLE_INNER.test(word.text)) return true;
      const name = word.text.replace(/^.*\//, "").toLowerCase();
      if (WRAPPERS.has(name)) {
        i++;
        // Options, NAME=value (env) and numbers (nice -n 5, timeout 10) before the wrapped command.
        while (i < words.length && (/^-/.test(words[i].text) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text) || /^\d+[smhd]?$/.test(words[i].text))) i++;
        continue;
      }
      if (SHELLS.has(name)) {
        const c = words.findIndex((w, k) => k > i && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text));
        if (c > i && words[c + 1] && runsAppBundleProgram(words[c + 1].text, depth + 1)) return true;
      }
      break;
    }
  }
  return false;
}
