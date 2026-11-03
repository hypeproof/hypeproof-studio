// Skill store panel (Epic #3418, REQ-STORE-*). Host: src/skillStorePanel.ts. Every rule (price
// caps, age, refund window, fraud block) is the Service's; this screen shows the state and the
// Service's own reason. Styles reuse the local-review surface so no new tokens are needed.
import { useEffect, useState } from "react";
import type { StoreHostMessage, StoreItemView, StorePublishDraft, StoreRequest, StoreState, StoreStepView, StoreTab } from "../../src/skillStoreProtocol";
import { STORE_COPY, won } from "../../src/skillStore";
import "./localReview.css";
import { postSkillStore } from "./vscode";

const TOOL_LABELS: Record<string, string> = { read: "파일 읽기", write: "파일 쓰기", browser: "브라우저" };
const CONNECTION_LABELS: Record<string, string> = { "google.gmail.send": "Gmail 보내기", "google.sheets.read": "구글 시트 읽기", "roster.read": "명단" };
const TIER_LABELS: Record<string, string> = { none: "본인인증 전", new: "신규", standard: "일반", verified: "인증", minor: "청소년" };
const SALE_STATUS: Record<string, string> = { refunded: "환불됨", refund_window: "환불 가능 기간", payout_hold: "지급 보류", payable: "정산 대상" };
const day = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");
const INITIAL: StoreState = { access: "ready", tab: "browse", items: [], ageGroup: "unknown", installs: [], testPayments: true, busy: true };

export function SkillStore({ send = postSkillStore }: { send?: (m: StoreRequest) => void }) {
  const [state, setState] = useState<StoreState>(INITIAL);
  const [draftBody, setDraftBody] = useState<string | undefined>();
  useEffect(() => {
    const listener = (event: MessageEvent<StoreHostMessage>) => {
      if (event.data?.type === "storeState") setState(event.data.state);
      if (event.data?.type === "storeDraftBody") setDraftBody(event.data.body);
    };
    window.addEventListener("message", listener);
    send({ type: "storeLoad" });
    return () => window.removeEventListener("message", listener);
  }, [send]);
  return <SkillStoreView state={state} send={send} draftBody={draftBody} />;
}

export function SkillStoreView({ state, send, draftBody }: { state: StoreState; send: (m: StoreRequest) => void; draftBody?: string }) {
  const tab = (t: StoreTab) => send({ type: "storeLoad", tab: t });
  const busy = Boolean(state.busy);

  return <main className="local-review skill-store">
    <header><p className="eyebrow">HypeProof Studio</p><h1>{STORE_COPY.title}</h1><p>다른 사람이 코치와 함께 만든 스킬을 사고, 내가 만든 스킬을 팔아요.</p></header>
    {state.testPayments && <aside className="record-policy" role="note">{STORE_COPY.testBanner}</aside>}
    <nav aria-label="스킬 스토어 메뉴">
      {(["browse", "mine", "sell"] as StoreTab[]).map(t => <button key={t} aria-current={state.tab === t ? "page" : undefined} disabled={busy} onClick={() => tab(t)}>{t === "browse" ? "둘러보기" : t === "mine" ? "내 스킬" : "판매"}</button>)}
    </nav>
    {busy && <p role="status">불러오는 중이에요…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.checks?.length ? <ul aria-label="자동 검사 결과">{state.checks.map(c => <li key={c}>{c}</li>)}</ul> : null}
    {state.notice && <p role="status">{state.notice}</p>}
    {state.access === "signedOut" && <section><p>{STORE_COPY.signIn}</p><button onClick={() => send({ type: "storeSignIn" })}>Google로 로그인</button></section>}
    {state.access === "ready" && state.ageGroup === "unknown" && <AgeQuestion busy={busy} send={send} />}
    {state.checkout && <section className="submission-preview" aria-label="결제 진행 중">
      <h2>{state.checkout.title} · {won(state.checkout.amount)}</h2><p>{STORE_COPY.checkoutOpen}</p>
      <button onClick={() => send({ type: "storeCancelCheckout" })}>결제 기다리지 않기</button>
    </section>}
    {state.tab === "browse" && <Browse state={state} busy={busy} send={send} />}
    {state.tab === "mine" && state.access === "ready" && <Mine state={state} busy={busy} send={send} />}
    {state.tab === "sell" && state.access === "ready" && <Sell state={state} busy={busy} send={send} draftBody={draftBody} />}
  </main>;
}

