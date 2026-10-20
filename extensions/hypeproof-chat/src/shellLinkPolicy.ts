// CGP-AGENT-R-005 verify F1-B / F2, verify 2 F2 — link-making commands in the coach's shell. Pure: the caller
// injects the canonicalizer.
//
// A link is how a write that looks inside lands outside. The real defence is the write gates' resolver
// (workspaceRouting.resolvePathThroughLinks), which follows every link the way the kernel does. This policy only
// keeps the coach's own shell from planting or swapping links without a decision, and it FAILS CLOSED rather
// than trying to parse every shell spelling:
//
//   ask (strong confirm, never remembered) — the command mentions a link-making tool ANYWHERE, read loosely
//          with quotes and backslashes removed (`\ln`, `l''n`, `$(which ln)`, `if …; then ln …`): ln, link,
//          cp -s/-R/-r/-a, rsync -l/-a, tar x, unzip and other extractors, git clone/checkout/pull/…,
//          python/node/perl/ruby/… -c/-e code that names a link call. Also any command this module cannot
//          read (`shellUnreadable`);
//   deny — a plainly readable `ln` whose TARGET resolves outside the work folder or cannot be decided (`$VAR`,
//          `~user`, a glob, a substitution, a backslash or an inner quote in an operand, a relative path after
//          `cd`, a missing operand);
//   null — no link-making tool: the shell tier decides as before.
//
// A symbolic link's relative target is resolved against the LINK's directory (that is what the kernel does);
// a hard link's against the shell's working directory (the work folder).
//
// The readability check is a minimal local copy. `src/shellWords.ts` on fix/sec-destructive-command-bypass is
// the full tokeniser; once it lands, `shellUnreadable` and `words` should be consolidated onto it.

import * as path from "node:path";
import { relativeEscapes } from "./workspaceRouting.ts";

export type LinkVerdict = { decision: "deny"; reason: string } | { decision: "ask" } | null;

