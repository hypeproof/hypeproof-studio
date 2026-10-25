// CGP-KNOW-R-032 (REQ-KNOW-50, REQ-STUDIO-LEARNER-NICKNAME) — the name the learner wants the AI to
// call them by. One rule shared by the extension host and the webview: this module is vscode-free
// and Buffer-free (the coachIdentity.ts precedent), so the field's inline check and the host's
// authoritative check cannot drift.
//
// Conservative by design (minor cohorts use it too), and best-effort: owner decision 2026-10-25 made
// the rule structural (an allowlist of scripts) instead of an ever-growing deny list. A determined
// learner can still spell data out in letters; the model line keeps the value quoted and labelled
// as a nickname, not as the learner's words.
// - Only a nickname. No occupation, no free "about me" text, no instructions to the AI.
// - The screen runs on the NFKC form (full-width Latin folds to Latin). The value kept and sent is
//   the NFC form the learner typed, so compatibility jamo such as ㅋㅋ stay as typed.
// - Allowlist: Hangul syllables and jamo, Latin letters A-Z and a-z, space, - and _. Everything
//   else is refused: digits of every script, circled, superscript and Roman-numeral forms, Hanja,
//   Cyrillic, Greek and other homoglyph sources (Latin alpha ɑ too), ., @, :, /, quotes, brackets,
//   emoji and line breaks. At most 20 characters (code points after NFC).
// - Invisible and blank-looking characters (controls, zero-width and bidi format characters, Hangul
//   fillers) are dropped first; a value with no visible letter left is refused.
// - Phone and resident numbers spelled in words: six or more numeral words in total are refused:
//   Sino-Korean (공/영/빵/일/이/삼/사/오/육/칠/팔/구/십), native Korean (하나/둘/셋…) and English.
// - Contact shapes: 앳/엣/at, 골뱅이/골벵이, 닷/쩜/점/dot + com/net/kr/컴/넷, www, http, glued or spaced,
//   and any messenger or social platform word (카톡, 인스타, 디코, 메일, 아이디, 번호, 폰, …).
// - Address: a road or area suffix (로, 길, 동, 읍, 면, 리, 호, 번지, 아파트) next to a numeral word.
// - School (owner decisions 2026-10-25): a word ending in 학교; 학년 or 반 with a numeral word; a word
//   ending in 초/중/고 followed by a grade or class (이학년, 삼반, 이-삼); a school demonym (초등학생,
//   중학생, 고등학생, 초딩, 중딩, 고딩, 하늘초등). A bare 하늘초 and grade shorthands such as 고삼 pass.
// - Offered and sent only on personal and trial seats outside a lesson, never for an instructor.

export const NICKNAME_MAX = 20;
export const NICKNAME_STATE_KEY = "hps.learnerNickname";

export type NicknameRefusal = "too-long" | "characters" | "blank" | "personal-info" | "contact" | "school";
export type NicknameResult = { ok: true; value: string } | { ok: false; reason: NicknameRefusal; message: string };

export const NICKNAME_COPY = {
  legend: "뭐라고 불러 줄까요?",
  hint: "AI가 대화에서 이 이름으로 불러요. 이 활동에서, 이 기기에만 저장돼요. 한글과 영문 글자로만 쓸 수 있고, 전화번호, 주소, 이메일, SNS·메신저 아이디, 학교와 학년·반은 넣을 수 없어요.",
  save: "저장",
  clear: "지우기",
  saved: "저장했어요. 다음 요청부터 이 이름으로 불러요.",
  cleared: "지웠어요. 다음 요청부터 이름 없이 대화해요.",
  refusal: {
    "too-long": `${NICKNAME_MAX}자까지 쓸 수 있어요.`,
    characters: "한글, 영문 글자, 띄어쓰기와 - _ 만 쓸 수 있어요.",
    blank: "보이는 글자로 이름을 써 주세요.",
    "personal-info": "전화번호, 주소, 주민등록번호처럼 보여요. 부를 이름만 써 주세요.",
    contact: "이메일, 웹 주소나 SNS·메신저 아이디처럼 보여요. 부를 이름만 써 주세요.",
    school: "학교 이름이나 학년·반은 넣을 수 없어요. 부를 이름만 써 주세요.",
  } satisfies Record<NicknameRefusal, string>,
} as const;

