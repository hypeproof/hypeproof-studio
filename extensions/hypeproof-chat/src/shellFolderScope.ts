// DEC-11 amended (Jay 2026-11-04) — the no-prompt default ("auto") for personal and adult seats.
//
// Under auto, file writes and shell commands inside the work folder run without a modal, like
// Claude Code / Codex auto mode. `isDestructiveCommand` (shellPolicy.ts) still flags the
// irreversible and outward commands; this module answers one narrower question for them:
// "does this destructive command only change files inside the work folder?" Only then may auto
// run it silently. Everything else keeps the strong confirm:
//
//   - deleting, moving or changing files OUTSIDE the work folder (an absolute path elsewhere,
//     `~`, `..`, a link that resolves outside, a path known only at run time);
//   - removing the work folder itself (`rm -rf .`);
//   - system and outward verbs (sudo, kill, launchctl, defaults, npm publish, git push --force,
//     curl | sh, npx/npm scripts, git reset/clean, every Windows destructive verb);
//   - anything the tokeniser cannot read, any substitution, any `cd` (later paths become unknown).
//
// Pure apart from the injected canonicaliser, so the smoke test can vary it.
import path from "node:path";
import { isDestructiveCommand } from "./shellPolicy.ts";
import { parseShell, shellQuote, type ShellWord } from "./shellWords.ts";

/** Verbs whose only effect is on the files they name. Their operands are checked one by one. */
const FOLDER_FILE_VERBS = new Set(["rm", "rmdir", "unlink", "mv", "cp", "truncate", "chmod", "mkdir", "touch"]);
/** Verbs that remove what they name: the work folder itself is never a silent target. */
const REMOVING_VERBS = new Set(["rm", "rmdir", "unlink"]);
/** Words that run another command or a script: what they run is not read here. */
const RUNS_OTHER = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "fish", "source", ".", "eval", "exec", "sudo", "su", "doas",
  "xargs", "env", "command", "builtin", "nohup", "time", "nice", "cd", "pushd", "popd",
  "powershell", "pwsh", "cmd",
]);

const escapes = (rel: string) => rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../") || path.isAbsolute(rel);

/**
 * True only when `command` is destructive solely through file verbs (and `>` redirections) whose
 * every target stays inside `workspaceRoot`. False whenever in doubt: the caller then asks.
 */
export function destructiveStaysInFolder(
  command: string,
  workspaceRoot: string | null | undefined,
  canonicalize: (p: string) => string,
): boolean {
  if (!workspaceRoot || !command.trim()) return false;
  const parsed = parseShell(command);
  if (parsed.uncertain || parsed.nested.length > 0 || parsed.commands.length === 0) return false;
  let root: string;
  try { root = canonicalize(workspaceRoot); } catch { return false; }
  // A target is inside when its static part resolves (links followed) strictly below or at the root.
  const inside = (w: ShellWord, removing: boolean): boolean => {
    if (w.dynamic || w.assignment) return false;
    const text = w.text;
    if (!text || text.startsWith("~")) return false;
    // `.*` matches `..` in some shells; a hidden-file glob is never silent.
    if (w.glob && /(^|\/)\.[^/]*[*?[]/.test(text)) return false;
    const staticPart = w.glob ? text.slice(0, text.search(/[*?[]/)) : text;
    const dir = w.glob ? (staticPart.endsWith("/") ? staticPart : path.dirname(staticPart || ".")) : staticPart;
    let resolved: string;
    try { resolved = canonicalize(path.isAbsolute(dir) ? dir : path.join(root, dir || ".")); } catch { return false; }
    const rel = path.relative(root, resolved);
    if (escapes(rel)) return false;
    // The work folder itself is not a silent target of rm/rmdir/unlink (`rm -rf .`); a glob inside it is.
    return !(removing && rel === "" && !w.glob);
  };
  for (const cmd of parsed.commands) {
    if (cmd.words.length === 0) return false;
    if (cmd.words.some((w) => w.assignment || w.dynamic)) return false;
    const head = cmd.words[0].text.replace(/^.*[\\/]/, "").toLowerCase();
    if (RUNS_OTHER.has(head)) return false;
    // Every output redirection lands inside the folder (fd duplications like 2>&1 and the scratch sinks aside).
    for (const r of cmd.redirects) {
      if (!r.op.includes(">")) continue;
      if (r.op === ">&" && /^\d+$|^-$/.test(r.target.text)) continue;
      if (r.target.text === "/dev/null" || r.target.text.startsWith("/tmp/")) continue;
      if (!inside(r.target, false)) return false;
    }
    if (FOLDER_FILE_VERBS.has(head)) {
      let operands = false;
      for (const w of cmd.words.slice(1)) {
        if (!operands && w.text === "--") { operands = true; continue; }
        if (!operands && w.text.startsWith("-")) {
          // A flag can carry a path (`--target-directory=/x`, `-t/x`, `--reference=~/f`): its value must be inside too.
          const eq = w.text.indexOf("=");
          if (eq > 0) { if (!inside({ ...w, text: w.text.slice(eq + 1) }, false)) return false; }
          else if (/[/~]/.test(w.text)) return false;
          continue;
        }
        if (!inside(w, REMOVING_VERBS.has(head))) return false;
      }
      continue;
    }
    // Any other verb must not be destructive on its own (git push --force, npm publish, kill, …).
    // Read twice: as the plain words (the patterns and the Windows verbs match unquoted text) and re-quoted.
    const plain = cmd.words.map((w) => w.text).join(" ");
    if (isDestructiveCommand(plain) || isDestructiveCommand(cmd.words.map((w) => shellQuote(w.text)).join(" "))) return false;
  }
  return true;
}
