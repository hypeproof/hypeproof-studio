// Skill store panel (Epic #3418, REQ-STORE-*). Host: src/skillStorePanel.ts. Every rule (price
// caps, age, refund window, fraud block) is the Service's; this screen shows the state and the
// Service's own reason. Styles reuse the local-review surface so no new tokens are needed.
import { useEffect, useState } from "react";
import type { StoreAttributionInput, StoreHostMessage, StoreInstallView, StoreItemView, StoreLocalConnections, StoreOverlaySpec, StoreOverlayView, StorePayoutAccountView, StorePublishDraft, StoreQuestDraft, StoreRequest, StoreSellerView, StoreState, StoreStepView, StoreTab } from "../../src/skillStoreProtocol";
import { PAYOUT_BANKS, STORE_COPY, won } from "../../src/skillStore";
import "./localReview.css";
import { postSkillStore } from "./vscode";

// A store run never gets a browser (design v1 F2), so the sell form does not offer it.
const TOOL_LABELS: Record<string, string> = { read: "파일 읽기", write: "파일 쓰기", browser: "브라우저(스토어 실행에서는 꺼져 있어요)" };
const SELL_TOOLS = ["read", "write"] as const;
const CONNECTION_LABELS: Record<string, string> = { "google.gmail.send": "Gmail 보내기", "google.sheets.read": "구글 시트 읽기", "roster.read": "명단" };
const TIER_LABELS: Record<string, string> = { none: "본인인증 전", new: "신규", standard: "일반", verified: "인증", minor: "청소년" };
const SALE_STATUS: Record<string, string> = { refunded: "환불됨", refunding: "환불 처리 중", refund_window: "환불 가능 기간", payout_hold: "지급 보류", payable: "정산 대상" };
const TONES: NonNullable<StoreOverlaySpec["tone"]>[] = ["짧게", "친근하게", "격식 있게"];
const WIDENED: Record<string, string> = { connection: "새 연결", tool: "새 도구", output: "새 결과물" };
const day = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");
/** Mirrors questSkill.connectedHere: presence of a connection on this device, never its account or sheet. */
const connectedHere = (id: string, local?: StoreLocalConnections) => !!local && (id.startsWith("google.") ? local.google : id === "roster.read" ? local.roster : false);
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
      {(["browse", "mine", "sell"] as StoreTab[]).map(t => <button key={t} aria-current={state.tab === t ? "page" : undefined} disabled={busy} onClick={() => tab(t)}>{t === "browse" ? "둘러보기" : t === "mine" ? "내 스킬" : "내 스토어"}</button>)}
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

/** The included quest steps, public layer only, and whether this device already has each connection (scene 2). */
function Steps({ steps, local }: { steps: StoreStepView[]; local?: StoreLocalConnections }) {
  if (!steps.length) return null;
  return <ol aria-label="포함된 퀘스트 단계">{steps.map(st => <li key={st.step_id}>{st.title}: {st.description}
    {st.connections.length ? <ul aria-label={`${st.title}에 필요한 연결`}>{st.connections.map(c => <li key={c.id}>{CONNECTION_LABELS[c.id] ?? c.id} · {c.why} · <strong>{connectedHere(c.id, local) ? STORE_COPY.connected : STORE_COPY.needsConnection}</strong></li>)}</ul> : null}
  </li>)}</ol>;
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
    <Steps steps={item.steps ?? []} local={state.connections} />
    {!free && <p>{STORE_COPY.refundRule(item.refund_window_days)}</p>}
    <p>{STORE_COPY.modelCost}</p>
    {state.access === "ready" && (installed ? <p>설치했어요.</p>
      : minorBlocked ? <p>{STORE_COPY.minorBuy}</p>
      : <button disabled={busy || Boolean(state.checkout)} onClick={() => send(free ? { type: "storeInstallFree", itemId: item.id } : { type: "storeBuy", itemId: item.id })}>{free ? "무료로 설치" : `${won(item.price_krw)} 카드 결제`}</button>)}
  </article>;
}

