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
//   - anything the tokeniser cannot read, any substitution, any `cd` (later paths become unknown);
//   - any glob, brace expansion, zsh `=cmd` or glob qualifier (they expand to names this module never checked).
//
// Pure apart from the injected canonicaliser, so the smoke test can vary it.
import fs from "node:fs";
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
  "powershell", "pwsh", "cmd", "noglob", "nocorrect", "-",
]);

/**
 * Verify round 2 (2026-11-04): the characters a silent command may contain, as a positive list. Every shell feature
 * the tokeniser does not model (zsh `>!`, `<->` ranges, `^`/`#` extended globs, `=cmd`, braces, qualifiers, history
 * `!`, quotes, `$`, `~`, globs, pipes, `<`) is outside it, so it asks instead of being read as plain text.
 * Allowed: letters and digits of any script, spaces, `_ . , : @ + % / -`, and `&`, `;`, `>` for `&&`, `;`, `>`, `>>`, `2>&1`.
 */
const PLAIN_COMMAND = /^[\p{L}\p{M}\p{N} _.,:@+%\/&;>-]*$/u;

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
  // Only plain characters (PLAIN_COMMAND); `>` only as `>`, `>>` or `2>&1`, never `>!`, `>|`, `&>` or `>&file`.
  if (!PLAIN_COMMAND.test(command) || /&>|>&(?!1(?!\d))|>{3}/.test(command)) return false;
  // A rename changes what later paths name (verify round 2 N5: `mv d e; rm -rf e/l/`): mv only as the last command.
  let root: string;
  try { root = canonicalize(workspaceRoot); } catch { return false; }
  // A target is inside when its static part resolves (links followed) strictly below or at the root.
  const inside = (w: ShellWord, removing: boolean): boolean => {
    if (w.dynamic || w.assignment) return false;
    const text = w.text;
    if (!text || text.startsWith("~") || text.startsWith("=")) return false;
    // No `..` part at all (verify round 2 N1: path.join folds `dl/../x` as text before links are followed).
    if (text.split(/[\\/]/).includes("..")) return false;
    // A glob is never silent (verify 2026-11-04 H1): it expands to names the app has not checked, including symlinks
    // that point outside (`rm -rf */`) and `..` after the wildcard (`*/../../x`).
    if (w.glob) return false;
    let resolved: string;
    // Links are followed: a link inside that points outside counts as outside (chmod, truncate, mv and cp follow it).
    try { resolved = canonicalize(path.isAbsolute(text) ? text : path.join(root, text)); } catch { return false; }
    const rel = path.relative(root, resolved);
    if (escapes(rel)) return false;
    // A hard link shares its bytes with a file that may sit outside (verify round 2 N7): writing through it is not silent.
    if (!removing) { try { const st = fs.statSync(resolved); if (st.isFile() && st.nlink > 1) return false; } catch { /* not there yet */ } }
    // The work folder itself is not a silent target of rm/rmdir/unlink (`rm -rf .`).
    return !(removing && rel === "");
  };
  for (const [index, cmd] of parsed.commands.entries()) {
    if (cmd.words.length === 0) return false;
    if (cmd.words.some((w) => w.assignment || w.dynamic)) return false;
    const head = cmd.words[0].text.replace(/^.*[\\/]/, "").toLowerCase();
    if (RUNS_OTHER.has(head)) return false;
    if (head === "mv" && index < parsed.commands.length - 1) return false;
    // Every output redirection lands inside the folder (fd duplications like 2>&1 and the scratch sinks aside).
    for (const r of cmd.redirects) {
      if (!r.op.includes(">")) continue;
      if (r.op === ">&" && /^\d+$|^-$/.test(r.target.text)) continue;
      // Only /dev/null exactly (verify 2026-11-04 H3: a raw `/tmp/` prefix let `/tmp/../Users/x/.zshrc` through).
      if (r.target.text === "/dev/null") continue;
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
          // An attached value that could name a place (`-t..`, `-t/x`) is not silent (verify round 2 N6).
          else if (/[./~]/.test(w.text)) return false;
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
