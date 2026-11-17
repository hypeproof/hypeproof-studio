/**
 * CGP-DS-R-009 / CGP-SHELL-R-017: the learner chooses how large text reads: body and composer
 * 16/18/20px, every other line +2/+4px, in personal and classroom chat (help sheets included) and on
 * the start page. 44px targets stay as they are. The choice is a device preference (globalState),
 * not part of any lesson or activity; it is set in 대화 설정 (personal chat) or the start page 설정
 * sheet (every seat). The 15/17/20px sizes and the 보통 label in REQ-SHELL-17 are a recorded
 * difference (decisions/CGP-SHELL-R-017.md CGP-SHELL-R-017).
 */
export const TEXT_SIZES = ["base", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { base: "기본", large: "크게", xlarge: "아주 크게" };
export const TEXT_SIZE_KEY = "hypeproof.textSize";

export function normalizeTextSize(value: unknown): TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value) ? (value as TextSize) : "base";
}
