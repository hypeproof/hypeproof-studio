// CGP-KNOW-D-011 (DES-KNOW-20) — "내 작품" as a drawer from the task rail. It lists the work folder's
// files from the provenance inventory (REQ-STUDIO-ARTIFACT-PROVENANCE), newest recorded event first:
// a thumbnail for a small raster image or a type glyph, the name, the provenance chip and the time of
// the last recorded event. List by default, grid on request; a window of 360px or less shows the list
// only. It is a native modal dialog: focus stays inside, Escape closes it and focus returns to the
// opener. A thumbnail is asked for only when its row scrolls into view, and the host answers with an
// inline data: image read from inside the work folder; the drawer never loads a URL.
// CGP-KNOW-D-030 (DES-KNOW-48): a 파일/기억 filter in the header; 기억 shows the activity's memory files
// (REQ-STUDIO-ACTIVITY-MEMORY-FILES) in the same drawer, always as a list.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtifactProvenanceEntry, ArtifactProvenanceView } from '../../src/artifactProvenanceView';
import { ActivityMemoryList } from './ActivityMemoryPanel';
import { ChatIcon } from './ChatDetails';
import { returnFocus, useDialogFocus } from './dialogFocus';
import { finishModal } from './modalMotion';
import { onHostMessage, postToHost } from './vscode';
import { filterWorks, IMAGE_FILE, thumbnailSrc, WORKS_LIST_ONLY_MAX, worksGlyph, worksLayout, worksName, type WorksLayout } from './myWorks';

