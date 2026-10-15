import type { AccountView } from '../../src/accountSession';
import type { StartRequest } from '../../src/startPageProtocol';
/** Credentials stay in the extension host; this view receives display fields and emits intents. */
export function AccountEntry({ account, checking, post }: { account: AccountView; checking: boolean; post: (message: StartRequest) => void }) {
  const disabled = checking || account.busy;
  const date = (time: number) => new Date(time * 1000).toLocaleDateString('ko-KR');
  return <section className="studio-account" aria-label="개인 계정" aria-busy={account.busy}>
    {account.status === 'waiting' ? <>
      <h3>브라우저에서 연결을 승인해 주세요</h3>
      <p className="studio-help">연결 번호 <strong>{account.userCode}</strong></p>
      <p className="studio-help">브라우저에 표시된 번호와 이 번호가 같은지 확인하세요.</p>
      <button className="studio-choice" onClick={() => post({type:'accountReopen'})}>로그인 창 다시 열기 <span aria-hidden="true">↗</span></button>
      <button className="studio-text-button" onClick={() => post({type:'accountCancel'})}>로그인 취소</button>
    </> : account.status === 'signedIn' ? <>
      <div className="studio-account-identity"><strong>{account.account?.display_name} 님</strong><span>{account.account?.email}</span></div>
      <h3>내 이용권</h3>
      {!account.passes?.length && <p className="studio-help">아직 이용권이 없어요. 이용권을 구매하면 이 계정으로 로그인한 컴퓨터에서 사용할 수 있어요.</p>}
      {account.passes?.map(pass => {
        const deadline = pass.expires_at ?? pass.activation_deadline_at;
        const usable = ['paid','active','available','ready'].includes(pass.status) && pass.requests_remaining > 0 && (!deadline || deadline * 1000 > Date.now());
        return <div className="studio-account-pass" key={pass.id}><strong>{pass.product_name}</strong><span>AI 요청 {pass.requests_remaining.toLocaleString('ko-KR')} / {pass.requests_limit.toLocaleString('ko-KR')}회 남음</span><span>{pass.expires_at ? `종료일 · ${date(pass.expires_at)}` : `${pass.duration_seconds > 0 ? `처음 사용부터 ${Math.ceil(pass.duration_seconds / 86400)}일` : '아직 시작하지 않았어요'}${pass.activation_deadline_at ? ` · 시작 가능 기한 ${date(pass.activation_deadline_at)}` : ''}`}</span>
          <button className="studio-choice" disabled={disabled || !usable} onClick={() => post({type:'accountActivate',passId:pass.id})}>{usable ? '이 이용권으로 시작하기' : '지금 사용할 수 없는 이용권'} <span aria-hidden="true">→</span></button></div>;
      })}
      <div className="studio-course-actions"><button className="studio-text-button" disabled={disabled} onClick={() => post({type:'accountRefresh'})}>이용권 새로고침</button><button className="studio-text-button" onClick={() => post({type:'accountManage'})}>계정·기기·영수증 관리 ↗</button><button className="studio-text-button" onClick={() => post({type:'accountSignOut'})}>로그아웃</button></div>
    </> : <>
      <button className="studio-primary" disabled={disabled} onClick={() => post({type:'accountSignIn'})}>{account.busy ? '로그인 준비 중…' : 'Google로 시작하기'} <span aria-hidden="true">↗</span></button>
      <p className="studio-help">만 14세 이상 개인 이용자를 위한 계정이에요. 이용권을 복사하지 않아도 다른 컴퓨터에서 이어 쓸 수 있어요.</p>
    </>}
    {account.message && <p className="studio-help" role="status">{account.message}</p>}
  </section>;
}
