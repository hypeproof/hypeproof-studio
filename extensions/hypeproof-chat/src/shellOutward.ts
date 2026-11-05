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
//   - `git config`/`git remote` changes, `cd`/`pushd`, or `GIT_*`/`SSH*`/proxy/`PATH`/`HOME` variables in
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
import path from "node:path";
import { parseShell, type ShellWord, type SimpleCommand } from "./shellWords.ts";

/** A part of the command that may send data off this computer. */
export type OutwardTarget =
  /** `git push`: `remote` null = the branch's default push remote; `dir` = a static `-C` path. */
  | { kind: "git"; remote: string | null; dir: string | null }
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
const STDIN_PATH = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/self\/fd\/\d+|\/dev\/tty)$/;
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
}

const mark = (s: State, why: string) => { s.outward = true; s.unknown ??= why; };
const add = (s: State, t: OutwardTarget) => { s.outward = true; s.targets.push(t); };

/** Read `command` for parts that may send data off this computer. */
export function readOutward(command: string): OutwardReading {
  const s: State = { targets: [], unknown: null, outward: false, moved: false, rewired: false };
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
  for (const cmd of parsed.commands) readCommand(cmd, cmd.words, s, depth);
}

function noteAssignments(words: ShellWord[], s: State, all = false): void {
  for (const w of words) {
    if (!(w.assignment || (all && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.text)))) continue;
    if (NET_ENV.test(w.text.replace(/\+?=[\s\S]*$/, ""))) s.rewired = true;
  }
}

function readCommand(cmd: SimpleCommand, words: ShellWord[], s: State, depth: number): void {
  let i = 0;
  // Leading assignments and grouping words.
  while (i < words.length && (words[i].assignment || KEYWORDS.has(words[i].text) || /^[A-Za-z_][\w-]*\(\)$/.test(words[i].text))) {
    if (words[i].assignment) noteAssignments([words[i]], s);
    i++;
  }
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
  if (head === "cd" || head === "pushd" || head === "popd") { s.moved = true; return; }
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
  if (head === "git") return readGit(rest, s);
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
    if (NETWORK_TOOLS.has(name) || SHELLS.has(name) || INTERPRETERS.has(name) || name === "eval" || name === "env" || name.startsWith("git-")) {
      if (transparent) { readCommand(cmd, rest.slice(j), s, depth); return; }
      // xargs/parallel/find -exec hand a shell or interpreter code built at run time (`xargs -I{} sh -c '{}'`).
      if (ARG_WRAPPERS.has(head) && (SHELLS.has(name) || INTERPRETERS.has(name) || name === "eval")) { mark(s, "a wrapper runs a shell or interpreter with arguments built at run time"); return; }
      const inner: State = { targets: [], unknown: null, outward: false, moved: s.moved, rewired: s.rewired };
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
  let i = 0, inline = false;
  while (i < rest.length && rest[i].text.startsWith("-") && rest[i].text !== "-" && rest[i].text !== "--") {
    const t = rest[i].text;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t) || t === "--command") inline = true;
    // `-o option` / `-O option` take a value.
    if (/^[-+][A-Za-z]*[oO]$/.test(t)) i++;
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
  // A script file named at run time (`bash <(echo …)`, `sh $F`) or standard input by path (`sh /dev/stdin`) is not read.
  if (rest.slice(i).some((w) => w.dynamic || w.glob)) { mark(s, "a shell runs a script known only at run time"); return; }
  if (rest[i] && STDIN_PATH.test(rest[i].text) && (cmd.piped || cmd.redirects.some((r) => r.op === "<"))) { mark(s, "a shell reads its script from a pipe"); return; }
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
  const fromStdin = operands.length === 0 || operands.some((w) => STDIN_PATH.test(w.text));
  if (!inline && fromStdin && (cmd.piped || cmd.redirects.some((r) => r.op === "<" || r.op === "<>"))) mark(s, "an interpreter reads its program from a pipe or file");
}

// ── git ─────────────────────────────────────────────────────────────────────

