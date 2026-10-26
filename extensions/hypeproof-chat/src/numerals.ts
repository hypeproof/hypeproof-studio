// Shared numeral detector for the deck numbers rule (deck generation and slide suggestion chips,
// CGP-ART-R-016 / REQ-STUDIO-DECK-SLIDE-SUGGEST). A slide may show a number only when that exact value
// is already in the entries it cites. "Exact value" means both sides are read by the same parser and
// compared as canonical decimal strings, so "52" never supports "2" and "구십 퍼센트" equals "90%".
//
// What counts as a number, in any script:
// - every Unicode decimal digit (\p{Nd}: Arabic-Indic, Devanagari, Thai, full-width, …), mapped to ASCII;
// - other number characters (\p{No}, \p{Nl}): circled and superscript digits through NFKC, Roman numerals
//   (Ⅻ = 12) by value, and any other number character as itself (only that same character supports it);
// - Hanja numerals (九十, 三千, 〇);
// - Korean number words joined to a counter, unit or % (구십 퍼센트, 열 명, 아홉 명, 스무 살);
// - digits with a magnitude (3만 = 30000, 1.5천, 2억, 3k).
// Format characters (zero-width spaces, bidi marks) are removed first, so "5\u200B2" reads as 52.
// Parsing that is uncertain counts as a number: a false refusal costs one repair round, a made-up
// number on a pitch slide costs the learner's credibility. Pure and vscode-free.

const ND_RUN = /\p{Nd}/u;
const ndCache = new Map<number, string>();

/** The ASCII digit for one \p{Nd} code point. Unicode lays every decimal digit set out as a run of ten starting at 0. */
function ndValue(cp: number): string {
  const hit = ndCache.get(cp);
  if (hit !== undefined) return hit;
  let start = cp;
  while (start > 0 && ND_RUN.test(String.fromCodePoint(start - 1))) start--;
  const d = String((cp - start) % 10);
  ndCache.set(cp, d);
  return d;
}

/** NFKC, format and control characters removed, every decimal digit mapped to ASCII. */
export function foldNumerals(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cf}\u0000-\u0008\u000E-\u001F\u007F-\u009F]/gu, "")
    .replace(/\p{Nd}/gu, (ch) => (/[0-9]/.test(ch) ? ch : ndValue(ch.codePointAt(0)!)));
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_EXTRA: Record<string, number> = { "ↀ": 1000, "ↁ": 5000, "ↂ": 10000, "ↅ": 6, "ↆ": 50, "ↇ": 50000, "ↈ": 100000 };

