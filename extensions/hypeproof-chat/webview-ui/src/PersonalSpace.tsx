import { useState } from 'react';
import type { PersonalSpaceView } from '../../src/personalSpace';
import type { StartRequest } from '../../src/startPageProtocol';

/** This surface opens a saved metadata record, never a local folder or conversation. */
export function PersonalSpace({ space, accountId, post }: { space: PersonalSpaceView; accountId: string; post(message: StartRequest): void }) {
  const [title, setTitle] = useState('');
  const pending = space.pendingTitle;
  const selected = space.selected;
  return <section className="studio-personal-space" aria-label="개인 공간" aria-busy={!!space.busy}>
    <h2>개인 공간</h2>
    <p className="studio-help">이 계정으로 프로젝트 이름을 저장하고 다시 볼 수 있어요. 대화와 파일은 동기화되지 않으며, 기존 작업은 자동으로 가져오지 않아요.</p>
    {!space.opened ? <button className="studio-choice" onClick={() => post({ accountId, type: 'personalSpaceOpen' })}>내 개인 공간 보기</button> : <>
      <div className="studio-course-actions"><button className="studio-text-button" disabled={space.busy} onClick={() => post({ accountId, type: 'personalSpaceOpen' })}>목록 새로고침</button></div>
      {space.loaded && !space.workspace && <>
        <p className="studio-help">아직 개인 공간이 없어요. 이름을 저장할 공간부터 만들어 주세요.</p>
        <button className="studio-choice" disabled={space.busy} onClick={() => post({ accountId, type: 'personalSpaceEnsure' })}>개인 공간 만들기</button>
      </>}
      {space.workspace && <>
        <form onSubmit={event => { event.preventDefault(); if (!space.busy && title.trim()) post({ accountId, type: 'personalProjectCreate', title }); }}>
          <label htmlFor="personal-project-title">새 프로젝트 이름</label>
          <input id="personal-project-title" value={pending ?? title} maxLength={160} disabled={space.busy || !!pending} autoComplete="off" placeholder="만들고 싶은 것의 이름" onChange={event => setTitle(event.target.value)} />
          {pending ? <button className="studio-choice" type="button" disabled={space.busy} onClick={() => post({ accountId, type: 'personalProjectCreate', title: pending })}>이 이름 저장 다시 시도</button>
            : <button className="studio-choice" type="submit" disabled={space.busy || !title.trim()}>프로젝트 이름 저장</button>}
        </form>
        <h3>저장된 프로젝트</h3>
        {!space.projects.length && <p className="studio-help">저장된 프로젝트가 없어요.</p>}
        <ul className="studio-personal-projects">{space.projects.map(project => <li key={project.id}>
          <button className="studio-choice" disabled={space.busy} onClick={() => post({ accountId, type: 'personalProjectOpen', projectId: project.id })} aria-label={`${project.title} 이름 기록 다시 열기`}><span>{project.title}</span><span>다시 열기</span></button>
        </li>)}</ul>
        {selected && <div className="studio-personal-record" role="region" aria-label="열린 프로젝트 이름 기록">
          <h3>{selected.title}</h3>
          <p className="studio-help">저장된 이름 기록을 열었어요. 이 화면에는 대화나 파일이 포함되지 않아요.</p>
          <p className="studio-help">만든 날 · {new Date(selected.created_at * 1000).toLocaleDateString('ko-KR')}</p>
        </div>}
      </>}
    </>}
    {space.authenticationRequired && <button className="studio-choice" disabled={space.busy} onClick={() => post({ type: 'accountRefresh' })}>로그인 상태 새로고침</button>}
    <p className="studio-help" role={space.failed ? 'alert' : 'status'}>{space.busy ? '개인 공간을 확인하고 있어요…' : space.message ?? ''}</p>
  </section>;
}