function AgeQuestion({ busy, send }: { busy: boolean; send: (m: StoreRequest) => void }) {
  const [year, setYear] = useState("");
  const value = Number(year);
  return <section className="record-omitted" aria-label="태어난 해">
    <p>{STORE_COPY.askAge}</p>
    <label>태어난 해 (예: 1990)<input inputMode="numeric" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
    <button disabled={busy || year.length !== 4} onClick={() => send({ type: "storeDeclareAge", birthYear: value })}>알려 주기</button>
  </section>;
}

/** The included steps, public layer only: what each step does and which connection it needs (scene 2). */
function Steps({ steps }: { steps: StoreStepView[] }) {
  if (!steps.length) return null;
  return <ol aria-label="포함된 단계">{steps.map(st => <li key={st.step_id}>{st.title}: {st.description}{st.connections.length ? ` (필요한 연결: ${st.connections.map(c => `${CONNECTION_LABELS[c.id] ?? c.id}, ${c.why}`).join("; ")})` : ""}</li>)}</ol>;
}

function ItemCard({ item, state, busy, send }: { item: StoreItemView; state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  const installed = state.installs.some(i => i.item_id === item.id);
  const free = item.price_krw === 0;
  const minorBlocked = !free && state.ageGroup === "minor";
  return <article className="capability" aria-label={item.title}>
    <h3>{item.title}</h3>
    <p>{item.summary}</p>
    <p>{free ? "무료" : won(item.price_krw)} · 판매자 {item.seller_name}</p>
    <p>쓰는 도구: {item.tools.length ? item.tools.map(t => TOOL_LABELS[t] ?? t).join(", ") : "없음"}</p>
    <Steps steps={item.steps ?? []} />
    {!free && <p>{STORE_COPY.refundRule(item.refund_window_days)}</p>}
    <p>{STORE_COPY.modelCost}</p>
    {state.access === "ready" && (installed ? <p>설치했어요.</p>
      : minorBlocked ? <p>{STORE_COPY.minorBuy}</p>
      : <button disabled={busy || Boolean(state.checkout)} onClick={() => send(free ? { type: "storeInstallFree", itemId: item.id } : { type: "storeBuy", itemId: item.id })}>{free ? "무료로 설치" : `${won(item.price_krw)} 카드 결제`}</button>)}
  </article>;
}

function Browse({ state, busy, send }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  if (state.access === "unavailable") return null;
  if (!state.items.length && !busy) return <p>아직 올라온 스킬이 없어요.</p>;
  return <section aria-label="스킬 목록"><div className="capability-grid">{state.items.map(i => <ItemCard key={i.id} item={i} state={state} busy={busy} send={send} />)}</div></section>;
}

function Mine({ state, busy, send }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  const [reporting, setReporting] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  if (!state.installs.length) return <p>아직 설치한 스킬이 없어요.</p>;
  return <section aria-label="내 스킬"><div className="capability-grid">{state.installs.map(i => <article key={i.item_id} className="capability" aria-label={i.title}>
    <h3>{i.title}</h3><p>{i.summary}</p>
    <Steps steps={i.public?.steps ?? []} />
    {i.warning === "reported" && <p>여러 사람이 신고해서 운영팀이 확인하고 있는 스킬이에요.</p>}
    {!i.runnable && <p>운영자가 내린 스킬이라 실행할 수 없어요.</p>}
    {i.order_id && (i.refundable
      ? <><button disabled={busy} onClick={() => send({ type: "storeRefund", orderId: i.order_id! })}>환불</button><p>{i.refund_until ? `${day(i.refund_until)}까지, 실행하기 전에만 환불할 수 있어요.` : ""}</p></>
      : <p>{i.first_run_at ? "실행한 뒤라 환불할 수 없어요." : "환불 기간이 지났어요."}</p>)}
    {reporting === i.item_id
      ? <><label>신고 이유<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => { send({ type: "storeReport", itemId: i.item_id, reason }); setReporting(undefined); setReason(""); }}>신고 보내기</button></>
      : <button disabled={busy} onClick={() => setReporting(i.item_id)}>신고</button>}
  </article>)}</div></section>;
}

