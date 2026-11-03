// Shell policy for the coach's Bash tool (epic #431). Pure + vscode-free so
// every rule here is locked by unit tests rather than by a lecture-day repro.
//
// DESIGN STANCE — deliberately NOT an allowlist.
//
// An earlier draft scoped shell to a prefix allowlist (`git`, `wrangler`, …).
// That was rejected for a reason worth recording: a narrow allowlist makes the
// coach INVENT detours when the task needs something off the list, which is the
// exact failure class as #428's fabricated `/app/workdir` — the model fills a
// gap it cannot fill honestly. Telling it the truth about what it can run
// removes the gap. So: any command may be proposed, and the APPROVAL MODAL is
// the gate. That mirrors how Claude Code itself works.
//
// What this module does provide, because "arbitrary commands" without it is
// just a footgun on the participant's real Mac (no container, no sandbox):
//
//   1. `isDestructiveCommand` — the small set that is unrecoverable when
//      approved by reflex. These get a stronger, never-remembered confirm.
//      Unix verbs first, then PowerShell and cmd (FO-11, see the Windows
//      section below).
//   2. `commandSignature` — the "always allow" key, so a participant approving
//      `git commit` fifteen times in the 20:35 block isn't trained to
//      rubber-stamp. Returns null whenever a command cannot be safely
//      summarized, which forces a fresh modal.
//   3. `scrubSecrets` — coach output travels through the gateway to the model.
//      A `cat ~/.git-credentials` would otherwise put a live PAT in the prompt.

import { parseShell, shellQuote, type ShellRedirect, type ShellWord } from "./shellWords.ts";

/**
 * Shell metacharacters. Their presence means the string is not ONE command:
 * it chains, substitutes, pipes, or redirects. Such a command may still run
 * (the participant can approve it) but it can never be reduced to a stable
 * signature — `git status; rm -rf ~` must not be remembered as "git status".
 */
