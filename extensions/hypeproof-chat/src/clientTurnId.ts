// Client turn id (REQ-STUDIO-TURN-ID), kept in a leaf module with no imports so that
// sdkCoachHelpers can use it without pulling in nativeObservationContract and the private
// measurement-core package (the Windows smoke job runs without that package).
export const CLIENT_TURN_ID_HEADER = "x-hps-turn-id";
export function validClientTurnId(v: unknown): v is string {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
}
export function clientTurnIdHeader(turnId: unknown): Record<string, string> {
  return validClientTurnId(turnId) ? { [CLIENT_TURN_ID_HEADER]: turnId } : {};
}
