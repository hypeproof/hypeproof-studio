// CGP-AGENT-R-004 (REQ-E1 / REQ-M17) — "이번 작업 동안 이 명령 허용".
//
// The shell approval used to offer "항상 허용 (<signature>)" and remembered it for the whole
// window session: switching to another task, another activity or another folder kept it. This
// module scopes that allow to ONE task and to ONE exact command. Pure and vscode-free;
// chatPanelProvider only supplies the scope parts and shows the modal.
//
// Scope. The allow belongs to the exact (cohort, activity, task, folder, folder-consent + its write
// time, instructor) tuple it was granted in. The store holds ONE scope at a time: the first time a
// different scope is observed, everything is forgotten, so going task A → task B → task A does not
// bring A's allow back. It lives in memory only: a window reload starts empty (the more
// conservative of "in memory" and "persisted per task", recorded in REQ-E1).
//
// What is remembered: the EXACT command, with runs of spaces and tabs collapsed and nothing else
// normalised. A deliberate deviation from the register row (REQ-CGP-AGENT-04 says "command prefix"):
// three adversarial rounds showed a "same kind" abstraction keeps widening, so any change asks again.
//
// Which commands can be remembered at all (round 5, "start conservative"). Five security reviews
// in a row found one more option of an allowed program that runs code or reaches outside the
// folder (`--upload-pack`, `git clone -u`, zsh `=cmd`, `npm install foo@file:..`, `host:path`).
// A denylist of options cannot be finished, so the offer is now a small POSITIVE allowlist of
// programs that cannot run another program or fetch remote code:
//   - ALLOW_COMMANDS: ls, cat, head, tail, wc, grep, pwd, echo, mkdir, touch;
//   - git, only as `git status|diff|log|show` with the subcommand as the second word (no global
//     option such as `-C` or `-c` before it), and only options from GIT_READ_OPTIONS (none of
//     them names a program, a file to write or another repository). `git commit` is not listed
//     because it runs the folder's hooks; clone/fetch/pull/push/submodule/ls-remote reach a remote.
// Package managers and interpreters (npm, pnpm, yarn, bun, node, python, pip) are never listed:
// `npm test` or `node a.js` re-runs whatever the folder's files hold at that moment. Everything
// outside the allowlist still runs with the normal one-time approval; it is just never offered
// "이번 작업 동안 이 명령 허용".
//
// Even an allowlisted exact repeat is never remembered when the command (see `taskCommandExact`):
//   - is destructive or chained (shellPolicy.commandSignature is null);
//   - has a quote, a backslash, `$` or a backtick anywhere;
//   - has an invisible, line-breaking or non-ASCII space character, or a format or filler character
//     that renders blank (Unicode Cf, variation selectors, U+034F, Hangul fillers U+115F/U+1160/
//     U+3164/U+FFA0, U+17B4/U+17B5, Mongolian selectors U+180B–U+180F, Braille blank U+2800): the
//     shell keeps them inside a word, so the argv differs from what the learner reads;
//   - has `@` or `:` in any argument word (package specs `foo@file:../x`, scp-style remotes
//     `host:../x`, URLs, drive letters);
//   - names an outside path in any word or option value (`/…`, `~…`, a `..` segment), or has a
//     word or option value that starts with `=` (zsh expands `=npm` to the program's absolute path);
//   - has a short flag with an attached value (`-n5`, `-f../x`), which can hide a path;
//   - is not read by shellWords.parseShell (the destructive check's tokeniser) as exactly one
//     simple command whose plain words are the key: a glob, a comment, an assignment, a redirect
//     or an uncertain parse asks again, so the key is always the argv that will actually run.
//
// Known residue, out of this key's reach: git reads the folder's own .git/config, which can name a
// program (core.fsmonitor, diff.external, a textconv driver); and a symlink inside the folder can
// point outside it. Changing either needs its own approved write first.

import { commandSignature } from "./shellPolicy.ts";
import { parseShell } from "./shellWords.ts";

/** The remember button on the shell approval modal. */
export const TASK_COMMAND_ALLOW_LABEL = "이번 작업 동안 이 명령 허용";

export interface TaskCommandExact {
  /** The remembered key: the command with runs of spaces and tabs collapsed. */
  key: string;
}

/**
 * The only first words a remembered command can have: programs that read or create files and
 * cannot run another program or fetch remote code. `git` is further limited by GIT_READ_SUBCOMMANDS.
 */