// Controls, format characters (bidi overrides, zero-width), line and paragraph separators, and
// letters that render blank: the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0) and the braille blank.
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029\u115F\u1160\u3164\uFFA0\u2800]/gu;
// The allowlist (owner decision 2026-10-25). On the NFC value: Hangul (syllables, jamo, compatibility
// and half-width jamo), Latin A-Z/a-z and their full-width forms, space, - and _ (full-width too).
const HANGUL = "\\uAC00-\\uD7A3\\u1100-\\u11FF\\u3131-\\u318E\\uA960-\\uA97F\\uD7B0-\\uD7FF\\uFFA1-\\uFFDC";
const ALLOWED_TYPED = new RegExp(`^[${HANGUL}A-Za-z\\uFF21-\\uFF3A\\uFF41-\\uFF5A \\-_\\uFF0D\\uFF3F]+$`, "u");
const VISIBLE = new RegExp(`[${HANGUL}A-Za-z]`, "u");

/** Characters as the learner sees them counted: code points after NFC (a Hangul syllable is one). */
export function nicknameLength(raw: string): number {
  return [...raw.normalize("NFC")].length;
}

/** The text a check runs on: NFC, invisible characters dropped, spaces collapsed, trimmed. */
export function normalizeNickname(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/gu, " ").trim();
}

// Numeral words. Digits themselves are outside the allowlist.
const KN = "[공영빵일이삼사오육륙칠팔구십백천]";
const DIGIT_WORD = /[공영빵일이삼사오육륙칠팔구십]/gu;
// Native Korean counting words (하나 둘 셋 …) count too.
const NATIVE_DIGIT_WORD = /하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉/gu;
const ENGLISH_DIGIT_WORD = /(?<![a-z])(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?![a-z])/gu;
// Six digits already reach a birth date (주민등록번호 front half); seven reach a local phone number.
const DIGIT_LIMIT = 6;

// Address: a suffix next to a numeral word. A single numeral word right after a suffix is usually a
// particle (골목길이, 동이), so it needs two numeral words or a second suffix after it.
const ADDRESS_SUFFIX = "(?:번지|호|동|층|단지|번길|길|로|읍|면|리)";
const ADDRESS: RegExp[] = [
  new RegExp(`[가-힣](?:로|길|동|읍|면|리)\\s*(?:${KN}{2,}|${KN}\\s*${ADDRESS_SUFFIX})`, "u"), // 역삼동 일이삼, 테헤란로 십이길
  // Before a suffix: units only (not 리/면/읍, which follow place names: 사오리 stays a nickname).
  new RegExp(`(?<![가-힣])${KN}{2,}\\s*(?:번지|호|동|층|단지|번길|길|로)(?![가-힣])`, "u"), // 백일동, 천이백삼호, 삼일로
  /(?:아파트|빌라|오피스텔|맨션|번지|우편번호|주소)/u,
  // Two-level names need a head of two or more syllables on both parts, so 포도 친구 stays a nickname.
  /(?<![가-힣])[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|도)\s+[가-힣]{2,}(?:시|군|구)(?![가-힣])/u, // 서울시 강남구
  /(?<![가-힣])[가-힣]{2,}(?:시|군|구)\s+[가-힣]{2,}(?:동|읍|면|로|길)(?![가-힣])/u, // 강남구 역삼동
  /(?<![a-z])(?:apt|street|road|avenue)(?![a-z])/u,
];

