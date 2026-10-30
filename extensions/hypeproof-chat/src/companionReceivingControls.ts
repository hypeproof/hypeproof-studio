/** #3135: presentation of an existing DEV owner, never a grant or execution port. */
export type CompanionReceivingState = 'stopped' | 'listening' | 'processing' | 'awaiting-approval' | 'needs-check' | 'closed';
export type CompanionReceivingAction = 'stop' | 'revoke';
export interface CompanionReceivingControls {
  nonce: string;
  state: CompanionReceivingState;
  canStop: boolean;
  canRevoke: boolean;
}
/** Host-only callbacks are never serialized into the webview. */
export interface CompanionReceivingControlBinding {
  view: CompanionReceivingControls;
  act(action: CompanionReceivingAction): void | Promise<void>;
}
export const companionReceivingLabels: Record<CompanionReceivingState, string> = {
  stopped:'수신 중지됨', listening:'휴대폰 요청 수신 중', processing:'휴대폰 요청 확인 중',
  'awaiting-approval':'컴퓨터 승인 기다리는 중', 'needs-check':'수신 결과 확인 필요', closed:'휴대폰 연결 닫힘',
};
