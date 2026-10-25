// REQ-KNOW-35 (CGP-KNOW-R-019, DES-KNOW-35) — low free space on the workspace volume.
//
// When the volume that holds the open work folder has less free space than the threshold
// (setting `hypeproofChat.lowDiskWarningMB`, default 500 MB, machine scope so a workspace cannot
// silence it), the chat shows one persistent bar above the composer with a "공간 확보 방법"
// disclosure. The host measures before every turn starts (so the bar is up before the turn can
// write a file), after a turn ends, and when the panel asks (mount, visibility, focus, a timer).
//
// The bar only informs. It never holds a send, never offers a purchase or upgrade, and never
// touches files: everything already saved stays openable. An unreadable volume (statfs error,
// a hung network mount past the timeout) is "unknown": it shows nothing rather than a guess, and the
// host keeps a bar that is already up (chatPanelProvider.ts). A hung mount can delay a turn's start by
// at most the 2 s timeout.
//
// Pure apart from the injectable statfs: no vscode, no DOM. The host wiring is in
// chatPanelProvider.ts (refreshLowDisk).

import * as fs from "node:fs";

export const LOW_DISK_SETTING = "lowDiskWarningMB";
export const LOW_DISK_DEFAULT_MB = 500;
/** Upper bound for the setting: anything larger is treated as a typo and the default applies. */
export const LOW_DISK_MAX_MB = 1024 * 1024;
const MB = 1024 * 1024;

export const LOW_DISK_COPY = {
  text: "저장 공간이 거의 없어요. 새 파일이 저장되지 않을 수 있어요.",
  help: "공간 확보 방법",
  keep: "지금 있는 파일은 그대로 열 수 있어요. 공간이 생기면 이 안내는 저절로 사라져요.",
  classroom: ["선생님께 저장 공간이 부족하다고 알려 주세요."],
  darwin: ["휴지통을 비워요.", "다운로드 폴더에서 필요 없는 큰 파일을 지워요.", "시스템 설정 → 일반 → 저장 공간에서 정리할 항목을 볼 수 있어요."],
  win32: ["휴지통을 비워요.", "다운로드 폴더에서 필요 없는 큰 파일을 지워요.", "설정 → 시스템 → 저장소에서 정리할 항목을 볼 수 있어요."],
  other: ["휴지통을 비워요.", "다운로드 폴더에서 필요 없는 큰 파일을 지워요."],
} as const;

export interface LowDiskNotice {
  text: string;
  help: string;
  /** "남은 공간 312MB · 필요한 여유 500MB" — numbers only, from the measurement and the setting. */
  amounts: string;
  steps: string[];
  keep: string;
}

/**
 * The threshold in bytes. A finite number from 0 to LOW_DISK_MAX_MB is used as MB (0 turns the
 * warning off); anything else (a string, NaN, a negative or absurd value) falls back to the default.
 */
export function lowDiskThresholdBytes(setting: unknown): number {
  const mb = typeof setting === "number" && Number.isFinite(setting) && setting >= 0 && setting <= LOW_DISK_MAX_MB ? setting : LOW_DISK_DEFAULT_MB;
  return Math.floor(mb * MB);
}

export interface StatfsLike { bavail: number | bigint; bsize: number | bigint }
export type Statfs = (p: string) => Promise<StatfsLike>;
const nodeStatfs: Statfs = (p) => fs.promises.statfs(p);

/**
 * Free bytes available to this user on the volume holding `folder`, or null when it cannot be
 * read in time. Async with a timeout so a hung network mount never blocks a send.
 */
export async function freeBytesAt(folder: string, statfs: Statfs = nodeStatfs, timeoutMs = 2000): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stat = await Promise.race([
      statfs(folder),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!stat) return null;
    const free = Number(stat.bavail) * Number(stat.bsize);
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 312MB under 1 GB, else 1.5GB (one decimal, rounded down so the bar never overstates free space). */
export function formatBytes(bytes: number): string {
  const mb = Math.max(0, Math.floor(bytes / MB));
  if (mb < 1024) return `${mb}MB`;
  return `${(Math.floor((bytes / (1024 * MB)) * 10) / 10).toFixed(1)}GB`;
}

/**
 * The bar, or null. Null when the free space is unknown, the threshold is 0, or the free space
 * is at or above the threshold. Classroom and lesson learners are told to ask the teacher rather
 * than delete files on a class PC.
 */
export function lowDiskNotice(args: { free: number | null; threshold: number; platform: string; classroom: boolean }): LowDiskNotice | null {
  const { free, threshold } = args;
  if (free === null || !(threshold > 0) || free >= threshold) return null;
  const steps = args.classroom ? LOW_DISK_COPY.classroom
    : args.platform === "darwin" ? LOW_DISK_COPY.darwin
    : args.platform === "win32" ? LOW_DISK_COPY.win32
    : LOW_DISK_COPY.other;
  return {
    text: LOW_DISK_COPY.text,
    help: LOW_DISK_COPY.help,
    amounts: `남은 공간 ${formatBytes(free)} · 필요한 여유 ${formatBytes(threshold)}`,
    steps: [...steps],
    keep: LOW_DISK_COPY.keep,
  };
}

/** Stable key so an unchanged state is not re-posted (the live region would announce it again). */
export function lowDiskKey(notice: LowDiskNotice | null): string {
  return notice ? JSON.stringify(notice) : "";
}
