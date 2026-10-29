// REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025 / REQ-KNOW-43; PI#7, SX-01) — the memory overview: the stated
// facts in the activity's memory files, grouped by the task each came from. It is built here on this
// computer from the files themselves (no model writes it), and it never carries an ability, personality or
// capability statement: an item or task name that looks like one is left out of the overview and only
// counted. The check that decides this is also run on the finished overview before the host sends it.
// vscode-free, so a smoke drives exactly what the host runs.

import { CAPABILITY_MODELS } from "@hypeproof/measurement-core/capability-models";
import type { MemoryFile } from "./activityMemory";
import type { MemoryOverview, MemoryOverviewGroup } from "./activityMemoryView";

/** Capability keys of both models the product has used (FRAMING…OWNERSHIP and the legacy seven). Matched in any case. */
export const CAPABILITY_KEYS: readonly string[] = [...new Set(CAPABILITY_MODELS.flatMap(model => model.capabilities.map(c => c.key)))];
/** All their Korean labels. The longer ones are refused anywhere; the short ones only next to an evaluative word. */
const ALL_LABELS: readonly string[] = [...new Set(CAPABILITY_MODELS.flatMap(model => model.capabilities.map(c => c.label_ko)))];
/**
 * Labels that do not read as everyday words. Two-syllable labels (검증, 판단, 의도…) are ordinary nouns in a stated
 * fact; they are refused when an evaluative word follows them (EVALUATIVE_NEIGHBOUR) or an ability noun sits with them.
 */
export const CAPABILITY_LABELS: readonly string[] = ALL_LABELS.filter(label => label.replace(/\s/g, "").length > 2);
/** Nouns that name an ability or a personality. Any of them makes the sentence a statement about the person. */
export const ABILITY_NOUNS: readonly string[] = ["역량", "능력", "실력", "재능", "소질", "적성", "지능", "아이큐", "성격", "성향", "기질", "인성",
  "이해력", "집중력", "사고력", "표현력", "창의력", "판단력", "응용력", "기억력", "학습력", "리더십", "센스", "눈치", "감각이있", "감각이없",
  "머리회전", "습득이", "습득속도", "학습속도", "이해속도", "배우는속도", "학습자", "약점", "강점", "자존감", "자신감"];
/**
 * Evaluative words, deficit and habit verdicts and person-type labels, as stems with no spaces: they are matched on a
 * copy of the sentence with every space removed, so "소 심 함" and "못  해 요" are caught (SX-01, SX-12).
 */
export const EVALUATIVE_WORDS: readonly string[] = [
  "똑똑", "영리", "명석", "총명", "천재", "머리가좋", "머리가나쁘", "머리가나빠", "머리좋", "우수", "뛰어나", "뛰어난", "훌륭", "탁월", "대단한",
  "성실", "게으르", "게으른", "게을러", "부지런", "산만", "꼼꼼", "덜렁", "소심", "내성적", "외향적", "창의적", "논리적", "감성적", "소극적",
  "적극적", "수동적", "의존적", "공격적", "예민", "까다로", "고집", "끈기", "부족", "미흡", "미숙", "능숙", "서툴", "서툰",
  "잘하는", "잘해요", "잘한다", "잘합니다", "잘함", "못하는", "못해", "못한다", "못합니다", "못함", "잘이해", "이해가빠르", "이해가느리",
  "어려워해", "어려워함", "어려워한다", "포기하", "포기해", "포기함", "포기한다", "포기를잘", "약하다", "약해", "약함", "약한편", "강한편",
  "느림", "느린편", "빠른편", "느린학습", "속도가느리", "싫증", "짜증", "실망", "말을안듣", "말을잘안듣", "안듣는", "빼먹", "항상늦", "자주늦", "늘늦",
  "싫어하는학생", "싫어하는아이", "하는아이", "하는학생", "하는애", "한아이", "한학생", "인아이", "형인간",
  "노력파", "행동파", "감성파", "이성파", "천재파", "주의자", "문제아", "모범생", "우등생", "열등생", "상위권", "중위권", "하위권", "꼴찌",
];
/** Health, diagnosis and emotional-state words: never kept in an overview about a learner. */
export const HEALTH_WORDS: readonly string[] = ["adhd", "난독", "자폐", "우울", "불안(?!정)", "공황", "강박", "중독", "장애(?!물)", "진단", "트라우마", "틱장애", "경계성", "과잉행동", "주의력결핍"];
/** English evaluative, person-type and health words, matched as words (and, from five letters, inside a spaced-out copy). */
const ENGLISH_WORDS = ["smart", "clever", "genius", "gifted", "talented", "intelligent", "bright", "lazy", "careless", "diligent", "personality",
  "good at", "bad at", "weak at", "poor at", "strong at", "weak", "skill level", "struggles?", "struggling", "slow learner", "slow to learn",
  "gives? up", "giving up", "shy", "impatient", "perfectionist", "iq", "adhd", "dyslexi\\w*", "autis\\w*", "depress\\w*", "anxi\\w*",
  "disorder", "diagnos\\w*", "self-esteem", "troublemaker", "leader type"];
/** "너는 ~한 사람", "나는 ~인 편": a type of person, not a fact (the SX-12 shape); "~타입" alone too (not 타입스크립트). */
const PERSON_TYPE = /(?:당신|학생|너|나|저|이아이|그아이)[은는이가]?[^.\n]{0,20}(?:한사람|인사람|인편|한편|유형)|타입(?!스크립트)/;
/** An evaluative word right after a capability label: "검증이 약함", "판단 점수". */
const EVALUATIVE_NEIGHBOUR = "[^.\\n]{0,4}(?:높|낮|약|강|좋|나쁘|나빠|부족|훌륭|뛰어|점수|등급|레벨|수준)";