function readGit(rest: ShellWord[], s: State): void {
  let i = 0, dir: string | null = null;
  while (i < rest.length && rest[i].text.startsWith("-")) {
    const w = rest[i], t = w.text;
    if (t === "-C") {
      const v = rest[i + 1];
      if (!v || v.dynamic || v.glob) { s.moved = true; mark(s, "git -C names a folder known only at run time"); return; }
      dir = dir ? path.join(dir, v.text) : v.text;
      i += 2; continue;
    }
    if (GIT_PLAIN_GLOBALS.has(t)) { i++; continue; }
    if (/^--(git-dir|work-tree|namespace)(=|$)/.test(t)) { s.moved = true; i += t.includes("=") ? 1 : 2; continue; }
    // `-c`, `--config-env`, `--exec-path` and anything unknown can run another program or rewrite the remote.
    mark(s, `git ${t} can change what runs or where it goes`);
    return;
  }
  const subWord = rest[i];
  if (!subWord) return;
  if (subWord.dynamic || subWord.glob) { mark(s, "git subcommand known only at run time"); return; }
  const sub = subWord.text.toLowerCase();
  const args = rest.slice(i + 1);
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
    if (t === "--") { positional = args[j + 1]?.text ?? null; break; }
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
    positional = t;
    break;
  }
  const repo = positional ?? repoOpt;
  // A remote helper (`ext::sh -c …`) runs a program instead of naming a place.
  if (repo !== null && /^[A-Za-z][A-Za-z0-9+.-]*::/.test(repo)) { mark(s, "git push to a remote helper"); return; }
  add(s, { kind: "git", remote: repo, dir });
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

/** Runs `git <args>` in `cwd`; the trimmed stdout, or null on any failure. */
export type GitRunner = (args: string[], cwd: string) => string | null;

/**
 * The destinations a reading sends to, resolving git remote names in `cwd` with `git`. `unknown` is set when
 * any of them cannot be named (then the host asks every time and remembers nothing).
 */
/**
 * Repository settings that send a push somewhere else than its address says, or run a program on the way
 * (an earlier silent `git config core.sshCommand …` then `git push` to a remembered remote, verify 2026-11-05).
 * Canonical key names are lowercase apart from the subsection, so the pattern is lowercase.
 */
export const GIT_TRANSPORT_KEYS = "^(core\\.(sshcommand|gitproxy|askpass)|http\\..*(proxy|curloptresolve)|https?\\.(proxy|curloptresolve)|gpg\\..*program|remote\\..*\\.(receivepack|proxy|vcs|uploadpack)|protocol\\..*\\.allow)$";

export function resolveOutwardDestinations(reading: OutwardReading, cwd: string | null, git: GitRunner, opts: { nestedRepo?: boolean } = {}): { destinations: string[]; unknown: string | null } {
  const out = new Set<string>();
  let unknown = reading.unknown;
  for (const t of reading.targets) {
    if (t.kind === "dest") { out.add(t.destination); continue; }
    if (!cwd) { unknown ??= "no work folder to read git remotes in"; continue; }
    const dir = t.dir ? path.resolve(cwd, t.dir) : cwd;
    // The agent's shell keeps its folder between commands: with another repository inside the work folder, a bare
    // `git push` may run there, so a remote name or a relative path cannot be placed.
    if (opts.nestedRepo && (t.remote === null || !/[:/]/.test(t.remote) || /^\.\.?\//.test(t.remote))) { unknown ??= "another repository inside the work folder"; continue; }
    if (git(["config", "--get-regexp", GIT_TRANSPORT_KEYS], dir)) { unknown ??= "repository settings change how a push travels"; continue; }
    let remote = t.remote;
    if (remote === null) {
      const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], dir);
      remote = (branch && (git(["config", "--get", `branch.${branch}.pushRemote`], dir) || null))
        || git(["config", "--get", "remote.pushDefault"], dir)
        || (branch && (git(["config", "--get", `branch.${branch}.remote`], dir) || null))
        || "origin";
    }
    const named = /^[A-Za-z0-9._-]+$/.test(remote) ? git(["remote", "get-url", "--push", "--all", remote], dir) : null;
    if (named) {
      for (const line of named.split(/\r?\n/).filter(Boolean)) {
        const d = gitDestination(line, dir);
        if (d) out.add(d); else unknown ??= "a remote address is not plain";
      }
      continue;
    }
    if (t.remote === null) { unknown ??= "the default push remote has no address"; continue; }
    // A written-out address: an insteadOf / pushInsteadOf rewrite would send it elsewhere.
    if (git(["config", "--get-regexp", "^url\\..*insteadof$"], dir)) { unknown ??= "url rewrites are configured"; continue; }
    const d = gitDestination(remote, dir);
    if (d) out.add(d); else unknown ??= "the push address is not plain";
  }
  return { destinations: [...out].sort(), unknown };
}