const SEGMENT_SPLIT = /&&|\|\||[;&|\n]/;
const UNCLEAR = /[$`*?[\]{}]|^~[^/]/;
const LN_WORD = /(^|[\s;&|()`'"])(?:\S*\/)?ln(?=\s|$|['"])/;

// Read on the command with every quote and backslash removed, so `\ln`, `l''n` and `"l"n` all read `ln`.
const B = "(?<![\\w.-])";
const E = "(?![\\w.-])";
const REST = "[^;&|\\n]*";
const LINK_TOOLS: readonly RegExp[] = [
  new RegExp(`${B}(?:ln|link|gln)${E}`),
  new RegExp(`${B}g?cp${E}${REST}\\s-(?:-(?:symbolic-link|recursive|archive|no-dereference|link)|[A-Za-z]*[sRraPl])`),
  new RegExp(`${B}rsync${E}${REST}\\s-(?:-(?:links|archive|copy-links|hard-links)|[A-Za-z]*[laH])`),
  new RegExp(`${B}g?(?:bsd)?tar${E}${REST}(?:\\s-?[A-Za-z]*x[A-Za-z]*(?=\\s|$)|--extract|--get)`),
  new RegExp(`${B}(?:unzip|7z|7za|ditto|cpio|pax|unar|gunzip|bunzip2)${E}`),
  new RegExp(`${B}git${E}${REST}\\s(?:clone|checkout|pull|switch|submodule|merge|rebase|apply|am|restore|worktree|stash|reset|cherry-pick)${E}`),
  // Inline code (-c/-e) only when the code names a link call: `curl … | python3 -c "print(…)"` is a read the
  // shell tier auto-runs by decision (REQ-M4), and stays that way. A link call spelled to hide the name is a
  // stated limit (REQ-E1).
  new RegExp(`${B}(?:python[0-9.]*|node|nodejs|perl|ruby|deno|bun|php|osascript|swift|lua)${E}${REST}\\s-[A-Za-z]*[ceEp][\\s\\S]*(?:symlink|link\\s*\\(|linkSync|hardlink|os\\.link|ln\\s)`, "i"),
];

/** Does the command mention a link-making tool anywhere, however it is quoted or escaped? */
export function mentionsLinkTool(command: string): boolean {
  const loose = command.replace(/['"\\]/g, "");
  return LINK_TOOLS.some((re) => re.test(loose));
}

/**
 * A command this module cannot read: an unbalanced quote, a trailing backslash, an unterminated `$(` or
 * backtick. The shell tier gives it the strong confirm. (Minimal; see the shellWords.ts note above.)
 */
export function shellUnreadable(command: string): boolean {
  let single = false, double = false, backtick = 0, subst = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (single) { if (c === "'") single = false; continue; }
    if (c === "\\") { if (i === command.length - 1) return true; i++; continue; }
    if (double) { if (c === '"') double = false; else if (c === "$" && command[i + 1] === "(") { subst++; i++; } else if (c === "`") backtick ^= 1; continue; }
    if (c === "'") single = true;
    else if (c === '"') double = true;
    else if (c === "`") backtick ^= 1;
    else if (c === "$" && command[i + 1] === "(") { subst++; i++; }
    else if (c === ")" && subst > 0) subst--;
  }
  return single || double || backtick !== 0 || subst !== 0;
}

function words(segment: string): string[] | null {
  // Only whole-word quoting is read ('a b', "a b"); a backslash, or a quote that touches other characters
  // (`.''./x`, `l''n`), is a spelling this reader does not model: null, and an `ln` there is refused.
  const plain = segment.replace(/(^|\s)(['"])[^'"\\]*\2(?=\s|$)/g, "$1Q");
  if (/['"\\]/.test(plain)) return null;
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel === "" || !relativeEscapes(rel);
};

/**
 * The verdict for every `ln` in `command`. `workspaceRoot` is the shell's working directory; `canonicalize`
 * follows links (dangling ones too) like the write gates do.
 */
export function linkCommandVerdict(
  command: string,
  workspaceRoot: string | undefined,
  canonicalize: (p: string) => string,
  home?: string,
): LinkVerdict {
  const linkTool = mentionsLinkTool(command);
  if (!linkTool && !LN_WORD.test(command)) return null;
  if (!workspaceRoot) return { decision: "ask" };
  const root = canonicalize(workspaceRoot);
  let cwdMoved = false;
  let sawLn = false;
  let ask = false;
  const expand = (w: string): string | null => {
    if (w === "~" || w.startsWith("~/")) return home ? path.join(home, w.slice(1)) : null;
    return UNCLEAR.test(w) ? null : w;
  };
  for (const raw of command.split(SEGMENT_SPLIT)) {
    const seg = raw.trim().replace(/^\(+/, "");
    const ws = words(seg);
    if (!ws) {
      // An `ln` in a spelling this reader does not model is refused, not guessed.
      if (mentionsLinkTool(seg) && /(?<![\w.-])g?ln(?![\w.-])/.test(seg.replace(/['"\\]/g, ""))) return { decision: "deny", reason: `ln in a spelling Studio cannot read: ${seg}` };
      continue;
    }
    if (ws.length === 0) continue;
    let i = 0;
    while (i < ws.length && /^(sudo|command|exec|nohup|time|env|xargs|builtin|then|do|else|if|while|until|!|\{|\()$/.test(ws[i].replace(/^.*\//, ""))) i++;
    const cmd = (ws[i] ?? "").replace(/^.*\//, "");
    if (cmd === "cd" || cmd === "pushd" || cmd === "popd") { cwdMoved = true; continue; }
    if (cmd !== "ln") continue;
    sawLn = true;
    let symbolic = false;
    let targetDir: string | null = null;
    let noTargetDir = false;
    const operands: string[] = [];
    let endOfFlags = false;
    for (let k = i + 1; k < ws.length; k++) {
      const w = ws[k];
      if (!endOfFlags && w === "--") { endOfFlags = true; continue; }
      if (!endOfFlags && (w === "-t" || w === "--target-directory")) { targetDir = ws[++k] ?? ""; continue; }
      if (!endOfFlags && w.startsWith("--target-directory=")) { targetDir = w.slice("--target-directory=".length); continue; }
      if (!endOfFlags && (w === "-T" || w === "--no-target-directory")) { noTargetDir = true; continue; }
      if (!endOfFlags && w.startsWith("--")) { if (w === "--symbolic") symbolic = true; continue; }
      if (!endOfFlags && w.startsWith("-") && w.length > 1) { if (w.includes("s")) symbolic = true; continue; }
      operands.push(w);
    }
    const resolveWord = (w: string, base: string): string | null => {
      const e = expand(w);
      if (e === null) return null;
      if (!path.isAbsolute(e) && cwdMoved) return null;
      return path.resolve(base, e);
    };
    let targets: string[];
    let linkDirOrName: string | null;
    if (targetDir !== null) { targets = operands; linkDirOrName = targetDir; }
    else if (operands.length === 1) { targets = operands; linkDirOrName = null; }
    else { targets = operands.slice(0, -1); linkDirOrName = operands[operands.length - 1] ?? null; }
    if (targets.length === 0) return { decision: "deny", reason: "ln with no target" };
    // Where each link is created.
    const linkBase = linkDirOrName === null ? root : resolveWord(linkDirOrName, root);
    if (linkBase === null) return { decision: "deny", reason: `ln link location cannot be decided: ${linkDirOrName}` };
    const linkIsDir = targetDir !== null || (!noTargetDir && targets.length > 1) || linkDirOrName === null;
    for (const t of targets) {
      // The last operand may be an existing directory (the link goes inside it) or the link's own name: both
      // readings are judged, so the verdict does not depend on what is on disk right now.
      const linkSpots = linkIsDir ? [path.join(linkBase, path.basename(t))] : [linkBase, path.join(linkBase, path.basename(t))];
      for (const linkAt of linkSpots) {
        const target = resolveWord(t, symbolic ? path.dirname(linkAt) : root);
        if (target === null) return { decision: "deny", reason: `ln target cannot be decided: ${t}` };
        if (!inside(root, canonicalize(target))) return { decision: "deny", reason: `ln target outside the work folder: ${t}` };
        if (!inside(root, canonicalize(linkAt))) ask = true;
      }
    }
  }
  // Every link-making command gets at least the strong confirm, whatever the reader made of it.
  void sawLn; void ask;
  return { decision: "ask" };
}
