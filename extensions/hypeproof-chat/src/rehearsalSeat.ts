// #4048 (chalk#17) — a same-window rehearsal. The instructor credential moves to REHEARSAL_RETURN_KEY while the
// learner seat runs (the issuer key is empty), and comes back when the rehearsal ends, after a restart, or after a failed
// return is retried. Pure: no vscode import. The host (extension.ts) supplies the secrets, folders and dialogs.
import { ISSUER_TOKEN_KEY } from "./mintStudentTokenHelpers.ts";

export const REHEARSAL_RETURN_KEY = "chalk.rehearsal.returnIssuer";
export const REHEARSAL_SEAT_KEY = "chalk.rehearsal.seat";
export const RESUME_QUESTION = "리허설 중에 앱이 닫혔습니다. 리허설을 이어갈까요, 끝내고 강사로 돌아갈까요?";
export const RESUME_CONTINUE = "이어가기";
export const RESUME_RETURN = "끝내고 돌아가기";
export const RETURN_FAILED = "강사 자격으로 돌아가지 못했습니다. 앱을 다시 켜면 다시 시도합니다.";

export type SeatPhase = "entering" | "inside" | "returning";
export interface SeatRecord {
  phase: SeatPhase;
  rehearsalId: string;
  /** Epoch milliseconds when the student token expires. */
  expiresAt: number;
  homeFolder: string;
  rehearsalFolder: string;
  pendingToken?: string;
}
export interface SeatSecrets {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export interface SeatHost {
  /** SecretStorage as seen by the activity wrap: TOKEN_KEY goes through the activity connection. */
  secrets: SeatSecrets;
  currentRoot(): string | undefined;
  /** The dedicated rehearsal folder for one rehearsal (canonical spelling, not chosen by the learner). */
  rehearsalFolderFor(rehearsalId: string): string;
  makeFolder(folder: string): void;
  /** Opens the folder in this window (forceReuseWindow). The window reloads; the promise may reject. */
  openFolder(folder: string): Promise<void>;
  /** Stores the student token under the activity wrap, so it binds to the current (rehearsal) folder. */
  bindStudentToken(token: string): Promise<void>;
  /** Drops the rehearsal activity record and binding for a folder, and disconnects if it is this window. */
  releaseStudentBinding(folder: string): Promise<void>;
  /** Shows the restart question. Undefined when dismissed. */
  askResume(): Promise<"resume" | "return" | undefined>;
  notify(message: string): void;
  now(): number;
}

export class RehearsalSeatError extends Error {}

const parseSeat = (raw: string | undefined): SeatRecord | undefined => {
  if (!raw) return undefined;
  try { const s = JSON.parse(raw); return typeof s?.phase === "string" && typeof s.homeFolder === "string" ? s : undefined; }
  catch { return undefined; }
};
const readSeat = (h: SeatHost) => Promise.resolve(h.secrets.get(REHEARSAL_SEAT_KEY)).then(parseSeat);
const writeSeat = (h: SeatHost, s: SeatRecord) => h.secrets.store(REHEARSAL_SEAT_KEY, JSON.stringify(s));

/** Restores the issuer from the return key, then deletes the return key and the seat. Order keeps a crash safe. */
async function restoreIssuer(h: SeatHost): Promise<void> {
  const ret = await h.secrets.get(REHEARSAL_RETURN_KEY);
  if (ret) await h.secrets.store(ISSUER_TOKEN_KEY, ret);
  await h.secrets.delete(REHEARSAL_SEAT_KEY);
  await h.secrets.delete(REHEARSAL_RETURN_KEY);
}

/** Start a rehearsal in this window: move the credential aside, then open the dedicated folder. */
export async function enterRehearsal(h: SeatHost, input: { token: string; expiresAt: number; rehearsalId: string }): Promise<void> {
  if (!input.token || !input.rehearsalId || !Number.isFinite(input.expiresAt))
    throw new RehearsalSeatError("리허설 정보를 확인해 주세요.");
  const issuer = await h.secrets.get(ISSUER_TOKEN_KEY);
  if (!issuer) throw new RehearsalSeatError("강사 자격이 없어서 리허설을 열 수 없어요.");
  if (await h.secrets.get(REHEARSAL_RETURN_KEY)) throw new RehearsalSeatError("이미 리허설 중이에요.");
  const home = h.currentRoot();
  if (!home) throw new RehearsalSeatError("작업 폴더를 먼저 열어 주세요.");
  const folder = h.rehearsalFolderFor(input.rehearsalId);
  await h.secrets.store(REHEARSAL_RETURN_KEY, issuer);
  await writeSeat(h, { phase: "entering", rehearsalId: input.rehearsalId, expiresAt: input.expiresAt, homeFolder: home, rehearsalFolder: folder, pendingToken: input.token });
  await h.secrets.delete(ISSUER_TOKEN_KEY);
  try {
    h.makeFolder(folder);
    await h.openFolder(folder);
  } catch {
    await restoreIssuer(h);
    throw new RehearsalSeatError("리허설 창을 열지 못했어요. 강사 자격은 그대로 있어요.");
  }
}

/** Return to the home folder with the credential. A failure keeps the return key for the next start. */
async function resumeReturn(h: SeatHost, seat: SeatRecord): Promise<"done" | "reloading" | "failed"> {
  try {
    const root = h.currentRoot();
    if (root === seat.rehearsalFolder) await h.releaseStudentBinding(root);
    await writeSeat(h, { ...seat, phase: "returning", pendingToken: undefined });
    const ret = await h.secrets.get(REHEARSAL_RETURN_KEY);
    if (!ret) throw new RehearsalSeatError("return key missing");
    await h.secrets.store(ISSUER_TOKEN_KEY, ret);
    if (root !== seat.homeFolder) {
      await h.openFolder(seat.homeFolder);
      return "reloading";
    }
    await h.secrets.delete(REHEARSAL_RETURN_KEY);
    await h.secrets.delete(REHEARSAL_SEAT_KEY);
    return "done";
  } catch {
    h.notify(RETURN_FAILED);
    return "failed";
  }
}

/** Both keys present: the start was interrupted after the credential came back. Release the seat, then finish the return. */
async function finishInterrupted(h: SeatHost, seat: SeatRecord | undefined): Promise<"done" | "reloading" | "failed"> {
  const root = h.currentRoot();
  if (seat && root === seat.rehearsalFolder) await h.releaseStudentBinding(root);
  if (seat && root !== seat.homeFolder) {
    try { await h.openFolder(seat.homeFolder); return "reloading"; }
    catch { h.notify(RETURN_FAILED); return "failed"; }
  }
  await h.secrets.delete(REHEARSAL_RETURN_KEY);
  await h.secrets.delete(REHEARSAL_SEAT_KEY);
  return "done";
}

/**
 * Runs at activation, after the activity wrap and before the resume marker. Returns:
 * - "none": no rehearsal state.
 * - "bound": entered this window; the student token is bound to the rehearsal folder.
 * - "ask": a rehearsal was open when the app closed and the token is valid; call offerResume (not awaited here).
 * - "inside": (not returned here; see offerResume)
 * - "reloading": a return opened the home folder; the window will reload.
 * - "done": the return finished in this window.
 * - "failed": the return did not finish; the return key is kept and the failure was shown.
 */
export async function resumeOnActivation(h: SeatHost): Promise<"none" | "bound" | "ask" | "reloading" | "done" | "failed"> {
  const ret = await h.secrets.get(REHEARSAL_RETURN_KEY);
  const seat = await readSeat(h);
  if (!ret) {
    if (seat) await h.secrets.delete(REHEARSAL_SEAT_KEY);
    return "none";
  }
  if (await h.secrets.get(ISSUER_TOKEN_KEY)) return finishInterrupted(h, seat);
  if (!seat) { await restoreIssuer(h); return "done"; }
  const root = h.currentRoot();
  if (seat.phase === "entering") {
    if (root === seat.rehearsalFolder && seat.pendingToken) {
      try { await h.bindStudentToken(seat.pendingToken); }
      catch { return (await resumeReturn(h, seat)) === "reloading" ? "reloading" : "failed"; }
      await writeSeat(h, { ...seat, phase: "inside", pendingToken: undefined });
      return "bound";
    }
    return (await resumeReturn(h, seat)) as "reloading" | "done" | "failed";
  }
  if (seat.phase === "inside") {
    if (root !== seat.rehearsalFolder || seat.expiresAt <= h.now()) return (await resumeReturn(h, seat)) as "reloading" | "done" | "failed";
    return "ask";
  }
  return (await resumeReturn(h, seat)) as "reloading" | "done" | "failed";
}

/** After the restart question: "return" goes home; "resume" (or dismissed) keeps the seat. */
export async function offerResume(h: SeatHost): Promise<"inside" | "none" | "reloading" | "done" | "failed"> {
  const seat = await readSeat(h);
  const choice = await h.askResume();
  if (choice !== "return") return "inside";
  return seat ? resumeReturn(h, seat) : endRehearsal(h);
}

/** The chalk "끝내고 돌아가기" button, or any explicit end: go home with the credential. */
export async function endRehearsal(h: SeatHost): Promise<"none" | "reloading" | "done" | "failed"> {
  if (!(await h.secrets.get(REHEARSAL_RETURN_KEY))) return "none";
  const seat = await readSeat(h);
  const root = h.currentRoot() ?? "";
  return resumeReturn(h, seat ?? { phase: "returning", rehearsalId: "", expiresAt: 0, homeFolder: root, rehearsalFolder: "" });
}

/** "Forget the instructor token": the issuer, the return key and the seat are all deleted. */
export async function forgetIssuer(h: SeatHost): Promise<void> {
  const seat = await readSeat(h);
  const root = h.currentRoot();
  if (seat && root === seat.rehearsalFolder) await h.releaseStudentBinding(root);
  await h.secrets.delete(ISSUER_TOKEN_KEY);
  await h.secrets.delete(REHEARSAL_RETURN_KEY);
  await h.secrets.delete(REHEARSAL_SEAT_KEY);
}

/** Is a credential held for a return (the seat is running or was interrupted)? Used by the chalk side. */
export async function hasReturnIssuer(h: SeatHost): Promise<boolean> {
  return !!(await h.secrets.get(REHEARSAL_RETURN_KEY));
}