// Latin look-alikes from Cyrillic and Greek, folded so "smаrt" with a Cyrillic а is still "smart".
const CONFUSABLES: Record<string, string> = { "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x" };
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u3164\uFEFF\uFFA0]/g;

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_RE = new RegExp(`(?<![a-z])(?:${CAPABILITY_KEYS.map(key => escape(key.toLowerCase())).join("|")})(?![a-z])`);
const LABEL_RE = new RegExp(CAPABILITY_LABELS.map(label => escape(label.replace(/\s/g, ""))).join("|"));
const LABEL_NEAR_RE = new RegExp(`(?:${ALL_LABELS.map(label => escape(label.replace(/\s/g, ""))).join("|")})${EVALUATIVE_NEIGHBOUR}`);
const KOREAN_RE = new RegExp([...ABILITY_NOUNS, ...EVALUATIVE_WORDS].map(escape).join("|"));
const HEALTH_RE = new RegExp(HEALTH_WORDS.join("|"));
const ENGLISH_RE = new RegExp(`(?<![a-z])(?:${ENGLISH_WORDS.map(word => word.replace(/ /g, "\\s+")).join("|")})(?![a-z])`);
const ENGLISH_SPACED_RE = new RegExp(ENGLISH_WORDS.filter(word => /^[a-z]{5,}$/.test(word)).join("|"));
/**
 * Everyday words that contain a listed stem ("요약해" holds 약해, "아이디어" holds 아이, "라이센스" holds 센스): blanked out
 * of the compact copy before the Korean lists are matched, so a stated fact that uses them still reaches the overview.
 */
const EVERYDAY = /(?:예|요|절|계|공|조|협|제|규|축|치|농|화|비|생|간)약|아이(?:디|콘|템|스|패|폰|돌)|애니|(?:라이|넌|난)센스/g;
/** Three or more Hangul compatibility jamo in a row ("ㄸㅗㄱ"): a word spelled out letter by letter is not read, so it is refused. */
const LOOSE_JAMO = /[\u3131-\u318E]{3,}/;

/** The forms a sentence is compared in: NFKC, look-alikes folded, invisible characters removed, lower case; and that with no spaces. */
export function memoryCheckForms(raw: string): { text: string; compact: string } {
  const text = raw.normalize("NFKC").replace(INVISIBLE, "").replace(CONFUSABLE_RE, ch => CONFUSABLES[ch]).toLowerCase();
  return { text, compact: text.replace(/\s+/g, "") };
}

/**
 * Why a sentence may not be in the overview: `capability` (a capability key in any case, a long capability label, or a
 * short one followed by an evaluative word), `health` (a health, diagnosis or emotional-state word), `judgment` (an
 * ability or personality noun, an evaluative or deficit word, a person-type label, or a spelled-out word). null when it
 * reads as a stated fact. Best-effort: these are the known shapes, not every sentence a model or a person could write.
 */
export function memoryStatementRefusal(raw: string): "capability" | "health" | "judgment" | null {
  const { text, compact } = memoryCheckForms(raw);
  if (KEY_RE.test(text) || KEY_RE.test(compact) || LABEL_RE.test(compact) || LABEL_NEAR_RE.test(compact)) return "capability";
  if (HEALTH_RE.test(compact)) return "health";
  if (KOREAN_RE.test(compact.replace(EVERYDAY, "_")) || PERSON_TYPE.test(compact) || ENGLISH_RE.test(text) || ENGLISH_SPACED_RE.test(compact) || LOOSE_JAMO.test(raw.normalize("NFC"))) return "judgment";
  return null;
}

/** The task names the overview may show: the activity's tasks, listed and archived. */
export interface MemoryTaskTitle { id: string; title: string }

/** A group's title when its task id is absent, unknown, or its name reads as a judgment. */
export const NO_TASK_TITLE = "작업 정보가 없는 기억";
export const GONE_TASK_TITLE = "지금 목록에 없는 작업";
export const HIDDEN_TITLE = "이름을 요약에 넣지 않은 작업";

/**
 * Groups the readable items by task, newest group first, items newest first. Items whose text is not shown
 * (too large, not text, blank) are not part of the overview; items that fail the check are counted in `withheld`.
 */
export function buildMemoryOverview(entries: readonly Pick<MemoryFile, "name" | "at" | "text" | "task">[], tasks: readonly MemoryTaskTitle[]): MemoryOverview {
  const titles = new Map(tasks.map(task => [task.id, task.title]));
  const groups = new Map<string, MemoryOverviewGroup>();
  let withheld = 0;
  for (const entry of [...entries].sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : 1))) {
    const text = entry.text?.trim();
    if (!text) continue;
    if (memoryStatementRefusal(text)) { withheld++; continue; }
    const key = entry.task ?? "";
    let group = groups.get(key);
    if (!group) {
      const known = entry.task ? titles.get(entry.task) : undefined;
      const title = !entry.task ? NO_TASK_TITLE : known === undefined ? GONE_TASK_TITLE : memoryStatementRefusal(known) ? HIDDEN_TITLE : known;
      group = { task: entry.task, title, items: [] };
      groups.set(key, group);
    }
    group.items.push({ name: entry.name, at: entry.at, text });
  }
  return { groups: [...groups.values()], withheld };
}

/** The check on a finished overview: true only when no title or item carries a capability or judgment statement. */
export function memoryOverviewPasses(overview: MemoryOverview): boolean {
  return overview.groups.every(group => memoryStatementRefusal(group.title) === null && group.items.every(item => memoryStatementRefusal(item.text) === null));
}