function Browse({ state, busy, send }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  const [query, setQuery] = useState(state.query ?? "");
  if (state.access === "unavailable") return null;
  return <section aria-label="스킬 목록">
    <form role="search" onSubmit={e => { e.preventDefault(); send({ type: "storeSearch", query }); }}>
      <label>스킬 찾기<input type="search" value={query} maxLength={40} placeholder="예: 요약" onChange={e => setQuery(e.target.value)} /></label>
      <button type="submit" disabled={busy}>검색</button>
    </form>
    {!state.items.length && !busy ? <p>{state.query ? `「${state.query}」에 맞는 스킬이 없어요.` : "아직 올라온 스킬이 없어요."}</p>
      : <div className="capability-grid">{state.items.map(i => <ItemCard key={i.id} item={i} state={state} busy={busy} send={send} />)}</div>}
  </section>;
}

function Mine({ state, busy, send }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  const [reporting, setReporting] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  if (!state.installs.length) return <p>아직 설치한 스킬이 없어요.</p>;
  return <section aria-label="내 스킬"><div className="capability-grid">{state.installs.map(i => <article key={i.item_id} className="capability" aria-label={i.title}>
    <h3>{i.title}</h3><p>{i.summary}</p>
    <Steps steps={i.public?.steps ?? []} local={state.connections} />
    {i.warning === "reported" && <p>여러 사람이 신고해서 운영팀이 확인하고 있는 스킬이에요.</p>}
    {!i.runnable && <p>운영자가 내린 스킬이라 실행할 수 없어요.</p>}
    {i.runnable && <button disabled={busy} onClick={() => send({ type: "storeRun", itemId: i.item_id })}>실행</button>}
    {i.runnable && state.overlay?.item_id !== i.item_id && <button disabled={busy} onClick={() => send({ type: "storeOverlayOpen", itemId: i.item_id })}>내 방식으로 바꾸기</button>}
    {state.overlay?.item_id === i.item_id && <OverlayEditor overlay={state.overlay} busy={busy} send={send} />}
    <Update install={i} state={state} busy={busy} send={send} />
    {i.order_id && (i.refundable
      ? <><button disabled={busy} onClick={() => send({ type: "storeRefund", orderId: i.order_id! })}>환불</button><p>{i.refund_until ? `${day(i.refund_until)}까지, 실행하기 전에만 환불할 수 있어요.` : ""}</p></>
      : <p>{i.first_run_at ? "실행한 뒤라 환불할 수 없어요." : "환불 기간이 지났어요."}</p>)}
    {reporting === i.item_id
      ? <><label>신고 이유<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => { send({ type: "storeReport", itemId: i.item_id, reason }); setReporting(undefined); setReason(""); }}>신고 보내기</button></>
      : <button disabled={busy} onClick={() => setReporting(i.item_id)}>신고</button>}
  </article>)}</div></section>;
}

