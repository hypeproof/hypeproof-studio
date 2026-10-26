// CGP-LEARN-R-015 / REQ-CGP-LEARN-15 — the completion checklist helper in /authoring (이번 주 미션 · 완료 조건).
// A completion item says what the learner makes to be done ("무엇을 만들면 끝인가"), never points or grade levels
// (OUT-05, SX-35). The Service validator refuses score KEYS inside `learning`; this kit refuses score WORDS inside the
// item text, on the page (before anything is sent) and again in Chalk's forwarder (src/routes/forward.ts).
//
// The page has no module loader, so the kit lives inside ONE self-contained factory: index.ts serializes it with
// Function.prototype.toString() into the served HTML, and the tests and the forwarder call the very same function.
// Nothing inside the factory may reference module scope.

export type DoneSentence = { ok: true; text: string } | { ok: false; reason: "empty" | "clause" };

export function completionChecklistKit() {
  /** Controls, soft hyphen, zero-width, bidi embeddings/isolates, word joiners, U+2028/2029 and BOM. */
  const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u206F\uFEFF]/g;
  /** Words that are not a score although they start with 점 (점검, 점선 …): a number before them is a count, not points. */
  const NOT_POINTS = "검선심프자원포멸화토유령차";
  /**
   * Grading words (OUT-05: no points, no grade levels) and the SX-35 banned labels. A bare 점 is not banned: 차이점,
   * 장점, 관점 are ordinary observable words. 점 counts only after a number ("10점", "3 점"), after a Korean numeral
   * ("백점", "열 점"), or inside a score compound.
   *
   * Structural rule: rules run on the text with ALL whitespace removed ("collapsed"), so no spacing inside a word
   * ("만 점", "등 급", "우　수") can hide it. A match that overlaps an ALLOWED word is dropped, so collapsing never
   * turns an allowed word into a refusal (차이점 수 -> "차이점수" must not read as 점수). The allowed word shields only
   * when it is written contiguously: "성장 점수" or "성 장 점 수" contain 장점 only once the space is gone, so they stay
   * refused. Rules marked "raw" need a word boundary and run on the whitespace-preserved text instead.
   */
  const NUM_KO = "(?:영|공|십|백|천|열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔|다섯|여섯|일곱|여덟|아홉)";
  const RULES: Array<[string, RegExp, "collapsed" | "raw" | "strict"]> = [
    ["점", new RegExp("\\d+(?:[.,]\\d+)?점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["점", new RegExp(NUM_KO + "점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["점", new RegExp("(?<![가-힣])[일삼사오육칠팔구]\\s*점(?![" + NOT_POINTS + "])", "g"), "raw"],
    ["점", /\d+(?:[.,]\d+)?(?:pts?|points?)(?![a-z])/gi, "collapsed"],
    ["점", /\d+(?:[.,]\d+)?\s*(?:pts?|points?)\b/gi, "raw"],
    ["점", /[点點]/g, "collapsed"],
    ["학점", /학점/g, "collapsed"],
    ["점수", /점수/g, "collapsed"],
    ["배점", new RegExp("배점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["만점", new RegExp("만점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["감점", new RegExp("감점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["가점", new RegExp("(?<!추)가점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["총점", new RegExp("총점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["득점", new RegExp("득점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["평점", new RegExp("평점(?![" + NOT_POINTS + "])", "g"), "collapsed"],
    ["채점", /채점/g, "collapsed"],
    ["등급", /등급/g, "collapsed"],
    ["우수", /우수/g, "collapsed"],
    ["미흡", /미흡/g, "collapsed"],
    ["개선 필요", /개선필요/g, "collapsed"],
    ["낮음", /낮음/g, "collapsed"],
    ["높음", /높음/g, "collapsed"],
    ["상위 N%", /상위\d+(?:\.\d+)?%/g, "collapsed"],
    ["역량 부족", /역량부족/g, "collapsed"],
    ["AI 활용 고수", /AI활용고수/gi, "collapsed"],
    ["성장 점수", /성장점수/g, "strict"],
  ];
  /** Ordinary words that contain 점 or end in it; checked against the collapsed text. */
  const ALLOWED = /차이점|공통점|유사점|문제점|개선점|장점|단점|약점|강점|관점|요점|시점|접점|추가점|점검|점선|점심|점프|점자|점원|점멸|점화|점토|점유|점령/g;

  /** NFKC (fullwidth digits, compatibility Hangul), then every invisible/bidi/control character removed. */
  function fold(text: unknown): string {
    return String(text ?? "").normalize("NFKC").replace(INVISIBLE, "");
  }

  /** The first grading rule `text` breaks — its label and the matched words — or null. */
  function gradingMatch(text: unknown): { word: string; found: string } | null {
    const raw = fold(text);
    let collapsed = "";
    const collapsedAt = new Map<number, number>();   // raw index -> collapsed index
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charAt(i);
      if (/\s/.test(ch)) continue;
      collapsedAt.set(i, collapsed.length); collapsed += ch;
    }
    const allowed: Array<[number, number]> = [];
    for (const a of raw.matchAll(ALLOWED)) {
      const from = collapsedAt.get(a.index ?? 0), last = collapsedAt.get((a.index ?? 0) + a[0].length - 1);
      if (from !== undefined && last !== undefined) allowed.push([from, last + 1]);
    }
    for (const [word, re, scope] of RULES) {
      for (const m of (scope === "raw" ? raw : collapsed).matchAll(re)) {
        const at = m.index ?? 0, end = at + m[0].length;
        if (scope === "collapsed" && allowed.some(([s, e]) => at < e && end > s)) continue;
        return { word, found: m[0] };
      }
    }
    return null;
  }

  /** The first grading word in `text`, or null. Invisible characters cannot split a word to slip past (등\u200B급). */
  function gradingWord(text: unknown): string | null {
    return gradingMatch(text)?.word ?? null;
  }

  /** The teacher-facing refusal for one item, quoting the words found (“10점”, not the rule name), or null. */
  function itemProblem(text: unknown): string | null {
    const m = gradingMatch(text);
    return m === null
      ? null
      : "완료 조건에 ‘" + m.found + "’ 같은 점수·등급 말은 넣지 않습니다. 무엇을 만들면 끝인지 적으세요. 예: 첫 화면 시안 1개를 만들면 끝";
  }

  /** 을 after a final consonant, 를 after a vowel; 을(를) when the last letter is not a Hangul syllable. */
  function objectParticle(word: string): string {
    const c = word.codePointAt(word.length - 1) ?? 0;
    if (c < 0xac00 || c > 0xd7a3) return "을(를)";
    return (c - 0xac00) % 28 === 0 ? "를" : "을";
  }

  /**
   * The helper: turns "what to make" into the "…을 만들면 끝" sentence. An item that already ends in 끝 is kept as it is;
   * a full clause (…한다, …해요, …하면) is refused instead of being glued into a broken sentence. Never rewrites silently:
   * the page calls this only when the teacher presses the button.
   */
  function doneSentence(text: unknown): DoneSentence {
    const s = fold(text).replace(/\s+/g, " ").trim().replace(/[.。!?]+$/, "").trim();
    if (!s) return { ok: false, reason: "empty" };
    if (/끝(?:이에요|이다|입니다|나요)?$/.test(s)) return { ok: true, text: s };
    if (/(?:다|요|면|며|죠|까|게)$/.test(s)) return { ok: false, reason: "clause" };
    return { ok: true, text: s + objectParticle(s) + " 만들면 끝" };
  }

  return { fold, gradingMatch, gradingWord, itemProblem, doneSentence, objectParticle };
}

/** Every grading problem in a session-design `content.learning.completion`, as `[index, message]`. */
export function completionProblems(content: unknown): Array<[number, string]> {
  const kit = completionChecklistKit();
  const list = (content as { learning?: { completion?: unknown } } | null)?.learning?.completion;
  if (!Array.isArray(list)) return [];
  const out: Array<[number, string]> = [];
  list.forEach((item, i) => {
    const msg = kit.itemProblem((item as { text?: unknown } | null)?.text);
    if (msg) out.push([i, msg]);
  });
  return out;
}

export const COMPLETION_CHECKLIST_SCRIPT =
  "const completionChecklistKit=(" + completionChecklistKit.toString() + ")();";
