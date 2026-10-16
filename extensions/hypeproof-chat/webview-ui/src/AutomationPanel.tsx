import { useEffect, useState } from 'react';
import type { AutomationAction, AutomationRecipe, AutomationView } from '../../src/automationProtocol';
import './AutomationPanel.css';

const STATUS = { sending: '확인 중', sent: '전송 완료', unknown: '전송 여부 확인 필요', failed: '전송 실패' };
export function AutomationPanel({ view, onAction, onClose }: { view: AutomationView; onAction(action: AutomationAction): void; onClose(): void }) {
  const [tab, setTab] = useState<'create' | 'store'>('create');
  const [reviewed, setReviewed] = useState(false);
  const [shareReviewed, setShareReviewed] = useState(false);
  useEffect(() => { setReviewed(false); }, [view.preview?.id]);
  useEffect(() => { setShareReviewed(false); }, [JSON.stringify(view.recipe), view.source?.id]);
  const edit = (patch: Partial<AutomationRecipe>, sheetUrl = view.sheetUrl, range = view.range) => onAction({ kind: 'edit', recipe: { ...view.recipe, ...patch }, sheetUrl, range });
  const act = (kind: 'connect' | 'disconnect' | 'preview' | 'list') => onAction({ kind });
  return <section className="automation-panel" aria-label="업무 자동화" data-testid="automation-panel">
    <header className="automation-header"><div><span className="automation-eyebrow">WORKFLOW / 이메일</span><h1>반복 업무를, 내 자동화로</h1><p>명단을 읽고, 내용을 확인한 뒤 보내요.</p></div><button className="automation-close" onClick={onClose} aria-label="업무 자동화 닫기">닫기</button></header>
    <nav className="automation-tabs" aria-label="업무 자동화 메뉴"><button aria-pressed={tab === 'create'} onClick={() => setTab('create')}>만들고 실행하기</button><button aria-pressed={tab === 'store'} onClick={() => { setTab('store'); act('list'); }}>우리 반 스토어</button></nav>
    {view.error && <p className="automation-error" role="alert">{view.error}</p>}
    {view.notice && <p className="automation-notice" role="status">{view.notice}</p>}
    {view.busy && <p role="status" className="automation-muted">처리하고 있어요…</p>}
    {tab === 'create' ? <>
      <div className="automation-step"><span>01</span><h2>Google 연결</h2><div className="automation-connection"><b>{view.revocationPending ? 'Google 권한 해제 확인 필요' : view.connected ? '연결됨' : '연결 전'}</b><button disabled={view.busy || (!view.configured && !view.revocationPending)} onClick={() => act(view.connected || view.revocationPending ? 'disconnect' : 'connect')}>{view.revocationPending ? '권한 해제 다시 시도' : view.connected ? '연결 해제' : 'Google 계정 연결'}</button></div>
        {(view.connected || view.revocationPending) && <p className="automation-muted">연결을 해제하면 이 Google 앱에 허용한 권한도 제거해요. 다른 기기의 연결도 다시 허용해야 할 수 있어요. 작업과 메일 전송 기록은 유지해요.</p>}
        {!view.configured && <p className="automation-muted">Google 연결 준비가 필요해요. 강사에게 알려 주세요.</p>}
        <p className="automation-muted">Google에서 명단 읽기와 Gmail 전송 권한을 확인해 주세요.</p>
      </div>
      <fieldset disabled={view.busy} className="automation-step"><legend><span>02</span>명단과 메일 만들기</legend>
        <label>Google Sheets 주소<input type="url" value={view.sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={e => edit({}, e.target.value)} /></label>
        <label>읽을 범위<input value={view.range} placeholder="A1:D21" onChange={e => edit({}, view.sheetUrl, e.target.value)} /><small>첫 줄에 열 이름을 넣어 주세요. 예: 이메일 / 이름 / 서류 / 기한</small></label>
        <div className="automation-columns">{(Object.keys(view.recipe.columns) as Array<keyof AutomationRecipe['columns']>).map(key => <label key={key}>{({ email: '받는 주소 열', name: '이름 열', document: '서류 열', dueDate: '기한 열' })[key]}<input value={view.recipe.columns[key]} onChange={e => edit({ columns: { ...view.recipe.columns, [key]: e.target.value } })} /></label>)}</div>
        <div className="automation-author-actions"><button type="button" onClick={() => onAction({ kind: 'authorWithAi' })}>AI와 템플릿 만들기</button><button type="button" onClick={() => onAction({ kind: 'importFile' })}>만든 템플릿 가져오기</button></div>
        <label>자동화 이름<input maxLength={120} value={view.recipe.title} onChange={e => edit({ title: e.target.value })} /></label>
        <label>설명<input maxLength={1000} value={view.recipe.description} onChange={e => edit({ description: e.target.value })} /></label>
        <label>메일 제목<input maxLength={240} value={view.recipe.subjectTemplate} onChange={e => edit({ subjectTemplate: e.target.value })} /></label>
        <label>메일 본문<textarea rows={6} maxLength={10000} value={view.recipe.bodyTemplate} onChange={e => edit({ bodyTemplate: e.target.value })} /></label>
        <p className="automation-muted">{'{{name}} 이름 · {{document}} 서류 · {{dueDate}} 기한을 명단 값으로 바꿔요.'}</p>
        <button className="automation-primary" disabled={!view.connected || !view.sheetUrl.trim() || !view.range.trim()} onClick={() => act('preview')}>명단 읽고 미리보기</button>
      </fieldset>
      <div className="automation-step"><span>03</span><h2>확인하고 보내기</h2>
        {!view.preview && <p className="automation-muted">미리보기를 만들면 실제 받는 주소와 메일 내용이 여기에 보여요.</p>}
        {view.preview && <><p><b>{view.preview.messages.length}명</b>에게 보낼 메일이에요. 한 통씩 확인해 주세요.</p>
          <div className="automation-messages">{view.preview.messages.map((message, index) => <article key={message.id} className="automation-message"><h3>{index + 1}. {message.to}</h3><b>{message.subject}</b><pre>{message.body}</pre>{view.records.length > 0 && <p className="automation-result">{view.records.find(record => record.id === message.id) ? STATUS[view.records.find(record => record.id === message.id)!.status] : '전송하지 않음'}</p>}</article>)}</div>
          <label className="automation-check"><input type="checkbox" checked={reviewed} disabled={view.busy || !!view.records.length} onChange={e => setReviewed(e.target.checked)} />받는 주소와 모든 메일 내용을 확인했어요.</label>
          <button className="automation-primary" disabled={!reviewed || view.busy || !!view.records.length || !view.preview.messages.length} onClick={() => onAction({ kind: 'send', previewId: view.preview!.id, reviewed })}>{view.preview.messages.length}명에게 전송 요청</button></>}
        {view.records.length > 0 && <div aria-label="전송 결과"><p>{view.records.filter(r => r.status === 'sent').length}건 완료 / {view.records.length}건 처리{view.preview && view.preview.messages.length > view.records.length ? ` · ${view.preview.messages.length - view.records.length}건 미전송` : ''}</p>{view.records.some(r => r.status === 'unknown' || r.status === 'sending') && <p className="automation-error">전송 여부가 확실하지 않은 메일은 다시 보내지 마세요. Gmail 보낸편지함에서 먼저 확인해 주세요.</p>}</div>}
      </div>
      <details className="automation-step"><summary>04　우리 반에 템플릿 공유하기</summary><p>아래 내용만 공유해요. 명단·Google 연결 정보는 포함하지 않아요. 제목과 본문에 직접 쓴 실제 업무 정보도 지워 주세요.</p><pre className="automation-share-preview">{JSON.stringify(view.recipe, null, 2)}</pre>{view.source && <p className="automation-muted">출처: {view.source.title} 버전 {view.source.version}. 원본과 연결된 내 스킬로 공유해요.</p>}
        <label className="automation-check"><input type="checkbox" checked={shareReviewed} onChange={e => setShareReviewed(e.target.checked)} />실제 이름·주소·회사 정보·비밀값이 없는 템플릿임을 확인했어요.</label><button disabled={!shareReviewed || view.busy} onClick={() => onAction({ kind: 'publish', reviewed: shareReviewed })}>우리 반 스토어에 올리기</button></details>
    </> : <div className="automation-store"><div className="automation-store-heading"><div><h2>함께 만든 자동화</h2><p>우리 반에 공유된 이메일 템플릿이에요.</p></div><button disabled={view.busy} onClick={() => act('list')}>새로고침</button></div>
      {!view.items.length && <p className="automation-empty">아직 공유된 자동화가 없어요. 첫 템플릿을 올려 보세요.</p>}
      <ul className="automation-cards">{view.items.map(item => <li key={item.id}><span className="automation-eyebrow">이메일 · v{item.version}{item.mine ? ' · 내가 만든 자동화' : ''}</span><h3>{item.title}</h3><p>{item.description}</p><button disabled={view.busy} onClick={() => onAction({ kind: 'detail', id: item.id })}>내용 보기</button></li>)}</ul>
      {view.selected && <article className="automation-step"><h2>{view.selected.item.title}</h2><p>{view.selected.item.description}</p><b>{view.selected.recipe.subjectTemplate}</b><pre>{view.selected.recipe.bodyTemplate}</pre><p className="automation-muted">내 명단과 내 Google 계정으로 실행해요. 가져오기만으로 메일이 전송되지 않아요.</p><button className="automation-primary" disabled={view.busy} onClick={() => { onAction({ kind: 'import', id: view.selected!.item.id }); setTab('create'); }}>내 자동화로 가져오기</button>{view.selected.item.mine && <button disabled={view.busy} onClick={() => onAction({ kind: 'unpublish', id: view.selected!.item.id })}>스토어에서 내리기</button>}</article>}
    </div>}
  </section>;
}
