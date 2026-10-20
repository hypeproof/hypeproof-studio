// Conservative POSIX shell-word tokeniser for the destructive-command policy
// (REQ-M4a). Pure and vscode-free.
//
// This is NOT a shell parser. It reads just enough to answer "which words does
// the shell actually run as commands?": it removes quotes and backslash
// escapes the way the shell does, splits at the control operators, takes
// redirections out of the word list, and hands back every `$(...)`, backtick
// and `<(...)` body as a nested script for the caller to classify on its own.
//
// Whenever it meets something it does not model (an unbalanced quote, an
// unterminated substitution or heredoc, a trailing backslash) it records why
// in `uncertain` and stops. The caller treats an uncertain parse as
// destructive: the cost is one extra confirm, the risk it closes is a silent
// `rm -rf ~` that was spelled `\rm`.

export interface ShellWord {
  /** The word as the command receives it: quotes removed, escapes resolved. */
  text: string;
  /** Some part of the word was quoted or backslash-escaped. */
  quoted: boolean;
  /**
   * The word's value is only known at run time: it holds a parameter
   * expansion, a command or process substitution, or `$'...'` / `$"..."`.
   */
  dynamic: boolean;
  /** An unquoted `*`, `?` or `[`: the shell may expand it to other words. */
  glob: boolean;
  /** An unquoted `NAME=` (or `NAME+=`) prefix: a variable assignment. */
  assignment: boolean;
  /**
   * Every dynamic or glob part sits before the last `/`, so the basename is
   * known (`$HOME/bin/cloudflared` is cloudflared; `$CMD` and `/bin/r?` are not).
   */
  staticBasename: boolean;
}

export interface ShellRedirect {
  /** `>`, `>>`, `>|`, `&>`, `&>>`, `>&`, `<`, `<>`, `<&`. */
  op: string;
  /** The file-descriptor number written before the operator, if any. */
  fd?: string;
  target: ShellWord;
}

export interface ShellHeredoc {
  /** The delimiter was quoted, so the body is literal text (no expansion). */
  quoted: boolean;
  body: string;
}

export interface SimpleCommand {
  words: ShellWord[];
  redirects: ShellRedirect[];
  heredocs: ShellHeredoc[];
  herestrings: ShellWord[];
  /** Standard input comes from a pipe (`a | b`: true for b). */
  piped: boolean;
}

export interface ShellParse {
  commands: SimpleCommand[];
  /** Bodies of `$(...)`, backticks, `<(...)` and `>(...)`, to classify on their own. */
  nested: string[];
  /** Why the tokeniser gave up, or null. */
  uncertain: string | null;
}

const PARAM_START = /[A-Za-z_0-9@*#?$!-]/;
const NAME_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;

class WordBuilder {
  text = "";
  quoted = false;
  dynamic = false;
  glob = false;
  /** Text read before the first quoted or escaped part; decides `assignment`. */
  private literalPrefix = "";
  private prefixOpen = true;
  /** Text length just after the last dynamic or glob part; -1 when there is none. */
  private unknownEnd = -1;
  /** Text index of the last literal `/`; -1 when there is none. */
  private lastSlash = -1;

  private addText(s: string): void {
    const slash = s.lastIndexOf("/");
    if (slash >= 0) this.lastSlash = this.text.length + slash;
    this.text += s;
  }

  addLiteral(s: string): void {
    if (s === "*" || s === "?" || s === "[") {
      this.glob = true;
      this.unknownEnd = this.text.length + 1;
    }
    this.addText(s);
    if (this.prefixOpen) this.literalPrefix += s;
  }

  addQuoted(s: string): void {
    this.addText(s);
    this.quoted = true;
    this.prefixOpen = false;
  }

  addDynamic(raw: string): void {
    this.text += raw;
    this.unknownEnd = this.text.length;
    this.dynamic = true;
    this.prefixOpen = false;
  }

  finish(): ShellWord {
    return {
      text: this.text,
      quoted: this.quoted,
      dynamic: this.dynamic,
      glob: this.glob,
      assignment: NAME_ASSIGNMENT.test(this.literalPrefix),
      staticBasename: this.unknownEnd <= this.lastSlash,
    };
  }
}

/**
 * Index of the `)` that closes the `(` at `open`, skipping quoted text,
 * escapes and nested parentheses; -1 when there is none.
 */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", k + 1);
      if (end < 0) return -1;
      k = end;
      continue;
    }
    if (c === '"' || c === "`") {
      const end = closingQuote(src, k);
      if (end < 0) return -1;
      k = end;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Index of the unescaped `"` or backtick closing the one at `open`; -1 when there is none. */
function closingQuote(src: string, open: number): number {
  const q = src[open];
  for (let k = open + 1; k < src.length; k++) {
    if (src[k] === "\\") {
      k++;
      continue;
    }
    if (src[k] === q) return k;
  }
  return -1;
}

/** Index of the `}` closing `${` at `open` (the `$`); -1 when there is none. */
function closingBrace(src: string, open: number): number {
  let depth = 0;
  for (let k = open + 1; k < src.length; k++) {
    if (src[k] === "\\") {
      k++;
      continue;
    }
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Inside backticks, `\\`, `` \` `` and `\$` are escapes; nothing else is. */
function unescapeBackticks(body: string): string {
  return body.replace(/\\([\\`$])/g, "$1");
}