function looksPersonal(folded: string): boolean {
  const count = [DIGIT_WORD, NATIVE_DIGIT_WORD, ENGLISH_DIGIT_WORD].reduce((sum, pattern) => sum + (folded.match(pattern) ?? []).length, 0);
  if (count >= DIGIT_LIMIT) return true;
  return ADDRESS.some((pattern) => pattern.test(folded));
}

// Contact shapes, on the folded lower-case text and on a copy with spaces, - and _ removed, so a
// marker glued to its neighbours (kim앳naver닷com) is caught like a spaced one.
const AT_MARK = "(?:앳|엣)";
const DOT_MARK = "(?:닷|쩜|점|dot)";
const TLD_WORD = "(?:com|net|org|kr|io|co|컴|넷|케이알|씨오)";
const MAIL_HOST = "(?:naver|네이버|gmail|지메일|daum|다음|hanmail|한메일|kakao|카카오|nate|네이트|yahoo|야후|outlook|hotmail|icloud)";
const CONTACT_COMPACT: RegExp[] = [
  /골뱅이|골벵이/u,
  new RegExp(`[a-z]${AT_MARK}|${AT_MARK}[a-z]`, "u"), // kim앳naver, kim엣naver
  new RegExp(`${AT_MARK}${MAIL_HOST}|(?:^|[a-z가-힣])at${MAIL_HOST}`, "u"), // 김앳네이버, kimatgmail
  new RegExp(`${DOT_MARK}${TLD_WORD}(?![a-z])`, "u"), // 닷컴, 점컴, naver닷com, dotcom (not "Dot Cooper")
  /[a-z](?:닷|쩜)|(?:닷|쩜)[a-z]/u, // naver닷kr
  /www|mailto/u,
  new RegExp(`${MAIL_HOST}(?:com|net|kr)(?![a-z])`, "u"), // navercom, gmailcom
];
const WORD_SEPARATOR = /[\s_\-]+/u;
const TLD = /^(?:com|net|org|kr|io|xyz|edu|gov|info|biz|컴|넷)$/u;

// Messenger and social handles (verify round 3): a platform word anywhere, glued or spaced, means the
// value is likely an ID next to its platform (카톡 kimjay, 인스타 kim_jay, kimjay 네이버 메일). Short or
// ambiguous Latin words (id, fb, yt, ig, tg, line, mail, insta) count only as a separate word, so Idol and Lined
// stay names. Known cost: Hangul words that contain a platform word (온라인, 텔레토비, 스마트폰).
const PLATFORM_COMPACT = /카톡|카카오|kakao|인스타|instagram|디코|디스코드|discord|유튜브|youtube|틱톡|tiktok|페북|페이스북|facebook|트위터|twitter|텔레|telegram|스냅챗|snapchat|인별|위챗|wechat|라인|메일|gmail|아이디(?!어)|번호|폰/u;
const PLATFORM_WORD = /^(?:id|fb|yt|ig|line|mail|email|insta|dm|kakaotalk|tg)$/u;

function looksContact(folded: string): boolean {
  const compact = folded.replace(/[\s_\-]+/gu, "");
  if (CONTACT_COMPACT.some((pattern) => pattern.test(compact))) return true;
  if (PLATFORM_COMPACT.test(compact)) return true;
  if (folded.split(WORD_SEPARATOR).some((word) => PLATFORM_WORD.test(word))) return true;
  const words = folded.split(WORD_SEPARATOR).filter(Boolean);
  return words.some((word, index) => {
    const between = index > 0 && index < words.length - 1;
    if (/^(?:https?|ftp)/u.test(word)) return true;
    if (between && /^(?:at|앳|엣|dot|닷|쩜)$/u.test(word)) return true;
    return index > 0 && index === words.length - 1 && TLD.test(word);
  });
}