const SHELL_METACHARACTERS = /[;&|><`$(){}\n\r]/;

/**
 * Commands whose damage is not undoable by the participant in a workshop
 * setting. Matched on the RESOLVED command word, so `sudo rm` and a chained
 * `... && rm -rf ~` both land here.
 *
 * Deliberately short. This is not a security boundary — an approved shell can
 * do anything. It is a speed bump on the handful of verbs that turn a
 * mis-click into a lost afternoon (or a lost patient-records folder).
 */
const DESTRUCTIVE_COMMANDS = new Set([
  "rm", "rmdir", "shred", "unlink",
  "sudo", "su", "doas",
  "dd", "mkfs", "diskutil", "fdisk",
  "chmod", "chown", "chgrp",
  "kill", "killall", "pkill",
  "mv",
  "truncate",
  "launchctl", "systemctl",
  "defaults",
  "npm", "npx", "pnpm", "yarn",
]);

/**
 * Subcommand-level exceptions: the base command is on the destructive list for
 * its OTHER forms, but this particular form is routine in the curriculum.
 * `npm install` / `npx wrangler pages deploy` are the 20:35 block's bread and
 * butter — flagging them as destructive would make the strong confirm
 * meaningless through overuse, which is the failure we are trying to avoid.
 */
const DESTRUCTIVE_EXCEPTIONS = new Set([
  "npm install", "npm i", "npm ci", "npm run", "npm test", "npm list",
  "npx wrangler", "npx vite", "npx serve",
  "pnpm install", "pnpm run", "yarn install", "yarn run",
]);

/** Argument patterns that make an otherwise-ordinary command destructive. */
const DESTRUCTIVE_ARG_PATTERNS: readonly RegExp[] = [
  /\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/,   // rewrites remote history
  /\bgit\s+reset\b[^\n]*\s--hard\b/,          // discards uncommitted work
  /\bgit\s+clean\b[^\n]*-[a-zA-Z]*[fd]/,      // deletes untracked files
  /\bgit\s+checkout\s+--\s/,                  // discards file changes
  /\bgit\s+branch\b[^\n]*\s-D\b/,
  // Output redirection, but ONLY the shape that can destroy the participant's
  // work: stdout to a path that is not scratch. Measured on a real run (#431
  // B5 verification): the naive `>` rule fired on 3 of 4 commands the coach
  // issued — `2>/dev/null`, `> /tmp/cf_tunnel.log 2>&1`. A strong confirm that
  // fires on noise-suppression is worse than none: it trains the reflex-approve
  // this whole gate exists to prevent.
  //
  //   NOT destructive:  2>/dev/null · 2>&1 · >/dev/null · > /tmp/x · >> file
  //   destructive:      > index.html · > ~/notes.md · 1> report.txt
  //   `1>` IS stdout (destructive); `2>`..`9>` are stderr/other fds; `>>` appends.
  /(?<![2-9&>])>(?!>)\s*(?!\/dev\/null|\/tmp\/|&)[^\s|&;]/,
  /\bcurl\b[^\n]*\|\s*(ba)?sh\b/,             // pipe-to-shell
  /\bwget\b[^\n]*\|\s*(ba)?sh\b/,
  /\bnpm\s+publish\b/,
];

/**
 * Words that INTRODUCE another command rather than being the command. Without
 * these, `ls | xargs rm -rf ~` reads as an `xargs` call and the `rm` hides one
 * word deeper — the exact shape a head-of-segment-only scan misses.
 */
const COMMAND_INTRODUCERS = new Set([
  "xargs", "env", "time", "nice", "nohup", "command", "exec", "builtin",
  "sh", "bash", "zsh", "dash", "-exec", "-execdir", "-c", "then", "else", "do",
]);

function commandWords(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Strip quoted runs so a commit MESSAGE mentioning "rm" isn't read as one. */
function stripQuoted(command: string): string {
  return command.replace(/'[^']*'/g, " '' ").replace(/"[^"]*"/g, ' "" ');
}

/** basename: `/bin/rm` → `rm`. */
function head(word: string): string {
  return word.replace(/^.*\//, "");
}

/**
 * Is this command one whose approval should NOT be remembered, and which
 * deserves a louder modal?
 *
 * Checks the command word of EVERY segment, because `git status && rm -rf ~`
 * is destructive even though it starts with `git`.
 *
 * Three passes, each of which can only add a flag:
 *   1. the raw-word Unix rules, unchanged since v0.1.56;
 *   2. the same verbs read from shell-normalised words (REQ-M4a): quotes and
 *      escapes removed, env assignments and wrappers dropped, nested shells
 *      and substitutions classified, and anything the tokeniser cannot read
 *      treated as destructive (`isDestructiveByNormalisedWords`);
 *   3. the PowerShell and cmd rules (`isWindowsDestructiveCommand`).
 */
export function isDestructiveCommand(command: string): boolean {
  if (!command || !command.trim()) return false;
  if (isLegacyUnixDestructive(command)) return true;
  if (isDestructiveByNormalisedWords(command)) return true;
  return isWindowsDestructiveCommand(command);
}

/** The v0.1.56 Unix rules over raw words. Kept as pass 1 so no old flag can disappear. */
function isLegacyUnixDestructive(command: string): boolean {

  // Quoted text is data, not shell syntax: `git commit -m "rm the header"` must
  // not trip the scan. Strip quoted runs BEFORE anything else looks at the
  // string — including the arg patterns below.
  //
  // 이 순서가 실측으로 틀렸던 자리다(2026-07-27). 예전에는 arg 패턴을 **원본**에
  // 걸었고, 그래서 읽기 전용 명령이 파괴적으로 분류됐다:
  //
  //   curl -sL "<url>" | python3 -c "import re; print(re.sub(r'<[^>]+>','',s))"
  //                                                          ^^^ 여기 `>]` 를
  //   출력 리다이렉트(`> 파일`)로 읽었다. 파이썬 정규식의 일부일 뿐인데.
  //
  // 결과는 「항상 허용」이 없는 강한 확인이 매 호출마다 뜨는 것 — 승인 게이트가
  // 교육 장치가 아니라 잡음이 된다. 따옴표 안을 먼저 비우면 사라진다.
  //
  // 살균이 진짜 위험을 가리지는 않는다: `rm -rf "$HOME"` 은 따옴표를 비워도
  // `rm -rf` 가 남아 아래 단어 스캔에 걸리고, `> "my file.txt"` 는 `> ""` 가 되어
  // 리다이렉트 규칙에 그대로 걸린다.
  const scannable = stripQuoted(command);

  for (const pattern of DESTRUCTIVE_ARG_PATTERNS) {
    if (pattern.test(scannable)) return true;
  }

  // Each chaining operator (and each substitution) starts a NEW command, so
  // scan every segment — `git status && rm -rf ~` is destructive even though
  // it starts with git.
  for (const segment of scannable.split(/[;&|]+|\$\(|`|\n/)) {
    const words = commandWords(segment.replace(/^[\s()]+/, ""));
    // Walk the segment tracking whether the next word is in COMMAND position.
    // Flags are transparent; introducers (xargs, sh -c, find -exec) hand the
    // command position to the following word.
    let expectCommand = true;
    for (let i = 0; i < words.length; i++) {
      const word = head(words[i]);
      if (COMMAND_INTRODUCERS.has(word)) {
        expectCommand = true;
        continue;
      }
      if (word.startsWith("-")) continue; // flag — does not consume the slot
      if (!expectCommand) continue;

      if (DESTRUCTIVE_COMMANDS.has(word)) {
        // On the list for its other forms — is THIS form routine?
        const next = words[i + 1] ? head(words[i + 1]) : "";
        if (DESTRUCTIVE_EXCEPTIONS.has(`${word} ${next}`.trim())) {
          expectCommand = false;
          continue;
        }
        return true;
      }
      // An ordinary command word: everything after it is its arguments.
      expectCommand = false;
    }
  }
  return false;
}

// ─── Shell-normalised words (REQ-M4a) ────────────────────────────────────────
//
// Pass 1 reads raw words, so the shell's own spelling rules hid the verb from
// it: `\rm`, `'rm'`, `r''m`, `FOO=1 rm`, `git push '--force'`, `bash -c "…"`
// and `echo "$(rm …)"` all ran without the strong confirm on the SDK path
// (independent verifier, 2026-10-20). This pass reads the words the shell
// will actually run (shellWords.parseShell), then applies the same verb list.
//
// Fail closed: anything the tokeniser or this classifier cannot read (an
// unbalanced quote, an unterminated substitution or heredoc, `eval`, a
// command word that is a variable or a glob, nesting deeper than
// NORMALISED_MAX_DEPTH) is destructive. The cost is one extra confirm; the
// risk it closes is silent deletion.

/** Nested scripts (`bash -c`, `$(…)`) deeper than this are flagged rather than read. */
const NORMALISED_MAX_DEPTH = 6;

/** Shells whose `-c` argument is a script and whose bare stdin is one too. */
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh"]);

