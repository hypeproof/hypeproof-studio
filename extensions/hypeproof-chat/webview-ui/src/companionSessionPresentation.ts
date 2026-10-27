/** Presentation only. The caller owns verified receipts, connection state and request persistence. */
import type { CompanionHostRequest, CompanionDispatchResult } from '../../src/companionHostDispatch';
export interface CompanionSessionSelection {
  request: Readonly<CompanionHostRequest>;
  projectName: string;
  artifactName: string;
}
export interface CompanionSessionSnapshot {
  computerName: string;
  connection: 'connected' | 'waiting_for_computer' | 'reconnecting';
  /** Missing retains the existing offline copy for callers that do not supply a reason. */
  waitingReason?: 'request_unconfirmed' | 'host_unavailable';
  selection: CompanionSessionSelection | null;
  /** Inject only the existing verified result consumer's output, bound to its original request. */
  receipt: { request: Readonly<CompanionHostRequest>; outcome: Readonly<CompanionDispatchResult> } | null;
  busy: boolean;
}
export interface CompanionSessionController {
  /** Reconcile connection/receipt state; this must not resubmit or rerun work. */
  reconnect(request: Readonly<CompanionHostRequest> | null): Promise<void>;
  /** Reuse the existing request lifecycle and exact host approval; the view grants nothing. */
  requestPreview(request: Readonly<CompanionHostRequest>): Promise<void>;
}
export type CompanionSessionPhase = 'no_selection' | 'idle' | 'waiting_for_computer' | 'reconnecting' | 'stale' | CompanionDispatchResult['state'];
export interface CompanionSessionPresentation {
  phase: CompanionSessionPhase;
  title: string;
  body: string;
  action: 'reconnect' | 'request_preview' | null;
  actionLabel: string;
  preview: NonNullable<CompanionDispatchResult['artifact']> | null;
}
const fields = ['schema', 'requestId', 'actorId', 'deviceId', 'hostId', 'workspaceId', 'projectId', 'taskId', 'version', 'epoch', 'consentRevision', 'artifactId', 'artifactVersion', 'operation'] as const;
export const companionSelectionIdentity = (request: Readonly<CompanionHostRequest> | null | undefined): string => request ? JSON.stringify(fields.map(k => request[k])) : '';
const view = (phase: CompanionSessionPhase, title: string, body: string, action: CompanionSessionPresentation['action'] = 'reconnect', actionLabel = '연결 상태 확인'): CompanionSessionPresentation => ({ phase, title, body, action, actionLabel, preview: null });
export function companionSessionPresentation(snapshot: CompanionSessionSnapshot): CompanionSessionPresentation {
  if (snapshot.connection === 'reconnecting') return view('reconnecting', '연결을 다시 확인하고 있어요', '컴퓨터에서 온 응답을 확인한 뒤 같은 작업으로 돌아갈게요.', null);
  if (snapshot.connection === 'waiting_for_computer' && snapshot.waitingReason === 'request_unconfirmed') return view('waiting_for_computer', '요청 결과를 아직 확인하지 못했어요', '같은 요청을 다시 보내지 않고 결과 상태를 확인해요.', 'reconnect', '결과 상태 확인');
  if (snapshot.connection === 'waiting_for_computer') return view('waiting_for_computer', '컴퓨터를 기다리고 있어요', '선택한 컴퓨터를 켜고 Studio를 열어 주세요. 연결 상태를 확인한 뒤 결과를 가져올 수 있어요.', 'reconnect', '컴퓨터 연결 확인');
  if (snapshot.connection !== 'connected') return view('waiting_for_computer', '컴퓨터 연결을 아직 확인하지 못했어요', '선택한 컴퓨터에서 Studio를 열고 연결 상태를 확인해 주세요.', 'reconnect', '컴퓨터 연결 확인');
  const selected = snapshot.selection;
  if (!selected) return view('no_selection', '컴퓨터에서 볼 결과를 골라 주세요', '컴퓨터에서 작업과 결과 하나를 고르면 여기에서 확인할 수 있어요.');
  if (selected.request.operation !== 'preview.read') return view('denied', '휴대폰에서 볼 수 있는 결과가 아니에요', '컴퓨터에서 선택한 결과와 허용 여부를 확인해 주세요.');
  const receipt = snapshot.receipt;
  if (!receipt) return view('idle', '컴퓨터에서 고른 결과를 볼까요?', '보기 요청을 보내면 컴퓨터에서 허용 여부와 선택한 결과를 확인해요.', 'request_preview', '선택한 결과 보기');
  if (companionSelectionIdentity(receipt.request) !== companionSelectionIdentity(selected.request)
    || (receipt.outcome.requestId !== undefined && receipt.outcome.requestId !== selected.request.requestId)) return view('stale', '지금 선택한 결과를 다시 확인해 주세요', '다른 작업이나 이전 요청의 결과는 열지 않았어요. 컴퓨터에서 선택을 확인한 뒤 연결 상태를 확인해 주세요.');
  const result = receipt.outcome;
  if (result.state === 'completed') {
    const artifact = result.artifact;
    if (result.code !== 'preview_read' || !artifact || artifact.id !== selected.request.artifactId || artifact.version !== selected.request.artifactVersion) return view('stale', '선택한 판과 결과가 달라요', '이 결과는 열지 않았어요. 컴퓨터에서 보고 싶은 판을 다시 확인해 주세요.');
    return { ...view('completed', '선택한 결과를 가져왔어요', '아래 결과를 눌러 사용해 보세요. 원본은 컴퓨터에 그대로 있어요.'), preview: artifact };
  }
  // A non-completed receipt may never smuggle a previous artifact into the preview slot.
  if (result.artifact !== undefined) return view('stale', '결과를 다시 확인해 주세요', '아직 확인되지 않은 결과는 열지 않았어요. 연결 상태를 먼저 확인해 주세요.');
  switch (result.state) {
    case 'wait_for_host': return view('wait_for_host', '컴퓨터를 기다리고 있어요', '컴퓨터에서 아직 요청을 받지 못했어요. 컴퓨터를 켜고 Studio의 연결을 확인해 주세요.', 'reconnect', '컴퓨터 연결 확인');
    case 'accepted': return view('accepted', '컴퓨터가 요청을 받았어요', '아직 결과가 도착한 것은 아니에요. 컴퓨터에서 선택한 결과를 확인하고 있어요.');
    case 'running': return view('running', '컴퓨터에서 결과를 확인하고 있어요', '같은 작업을 다시 보내지 않아도 돼요. 확인한 결과가 도착하면 여기에 보여 드릴게요.');
    case 'outcome_unknown': return view('outcome_unknown', '컴퓨터가 마쳤는지 아직 알 수 없어요', '작업을 다시 실행하지 않고 상태부터 확인해 주세요.', 'reconnect', '상태 다시 확인');
    case 'desktop_handoff': return view('desktop_handoff', '컴퓨터에서 이어서 확인해 주세요', '휴대폰에서 새로 실행하지 않았어요. 같은 작업을 컴퓨터에서 확인해 주세요.');
    case 'denied': return result.code === 'result_too_large'
      ? view('denied', '결과가 커서 가져오지 못했어요', '선택한 결과는 컴퓨터에 그대로 있어요. 컴퓨터에서 결과를 확인해 주세요.')
      : view('denied', '지금은 이 결과를 볼 수 없어요', '컴퓨터에서 허용한 결과만 볼 수 있어요. 컴퓨터에서 선택과 허용 여부를 확인해 주세요.');
    case 'failed': return view('failed', '결과를 가져오지 못했어요', '원본은 컴퓨터에 있어요. 연결 상태를 확인한 뒤 컴퓨터에서 결과를 확인해 주세요.');
    default: return view('stale', '결과를 다시 확인해 주세요', '아직 확인되지 않은 응답은 결과로 표시하지 않았어요.');
  }
}