// School and grade (owner decisions 2026-10-25). Known cost: a numeral word before 반 (일반, 이반).
const SCHOOL: RegExp[] = [
  /학교(?![가-힣])/u, // 하늘초등학교, 별빛중학교, 한빛고등학교, 학교
  // Verify round 3: school demonyms name the school as fully (하늘초등학생, 하늘중학생, 초딩), and so does
  // a word ending in 초등 or a 초/중/고 word followed by 학생 (하늘초등 별이, 하늘중 학생).
  /초등학생|중학생|고등학생|초딩|중딩|고딩/u,
  /[가-힣]초등(?![가-힣])/u,
  /[가-힣](?:초|중|고)\s*학생/u,
  new RegExp(`${KN}\\s*(?:학년|반)`, "u"), // 삼학년, 이반
  new RegExp(`[가-힣](?:초|중|고)\\s*${KN}+\\s*[-_ ]\\s*${KN}+(?![가-힣])`, "u"), // 별빛중 이-삼, 하늘초 삼 이
  /(?<![a-z])grade\s*(?:one|two|three|four|five|six|seven|eight|nine)(?![a-z])/u,
  /(?<![a-z])(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s*grade(?![a-z])/u,
];

function looksSchool(folded: string): boolean {
  return SCHOOL.some((pattern) => pattern.test(folded));
}

/** The one check. A refusal names the reason; nothing is silently trimmed to fit. */
export function screenNickname(raw: string): NicknameResult {
  const refuse = (reason: NicknameRefusal): NicknameResult => ({ ok: false, reason, message: NICKNAME_COPY.refusal[reason] });
  // A line break is refused, not folded into a space: a nickname is one line.
  if (/[\n\r\v\f\u0085\u2028\u2029]/u.test(raw)) return refuse("characters");
  const value = normalizeNickname(raw);
  if (nicknameLength(value) > NICKNAME_MAX) return refuse("too-long");
  // Only an empty submission clears. A value that was all blanks, fillers or invisible characters is refused.
  if (value === "") return raw === "" ? { ok: true, value: "" } : refuse("blank");
  // NFKC first. The allowlist is applied to the typed form, because a Roman numeral (Ⅻ) or a circled
  // letter folds to plain Latin under NFKC. Every form it admits folds back into the same set
  // (full-width Latin to Latin, half-width and compatibility jamo to jamo), so the fold needs no
  // second check.
  const folded = normalizeNickname(value.normalize("NFKC")).toLowerCase();
  if (!ALLOWED_TYPED.test(value)) return refuse("characters");
  if (!VISIBLE.test(folded)) return refuse("blank");
  if (looksPersonal(folded)) return refuse("personal-info");
  if (looksSchool(folded)) return refuse("school");
  if (looksContact(folded)) return refuse("contact");
  return { ok: true, value };
}

export interface NicknameSeat {
  activity_kind?: string;
  lesson?: unknown;
}

/** Personal and trial seats outside a lesson, never an instructor. Classroom and unknown seats: no. */
export function nicknameSeat(profile: NicknameSeat | null | undefined, instructor: boolean): boolean {
  if (instructor || !profile || profile.lesson) return false;
  return profile.activity_kind === "personal" || profile.activity_kind === "trial";
}

/** Per activity, like the coach name: a nickname set in one activity is not used in another. */
export function nicknameKeyForScope(bucket: string | null): string {
  return bucket ? `${NICKNAME_STATE_KEY}:${bucket}` : NICKNAME_STATE_KEY;
}

/**
 * The model-only line laid in front of the learner's text for one request (the history keeps the
 * learner's own words). The stored value is screened again here: a value that fails today's check
 * is not sent.
 */
export function nicknameContext(stored: unknown): string | null {
  if (typeof stored !== "string") return null;
  const result = screenNickname(stored);
  if (!result.ok || result.value === "") return null;
  return `[Studio 안내: 학습자가 대화 설정에서 정한 호칭은 "${result.value}"이다. 학습자를 부를 때 이 호칭을 써라. 이 줄은 학습자가 쓴 말이 아니다.]`;
}