/** Reserved words that introduce a command rather than being one. */
const SHELL_KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}"]);

/** Reserved words after which the rest of the simple command is not a command. */
const SHELL_NON_COMMAND_KEYWORDS = new Set(["for", "case", "select", "function", "esac", "in"]);

/** Wrapper options that take a value, so the value is not read as the command. */
const WRAPPER_VALUE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  env: new Set(["-u", "--unset", "-C", "--chdir", "-P"]),
  exec: new Set(["-a"]),
  time: new Set(["-o", "--output", "-f", "--format"]),
  nice: new Set(["-n", "--adjustment"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  caffeinate: new Set(["-t", "-w"]),
  xargs: new Set(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "-J", "-R", "-S", "--max-args", "--max-procs", "--max-chars", "--delimiter", "--arg-file", "--eof", "--replace", "--max-lines"]),
  git: new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]),
  stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
  ionice: new Set(["-c", "-n", "-p", "-P", "-u", "--class", "--classdata"]),
  watch: new Set(["-n", "--interval", "-q", "--equexit"]),
};

/** Wrappers that run the words after their options as a command. */
const COMMAND_WRAPPERS = new Set([
  "env", "command", "builtin", "exec", "time", "nice", "nohup", "timeout", "caffeinate", "xargs", "busybox",
  "stdbuf", "ionice", "unbuffer", "chronic",
]);

/** Redirection targets that hold nothing worth keeping (same as the `>` rule above). */
function isScratchTarget(target: ShellWord): boolean {
  if (target.dynamic) return false;
  if (target.text === "/dev/null") return true;
  return target.text.startsWith("/tmp/") && !target.text.split("/").includes("..");
}

/** A redirection that replaces a file's contents. `>>` appends; `2>` is stderr. */
function clobbers(r: ShellRedirect): boolean {
  if (r.fd !== undefined && r.fd !== "1") return false;
  if (r.op === ">&") {
    // `>&2` duplicates a descriptor; `>& file` is bash's `&> file`.
    if (!r.target.dynamic && /^(?:\d+|-)$/.test(r.target.text)) return false;
  } else if (r.op !== ">" && r.op !== ">|" && r.op !== "&>") {
    return false;
  }
  return !isScratchTarget(r.target);
}