/** A seller update: free, applied by the buyer's choice; one that widens connections, tools or outputs asks first (F5). */
function Update({ install, state, busy, send }: { install: StoreInstallView; state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  if (!install.update_available) return null;
  if (state.consent?.itemId !== install.item_id) return <p>새 버전이 있어요. <button disabled={busy} onClick={() => send({ type: "storeUpdate", itemId: install.item_id })}>업데이트</button></p>;
  return <section className="record-omitted" aria-label="업데이트 동의">
    <p>{STORE_COPY.consent}</p>
    <ul>{state.consent.widened.map(w => { const [kind, id] = w.split(":"); return <li key={w}>{WIDENED[kind] ?? kind}: {CONNECTION_LABELS[id] ?? TOOL_LABELS[id] ?? id}</li>; })}</ul>
    <button disabled={busy} onClick={() => send({ type: "storeUpdate", itemId: install.item_id, consent: true })}>확인하고 업데이트</button>
    <button disabled={busy} onClick={() => send({ type: "storeLoad", tab: "mine" })}>지금 버전 그대로 쓰기</button>
  </section>;
}

/**
 * The buyer's adaptation of one installed skill (scene 4, design v1 D5): by conversation or by step.
 * Only the public steps and the buyer's own overlay are shown; the seller's text never is.
 */
function OverlayEditor({ overlay, busy, send }: { overlay: StoreOverlayView; busy: boolean; send: (m: StoreRequest) => void }) {
  const [talk, setTalk] = useState("");
  const [spec, setSpec] = useState<Record<string, StoreOverlaySpec>>(overlay.overlay);
  useEffect(() => setSpec(overlay.overlay), [overlay]);
  const order = [...overlay.steps.map((st, i) => ({ id: st.step_id, title: st.title, description: st.description, added: false, at: spec[st.step_id]?.position ?? i })),
    ...Object.entries(spec).filter(([id]) => id.startsWith("buyer-")).map(([id, v]) => ({ id, title: v.title ?? "추가 단계", description: "내가 추가한 단계", added: true, at: v.position ?? overlay.steps.length }))]
    .sort((a, b) => a.at - b.at);
  const patch = (id: string, p: Partial<StoreOverlaySpec>) => setSpec(cur => ({ ...cur, [id]: { ...cur[id], ...p } }));
  const move = (index: number, by: number) => {
    const next = [...order];
    const [row] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, row);
    setSpec(cur => { const out = { ...cur }; next.forEach((r, at) => { out[r.id] = { ...out[r.id], position: at }; }); return out; });
  };
  const addStep = () => { const id = `buyer-${Object.keys(spec).filter(k => k.startsWith("buyer-")).length + 1}`; patch(id, { title: "내 단계", replace: "", position: order.length }); };
  const clean = Object.fromEntries(Object.entries(spec).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined))]).filter(([id, v]) => !id.startsWith("buyer-") || (v as StoreOverlaySpec).replace));
  return <section aria-label="내 방식으로 바꾸기">
    <p>판매자의 원래 지침은 보이지 않아요. 내가 바꾼 내용만 저장되고 다음 실행부터 적용돼요.</p>
    <form onSubmit={e => { e.preventDefault(); if (talk.trim()) { send({ type: "storeAdapt", itemId: overlay.item_id, text: talk }); setTalk(""); } }}>
      <label>대화로 바꾸기<input value={talk} maxLength={500} placeholder="예: 세 줄로 짧게 요약해 주세요" onChange={e => setTalk(e.target.value)} /></label>
      <button type="submit" disabled={busy || !talk.trim()}>이렇게 바꾸기</button>
    </form>
    {overlay.needs_review.length > 0 && <p role="alert">판매자가 고친 버전에서 사라진 단계에 내 수정이 남아 있어요: {overlay.needs_review.join(", ")}. 확인해 주세요.</p>}
    <ol aria-label="단계별로 바꾸기">{order.map((r, index) => { const v = spec[r.id] ?? {}; return <li key={r.id}>
      <label><input type="checkbox" checked={v.enabled !== false} onChange={e => patch(r.id, { enabled: e.target.checked })} />{r.added ? <input aria-label="추가 단계 이름" value={v.title ?? ""} maxLength={60} onChange={e => patch(r.id, { title: e.target.value })} /> : r.title}</label>
      <button disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`${r.title} 위로`}>↑</button>
      <button disabled={busy || index === order.length - 1} onClick={() => move(index, 1)} aria-label={`${r.title} 아래로`}>↓</button>
      {!r.added && <div role="group" aria-label={`${r.title} 말투`}>말투 {[undefined, ...TONES].map(t => <button key={t ?? "seller"} aria-pressed={v.tone === t} disabled={busy} onClick={() => patch(r.id, { tone: t })}>{t ?? "판매자 그대로"}</button>)}</div>}
      {!r.added && <label>추가 요청<input value={v.extra ?? ""} maxLength={500} onChange={e => patch(r.id, { extra: e.target.value })} /></label>}
      <label>{r.added ? "이 단계에서 할 일" : "이 단계를 내 지침으로 바꾸기"}<textarea value={v.replace ?? ""} maxLength={4000} onChange={e => patch(r.id, { replace: e.target.value })} /></label>
    </li>; })}</ol>
    <button disabled={busy} onClick={addStep}>단계 추가</button>
    <button disabled={busy} onClick={() => send({ type: "storeOverlaySave", itemId: overlay.item_id, steps: clean as Record<string, StoreOverlaySpec> })}>저장</button>
    <button disabled={busy} onClick={() => send({ type: "storeOverlayClose" })}>닫기</button>
  </section>;
}

/**
 * The first-publication choice (policy v2 `attribution.*`): partner and instructor codes, both optional. Typed codes
 * must be checked first so the seller sees whose they are; no code at all registers "none". `ready` gates every
 * publish button; `input` is what the host registers once before that publish.
 */