function romanValue(s: string): number | null {
  const up = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return null;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = ROMAN[up[i]], next = ROMAN[up[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 ? total : null;
}

/** Canonical decimal string for a value: no exponent, no trailing zeros. */
function canon(n: number): string {
  if (!Number.isFinite(n)) return "NaN";
  const fixed = n.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

// ── Han (Hanja) numerals ──
const HAN_DIGIT: Record<string, number> = {
  "〇": 0, "零": 0, "一": 1, "壹": 1, "二": 2, "貳": 2, "弐": 2, "两": 2, "兩": 2, "三": 3, "參": 3, "叁": 3, "参": 3,
  "四": 4, "肆": 4, "五": 5, "伍": 5, "六": 6, "陸": 6, "七": 7, "柒": 7, "八": 8, "捌": 8, "九": 9, "玖": 9,
};
const HAN_SMALL: Record<string, number> = { "十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000 };
const HAN_BIG: Record<string, number> = { "万": 1e4, "萬": 1e4, "億": 1e8, "兆": 1e12 };
const HAN_RE = /[〇零一壹二貳弐两兩三參叁参四肆五伍六陸七柒八捌九玖十拾百佰千仟万萬億兆]+/gu;

/** Value of a Han numeral run, or a positional reading (〇 一 二 → "012") when it has no multiplier. */
function hanValue(run: string): string {
  const chars = [...run];
  if (chars.every((c) => c in HAN_DIGIT)) return canon(Number(chars.map((c) => HAN_DIGIT[c]).join("")));
  let total = 0, section = 0, digit = -1;
  for (const c of chars) {
    if (c in HAN_DIGIT) digit = HAN_DIGIT[c];
    else if (c in HAN_SMALL) { section += (digit < 0 ? 1 : digit) * HAN_SMALL[c]; digit = -1; }
    else if (c in HAN_BIG) { total += (section + Math.max(digit, 0) || 1) * HAN_BIG[c]; section = 0; digit = -1; }
  }
  return canon(total + section + Math.max(digit, 0));
}

// ── Korean number words ──
const SINO_DIGIT: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SINO_SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const SINO_BIG: Record<string, number> = { 만: 1e4, 억: 1e8, 조: 1e12 };

/** A Sino-Korean numeral word ("구십", "이십오", "삼천", "만"), or null when the syllables are not a well-formed number ("이사"). */
function sinoValue(word: string): number | null {
  let total = 0, section = 0, digit = -1;
  let prevKind = "";
  for (const c of word) {
    if (c in SINO_DIGIT) {
      if (prevKind === "digit") return null;
      digit = SINO_DIGIT[c]; prevKind = "digit";
    } else if (c in SINO_SMALL) {
      if (prevKind === "small") return null;
      section += (digit < 0 ? 1 : digit) * SINO_SMALL[c]; digit = -1; prevKind = "small";
    } else if (c in SINO_BIG) {
      if (prevKind === "big") return null;
      total += (section + Math.max(digit, 0) || 1) * SINO_BIG[c]; section = 0; digit = -1; prevKind = "big";
    } else return null;
  }
  return total + section + Math.max(digit, 0);
}

const NATIVE_TENS: Array<[string, number]> = [["스물", 20], ["스무", 20], ["서른", 30], ["마흔", 40], ["예순", 60], ["일흔", 70], ["여든", 80], ["아흔", 90], ["열", 10], ["쉰", 50]];
const NATIVE_UNITS: Array<[string, number]> = [["하나", 1], ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["여덜", 8], ["아홉", 9], ["한", 1], ["두", 2], ["둘", 2], ["세", 3], ["셋", 3], ["석", 3], ["네", 4], ["넷", 4], ["넉", 4]];
const NATIVE = new Map<string, number>([...NATIVE_TENS, ...NATIVE_UNITS]);

// Counters, units and % a Korean number word must be joined to (longest first so "시간" wins over "시").
const COUNTERS = [
  "퍼센트", "페이지", "사람", "가지", "개월", "번째", "시간", "주일", "단계", "군데", "마리", "차례", "학년", "프로", "포인트",
  "명", "분", "개", "번", "살", "세", "달", "해", "년", "월", "일", "주", "시", "초", "회", "차", "배", "곳", "대", "장", "권",
  "줄", "쪽", "칸", "건", "통", "표", "점", "원", "층", "반", "퍼", "%",
].sort((a, b) => b.length - a.length);
// What may follow the counter: the end of the word, a non-Hangul character or a particle. "세 분석" and
// "한 개념" are not numbers, "두 명이" and "열 번째" are.
const AFTER = "(?=$|[^가-힣]|이나|에서|으로|에게|까지|부터|밖에|이상|이하|이내|정도|보다|마다|짜리|가량|[이가을를은는의에도만씩째쯤과와로께중당뿐여])";
const COUNTER_RE = `(?:${COUNTERS.join("|")})`;
const NATIVE_WORD = `(?:${[...NATIVE_TENS.map((x) => x[0])].join("|")})?(?:${NATIVE_UNITS.map((x) => x[0]).join("|")})?`;
const NATIVE_RE = new RegExp(`(?<![가-힣])(${NATIVE_WORD})\\s?(${COUNTER_RE})${AFTER}`, "gu");
const SINO_RE = new RegExp(`(?<![가-힣])([일이삼사오육륙칠팔구십백천만억조]+)(\\s?)(${COUNTER_RE})${AFTER}`, "gu");

function nativeValue(word: string): number | null {
  if (!word) return null;
  for (const [tens, tv] of [["", 0] as [string, number], ...NATIVE_TENS]) {
    if (!word.startsWith(tens)) continue;
    const rest = word.slice(tens.length);
    if (!rest) return tv || null;
    const u = NATIVE_UNITS.find((x) => x[0] === rest);
    if (u) return tv + u[1];
  }
  return NATIVE.get(word) ?? null;
}

// Digits with a magnitude: 3만, 1.5천, 2억, 10万, 3k. The run of multipliers is read as a product (5천만 = 5 × 1000 × 10000).
const MAG: Record<string, number> = { 십: 10, 백: 100, 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12, "十": 10, "百": 100, "千": 1e3, "万": 1e4, "萬": 1e4, "億": 1e8, "兆": 1e12, k: 1e3, K: 1e3, M: 1e6, B: 1e9 };
const DIGIT_RE = /(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)((?:[십백천만억조十百千万萬億兆])+|[kKMB](?![A-Za-z]))?/g;

/**
 * Every number in a text as canonical value strings, in order of appearance (duplicates removed).
 * A number character with no known value is returned as itself.
 */
export function numberValues(text: string): string[] {
  const raw = String(text ?? "");
  const out: string[] = [];
  // Number forms in the raw text, before NFKC turns Ⅻ into the letters XII.
  for (const ch of raw.match(/[\p{Nl}\p{No}]/gu) ?? []) {
    if (ch in ROMAN_EXTRA) { out.push(canon(ROMAN_EXTRA[ch])); continue; }
    const k = foldNumerals(ch);
    if (/[0-9]/.test(k) || HAN_RE.test(k)) { HAN_RE.lastIndex = 0; continue; } // read below, after NFKC
    HAN_RE.lastIndex = 0;
    const r = romanValue(k);
    out.push(r !== null ? canon(r) : ch);
  }
  let t = foldNumerals(raw);
  t = t.replace(DIGIT_RE, (_m, num: string, mag: string | undefined) => {
    let v = Number(num.replace(/,/g, ""));
    for (const c of mag ?? "") v *= MAG[c] ?? 1;
    out.push(canon(v));
    return " ";
  });
  t = t.replace(HAN_RE, (run) => { out.push(hanValue(run)); return " "; });
  t = t.replace(SINO_RE, (m, word: string, space: string, _counter: string) => {
    // A single syllable must stand apart from its counter ("삼 명"); "이번", "구분" and "일주일" are words.
    if ([...word].length === 1 && !space) return m;
    const v = sinoValue(word);
    if (v === null) return m;
    out.push(canon(v));
    return " ";
  });
  t.replace(NATIVE_RE, (m, word: string, counter: string, offset: number, all: string) => {
    // "한 번에" / "한번에" (at once) and "한번" (just try) are idioms, not counts.
    if (word === "한" && counter === "번" && (all.slice(offset + m.length).startsWith("에") || !/\s/.test(m))) return m;
    // "한 단계씩" / "한 명씩" (one at a time) describe a pace, not a count.
    if (word === "한" && all.slice(offset + m.length).startsWith("씩")) return m;
    const v = nativeValue(word);
    if (v !== null) out.push(canon(v));
    return m;
  });
  return [...new Set(out)];
}

/**
 * Numbers in `slideText` whose exact value is absent from `cited` (both read by numberValues). This is
 * the deck numbers rule, shared by deck generation and slide suggestion chips.
 */
export function unsupportedNumbers(slideText: string, cited: string): string[] {
  const have = new Set(numberValues(cited));
  return numberValues(slideText).filter((n) => !have.has(n));
}

// ── Quantity words (owner decision, fix 2) ──
// Value equality cannot see a quantity it cannot parse ("절반", "열에 아홉", "첫째", "서너 명", "five users"),
// so a second, lexical rule runs beside it: a slide may not contain a quantity word that its source text
// (the cited entries, plus the slide's current face for a suggestion) does not contain. Both sides are read
// by quantityWords, so the comparison is token against token after normalization, never a substring.
// The lexicon is best-effort: a quantity said with a word outside it (e.g. "처음", "대부분", "몇") still passes.
const KO_END = "(?=$|[^가-힣]|[이가을를은는의에도만씩째쯤과와로께중당뿐여]|이나|에서|으로|에게|까지|부터|밖에|이상|이하|이내|정도|보다|마다|짜리|가량|꼴)";
const KO_START = "(?<![가-힣])";
const NATIVE_FREE = ["하나", "다섯", "여섯", "일곱", "여덟", "여덜", "아홉", "둘", "셋", "넷", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const NATIVE_COMPOUND = `(?:열|스물|서른|마흔|쉰|예순|일흔|여든|아흔)(?:하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|한|두|세|네)?`;
const QUANTITY_KO: RegExp[] = [
  // approximations and ranges
  new RegExp(`${KO_START}(한두|두세|두어|서너|너덧|너댓|대여섯|예닐곱|일여덟|삼사|사오|오륙|육칠|칠팔|팔구|[수몇][십백천만]+)`, "gu"),
  // fractions and parts
  new RegExp(`${KO_START}(절반|과반수?|반수|반)${KO_END}`, "gu"),
  /([0-9]+|[일이삼사오육칠팔구십백천만]+|한|두|세|네)\s?분의\s?([0-9]+|[일이삼사오육칠팔구십백천만]+|하나|둘|셋|넷)/gu,
  new RegExp(`${KO_START}([0-9]+|[일이삼사오육칠팔구십]+)할(?!\\s?수)${KO_END}`, "gu"),
  /십\s?중\s?팔\s?구/gu,
  // ordinals
  new RegExp(`${KO_START}(첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)째`, "gu"),
  new RegExp(`${KO_START}(첫|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|[0-9]+)\\s?번째`, "gu"),
  // native numerals standing alone or compound, and determiners before a noun (세 어르신, 첫 시험)
  new RegExp(`${KO_START}(${NATIVE_COMPOUND}|${NATIVE_FREE.join("|")})${KO_END}`, "gu"),
  new RegExp(`${KO_START}(한|두|세|네|석|넉|첫)(?=\\s+[가-힣])`, "gu"),
];
// Sino-Korean runs of two or more syllables that parse as a number (오십삼, 이십, 백만); single syllables
// only count next to a counter (numberValues), since 이/일/사 alone are everyday words.
const SINO_RUN = new RegExp(`${KO_START}([일이삼사오육칠팔구십백천만억]{2,})${KO_END}`, "gu");
const EN_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety", "hundred", "thousand", "million", "billion", "dozen", "half", "halves", "twice", "thrice", "percent", "percentage",
  "third", "thirds", "quarter", "quarters", "fifth", "fifths", "tenth", "tenths",
];
const EN_RE = new RegExp(`(?<![a-z])(${EN_WORDS.join("|")})(?![a-z])`, "g");

/** Quantity words in a text (normalized), for the "no new quantity words" rule. */
export function quantityWords(text: string): string[] {
  const t = foldNumerals(text).toLowerCase();
  const out: string[] = [];
  const idiom = (m: string, at: number) => m === "한" && /^\s*번에|^\s*[가-힣]+씩/.test(t.slice(at + 1));
  for (const re of QUANTITY_KO) {
    for (const m of t.matchAll(re)) {
      if (idiom(m[0], m.index!)) continue;
      out.push(m[0].replace(/\s+/g, ""));
    }
  }
  for (const m of t.matchAll(SINO_RUN)) if (sinoValue(m[1]) !== null) out.push(m[1]);
  for (const m of t.matchAll(EN_RE)) out.push(m[1]);
  if (t.includes("%")) out.push("%");
  return [...new Set(out)];
}

/** Quantity words in `slideText` that `source` does not contain as a quantity word. */
export function unsupportedQuantityWords(slideText: string, source: string): string[] {
  const have = new Set(quantityWords(source));
  return quantityWords(slideText).filter((w) => !have.has(w));
}
