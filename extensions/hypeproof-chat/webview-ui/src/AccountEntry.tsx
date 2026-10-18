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
        return <div className="studio-account-pass" key={pass.id}><strong>{pass.product_name}</strong><span>AI 요청 {pass.requests_remaining.toLocaleString('ko-KR')} / {pass.requests_limit.toLocaleString('ko-KR')}회 남음</span>
          {pass.expires_at ? <span>종료일 · {date(pass.expires_at)}</span> : <>
            <span>{pass.duration_seconds > 0 ? `처음 사용부터 최대 ${Math.ceil(pass.duration_seconds / 86400)}일` : '아직 시작하지 않았어요'}</span>
            {pass.activation_deadline_at && <><span>전체 제공 기한 · {date(pass.activation_deadline_at)}</span><span>시작한 날과 관계없이 이 기한에 이용이 종료돼요.</span></>}
          </>}
          <button className="studio-choice" disabled={disabled || !usable} onClick={() => post({type:'accountActivate',passId:pass.id})}>{usable ? '이 이용권으로 시작하기' : '지금 사용할 수 없는 이용권'} <span aria-hidden="true">→</span></button></div>;
      })}
      <div className="studio-course-actions"><button className="studio-text-button" disabled={disabled} onClick={() => post({type:'accountRefresh'})}>이용권 새로고침</button><button className="studio-text-button" onClick={() => post({type:'accountManage'})}>계정·기기·영수증 관리 ↗</button><button className="studio-text-button" onClick={() => post({type:'accountSignOut'})}>로그아웃</button></div>
    </> : <>
      <button className="studio-primary" disabled={disabled} onClick={() => post({type:'accountSignIn'})}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign:'middle',marginRight:8}}><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z"/></svg>{account.busy ? '로그인 준비 중…' : 'Google로 시작하기'} <span aria-hidden="true">↗</span></button>
      <p className="studio-help">만 14세 이상 개인 이용자를 위한 계정이에요. 이용권을 복사하지 않아도 다른 컴퓨터에서 이어 쓸 수 있어요.</p>
    </>}
    {account.message && <p className="studio-help" role="status">{account.message}</p>}
  </section>;
}