const when = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let requestSeq = 0;
const nextRequestId = () => `thumb-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;
/** A file whose recorded state changes gets a fresh thumbnail. */
const thumbKey = (entry: Pick<ArtifactProvenanceEntry, 'path' | 'at'>) => `${entry.path}\n${entry.at ?? ''}`;

export type WorksFilter = 'files' | 'memory';

export function MyWorksDrawer({ files, scopeKey, viewport, opener, fallback, onClose }: {
  files: ArtifactProvenanceView | null | undefined;
  /** The task and activity the drawer was opened for; the memory list binds to it. */
  scopeKey: string;
  viewport: number;
  /** The rail's 내 작품 button; `fallback` (the rail toggle) when the narrow rail closed under it. */
  opener: () => HTMLElement | null;
  fallback: () => HTMLElement | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const [choice, setChoice] = useState<WorksLayout>('list');
  const [filter, setFilter] = useState<WorksFilter>('files');
  const [search, setSearch] = useState({ scope: scopeKey, query: '' });
  const query = search.scope === scopeKey ? search.query : '';
  const searchInput = useRef<HTMLInputElement>(null);
  const entries = filterWorks(files?.entries ?? [], query);
  useEffect(() => { setSearch({ scope: scopeKey, query: '' }); }, [scopeKey]);
  const memoryButton = useRef<HTMLButtonElement>(null);
  const layout = worksLayout(choice, viewport);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const asked = useRef(new Map<string, string>());   // requestId → thumbKey
  const requested = useRef(new Set<string>());

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    finishModal(dialog.current, onClose);
  };
  // showModal first, so the focus contract below finds a rendered surface to move into.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {
      // close() would hand focus to whatever was focused before showModal (on the narrow rail, the
      // element the rail itself restored); the opener, else the rail toggle, wins instead.
      const owned = !!node && (node.contains(document.activeElement) || document.activeElement === document.body);
      if (node?.open) node.close();
      if (owned) returnFocus(opener, fallback);
    };
  }, []);
  useDialogFocus(dialog, { open: true, kind: 'modal', keepFocusOnDismiss: true, opener, fallback, onDismiss: close });

  useEffect(() => onHostMessage(message => {
    if (message.type !== 'artifactThumbnail') return;
    const key = asked.current.get(message.requestId);
    if (!key || !key.startsWith(`${message.path}\n`)) return;
    asked.current.delete(message.requestId);
    setThumbs(current => ({ ...current, [key]: thumbnailSrc(message.src) }));
  }), []);

  // Lazy: a row asks for its thumbnail once it is (nearly) visible in the drawer's scroller.
  useEffect(() => {
    const root = body.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(seen => {
      for (const item of seen) {
        if (!item.isIntersecting) continue;
        const element = item.target as HTMLElement;
        const path = element.dataset.thumbPath, key = element.dataset.thumbKey;
        observer.unobserve(element);
        if (!path || !key || requested.current.has(key)) continue;
        requested.current.add(key);
        const requestId = nextRequestId();
        asked.current.set(requestId, key);
        postToHost({ type: 'artifactThumbnailRequest', requestId, path });
      }
    }, { root, rootMargin: '64px 0px' });
    root.querySelectorAll<HTMLElement>('[data-thumb-path]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [files, layout, filter, query]);

  const note = (text: string, status = false) => <p className="tw-works-note" role={status ? 'status' : undefined}>{text}</p>;
  return <dialog ref={dialog} className="tw-works-drawer" aria-labelledby="tw-works-title" data-testid="my-works-drawer" data-layout={filter === 'memory' ? 'list' : layout} data-filter={filter}
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="tw-works-head">
      <h2 id="tw-works-title">내 작품</h2>
      <div className="tw-works-views tw-works-filter" role="group" aria-label="보여 줄 것">
        <button type="button" aria-pressed={filter === 'files'} aria-controls="tw-works-body" onClick={() => setFilter('files')}>파일</button>
        <button ref={memoryButton} type="button" aria-pressed={filter === 'memory'} aria-controls="tw-works-body" onClick={() => setFilter('memory')}>기억</button>
      </div>
      {filter === 'files' && viewport > WORKS_LIST_ONLY_MAX && <div className="tw-works-views" role="group" aria-label="보기 방식">
        <button type="button" aria-pressed={layout === 'list'} onClick={() => setChoice('list')}>목록</button>
        <button type="button" aria-pressed={layout === 'grid'} onClick={() => setChoice('grid')}>격자</button>
      </div>}
      <button type="button" className="tw-quiet tw-works-close" aria-label="내 작품 닫기" data-hp-tooltip="내 작품 닫기" onClick={close}><ChatIcon kind="close" size={20} /></button>
    </header>
    <div ref={body} id="tw-works-body" className="tw-works-body" tabIndex={0} role="region" aria-label={filter === 'memory' ? 'AI 기억 파일 목록' : '내 작품 목록'}>
      {filter === 'memory' ? <ActivityMemoryList scopeKey={scopeKey} fallback={() => memoryButton.current} />
        : files === undefined ? note('파일 기록을 불러오는 중…', true)
        : files === null ? note('작업 폴더가 열려 있지 않아서 보여 줄 파일이 없어요.')
        : files.unobserved ? note('아직 기록이 없어요. 이 목록을 열거나 AI에게 요청을 보내면 그때부터 기록해요.')
        : files.entries.length === 0 ? note('작업 폴더에 아직 파일이 없어요.')
        : <>
          {files.unconfirmed && note('지금 작업 폴더를 다 확인하지 못해서 모든 파일을 ‘기록 없음’으로 보여 줘요.', true)}
          <label className="tw-search">작품 파일 검색
            <input ref={searchInput} type="search" value={query} maxLength={200} placeholder="파일 이름이나 폴더 경로"
              onChange={event => setSearch({ scope: scopeKey, query: event.target.value })} />
          </label>
          {query && <button type="button" className="tw-quiet" onClick={() => { setSearch({ scope: scopeKey, query: '' }); searchInput.current?.focus(); }}>검색 지우기</button>}
          {note(`현재 목록에서 ${entries.length}개 / ${files.entries.length}개`, true)}
          {entries.length === 0 && note('일치하는 파일이 없어요. 다른 검색어를 넣거나 검색을 지워 주세요.')}
          <ul className="tw-works-list" aria-label="내 작품 파일">{entries.map(entry => {
            const { name, folder } = worksName(entry.path);
            const key = thumbKey(entry);
            const src = thumbs[key] ?? null;
            const image = IMAGE_FILE.test(entry.path);
            return <li key={entry.path} className="tw-works-item" data-provenance={entry.kind}>
              <span className="tw-works-thumb" aria-hidden="true" {...(image ? { 'data-thumb-path': entry.path, 'data-thumb-key': key } : {})}>
                {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : <ChatIcon kind={worksGlyph(entry.path)} size={20} />}
              </span>
              <span className="tw-works-text">
                <span className="tw-works-name" dir="auto" data-hp-tooltip={entry.path}>{name}</span>
                {folder && <span className="tw-works-folder" dir="auto">{folder}</span>}
                <span className="tw-works-meta">
                  <span className="tw-provenance-chip"><span aria-hidden="true" data-provenance-symbol>{entry.symbol}</span><strong>{entry.label}</strong></span>
                  {entry.at ? <time dateTime={new Date(entry.at).toISOString()}>마지막 기록 {when.format(entry.at)}</time> : <span>바뀐 때 기록 없음</span>}
                </span>
              </span>
            </li>;
          })}</ul>
          {files.more > 0 && note(`파일 ${files.more}개는 더 있어서 여기에 다 보여 주지 못했어요.`)}
        </>}
    </div>
  </dialog>;
}