export function parseShell(src: string): ShellParse {
  const out: ShellParse = { commands: [], nested: [], uncertain: null };
  const fail = (why: string) => {
    if (!out.uncertain) out.uncertain = why;
  };
  const newCommand = (piped: boolean): SimpleCommand => ({ words: [], redirects: [], heredocs: [], herestrings: [], piped });

  let cmd = newCommand(false);
  let word: WordBuilder | null = null;
  let pending: { op: string; fd?: string } | null = null;
  const pendingHeredocs: { delim: string; strip: boolean; quoted: boolean; cmd: SimpleCommand }[] = [];
  const w = (): WordBuilder => (word ??= new WordBuilder());

  const endWord = () => {
    if (!word) return;
    const done = word.finish();
    word = null;
    if (!pending) {
      cmd.words.push(done);
      return;
    }
    const { op, fd } = pending;
    pending = null;
    if (op === "<<" || op === "<<-") {
      pendingHeredocs.push({ delim: done.text, strip: op === "<<-", quoted: done.quoted, cmd });
    } else if (op === "<<<") {
      cmd.herestrings.push(done);
    } else {
      cmd.redirects.push({ op, ...(fd !== undefined ? { fd } : {}), target: done });
    }
  };
  const endCommand = (nextPiped: boolean) => {
    endWord();
    if (pending) {
      fail(`redirection ${pending.op} has no target`);
      pending = null;
    }
    if (cmd.words.length || cmd.redirects.length || cmd.heredocs.length || cmd.herestrings.length) {
      out.commands.push(cmd);
    }
    cmd = newCommand(nextPiped);
  };
  /** Read the bodies of the heredocs opened on the line that ends at `nl`; returns the next index. */
  const readHeredocs = (nl: number): number => {
    let at = nl + 1;
    while (pendingHeredocs.length) {
      const h = pendingHeredocs.shift()!;
      const lines: string[] = [];
      let found = false;
      while (at <= src.length) {
        const next = src.indexOf("\n", at);
        const end = next < 0 ? src.length : next;
        const line = src.slice(at, end);
        at = end + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) {
          found = true;
          break;
        }
        lines.push(line);
        if (next < 0) break;
      }
      if (!found) {
        fail(`heredoc ${h.delim} is not terminated`);
        return src.length;
      }
      h.cmd.heredocs.push({ quoted: h.quoted, body: lines.join("\n") });
    }
    return at;
  };

  let i = 0;
  while (i < src.length && !out.uncertain) {
    const c = src[i];
    const n = src[i + 1];

    if (c === "\\") {
      if (n === "\n") {
        i += 2; // line continuation
        continue;
      }
      if (n === undefined) {
        fail("trailing backslash");
        break;
      }
      w().addQuoted(n);
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) {
        fail("unbalanced single quote");
        break;
      }
      w().addQuoted(src.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const b = w();
      b.addQuoted("");
      let k = i + 1;
      let closed = false;
      while (k < src.length) {
        const d = src[k];
        if (d === '"') {
          closed = true;
          break;
        }
        if (d === "\\" && k + 1 < src.length && '$`"\\\n'.includes(src[k + 1])) {
          if (src[k + 1] !== "\n") b.addQuoted(src[k + 1]);
          k += 2;
          continue;
        }
        if (d === "$" && src[k + 1] === "(") {
          const end = matchParen(src, k + 1);
          if (end < 0) break;
          out.nested.push(src.slice(k + 2, end));
          b.addDynamic(src.slice(k, end + 1));
          k = end + 1;
          continue;
        }
        if (d === "$" && src[k + 1] === "{") {
          const end = closingBrace(src, k);
          if (end < 0) break;
          b.addDynamic(src.slice(k, end + 1));
          k = end + 1;
          continue;
        }
        if (d === "$" && k + 1 < src.length && PARAM_START.test(src[k + 1])) {
          b.addDynamic("$");
          k++;
          continue;
        }
        if (d === "`") {
          const end = closingQuote(src, k);
          if (end < 0) break;
          out.nested.push(unescapeBackticks(src.slice(k + 1, end)));
          b.addDynamic(src.slice(k, end + 1));
          k = end + 1;
          continue;
        }
        b.addQuoted(d);
        k++;
      }
      if (!closed) {
        fail("unbalanced double quote or substitution inside one");
        break;
      }
      i = k + 1;
      continue;
    }
    if (c === "$") {
      if (n === "(") {
        const end = matchParen(src, i + 1);
        if (end < 0) {
          fail("unterminated $(");
          break;
        }
        out.nested.push(src.slice(i + 2, end));
        w().addDynamic(src.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      if (n === "{") {
        const end = closingBrace(src, i);
        if (end < 0) {
          fail("unterminated ${");
          break;
        }
        w().addDynamic(src.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      if (n === "'" || n === '"') {
        // $'...' decodes escapes (`$'\x72m'` is rm); $"..." is a translated
        // string. Neither is decoded here: the word is dynamic.
        const end = closingQuote(src, i + 1);
        if (end < 0) {
          fail(`unterminated $${n}`);
          break;
        }
        w().addDynamic(src.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      if (n !== undefined && PARAM_START.test(n)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(src.slice(i + 1));
        w().addDynamic("$" + (m ? m[0] : ""));
        i += 1 + (m ? m[0].length : 0);
        continue;
      }
      w().addLiteral("$");
      i++;
      continue;
    }
    if (c === "`") {
      const end = closingQuote(src, i);
      if (end < 0) {
        fail("unterminated backtick");
        break;
      }
      out.nested.push(unescapeBackticks(src.slice(i + 1, end)));
      w().addDynamic(src.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }
    if (c === "\n") {
      endCommand(false);
      i = pendingHeredocs.length ? readHeredocs(i) : i + 1;
      continue;
    }
    if (c === "#" && word === null) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === ";") {
      endCommand(false);
      i++;
      continue;
    }
    if (c === "&") {
      if (n === "&") {
        endCommand(false);
        i += 2;
        continue;
      }
      if (n === ">") {
        endWord();
        const append = src[i + 2] === ">";
        pending = { op: append ? "&>>" : "&>" };
        i += append ? 3 : 2;
        continue;
      }
      endCommand(false);
      i++;
      continue;
    }
    if (c === "|") {
      if (n === "|") {
        endCommand(false);
        i += 2;
        continue;
      }
      endCommand(true);
      i += n === "&" ? 2 : 1;
      continue;
    }
    if (c === "(" || c === ")") {
      endCommand(false);
      i++;
      continue;
    }
    if (c === "<" || c === ">") {
      if (n === "(") {
        // Process substitution: a word whose content is a command.
        const end = matchParen(src, i + 1);
        if (end < 0) {
          fail(`unterminated ${c}(`);
          break;
        }
        endWord();
        out.nested.push(src.slice(i + 2, end));
        w().addDynamic(src.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      let fd: string | undefined;
      // TypeScript cannot see the closures that assign `word`.
      const current = word as WordBuilder | null;
      if (current && !current.quoted && !current.dynamic && /^\d+$/.test(current.text)) {
        fd = current.text;
        word = null;
      } else {
        endWord();
      }
      if (pending) {
        fail("two redirections in a row");
        break;
      }
      let op: string;
      if (c === "<") {
        if (src.startsWith("<<<", i)) op = "<<<";
        else if (src.startsWith("<<-", i)) op = "<<-";
        else if (n === "<") op = "<<";
        else if (n === ">") op = "<>";
        else if (n === "&") op = "<&";
        else op = "<";
      } else {
        if (n === ">") op = ">>";
        else if (n === "|") op = ">|";
        else if (n === "&") op = ">&";
        else op = ">";
      }
      pending = { op, ...(fd !== undefined ? { fd } : {}) };
      i += op.length;
      continue;
    }

    w().addLiteral(c);
    i++;
  }

  if (!out.uncertain) {
    endCommand(false);
    if (pendingHeredocs.length) fail(`heredoc ${pendingHeredocs[0].delim} has no body`);
  }
  return out;
}

/** Quote a word so that parseShell reads it back as exactly that one word. */
export function shellQuote(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}