/** `/bin/rm` → `rm`, `RM` → `rm` (macOS file systems are case-insensitive). */
function commandName(word: ShellWord): string {
  return word.text.replace(/^.*\//, "").toLowerCase();
}

/** Index of the first word after `name`'s options, starting at `from`. */
function skipOptions(words: readonly ShellWord[], from: number, name: string): number {
  const valued = WRAPPER_VALUE_OPTIONS[name] ?? new Set<string>();
  let j = from;
  while (j < words.length) {
    const t = words[j].text;
    if (t === "--") return j + 1;
    if (!t.startsWith("-") || t === "-") return j;
    if (valued.has(t)) j += 2;
    else j += 1;
  }
  return j;
}

function isDestructiveGit(args: readonly string[]): boolean {
  const sub = args[0];
  const rest = args.slice(1);
  const shortCluster = (a: string, letters: RegExp) => /^-[A-Za-z]+$/.test(a) && letters.test(a.slice(1));
  switch (sub) {
    case "push":
      return rest.some((a) =>
        a === "--force" || a.startsWith("--force-with-lease") || a === "--mirror" || a === "--delete" ||
        shortCluster(a, /[fd]/) || /^\+./.test(a) || /^:./.test(a));
    case "reset":
      return rest.includes("--hard") || rest.includes("--merge");
    case "clean":
      return rest.some((a) => a === "--force" || shortCluster(a, /[fdxX]/));
    case "checkout":
      return rest.some((a) => a === "--" || a === "." || a === "--force" || shortCluster(a, /f/));
    case "restore": {
      const staged = rest.some((a) => a === "--staged" || shortCluster(a, /S/));
      const worktree = rest.some((a) => a === "--worktree" || shortCluster(a, /W/));
      return !staged || worktree;
    }
    case "switch":
      return rest.some((a) => a === "--force" || a === "--discard-changes" || shortCluster(a, /f/));
    case "branch": {
      if (rest.some((a) => shortCluster(a, /D/))) return true;
      const del = rest.some((a) => a === "--delete" || shortCluster(a, /d/));
      const force = rest.some((a) => a === "--force" || shortCluster(a, /f/));
      return del && force;
    }
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear";
    default:
      return false;
  }
}

/**
 * Classify one simple command's words from `from`. `stdinIsScript` is true
 * when its standard input is a pipe, heredoc or here-string, which a shell
 * reading stdin runs as commands.
 */
function isDestructiveWords(words: readonly ShellWord[], from: number, stdinIsScript: boolean, depth: number): boolean {
  let i = from;
  for (let guard = 0; guard < 32; guard++) {
    while (i < words.length && (words[i].assignment || (!words[i].quoted && SHELL_KEYWORDS.has(words[i].text)))) i++;
    if (i >= words.length) return false;
    const word = words[i];
    if (!word.quoted && SHELL_NON_COMMAND_KEYWORDS.has(word.text)) return false;
    // A command word only known at run time (`$CMD`, `$'\x72m'`) or one the
    // shell expands (`/bin/r?`) could be any command.
    // `[` and `[[` are the test command and keyword, not bracket globs.
    if (!word.quoted && (word.text === "[" || word.text === "[[")) return false;
    if ((word.dynamic || word.glob) && !word.staticBasename) return true;
    const name = commandName(word);
    if (!name) return false;
    const args = words.slice(i + 1);
    const texts = args.map((a) => a.text);

    if (DESTRUCTIVE_COMMANDS.has(name)) {
      if (DESTRUCTIVE_EXCEPTIONS.has(`${name} ${texts[0] ?? ""}`.trim())) return false;
      return true;
    }
    if (name.startsWith("mkfs") || name.startsWith("newfs") || name === "eval" || name === "run0" || name === "pkexec") return true;

    if (POSIX_SHELLS.has(name)) {
      let j = i + 1;
      let script = false;
      let stdin = false;
      while (j < words.length) {
        const t = words[j].text;
        if (t === "--" || t === "-") {
          j++;
          break;
        }
        if (!/^[-+]/.test(t)) break;
        if (!t.startsWith("--")) {
          if (t.slice(1).includes("c")) script = true;
          if (t.slice(1).includes("s")) stdin = true;
        }
        j += t === "-o" || t === "+o" || t === "-O" || t === "+O" || t === "--rcfile" || t === "--init-file" ? 2 : 1;
      }
      if (script) {
        const body = words[j];
        if (!body) return false;
        return body.dynamic || isDestructiveNormalised(body.text, depth + 1);
      }
      // No script operand (or -s): the shell runs whatever stdin holds.
      if (stdin || j >= words.length) return stdinIsScript;
      return false; // a script file: its contents are not visible here
    }

    if (name === "source" || name === ".") {
      const file = args[0];
      return !!file && (file.dynamic || (stdinIsScript && /^\/dev\/(?:stdin|fd\/0)$/.test(file.text)));
    }

    if (name === "find") {
      for (let k = 0; k < args.length; k++) {
        const t = texts[k];
        if (t === "-delete") return true;
        if (t === "-exec" || t === "-execdir" || t === "-ok" || t === "-okdir") {
          let end = k + 1;
          while (end < args.length && texts[end] !== ";" && texts[end] !== "+") end++;
          if (isDestructiveWords(args.slice(k + 1, end), 0, false, depth)) return true;
          k = end;
        }
      }
      return false;
    }

    if (name === "git") {
      const j = skipOptions(words, i + 1, "git");
      if (j < words.length && words[j].dynamic) return true;
      return isDestructiveGit(words.slice(j).map((a) => a.text));
    }

    if (name === "command") {
      // `command -v rm` only looks the name up.
      let j = i + 1;
      while (j < words.length && words[j].text.startsWith("-") && words[j].text !== "--") {
        if (/[vV]/.test(words[j].text)) return false;
        j++;
      }
      if (words[j]?.text === "--") j++;
      i = j;
      continue;
    }

    if (name === "env") {
      let j = i + 1;
      while (j < words.length) {
        const t = words[j].text;
        if (words[j].dynamic) return true;
        if (t === "-S" || t === "--split-string" || t.startsWith("-S") || t.startsWith("--split-string=")) {
          const inline = t === "-S" || t === "--split-string" ? null : t.replace(/^(?:-S|--split-string=)/, "");
          const rest = words.slice(inline === null ? j + 2 : j + 1).map((a) => shellQuote(a.text));
          const split = inline ?? words[j + 1]?.text ?? "";
          return isDestructiveNormalised([split, ...rest].join(" "), depth + 1);
        }
        if (t === "--") {
          j++;
          continue;
        }
        if (t.startsWith("-") && t !== "-") {
          j += WRAPPER_VALUE_OPTIONS.env.has(t) ? 2 : 1;
          continue;
        }
        // env reads NAME=value itself, quoted or not.
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
          j++;
          continue;
        }
        break;
      }
      i = j;
      continue;
    }

    if (name === "watch") {
      // watch hands its arguments, joined, to `sh -c`.
      const j = skipOptions(words, i + 1, name);
      if (words.slice(j).some((a) => a.dynamic)) return true;
      return isDestructiveNormalised(words.slice(j).map((a) => a.text).join(" "), depth + 1);
    }
    if (name === "timeout") {
      i = skipOptions(words, i + 1, name) + 1; // the duration
      continue;
    }
    if (name === "busybox") {
      if (words[i + 1]?.text.startsWith("-")) return false;
      i++;
      continue;
    }
    if (COMMAND_WRAPPERS.has(name)) {
      i = skipOptions(words, i + 1, name);
      continue;
    }
    // An ordinary command: what follows is its arguments.
    return false;
  }
  return true; // more wrappers than any real command line has
}