function Sell({ state, busy, send, draftBody }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void; draftBody?: string }) {
  const [draft, setDraft] = useState<StorePublishDraft>({ title: "", summary: "", body: "", tools: [], price_krw: 0 });
  useEffect(() => { if (draftBody !== undefined) setDraft(d => ({ ...d, body: draftBody })); }, [draftBody]);
  const s = state.seller;
  const set = (patch: Partial<StorePublishDraft>) => setDraft(d => ({ ...d, ...patch }));
  const ready = draft.title.trim() && draft.summary.trim() && draft.body.trim();
  return <>
    {s && <section className="record-policy" aria-label="판매자 정보">
      <p>판매자 등급: {TIER_LABELS[s.tier] ?? s.tier} · 한 개당 최대 {won(s.cap_krw)}</p>
      {s.tier === "none" && <p>유료 스킬을 팔려면 휴대폰 본인인증이 필요해요. 지금은 무료 스킬만 올릴 수 있어요.</p>}
      <p>{s.origin ? "처음 들은 강의의 강사와 교육 파트너에게 HypeProof 수수료의 일부가 계속 나눠져요." : "처음 들은 강의 기록이 없어요."}</p>
    </section>}
    <section aria-label="스킬 올리기">
      <h2>스킬 올리기</h2>
      <label>이름<input value={draft.title} maxLength={60} onChange={e => set({ title: e.target.value })} /></label>
      <label>한 줄 설명<input value={draft.summary} maxLength={200} onChange={e => set({ summary: e.target.value })} /></label>
      <label>스킬 내용<textarea value={draft.body} maxLength={20000} onChange={e => set({ body: e.target.value })} /></label>
      <button disabled={busy} onClick={() => send({ type: "storeImportFile" })}>파일에서 불러오기</button>
      <fieldset><legend>쓰는 도구</legend>{Object.entries(TOOL_LABELS).map(([k, label]) => <label key={k}><input type="checkbox" checked={draft.tools.includes(k)} onChange={e => set({ tools: e.target.checked ? [...draft.tools, k] : draft.tools.filter(t => t !== k) })} />{label}</label>)}</fieldset>
      <label>가격 (원, 부가세 포함, 0이면 무료)<input inputMode="numeric" value={String(draft.price_krw)} onChange={e => set({ price_krw: Number(e.target.value.replace(/\D/g, "").slice(0, 7) || 0) })} /></label>
      <p>키, 토큰, 비밀번호, 이메일 주소, 전화번호, 외부 MCP 설정은 넣을 수 없어요. 올리면 자동으로 검사해요.</p>
      <button disabled={busy || !ready} onClick={() => send({ type: "storePublish", draft })}>스토어에 올리기</button>
    </section>
    {s && <section aria-label="정산 내역">
      <h2>정산 내역</h2>
      <p>{s.payout === "linked_adult_required" ? STORE_COPY.payoutLinkedAdult : STORE_COPY.payoutNotStarted}</p>
      <p>정산 대상 {won(s.totals.payable)} · 대기 {won(s.totals.pending)}{s.totals.rolls_over ? ` · ${won(s.totals.payout_min_krw)} 미만은 다음 달로 넘어가요.` : ""}</p>
      {s.sales.length ? <table><thead><tr><th>스킬</th><th>판매가</th><th>결제 수수료</th><th>내 몫 (80%)</th><th>HypeProof 수수료 (20%)</th><th>그중 파트너</th><th>그중 강사</th><th>상태</th><th>정책</th></tr></thead>
        <tbody>{s.sales.map(x => <tr key={x.order_id}><td>{x.title}</td><td>{won(x.gross)}</td><td>{won(x.pg_fee)}</td><td>{won(x.seller)}</td><td>{won(x.commission)}</td><td>{won(x.partner)}</td><td>{won(x.instructor)}</td><td>{SALE_STATUS[x.status] ?? x.status}</td><td>{x.policy_version}</td></tr>)}</tbody></table>
        : <p>아직 판매가 없어요.</p>}
      {s.items.length > 0 && <><h3>내가 올린 스킬</h3><ul>{s.items.map(i => <li key={i.id}>{i.title} · {i.price_krw ? won(i.price_krw) : "무료"} · {i.status === "listed" ? "판매 중" : i.status === "review" ? "검토 대기" : "내려감"}</li>)}</ul></>}
    </section>}
  </>;
}
