/**
 * CGP-DS-R-009: the learner chooses how large chat text reads. Body sizes per mode: classroom
 * 13/15/17px, personal 15/17/19px; the composer follows. 44px targets stay as they are. The choice
 * is a device preference (globalState), not part of any lesson or activity.
 */
export const TEXT_SIZES = ["base", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { base: "기본", large: "크게", xlarge: "아주 크게" };
export const TEXT_SIZE_KEY = "hypeproof.textSize";

export function normalizeTextSize(value: unknown): TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value) ? (value as TextSize) : "base";
}