function isDestructiveNormalised(command: string, depth: number): boolean {
  if (depth > NORMALISED_MAX_DEPTH) return true;
  const parsed = parseShell(command);
  if (parsed.uncertain) return true;
  for (const nested of parsed.nested) {
    if (isDestructiveNormalised(nested, depth + 1)) return true;
  }
  for (const cmd of parsed.commands) {
    if (cmd.redirects.some(clobbers)) return true;
    // An unquoted heredoc delimiter expands `$(…)` and backticks in the body.
    if (cmd.heredocs.some((h) => !h.quoted && /\$\(|`/.test(h.body))) return true;
    const stdinIsScript = cmd.piped || cmd.heredocs.length > 0 || cmd.herestrings.length > 0;
    if (isDestructiveWords(cmd.words, 0, stdinIsScript, depth)) return true;
  }
  return false;
}

/**
 * Pass 2 of isDestructiveCommand: the destructive-verb rules over the words
 * the shell will run, failing closed on anything it cannot read. Exported for
 * the smoke tests, which hold every other pass to "may only add a flag".
 */
export function isDestructiveByNormalisedWords(command: string): boolean {
  if (!command || !command.trim()) return false;
  return isDestructiveNormalised(command, 0);
}

// ─── Windows shells: PowerShell and cmd (FO-11, orchestrator spec §6.4) ─────
//
// Every rule above is Unix-only. On a Windows seat that meant
// `Remove-Item -Recurse -Force .\site` and `irm https://… | iex` auto-ran
// without even a normal modal: the SDK shell gate (sdkCoachHelpers
// evaluateSdkToolUse) runs whatever this module does not call destructive.
//
// This pass only runs after the Unix rules said "not destructive", and it only
// adds flags. Its command words are PowerShell and cmd verbs, and its patterns
// need PowerShell or cmd syntax (`| iex`, `-ExecutionPolicy`, `cmd /c`,
// Set-Content), so a Unix command keeps the verdict it had. The smoke test
// holds the v0.1.56 function as an oracle for that. Two listed aliases are
// also Unix tools and now prompt on a Mac too, as the spec lists them: `iex`
// (Elixir's shell) and `ri` (Ruby's docs).
//
// Matching follows the shells: case-insensitive, with `\` and `/` path heads
// and an .exe/.com/.cmd/.bat suffix stripped, so `C:\Windows\System32\reg.exe`
// is `reg`.

/** Command words, matched in every segment like the Unix list. */
const WINDOWS_DESTRUCTIVE_COMMANDS = new Set([
  // Spec §6.4, as listed.
  "remove-item", "ri", "del", "erase", "rd",
  "format-volume", "clear-disk",
  "stop-process", "spps",
  "set-executionpolicy",
  "invoke-expression", "iex",
  "reg", "takeown", "icacls", "cipher", "vssadmin", "bcdedit",
  "remove-itemproperty",
  "move-item", "mi",
  "clear-content",
  // The other built-in Windows PowerShell aliases of those cmdlets. `rm`,
  // `rmdir`, `mv` and `kill` are aliases too, but they are Unix-list words and
  // stay with the Unix rules. `sc` is Set-Content in Windows PowerShell and the
  // service controller in cmd: it changes something either way.
  "move", "clc", "rp", "sc",
  // cmd's forms of Unix-list verbs: taskkill for kill/pkill, format and
  // diskpart for mkfs/fdisk, runas for su.
  "taskkill", "format", "diskpart", "runas",
]);

/** Shells whose next word is a command again, and whose arguments are a command (`-Command`, `/c`). */
const WINDOWS_SHELLS = new Set(["powershell", "pwsh", "cmd"]);

/** Patterns over the masked command (quoted text cannot match). */
const WINDOWS_DESTRUCTIVE_ARG_PATTERNS: readonly RegExp[] = [
  // A download piped into a shell: PowerShell's `curl | sh`.
  /\b(?:irm|iwr|invoke-restmethod|invoke-webrequest|curl|wget)\b[^\n]*\|\s*(?:iex|invoke-expression|powershell|pwsh|cmd)\b/i,
  // cmd deleting through /c or /k, including the upper-case RMDIR that the
  // case-sensitive Unix list does not see.
  /\bcmd(?:\.exe)?\s+\/[ck]\s+(?:del|erase|rd|rmdir)\b/i,
  // Elevation, the Windows sudo.
  /\b(?:start-process|saps|start)\b[^\n;&|]*\s-verb\s+runas\b/i,
];

/** The PowerShell CLI's -Command by the prefixes it accepts: -c, -com … -command. */
const PS_COMMAND_PARAM = /^-c(?:om(?:m(?:a(?:n(?:d)?)?)?)?)?$/;
const PS_FILE_PARAM = /^-f(?:i(?:l(?:e)?)?)?$/;
/** -EncodedCommand (-e, -ec, -enc …): a command nobody at the modal can read. */
const PS_ENCODED_PARAM = /^-(?:e|ec|en[a-z]*)$/;
/** -ExecutionPolicy (-ex, -exec … and -ep). */
const PS_POLICY_PARAM = /^-(?:ex[a-z]*|ep)$/;
/** CLI parameters that take a value, so the value is not read as the command. */
const PS_VALUE_PARAM = /^-(?:w|wi|win[a-z]*|v|ve|ver[a-z]*|inputformat|if|outputformat|of|o|configurationname|config|psconsolefile|settingsfile|workingdirectory|wd)$/;

/** Set-Content and Out-File: PowerShell's form of the `>` rule above. */
const WINDOWS_WRITE_COMMANDS = new Set(["set-content", "out-file"]);
/**
 * Where a write destroys nothing, as `/tmp/` and `/dev/null` are for `>`:
 * the temp folder by its usual spellings, and the null devices.
 */
const WINDOWS_TEMP_TARGET =
  /^(?:\$env:(?:temp|tmp)\b|\$\{env:(?:temp|tmp)\}|%(?:temp|tmp)%|\/tmp\/|\/dev\/null$|\$null$|nul$|(?:[a-z]:)?[\\/](?:windows[\\/])?temp[\\/])|[\\/]appdata[\\/]local[\\/]temp[\\/]/i;
/** A target that is an expression, e.g. `(Join-Path $env:TEMP log.txt)`, is temp if it names the temp folder. */
const WINDOWS_TEMP_EXPRESSION = /\$env:(?:temp|tmp)\b|gettemppath|gettempfilename|new-temporaryfile/i;

/**
 * Same quoted runs as stripQuoted, but each keeps its length: the quote marks
 * stay and the content becomes \u0001, so an offset into the mask is an offset
 * into the command. The rules look at the mask; values are read from the
 * command.
 */
function maskQuoted(command: string): string {
  const fill = (run: string) => run[0] + "\u0001".repeat(run.length - 2) + run[run.length - 1];
  return command.replace(/'[^']*'/g, fill).replace(/"[^"]*"/g, fill);
}

/**
 * Heredoc bodies are data here too: in `python3 - <<'EOF'` a line `del x` is
 * Python's del, not cmd's. Windows shells have no heredocs, so nothing these
 * rules look for can hide in one. Masked like quoted text, offsets kept.
 */
function maskHeredocs(command: string, masked: string): string {
  let out = masked;
  for (const opener of command.matchAll(/(?<!<)<<(?!<)-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
    const at = opener.index ?? 0;
    if (masked[at] !== "<") continue; // inside quoted text
    const newline = command.indexOf("\n", at);
    if (newline < 0) continue;
    let end = command.length;
    for (let line = newline + 1; line < command.length; ) {
      const next = command.indexOf("\n", line);
      const lineEnd = next < 0 ? command.length : next;
      if (command.slice(line, lineEnd).trim() === opener[2]) {
        end = line;
        break;
      }
      if (next < 0) break;
      line = next + 1;
    }
    out = out.slice(0, newline + 1) + out.slice(newline + 1, end).replace(/[^\n]/g, "\u0001") + out.slice(end);
  }
  return out;
}

/** `C:\Windows\System32\reg.exe` → `reg`; `Remove-Item` → `remove-item`. */
function windowsHead(word: string): string {
  return word.replace(/^.*[\\/]/, "").toLowerCase().replace(/\.(?:exe|com|cmd|bat)$/, "");
}

/** A cmd switch such as /s, /q, /c or /a:h. */
function isCmdSwitch(word: string): boolean {
  return /^\/[a-z?](?::\S*)?$/i.test(word);
}

interface WindowsToken {
  /** The token in the mask: quoted content is hidden. */
  masked: string;
  /** The same span of the command with its outer quotes removed. */
  value: string;
}

/**
 * Segments split at `;`, `&`, `|`, line breaks and braces, as tokens.
 * Parentheses stay inside a segment: `(Join-Path $env:TEMP log.txt)` is one
 * argument of Out-File.
 */
function windowsSegments(command: string, masked: string): WindowsToken[][] {
  const segments: WindowsToken[][] = [];
  for (const segment of masked.matchAll(/[^;&|\n\r{}]+/g)) {
    const tokens: WindowsToken[] = [];
    for (const token of segment[0].matchAll(/\S+/g)) {
      const start = (segment.index ?? 0) + (token.index ?? 0);
      const text = command.slice(start, start + token[0].length);
      const quoted = text.length >= 2 && (text[0] === "'" || text[0] === '"') && text[text.length - 1] === text[0];
      tokens.push({ masked: token[0], value: quoted ? text.slice(1, -1) : text });
    }
    if (tokens.length > 0) segments.push(tokens);
  }
  return segments;
}

/** `-Path:index.html` → ["-path", "index.html"]; `-Force` → ["-force", undefined]. */
function splitParameter(token: WindowsToken): [string, string | undefined] {
  const colon = token.value.indexOf(":");
  if (colon < 0) return [token.value.toLowerCase(), undefined];
  const value = token.value.slice(colon + 1);
  return [token.value.slice(0, colon).toLowerCase(), value.replace(/^(['"])(.*)\1$/s, "$2")];
}

/** Commands nested in shells this deep are flagged rather than unwrapped further. */
const WINDOWS_PAYLOAD_DEPTH = 4;
let windowsPayloadDepth = 0;

/**
 * What `powershell -Command …` or `cmd /c …` will run. Their shells are
 * case-insensitive, so the payload is also read in lower case (`RM -r` is
 * `rm -r` there). Every rule applies to it, Unix ones included: this is a
 * Windows shell's command line, not a Unix command.
 */
function isDestructivePayload(payload: string): boolean {
  if (!payload.trim()) return false;
  if (windowsPayloadDepth >= WINDOWS_PAYLOAD_DEPTH) return true;
  windowsPayloadDepth++;
  try {
    return isDestructiveCommand(payload) || isDestructiveCommand(payload.toLowerCase());
  } finally {
    windowsPayloadDepth--;
  }
}

/**
 * A PowerShell CLI call: its own parameters come first and end at -Command,
 * -File or the first positional word (Windows PowerShell runs that word as the
 * command; pwsh runs it as a file). Flags a bypassed or unrestricted execution
 * policy and an encoded command among those parameters, and scans the command
 * it is given. Words after -File belong to the script and are not read here.
 */
function isDestructivePowerShellCall(tokens: readonly WindowsToken[], pwsh: boolean): boolean {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.masked.startsWith("-")) {
      return pwsh ? false : isDestructivePayload(tokens.slice(i).map((t) => t.value).join(" "));
    }
    const [name, inline] = splitParameter(token);
    if (PS_COMMAND_PARAM.test(name)) {
      const rest = tokens.slice(i + 1).map((t) => t.value);
      return isDestructivePayload([inline ?? "", ...rest].join(" "));
    }
    if (PS_FILE_PARAM.test(name)) return false;
    if (PS_ENCODED_PARAM.test(name)) return true;
    if (PS_POLICY_PARAM.test(name)) {
      const policy = (inline ?? tokens[i + 1]?.value ?? "").toLowerCase();
      if (policy === "bypass" || policy === "unrestricted") return true;
      if (inline === undefined) i++;
      continue;
    }
    if (PS_VALUE_PARAM.test(name) && inline === undefined) i++;
  }
  return false;
}

/** `cmd /c …` and `cmd /k …` run the rest of the line. */
function isDestructiveCmdCall(tokens: readonly WindowsToken[]): boolean {
  for (let i = 1; i < tokens.length; i++) {
    const switchName = tokens[i].masked.toLowerCase();
    if (switchName === "/c" || switchName === "/k") {
      return isDestructivePayload(tokens.slice(i + 1).map((t) => t.value).join(" "));
    }
    if (!isCmdSwitch(tokens[i].masked)) return false;
  }
  return false;
}

/** Set-Content and Out-File parameters that take a value, by unambiguous prefix. */
const PS_WRITE_VALUE_PARAMS: ReadonlyArray<readonly [string, number]> = [
  ["value", 2], ["encoding", 2], ["width", 1], ["inputobject", 2], ["stream", 2],
  ["filter", 2], ["include", 3], ["exclude", 2], ["credential", 2],
  // common parameters
  ["erroraction", 6], ["warningaction", 6], ["informationaction", 6], ["errorvariable", 6],
  ["warningvariable", 6], ["informationvariable", 6], ["outvariable", 4], ["outbuffer", 4],
  ["pipelinevariable", 4], ["ea", 2], ["wa", 2], ["infa", 4], ["ev", 2], ["wv", 2],
  ["iv", 2], ["ov", 2], ["ob", 2], ["pv", 2],
];
const PS_WRITE_PATH_PARAMS: ReadonlyArray<readonly [string, number]> = [
  ["path", 3], ["literalpath", 1], ["pspath", 3], ["lp", 2], ["filepath", 2],
];

function matchesParameter(name: string, table: ReadonlyArray<readonly [string, number]>): boolean {
  const bare = name.replace(/^-/, "");
  return table.some(([full, min]) => bare.length >= min && full.startsWith(bare));
}

/**
 * Set-Content or Out-File replacing a file that is not scratch. Appending
 * (`-Append`) and Out-File's `-NoClobber` overwrite nothing, like `>>`. A write
 * whose target cannot be read (a variable, the pipeline) is flagged.
 */
function isDestructiveWindowsWrite(tokens: readonly WindowsToken[]): boolean {
  let target: string | null = null;
  let targetIsExpression = false;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.masked.startsWith("-")) {
      const [name, inline] = splitParameter(token);
      const bare = name.slice(1);
      if ("append".startsWith(bare) || (bare.length >= 3 && ("noclobber".startsWith(bare) || "nooverwrite".startsWith(bare)))) {
        if (bare.length > 0 && !/^\$false$/i.test(inline ?? "")) return false;
        continue;
      }
      if (matchesParameter(name, PS_WRITE_PATH_PARAMS)) {
        const value = inline ?? tokens[++i]?.value ?? null;
        target = value;
        targetIsExpression = value !== null && /^\$?\(/.test(value);
        if (targetIsExpression) target = tokens.slice(i).map((t) => t.value).join(" ");
        continue;
      }
      if (matchesParameter(name, PS_WRITE_VALUE_PARAMS) && inline === undefined) i++;
      continue;
    }
    if (target === null) {
      targetIsExpression = /^\$?\(/.test(token.value);
      target = targetIsExpression ? tokens.slice(i).map((t) => t.value).join(" ") : token.value;
    }
  }
  if (target === null) return true;
  return !(targetIsExpression ? WINDOWS_TEMP_EXPRESSION.test(target) : WINDOWS_TEMP_TARGET.test(target));
}

/**
 * PowerShell and cmd rules, for a command the Unix rules passed. Exported only
 * through isDestructiveCommand.
 */
function isWindowsDestructiveCommand(command: string): boolean {
  const masked = maskHeredocs(command, maskQuoted(command));
  for (const pattern of WINDOWS_DESTRUCTIVE_ARG_PATTERNS) {
    if (pattern.test(masked)) return true;
  }

  // Command words in every segment. Besides the Unix separators, braces and
  // parentheses open a new command in PowerShell (`% { del $_ }`,
  // `$(Remove-Item x)`), and so does an assignment (`$r = Remove-Item x`).
  for (const segment of masked.split(/[;&|{}()\n\r]+|`/)) {
    let expectCommand = true;
    for (const word of commandWords(segment)) {
      const lower = word.toLowerCase();
      if (isCmdSwitch(word)) {
        if (lower === "/c" || lower === "/k") expectCommand = true;
        continue;
      }
      if (PS_COMMAND_PARAM.test(lower) || word === "=") {
        expectCommand = true;
        continue;
      }
      const name = windowsHead(word);
      if (WINDOWS_SHELLS.has(name) || COMMAND_INTRODUCERS.has(name)) {
        expectCommand = true;
        continue;
      }
      if (word.startsWith("-")) continue;
      if (!expectCommand) continue;
      if (WINDOWS_DESTRUCTIVE_COMMANDS.has(name)) return true;
      expectCommand = false;
    }
  }

  // Calls whose arguments decide: a PowerShell or cmd command line (quoted or
  // not) and a Set-Content/Out-File target.
  for (const tokens of windowsSegments(command, masked)) {
    if (/^['"]/.test(tokens[0].masked)) continue;
    const name = windowsHead(tokens[0].masked);
    if (name === "powershell" || name === "pwsh") {
      if (isDestructivePowerShellCall(tokens, name === "pwsh")) return true;
    } else if (name === "cmd") {
      if (isDestructiveCmdCall(tokens)) return true;
    } else if (WINDOWS_WRITE_COMMANDS.has(name)) {
      if (isDestructiveWindowsWrite(tokens)) return true;
    }
  }
  return false;
}

/**
 * Stable key for "이 명령은 항상 허용" within a session.
 *
 * Returns null — meaning "always ask, never remember" — when the command
 * cannot be safely summarized:
 *   - it is destructive (approving `rm` once must not approve it forever);
 *   - it contains shell metacharacters (the signature would describe only the
 *     first segment while the rest runs unreviewed).
 *
 * Otherwise the signature is the command word plus its first subcommand, so
 * `git commit -m "초안"` and `git commit -m "루브릭 반영"` share one key. That
 * is the point: the 20:35 block commits repeatedly, and a participant asked to
 * approve fifteen near-identical modals stops reading them.
 */
export function commandSignature(command: string): string | null {
  const trimmed = (command ?? "").trim();
  if (!trimmed) return null;
  if (SHELL_METACHARACTERS.test(trimmed)) return null;
  if (isDestructiveCommand(trimmed)) return null;

  const words = commandWords(trimmed);
  const head = words[0].replace(/^.*\//, "");
  const second = words[1];
  // A bare flag ("-m") is not a subcommand; a word is.
  if (second && /^[A-Za-z0-9]/.test(second)) return `${head} ${second}`;
  return head;
}

/**
 * What the approval modal shows for a shell command (REQ-M4a). The modal
 * re-derives the destructive flag from the command and ORs it with the flag
 * the caller carried, so a request that arrives without the SDK verdict's
 * flag still gets the strong confirm, and a flag is never dropped. A
 * destructive command has no signature, so "항상 허용" can never remember it.
 */
export function shellApprovalFor(command: string, flagged: boolean): { destructive: boolean; signature: string | null } {
  const destructive = flagged || isDestructiveCommand(command ?? "");
  return { destructive, signature: destructive ? null : commandSignature(command ?? "") };
}

/**
 * Reviewable command for the approval modal. Preserve the entire command and
 * line breaks: an operation in the middle matters as much as its first/last
 * word. Redact credentials before displaying it on a workshop projector.
 */
export function describeCommandForApproval(command: string): string {
  return scrubSecrets(command ?? "");
}

// ── Secret scrubbing ────────────────────────────────────────────────────────
// The coach's tool RESULTS are fed back into the model through the HypeProof
// gateway, so anything a command prints becomes prompt content and lands in
// logs. Without shell that was a non-issue; with it, `cat ~/.git-credentials`,
// `env`, or a wrangler error echoing its token are one approval away.

const SECRET_PATTERNS: readonly { re: RegExp; label: string }[] = [
  // GitHub — PAT (classic + fine-grained) and the OAuth/app token family.
  { re: /\bghp_[A-Za-z0-9]{20,}/g, label: "GITHUB_TOKEN" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, label: "GITHUB_TOKEN" },
  { re: /\bgh[ousr]_[A-Za-z0-9]{20,}/g, label: "GITHUB_TOKEN" },
  // Anthropic + generic OpenAI-style keys.
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, label: "ANTHROPIC_KEY" },
  { re: /\bsk-[A-Za-z0-9]{20,}/g, label: "API_KEY" },
  // AWS access key id.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS_KEY" },
  // Credentials embedded in a URL — exactly what ~/.git-credentials holds.
  { re: /(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g, label: "URL_CREDENTIALS" },
  // A HypeProof workshop/issuer token (base64url payload "." signature).
  { re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, label: "HYPEPROOF_TOKEN" },
  // Any KEY=value / KEY: value where the key NAMES a secret. Catches
  // CLOUDFLARE_API_TOKEN, CF_API_KEY, GH_TOKEN, DB_PASSWORD, … without
  // needing a pattern per vendor.
  {
    re: /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIAL)S?)\s*[=:]\s*["']?[^\s"'&]{8,}/gi,
    label: "SECRET_ASSIGNMENT",
  },
  // PEM private key blocks — replace the whole body, not just the header.
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    label: "PRIVATE_KEY",
  },
];

/**
 * Mask credentials in text that is about to travel to the model.
 *
 * Fail-safe by shape: each pattern replaces with a labeled placeholder, so the
 * coach can still reason about "there is a token here" without ever seeing it.
 * Over-masking is acceptable; under-masking leaks a live credential into a
 * prompt and a log line.
 */
export function scrubSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) {
    // Preserve the assignment's key name so `GH_TOKEN=***` still reads as a
    // token assignment rather than an opaque blob.
    if (label === "SECRET_ASSIGNMENT") {
      out = out.replace(re, (_m, key) => `${key}=«${label} 가려짐»`);
      continue;
    }
    if (label === "URL_CREDENTIALS") {
      out = out.replace(re, (_m, scheme) => `${scheme}«${label} 가려짐»@`);
      continue;
    }
    out = out.replace(re, `«${label} 가려짐»`);
  }
  return out;
}

/** Did scrubbing actually remove anything? Used to warn in the activity log. */
export function containsSecret(text: string): boolean {
  return !!text && scrubSecrets(text) !== text;
}