interface AttributionGate { ready: boolean; input?: StoreAttributionInput }
function useAttribution(state: StoreState) {
  const [partnerCode, setPartnerCode] = useState("");
  const [instructorCode, setInstructorCode] = useState("");
  const [consent, setConsent] = useState(false);
  // A seller view the panel has not loaded yet is left to the Service, which refuses an undecided first publish.
  const decided = state.seller?.attribution?.decided !== false;
  const consentVersion = state.seller?.attribution?.consent_version ?? "";
  const empty = !partnerCode.trim() && !instructorCode.trim();
  const preview = state.attributionPreview;
  const confirmed = Boolean(preview && preview.partnerCode === partnerCode && preview.instructorCode === instructorCode);
  // A code shares the seller's display name and sale amounts with that partner/instructor: it needs the consent.
  const input: StoreAttributionInput | undefined = decided ? undefined : empty ? { none: true }
    : { ...(partnerCode.trim() ? { partner_code: partnerCode.trim() } : {}), ...(instructorCode.trim() ? { instructor_code: instructorCode.trim() } : {}), consent: { version: consentVersion, granted: true } };
  const gate: AttributionGate = { ready: decided || empty || (confirmed && consent && Boolean(consentVersion)), input };
  const skip = () => { setPartnerCode(""); setInstructorCode(""); setConsent(false); };
  return { decided, partnerCode, instructorCode, setPartnerCode, setInstructorCode, confirmed, consent, setConsent, skip, empty, gate };
}

function AttributionStep({ a, state, busy, send }: { a: ReturnType<typeof useAttribution>; state: StoreState; busy: boolean; send: (m: StoreRequest) => void }) {
  const p = a.confirmed ? state.attributionPreview : undefined;
  return <section className="record-omitted" aria-label="파트너·강사 코드">
    <h2>{STORE_COPY.codesTitle}</h2>
    <p>{STORE_COPY.codesHelp}</p>
    <label>파트너 코드<input value={a.partnerCode} maxLength={20} autoComplete="off" placeholder="예: P-ABCDE-FGHJK" onChange={e => a.setPartnerCode(e.target.value)} /></label>
    <label>강사 코드<input value={a.instructorCode} maxLength={20} autoComplete="off" placeholder="예: I-ABCDE-FGHJK" onChange={e => a.setInstructorCode(e.target.value)} /></label>
    <button disabled={busy || (!a.partnerCode.trim() && !a.instructorCode.trim())} onClick={() => send({ type: "storeResolveCodes", partnerCode: a.partnerCode, instructorCode: a.instructorCode })}>코드 확인</button>
    {p ? <p role="status">확인했어요. {p.partner ? `파트너: ${p.partner.name}${!a.partnerCode.trim() ? " (강사 소속으로 함께 등록돼요)" : ""}` : ""}{p.partner && p.instructor ? " · " : ""}{p.instructor ? `강사: ${p.instructor.name}` : ""}. 올리면 이대로 한 번만 등록돼요.</p>
      : a.empty ? <p>{STORE_COPY.codesNone}</p> : <p>{STORE_COPY.codesCheck}</p>}
    {!a.empty && <>
      <label><input type="checkbox" checked={a.consent} onChange={e => a.setConsent(e.target.checked)} />{STORE_COPY.codesConsent}</label>
      {!a.consent && <p>{STORE_COPY.codesConsentNeeded}</p>}
      <button disabled={busy} onClick={a.skip}>{STORE_COPY.codesSkip}</button>
    </>}
  </section>;
}

