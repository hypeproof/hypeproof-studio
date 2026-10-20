// CGP-AGENT-R-005 verify F1-B / F2 — `ln` in the coach's shell. Pure: the caller injects the canonicalizer.
//
// A link is how a write that looks inside lands outside: `ln -s ~/Library/LaunchAgents/x.plist page.html`, then
// `Write page.html`. The write gates follow links (workspaceRouting.resolvePathThroughLinks), and this closes the
// other half: the shell must not plant such a link without a decision.
//
//   deny — a link TARGET resolves outside the work folder, or cannot be decided (`$VAR`, `~user`, a glob, a
//          command substitution, an `ln` after `cd`/`pushd` with a relative path, a missing operand);
//   ask  — the target is inside but the LINK itself would be created outside (destructive: strong confirm, never
//          remembered); also any `ln` mention the parser cannot read (e.g. inside `sh -c '…'`);
//   null — no `ln` in the command, or every link and target stays inside: the shell tier decides as before.
//
// A symbolic link's relative target is resolved against the LINK's directory (that is what the kernel does);
// a hard link's against the shell's working directory (the work folder).

import * as path from "node:path";
import { relativeEscapes } from "./workspaceRouting.ts";

export type LinkVerdict = { decision: "deny"; reason: string } | { decision: "ask" } | null;

const SEGMENT_SPLIT = /&&|\|\||[;&|\n]/;
const UNCLEAR = /[$`*?[\]{}]|^~[^/]/;
const LN_WORD = /(^|[\s;&|()`'"])(?:\S*\/)?ln(?=\s|$|['"])/;

function words(segment: string): string[] | null {
  // Quoted operands are taken as written (a `$` or backtick inside double quotes is then judged unclear);
  // an unbalanced quote or a backslash escape is not readable.
  const out: string[] = [];
  const re = /'([^']*)'|"([^"\\]*)"|([^\s'"]+)/g;
  let m: RegExpExecArray | null;
  let consumed = "";
  while ((m = re.exec(segment))) {
    out.push(m[1] ?? m[2] ?? m[3]);
    consumed += m[0];
  }
  return consumed.replace(/\s/g, "").length === segment.replace(/\s/g, "").length ? out : null;
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
  if (!LN_WORD.test(command)) return null;
  if (!workspaceRoot) return { decision: "deny", reason: "ln with no work folder to judge it against" };
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
    if (!ws || ws.length === 0) continue;
    let i = 0;
    while (i < ws.length && /^(sudo|command|exec|nohup|time|env|xargs|builtin)$/.test(ws[i].replace(/^.*\//, ""))) i++;
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
  if (!sawLn) return { decision: "ask" };
  return ask ? { decision: "ask" } : null;
}
