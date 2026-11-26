// #4514 — the rehearsal seat host of this window. activate() sets it after the activity wrap; the chalk entry points,
// the band button, the palette item and the report read it through this getter. No vscode import: a test can set it
// with a host built from its own secrets. Holds no state other than the host reference.
import type { SeatHost } from "./rehearsalSeat";

let current: SeatHost | undefined;

export function setRehearsalSeatHost(host: SeatHost | undefined): void {
  current = host;
}

export function getRehearsalSeatHost(): SeatHost | undefined {
  return current;
}