/** Earnings first: every amount the Service reports, then the payout account only once it is due. */
function PayoutAccount({ account, busy, send }: { account: StorePayoutAccountView; busy: boolean; send: (m: StoreRequest) => void }) {
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  if (account.state === "not_due") return <p>{STORE_COPY.payoutNotDue(account.prompt_at_krw)}</p>;
  const minor = account.holder === "linked_adult";
  const digits = number.replace(/[\s-]/g, "");
  const valid = Boolean(bank) && /^\d{10,16}$/.test(digits) && holder.trim().length > 0;
  const onFile = account.state === "on_file" ? account : undefined;
  return <section aria-label="지급 계좌">
    {onFile && <>
      <p>{minor ? "보호자 계좌" : "지급 계좌"}: {onFile.masked}</p>
      <p>{onFile.holder_check === "sandbox_matched" ? STORE_COPY.payoutHolderSandbox : STORE_COPY.payoutHolderNotRun}</p>
      {!editing && <button disabled={busy} onClick={() => setEditing(true)}>계좌 바꾸기</button>}
    </>}
    {account.linked_adult_required && <p>{STORE_COPY.payoutLinkedAdultPending}</p>}
    {(!onFile || editing) && <form onSubmit={e => { e.preventDefault(); if (!valid) return; send({ type: "storeSavePayoutAccount", bankCode: bank, accountNumber: digits, holderName: holder.trim() }); setNumber(""); setEditing(false); }}>
      <h3>{minor ? "보호자 계좌" : "정산금 받을 계좌"}</h3>
      {!onFile && <p>{minor ? STORE_COPY.payoutDueMinor : STORE_COPY.payoutDue}</p>}
      <label>은행<select value={bank} onChange={e => setBank(e.target.value)}><option value="">은행 고르기</option>{PAYOUT_BANKS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label>계좌번호<input inputMode="numeric" autoComplete="off" value={number} maxLength={20} onChange={e => setNumber(e.target.value.replace(/[^\d-]/g, ""))} /></label>
      <label>{minor ? "보호자 이름 (예금주)" : "예금주"}<input autoComplete="off" value={holder} maxLength={30} onChange={e => setHolder(e.target.value)} /></label>
      <p>{STORE_COPY.payoutSealed}</p>
      <button type="submit" disabled={busy || !valid}>계좌 저장</button>
    </form>}
  </section>;
}

function Settlement({ s, busy, send }: { s: StoreSellerView; busy: boolean; send: (m: StoreRequest) => void }) {
  const t = s.totals;
  return <section aria-label="정산 내역">
    <h2>정산 내역</h2>
    <ul aria-label="정산 금액">
      <li>환불 가능 기간 {won(t.refund_window)}</li>
      <li>지급 보류 {won(t.payout_hold)}</li>
      <li>정산 대상 {won(t.payable)}{t.rolls_over && t.payable > 0 ? ` (${won(t.payout_min_krw)} 미만은 다음 달로 넘어가요)` : ""}</li>
      {t.refunded > 0 && <li>환불됨 {won(t.refunded)}</li>}
    </ul>
    <p>{s.payout === "linked_adult_required" ? STORE_COPY.payoutLinkedAdult : STORE_COPY.payoutNotStarted}</p>
    <p>{STORE_COPY.pgFeeEstimate}</p>
    {s.payout_account && <PayoutAccount account={s.payout_account} busy={busy} send={send} />}
    {s.sales.length ? <table><thead><tr><th>스킬</th><th>판매가</th><th>결제 수수료(예상)</th><th>내 몫 (80%)</th><th>HypeProof 수수료 (20%)</th><th>그중 파트너</th><th>그중 강사</th><th>상태</th><th>정책</th></tr></thead>
      <tbody>{s.sales.map(x => <tr key={x.order_id}><td>{x.title}</td><td>{won(x.gross)}</td><td>{won(x.pg_fee)}</td><td>{won(x.seller)}</td><td>{won(x.commission)}</td><td>{won(x.partner)}</td><td>{won(x.instructor)}</td><td>{SALE_STATUS[x.status] ?? x.status}</td><td>{x.policy_version}</td></tr>)}</tbody></table>
      : <p>아직 판매가 없어요.</p>}
    {s.items.length > 0 && <><h3>내 스토어</h3><ul>{s.items.map(i => <li key={i.id}>{i.title} · {i.price_krw ? won(i.price_krw) : "무료"} · {i.status === "listed" ? STORE_COPY.listed : i.status === "review" ? "검토 대기" : "내려감"}</li>)}</ul></>}
  </section>;
}

/** Scene 1: the finished quest, name and description prefilled; the seller sets a price within the tier cap. */
function QuestPublish({ draft, cap, busy, send, gate }: { draft: StoreQuestDraft; cap?: number; busy: boolean; send: (m: StoreRequest) => void; gate: AttributionGate }) {
  const [title, setTitle] = useState(draft.title);
  const [summary, setSummary] = useState(draft.summary);
  const [price, setPrice] = useState(0);
  const over = cap !== undefined && price > cap;
  return <section aria-label="퀘스트 스토어에 등록">
    <h2>스토어에 등록</h2>
    <label>이름<input value={title} maxLength={60} onChange={e => setTitle(e.target.value)} /></label>
    <label>한 줄 설명<input value={summary} maxLength={200} onChange={e => setSummary(e.target.value)} /></label>
    <ol aria-label="공개되는 퀘스트 단계">{draft.steps.map((st, i) => <li key={i}>{st.title}{st.description ? `: ${st.description}` : ""}</li>)}</ol>
    <label>가격 (원, 부가세 포함, 0이면 무료)<input inputMode="numeric" value={String(price)} onChange={e => setPrice(Number(e.target.value.replace(/\D/g, "").slice(0, 7) || 0))} /></label>
    {cap !== undefined && <p>{over ? `판매자 등급의 가격 한도(${won(cap)})를 넘었어요.` : `한 개당 최대 ${won(cap)}까지 정할 수 있어요.`}</p>}
    <p>{STORE_COPY.questPrivate}</p>
    <button disabled={busy || over || !gate.ready || !title.trim() || !summary.trim()} onClick={() => send({ type: "storePublishQuest", title, summary, price_krw: price, ...(gate.input ? { attribution: gate.input } : {}) })}>스토어에 등록</button>
  </section>;
}

function Sell({ state, busy, send, draftBody }: { state: StoreState; busy: boolean; send: (m: StoreRequest) => void; draftBody?: string }) {
  const [draft, setDraft] = useState<StorePublishDraft>({ title: "", summary: "", body: "", tools: [], price_krw: 0 });
  useEffect(() => { if (draftBody !== undefined) setDraft(d => ({ ...d, body: draftBody })); }, [draftBody]);
  const s = state.seller;
  const set = (patch: Partial<StorePublishDraft>) => setDraft(d => ({ ...d, ...patch }));
  const ready = draft.title.trim() && draft.summary.trim() && draft.body.trim();
  const a = useAttribution(state);
  const bound = s?.attribution;
  return <>
    {!a.decided && <AttributionStep a={a} state={state} busy={busy} send={send} />}
    {state.questDraft && <QuestPublish draft={state.questDraft} cap={s?.cap_krw} busy={busy} send={send} gate={a.gate} />}
    {s && <section className="record-policy" aria-label="판매자 정보">
      <p>판매자 등급: {TIER_LABELS[s.tier] ?? s.tier} · 한 개당 최대 {won(s.cap_krw)}</p>
      {s.tier === "none" && <p>유료 스킬을 팔려면 휴대폰 본인인증이 필요해요. 지금은 무료 스킬만 올릴 수 있어요.</p>}
      {bound?.decided && <p>{bound.partner || bound.instructor
        ? `등록한 코드: ${[bound.partner ? `파트너 ${bound.partner.name}` : "", bound.instructor ? `강사 ${bound.instructor.name}` : ""].filter(Boolean).join(" · ")}. `
        : `${STORE_COPY.codesEmpty} `}{bound.seller_editable ? "" : STORE_COPY.codesFixed}</p>}
    </section>}
    <section aria-label="스킬 올리기">
      <h2>스킬 올리기</h2>
      <label>이름<input value={draft.title} maxLength={60} onChange={e => set({ title: e.target.value })} /></label>
      <label>한 줄 설명<input value={draft.summary} maxLength={200} onChange={e => set({ summary: e.target.value })} /></label>
      <label>스킬 내용<textarea value={draft.body} maxLength={20000} onChange={e => set({ body: e.target.value })} /></label>
      <button disabled={busy} onClick={() => send({ type: "storeImportFile" })}>파일에서 불러오기</button>
      <fieldset><legend>쓰는 도구</legend>{SELL_TOOLS.map(k => [k, TOOL_LABELS[k]] as const).map(([k, label]) => <label key={k}><input type="checkbox" checked={draft.tools.includes(k)} onChange={e => set({ tools: e.target.checked ? [...draft.tools, k] : draft.tools.filter(t => t !== k) })} />{label}</label>)}</fieldset>
      <label>가격 (원, 부가세 포함, 0이면 무료)<input inputMode="numeric" value={String(draft.price_krw)} onChange={e => set({ price_krw: Number(e.target.value.replace(/\D/g, "").slice(0, 7) || 0) })} /></label>
      <p>키, 토큰, 비밀번호, 이메일 주소, 전화번호, 외부 MCP 설정은 넣을 수 없어요. 올리면 자동으로 검사해요.</p>
      <button disabled={busy || !ready || !a.gate.ready} onClick={() => send({ type: "storePublish", draft, ...(a.gate.input ? { attribution: a.gate.input } : {}) })}>스토어에 올리기</button>
    </section>
    {s && <Settlement s={s} busy={busy} send={send} />}
  </>;
}