export const ALLOW_COMMANDS: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "pwd", "echo", "mkdir", "touch", "git",
]);
/** Read-only git subcommands; the subcommand must be the second word. */
export const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set(["status", "diff", "log", "show"]);
/** The only options an allowlisted git command may carry. None names a program, a file or a repository. */
export const GIT_READ_OPTIONS: ReadonlySet<string> = new Set([
  "-s", "-b", "-sb", "-p", "--short", "--branch", "--porcelain", "--long",
  "--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--cached", "--staged",
  "--oneline", "--graph", "--all", "--decorate", "--reverse", "--patch", "--no-color", "--",
]);
const QUOTING = /['"\\$`]/;
/**
 * Invisible or line-breaking characters (ASCII escapes so this file stays plain): C0/C1 controls
 * other than tab, NBSP, soft hyphen, U+1680, U+2000–U+200F, U+2028–U+202F, U+205F–U+206F, U+3000, U+FEFF.
 */
const INVISIBLE = /[\u0000-\u0008\u000A-\u001F\u007F-\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/;
/**
 * Format and filler characters that render blank but are not in INVISIBLE: every Unicode Cf
 * (U+2061, tag characters U+E0000–U+E007F, …), the variation selectors, the combining grapheme
 * joiner, the Hangul fillers, the Khmer inherent vowels, the Mongolian free variation selectors
 * (U+180B–U+180F) and the Braille blank (U+2800).
 */
const FORMAT = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
/** Every Unicode space separator except U+0020. */
const NON_ASCII_SPACE = /(?! )\p{Zs}/u;
/** An outside path: absolute, home, or a `..` segment. URLs, remotes and drive letters carry `:` or `@`. */
const OUTSIDE = /^[\/~]|(?:^|\/)\.\.(?:\/|$)/;
/** A package spec (`foo@file:..`), a remote (`host:path`, `git@x`), a URL or a drive letter. */
const SPEC_OR_REMOTE = /[@:]/;

/** The exact-command key, or null when even an exact repeat must be asked again. */
export function taskCommandExact(command: string): TaskCommandExact | null {
  if (commandSignature(command) === null) return null;
  const body = (command ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
  if (!body || INVISIBLE.test(body) || NON_ASCII_SPACE.test(body) || QUOTING.test(body)) return null;
  if (FORMAT.test(body)) return null;
  const words = body.split(/[ \t]+/);
  if (!ALLOW_COMMANDS.has(words[0])) return null;
  if (words[0] === "git") {
    if (!GIT_READ_SUBCOMMANDS.has(words[1])) return null;
    if (words.slice(2).some((w) => w.startsWith("-") && !GIT_READ_OPTIONS.has(w))) return null;
  }
  for (const w of words.slice(1)) {
    if (SPEC_OR_REMOTE.test(w)) return null;
    // A short flag with an attached value (`-n5`, `-f../x`): never remembered.
    if (/^-[^-]/.test(w) && !/^-[A-Za-z]+$/.test(w)) return null;
    const value = w.includes("=") ? w.slice(w.indexOf("=") + 1) : w;
    if (OUTSIDE.test(w) || OUTSIDE.test(value)) return null;
    // zsh equals expansion: `=cmd` becomes the absolute path of cmd (`echo =npm`).
    if (w.startsWith("=") || value.startsWith("=")) return null;
  }
  // The key must be the argv the shell will actually run (REQ-M4a's shellWords tokeniser). Read
  // the command the way the destructive check reads it, and remember it only when that reading is
  // certain and is word-for-word the key: one simple command, no redirect, heredoc, substitution,
  // glob, assignment or comment. Anything else (including a tokeniser that is unsure) asks again.
  if (!isExactlyWhatRuns(body, words)) return null;
  return { key: words.join(" ") };
}

function isExactlyWhatRuns(body: string, words: readonly string[]): boolean {
  let parsed;
  try {
    parsed = parseShell(body);
  } catch {
    return false;
  }
  if (parsed.uncertain !== null || parsed.nested.length > 0 || parsed.commands.length !== 1) return false;
  const [cmd] = parsed.commands;
  if (cmd.piped || cmd.redirects.length > 0 || cmd.heredocs.length > 0 || cmd.herestrings.length > 0) return false;
  if (cmd.words.length !== words.length) return false;
  return cmd.words.every((w, i) => !w.quoted && !w.dynamic && !w.glob && !w.assignment && w.text === words[i]);
}

export interface TaskCommandAllowScope {
  cohort: string | null;
  activity: string | null;
  task: string | null;
  folder: string | null;
  /** The folder-consent decision for the open folder: skip | full | read | none | ask | refuse. */
  consent: string;
  /** When that decision was last written (any window): a full → read → full flip elsewhere changes it. */
  consentAt?: number | null;
  instructor: boolean;
}

export function taskCommandAllowScopeKey(s: TaskCommandAllowScope): string {
  return JSON.stringify([s.cohort ?? null, s.activity ?? null, s.task ?? null, s.folder ?? null, s.consent, s.consentAt ?? null, s.instructor === true]);
}

/** Folder consent that lets a shell command run at all. Anything else refuses before any allow is read. */
export function shellAllowedByFolderConsent(consent: string): boolean {
  return consent === "skip" || consent === "full";
}

/** In-memory allows for the current task. Never persisted. */
export class TaskCommandAllows {
  private scopeKey: string | null = null;
  private readonly kinds = new Set<string>();
  private gen = 0;

  /** Bumped on every forget; an answer given across a bump (a modal open during a task switch) is not remembered. */
  get generation(): number {
    return this.gen;
  }

  /** Forgets everything when the scope differs from the one the allows were granted in. */
  observe(scopeKey: string): void {
    if (this.scopeKey === scopeKey) return;
    this.kinds.clear();
    this.scopeKey = scopeKey;
    this.gen++;
  }

  has(scopeKey: string, kindKey: string): boolean {
    this.observe(scopeKey);
    return this.kinds.has(kindKey);
  }

  remember(scopeKey: string, kindKey: string): void {
    this.observe(scopeKey);
    this.kinds.add(kindKey);
  }

  clear(): void {
    this.kinds.clear();
    this.scopeKey = null;
    this.gen++;
  }

  get size(): number {
    return this.kinds.size;
  }
}
