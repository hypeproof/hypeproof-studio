import { useState } from 'react';
import type { PersonalRecordsView } from '../../src/personalRecordTypes';
import type { StartRequest } from '../../src/startPageProtocol';

/** Actual start-page project UI. The only input source is the labelled host fixture. */
export function PersonalRecords({ view, accountId, projectId, post }: { view: PersonalRecordsView; accountId: string; projectId: string; post(message: StartRequest): void }) {
  const [includeFile, setIncludeFile] = useState(false);
  const preview = view.preview, selected = view.selected;
  return <section className="studio-records" aria-label="합성 개인 기록 테스트" aria-busy={!!view.busy}>
    <h4>로컬 합성 기록 테스트</h4>
    <p className="studio-help">테스트용 대화와 고른 합성 파일만 저장합니다. 실제 대화·작업 폴더는 읽지 않아요. 이 기록은 읽기용이며 AI를 실행하거나 공개하지 않아요.</p>
    <label className="studio-record-file"><input type="checkbox" checked={includeFile} disabled={view.busy || !!preview || !!view.pending || view.authenticationRequired} onChange={event => setIncludeFile(event.target.checked)} />합성 파일 synthetic-result.html 포함</label>
    {!preview && !view.pending && <button className="studio-choice" disabled={view.busy || view.authenticationRequired} onClick={() => post({ type: 'personalRecordPrepare', accountId, projectId, includeFile })}>합성 기록 검토</button>}
    {preview && <div className="studio-record-preview" role="region" aria-label="저장 전 합성 기록 검토">
      <h4>저장할 사본 확인</h4>
      <p>계정 · {preview.account}<br />저장할 서비스 · {preview.service}<br />개인 프로젝트 · {preview.destination}</p>
      {preview.manifest.messages.map(message => <article key={message.id}><strong>{message.role === 'user' ? '나 (합성)' : 'AI (합성)'}</strong><pre>{message.content}</pre></article>)}
      {preview.files.map(file => <div key={file.client_ref}><strong>{file.name} · {file.bytes}바이트</strong><pre>{file.text}</pre><details><summary>파일 확인 정보</summary><code>{file.sha256}</code></details></div>)}
      {!preview.files.length && <p>고른 파일 없음</p>}
      <details><summary>기록 확인 정보</summary><code>{preview.digest}</code></details>
      <p className="studio-help">입력 중인 글, 숨긴 대화, 실제 파일, 로그인 정보는 포함하지 않아요. 저장할 때 앱 확인 창이 한 번 더 열립니다.</p>
      <button className="studio-choice" disabled={view.busy} onClick={() => post({ type: 'personalRecordSave', accountId, projectId, nonce: preview.nonce, digest: preview.digest })}>검토한 합성 기록 저장</button>
      <button className="studio-text-button" disabled={view.busy} onClick={() => post({ type: 'personalRecordCancel', accountId, projectId, nonce: preview.nonce })}>검토 취소</button>
    </div>}
    {view.pending && <div className="studio-record-preview"><p>이 기기에 저장 대기 사본이 있어요. 앱을 다시 열어도 같은 사본과 요청으로만 재시도합니다.</p><details><summary>대기 사본 확인 정보</summary><code>{view.pending.digest}</code></details><button className="studio-choice" disabled={view.busy || view.authenticationRequired} onClick={() => post({ type: 'personalRecordRetry', accountId, projectId })}>같은 기록 저장 다시 시도</button></div>}
    <button className="studio-choice" disabled={view.busy} onClick={() => post({ type: 'personalRecordsOpen', accountId, projectId })}>저장된 합성 기록 보기</button>
    {view.loaded && !view.records.length && <p className="studio-help">저장된 합성 기록이 없어요.</p>}
    {!!view.records.length && <ul className="studio-personal-projects">{view.records.map(record => <li key={record.id}><button className="studio-choice" disabled={view.busy} onClick={() => post({ type: 'personalRecordOpen', accountId, projectId, recordId: record.id })}>{record.manifest?.title ?? '합성 기록'} · 읽기</button></li>)}</ul>}
    {selected?.manifest && <div className="studio-record-preview" role="region" aria-label="저장된 합성 기록 읽기"><h4>{selected.manifest.title}</h4>
      {selected.manifest.messages.map(message => <article key={message.id}><strong>{message.role === 'user' ? '나 (합성)' : message.role === 'assistant' ? 'AI (합성)' : '작업 상태'}</strong><pre>{message.content}</pre></article>)}
      <details><summary>저장된 기록 확인 정보</summary><code>{selected.manifest_sha256}</code></details>
      {selected.artifacts.map(file => <div key={file.id}><p>{file.name} · {file.bytes}바이트</p><button className="studio-choice" disabled={view.busy} onClick={() => post({ type: 'personalRecordDownload', accountId, projectId, artifactId: file.id })}>확인 후 파일 사본 저장</button></div>)}
    </div>}
    {view.authenticationRequired && <button className="studio-choice" disabled={view.busy} onClick={() => post({ type: 'accountRefresh' })}>로그인 상태 새로고침</button>}
    <p className="studio-help" role={view.failed ? 'alert' : 'status'}>{view.busy ? '합성 기록을 처리하고 있어요…' : view.message}</p>
  </section>;
}
