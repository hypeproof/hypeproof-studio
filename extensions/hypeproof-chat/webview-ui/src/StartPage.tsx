import { useEffect, useRef, useState } from "react";
import type { StartState } from "../../src/startPageProtocol";
import { onHostMessage, postToHost } from "./vscode";
import { startPageCopy } from "../../src/coachIdentity";
import { Brand } from "./Brand";
import "./start.css";

import { AccountEntry } from "./AccountEntry";
import { InstructorInbox } from "./InstructorInbox";
import { activityLabel, passSummary, trialAllowance, trialEndedFacts, trialSummary } from "./activityLabel";
import { trialEntryNote } from "../../src/trialOffer";
import { FREE_START_COPY } from "../../src/freeStart";

export function StartPage() {
  const [state, setState] = useState<StartState>({ checking: true, version: "" });
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState<"trial" | "classroom" | "purchase" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const off = onHostMessage(msg => {
      if (msg.type !== "startState") return;
      setState(msg.state);
      // REQ-L12 — a purchase in progress keeps its own view; the connected card must not take the screen back mid-payment.
      if (!msg.state.checking && !msg.state.error && msg.state.profile && !msg.state.purchase?.stage) { setToken(""); setEditing(false); setEntry(e => e === "purchase" ? null : e); }
    });
    postToHost({ type: "startReady" });
    return off;
  }, []);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing, entry]);
  // TUX-COND-07 — the person pressed "이용권 살펴보기" on the chat's end-of-trial card: show the pass list once per press.
  const purchaseFocus = state.purchase?.focus;
  useEffect(() => { if (purchaseFocus) { setEntry("purchase"); setEditing(true); } }, [purchaseFocus]);
  const connect = (e: React.FormEvent) => {
    e.preventDefault(); if (!token.trim() || state.checking) return;
    setState(s => ({ ...s, checking: true, error: undefined }));
    postToHost({ type: "connectCourse", token });
    // A submitted credential is never retained in the document, VS Code state or storage.
    setToken("");
  };
  const copy = startPageCopy(state.coachName);
  const freeSeat = !!state.profile?.free;
  const activity = activityLabel(state.profile?.kind, state.profile?.pass, "활동", freeSeat);
  const passLeft = passSummary(state.profile?.pass);
  // TUX-SP-12 — said before the choice: a code is needed today (until the Service advertises open entry), and the Service's allowance.
  const trialNote = trialEntryNote(state.trialOffer);
  // TUX-SP-13 — a trial seat's allowance (candidate), what is left (connected), or the ended card.
  // A pass keeps passSummary and is never read as a trial.
  const trial = state.profile?.pass ? undefined : state.profile?.trial;
  const ended = trialEndedFacts(trial, Date.now(), freeSeat);
  const trialLeft = ended ? null : state.candidate ? trialAllowance(trial, Date.now(), freeSeat) : trialSummary(trial, Date.now(), freeSeat);
  const openPurchase = () => { setEntry("purchase"); setEditing(true); postToHost({ type: "purchaseOpen" }); };
  const choose = (next: "trial" | "classroom") => { setToken(""); setEntry(next); setEditing(true); };
  // REQ-L12 — buying a pass. The host owns the order; this view shows its stage and sends intents.
  const purchase = state.purchase;
  const purchaseHeld = !!purchase?.stage && purchase.stage !== "choosing" && !state.candidate;
  // TUX-SP-14 — free start: drawn only while the Service advertises it. While its claim leads into
  // the ordinary entry path, the free card stays on screen (no preview card, no folder choice).
  const free = state.freeStart;
  const freeEntering = !!free?.claiming;
  const showProfile = !!state.profile && !editing && !purchaseHeld && !freeEntering;
  const buying = !showProfile && (entry === "purchase" || purchaseHeld);
  const freeCard = !!free && !showProfile && !buying && (entry === null || freeEntering);
  const freeBlocked = free?.age === "under14";
  // e2e D2 — a saved free seat whose window is over: the card names the end, never a fresh start.
  const freeEnded = !freeBlocked && free?.ended === "expired";
  const freeCalm = free?.refusal?.code === "daily_cap_reached" || free?.refusal?.code === "paused" ? free.refusal.message
    : free?.unavailable === "daily_cap" ? FREE_START_COPY.dailyCapStart : free?.unavailable === "paused" ? FREE_START_COPY.pausedStart : null;
  const freeError = free?.refusal && !freeCalm ? free.refusal.message : null;
  // A drained or paused day says when, in the title; the card then holds only the calm notice and the two links.
  const freeTitle = freeBlocked ? FREE_START_COPY.under14Title
    : freeEnded ? FREE_START_COPY.endedTitle
    : freeCalm ? (free?.unavailable === "paused" || free?.refusal?.code === "paused" ? "잠시 뒤 시작할 수 있습니다" : "밤 12시 이후에 시작할 수 있습니다")
    : !free?.age ? FREE_START_COPY.ageTitle : FREE_START_COPY.readyTitle;
  const openCode = () => { setToken(""); setEntry("classroom"); setEditing(true); };
  const products = purchase?.products ?? [];
  const chosen = products.find(p => p.id === picked) ?? products.find(p => p.recommended) ?? products[0];
  const purchaseTitle = purchase?.stage === "waiting" ? "브라우저에서 결제를 기다리고 있어요" : purchase?.stage === "connecting" ? "이용권을 넣고 있어요" : purchase?.stage === "stopped" ? "구매를 마치지 못했어요" : "어떤 이용권으로 시작할까요?";
  const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
  // Leaving keeps a saved order: the host stops waiting and the choice list offers it again.
  const leavePurchase = () => { postToHost({ type: purchase?.order ? "purchaseHide" : "purchaseCancel" }); setEntry(null); };
  // "GitHub에서 이어하기": only while a code is being confirmed.
  const gh = state.candidate ? state.github : undefined;
  const ghChoice = gh?.status === "found" && !!gh.repos?.length;
  const ghBusy = gh?.status === "checking" || !!gh?.working;
  const status = gh?.working === "download" ? "GitHub에서 홈페이지를 내려받고 있어요…"
    : gh?.working === "signin" ? "GitHub 로그인 창에서 코드를 입력해 주세요."
    : gh?.status === "checking" ? "GitHub에 올린 홈페이지가 있는지 확인하고 있어요…"
    : freeEntering ? FREE_START_COPY.preparing
    : state.checking ? "연결 정보를 확인하고 있습니다." : "";

  return <main className="studio-start">
    <header className="studio-top"><Brand/><nav className="studio-nav" aria-label="Studio 탐색">{state.account?.status === "signedIn" && <button onClick={() => postToHost({type:"accountManage"})}>{state.account.account?.display_name} · 내 계정 ↗</button>}<button onClick={() => postToHost({ type: "openLocalReview" })}>나의 변화 기록</button><button onClick={() => postToHost({ type: "openStudioFiles" })}>파일</button><button onClick={() => postToHost({ type: "openStudioSettings" })}>설정</button></nav></header>
    <div className="studio-main">
      <section className="studio-intro" aria-labelledby="start-title">
        <p className="studio-eyebrow"><span/> 생각에서, 나의 결과물로</p>
        <h1 id="start-title">생각을 현실로.<br/><span>완성은 내 손으로.</span></h1>
        <p className="studio-lead">목표를 정하고, AI와 함께 만들고,<br className="studio-wide"/> 결과를 검토하는 나만의 작업 공간.</p>
        <div className="studio-process" aria-label="목표 정하기, 함께 만들기, 직접 검토하기">
          <div><span>01</span><strong>목표 정하기</strong><p>무엇을 바꾸고 싶은가요?</p></div>
          <div><span>02</span><strong>함께 만들기</strong><p>{copy.stepTwo}</p></div>
          <div><span>03</span><strong>직접 검토하기</strong><p>결과를 확인하고 내 것으로.</p></div>
        </div>
      </section>
      <section className="studio-connect" aria-labelledby="connect-title" aria-busy={state.checking}>
        <div className="studio-card-top"><span className="studio-step">시작하기</span><span className="studio-dot"/></div>
        <h2 id="connect-title">{freeCard ? freeTitle : showProfile && ended ? ended.title : showProfile ? (state.started ? copy.startedTitle : state.candidate ? "이 활동으로 시작할까요?" : "이어서 시작할까요?") : buying ? purchaseTitle : entry === "trial" ? "내 삶에 AI 더하기" : entry === "classroom" ? (free ? "참여 코드로 시작하기" : "수업에 참여하기") : "어떻게 시작할까요?"}</h2>
        <p className="studio-card-description">{freeCard ? (freeBlocked ? FREE_START_COPY.under14Body : freeEnded ? FREE_START_COPY.endedExpired : !free?.age || freeCalm ? "" : "로그인 없이 바로 시작합니다.") : showProfile && ended ? ended.description : showProfile ? (state.started ? copy.startedDescription : state.candidate ? (state.previousConnected ? "작업 폴더를 준비한 뒤 연결합니다. 시작 전에는 기존 활동이 유지됩니다." : "사용할 작업 폴더를 확인한 뒤 시작하세요.") : "연결된 활동을 확인한 뒤 이어서 시작하세요.") : buying ? (purchase?.stage && purchase.stage !== "choosing" ? "" : `${chosen?.durationDays ?? 30}일 동안 쓰는 이용권이에요. 한 번만 결제하고, 자동으로 다시 결제되지 않아요.`) : entry === "trial" ? "일상의 고민부터 만들고 싶은 것까지, AI와 함께 시작해보세요. 지금은 발급받은 체험 코드가 필요합니다." : entry === "classroom" ? (free ? "받은 참여 코드를 입력하세요." : "발급받은 참여 코드로 수업을 확인하세요.") : "혼자 AI를 체험하거나, 참여한 수업을 이어갈 수 있습니다."}</p>
        {freeCard ? <FreeStartCard free={free!} checking={state.checking} calm={freeCalm} error={freeError} purchase={!!purchase?.available} onCode={openCode} onPurchase={openPurchase} onBack={state.profile && !freeEntering ? () => setEditing(false) : undefined} />
        : state.profile && !editing ? <>
          <div className="studio-course"><span className="studio-verified">{activity}</span><h3>{state.profile.name}</h3><dl><div><dt>{copy.coachRowLabel}</dt><dd>{state.profile.coach}</dd></div>{state.profile.kind !== "trial" && state.profile.kind !== "personal" && <div><dt>회차</dt><dd>{state.profile.series}</dd></div>}{passLeft && <div><dt>남은 이용</dt><dd>{passLeft}</dd></div>}{ended ? <div><dt>{freeSeat ? "무료 사용" : "체험"}</dt><dd>{ended.row}</dd></div> : trialLeft && <div><dt>{state.candidate ? (freeSeat ? "무료 사용량" : "체험 한도") : (freeSeat ? "남은 무료 사용" : "남은 체험")}</dt><dd>{trialLeft}</dd></div>}<div><dt>작업 폴더</dt><dd>{state.profile.workspace}</dd></div></dl></div>
          {/* TUX-SP-13 — an ended trial has no "이어서 하기": peer choices only (SX-04), and the pass is opened only by the person (REQ-L12 ①). */}
          {ended ? (purchase?.available || (ended.reason === "exhausted" && !state.candidate)) && <div className="studio-entry-options" role="group" aria-label={freeSeat ? "무료 사용 이후 고르기" : "체험 이후 고르기"}>
            {purchase?.available && <button className="studio-choice" disabled={state.checking} onClick={openPurchase}>이어서 하려면 이용권으로 시작하기 <span aria-hidden="true">→</span></button>}
            {ended.reason === "exhausted" && !state.candidate && <button className="studio-choice" disabled={state.checking} onClick={() => { setState(s => ({ ...s, checking: true, error: undefined })); postToHost({ type: "beginCourse" }); }}>{state.checking ? "활동 여는 중…" : "지난 대화 보기"} <span aria-hidden="true">→</span></button>}
          </div> : ghChoice ? <GithubChoice github={gh!} checking={state.checking} /> : <button className="studio-primary" disabled={state.checking || ghBusy} onClick={() => { setState(s => ({ ...s, checking: true, error: undefined })); postToHost({ type: "beginCourse" }); }}>{state.checking ? (gh?.working === "signin" ? "GitHub 로그인 기다리는 중…" : "활동 여는 중…") : state.started ? copy.continueButton : state.candidate ? "이 활동 시작하기" : "이어서 하기"} <span aria-hidden="true">↗</span></button>}
          {!ended && gh?.status === "signin" && !gh.working && <button className="studio-text-button" disabled={state.checking} onClick={() => postToHost({ type: "githubSignIn" })}>다른 컴퓨터에서 올린 홈페이지 불러오기 (GitHub 로그인)</button>}
          {!ended && gh?.status === "unavailable" && <p className="studio-help">GitHub에 올린 홈페이지를 확인하지 못했어요. 새로 시작해도 돼요.</p>}
          {/* #751 U2 — a quiet line under the one Primary (SX-02/04): the same list, from the same host read, as the work screen. */}
          {!state.candidate && <InstructorInbox inbox={state.inbox ?? null} post={postToHost} quiet />}
          {state.candidate && !ghChoice && !ended && <button className="studio-text-button" disabled={state.checking || ghBusy} onClick={() => postToHost({type:"chooseActivityFolder"})}>다른 작업 폴더 선택</button>}
          <div className="studio-course-actions"><button className="studio-text-button" onClick={() => { setEditing(true); setEntry(null); setToken(""); }} disabled={state.checking}>다른 활동 선택</button><button className="studio-text-button" onClick={() => postToHost({ type: state.candidate ? "cancelCandidate" : "disconnectCourse" })} disabled={state.checking}>{state.candidate ? "선택 취소" : "연결 해제"}</button></div>
        </> : buying ? <div className="studio-purchase">
          {/* SPEC iteration 4 §2.5 — with free start the Google sign-in sits at purchase, never on first open. */}
          {free && state.account && (!purchase?.stage || purchase.stage === "choosing") && <AccountEntry account={state.account} checking={state.checking} post={postToHost} />}
          {purchase?.stage === "waiting" || purchase?.stage === "connecting" ? <>
            {purchase.order && <div className="studio-course"><span className="studio-verified">{purchase.stage === "connecting" ? "결제 확인" : "결제 기다리는 중"}</span><h3>{purchase.order.label}</h3><dl><div><dt>결제할 금액</dt><dd>{won(purchase.order.amount)}</dd></div></dl></div>}
            {purchase.guardian && <div className="studio-guardian-pay"><img src={purchase.guardian.qr} width={160} height={160} alt="보호자 결제 페이지 QR 코드" /><p className="studio-help">{FREE_START_COPY.guardianPayHelp}</p><a href={purchase.guardian.url} className="studio-text-button" target="_blank" rel="noreferrer">결제 페이지 주소 열기 ↗</a></div>}
            <p className="studio-help" role="status">{purchase.message}</p>
            {/* The way out when the browser says paid and this screen has not moved: ask the Service again. */}
            {purchase.stage === "waiting" && <div className="studio-purchase-actions"><button className="studio-text-button" onClick={() => postToHost({ type: "purchaseReopen" })}>결제 창 다시 열기</button><button className="studio-text-button" onClick={() => postToHost({ type: "purchaseRetry" })}>결제했는데 그대로예요</button><button className="studio-text-button" onClick={leavePurchase}>그만두기</button></div>}
          </> : purchase?.stage === "stopped" ? <>
            <p className="studio-help" role="status">{purchase.message}</p>
            {purchase.order && <button className="studio-primary" disabled={state.checking} onClick={() => postToHost({ type: "purchaseRetry" })}>다시 연결 <span aria-hidden="true">→</span></button>}
            <button className="studio-text-button" disabled={state.checking} onClick={leavePurchase}>시작 방법 다시 선택</button>
          </> : chosen ? <>
            {/* SX-04 — the passes are a plain list of choices; the one Primary follows the list. */}
            <div role="radiogroup" aria-label="이용권 고르기" className="studio-plans">{products.map(p => <button key={p.id} type="button" role="radio" aria-checked={p.id === chosen.id} className="studio-plan" disabled={state.checking} onClick={() => setPicked(p.id)}>
              <span className="studio-plan-name">{p.label}{p.recommended && <em>추천</em>}</span>
              <span className="studio-plan-price">{won(p.amount)}</span>
              {p.tagline && <span className="studio-plan-for">{p.tagline}</span>}
              <span className="studio-plan-what">AI 요청 {p.requestLimit.toLocaleString("ko-KR")}번 · {p.durationDays}일 동안</span>
            </button>)}</div>
            {/* SPEC iteration 4 §2.5 — on a free seat, one question before checkout; under 19 a guardian pays. */}
            {purchase?.freeSeat && purchase.payerAdult === undefined ? <div className="studio-entry-options" role="group" aria-labelledby="payer-question">
              <p id="payer-question" className="studio-question">{FREE_START_COPY.payerQuestion}</p>
              <button className="studio-choice" disabled={state.checking} onClick={() => postToHost({ type: "purchasePayer", adult: true })}>{FREE_START_COPY.payerYes} <span aria-hidden="true">→</span></button>
              <button className="studio-choice" disabled={state.checking} onClick={() => postToHost({ type: "purchasePayer", adult: false })}>{FREE_START_COPY.payerNo} <span aria-hidden="true">→</span></button>
            </div>
            : purchase?.freeSeat && purchase.payerAdult === false ? <button className="studio-primary" disabled={state.checking} onClick={() => { setState(s => ({ ...s, checking: true, error: undefined })); postToHost({ type: "purchaseStart", productId: chosen.id, guardian: true }); }}>{state.checking ? "결제 페이지를 준비하고 있어요" : FREE_START_COPY.guardianPay} <span aria-hidden="true">→</span></button>
            : <button className="studio-primary" disabled={state.checking} onClick={() => { setState(s => ({ ...s, checking: true, error: undefined })); postToHost({ type: "purchaseStart", productId: chosen.id }); }}>{state.checking ? "결제 창을 열고 있어요" : `${won(chosen.amount)} 결제하러 가기`} <span aria-hidden="true">↗</span></button>}
            <p className="studio-help">브라우저가 열려요. 결제하고 돌아오면 바로 쓸 수 있어요.</p>
            <button className="studio-text-button" disabled={state.checking} onClick={leavePurchase}>시작 방법 다시 선택</button>
          </> : <>
            <p className="studio-help" role="status">{purchase?.message ?? "이용권을 불러오고 있어요."}</p>
            <button className="studio-text-button" onClick={leavePurchase}>시작 방법 다시 선택</button>
          </>}
        </div> : entry === null ? <div className="studio-entry-options" role="group" aria-label="시작 방법 고르기">
          {state.account && <AccountEntry account={state.account} checking={state.checking} post={postToHost} />}
          {/* SX-04 — these two are **peer choices**. They both used to be Lime Primary,
              which puts two emphasized buttons on one screen. The requirement names this
              screen explicitly and writes "draw it as a list of options and do not draw
              both as Primary". The "코드 확인하기" that appears after choosing is the only
              Primary in this flow. */}
          <div className="studio-choice-group">
            <button className="studio-choice" disabled={state.checking} onClick={() => choose("trial")} aria-describedby={trialNote.code || trialNote.allowance ? "trial-entry-note" : undefined}>AI 체험하기 <span aria-hidden="true">→</span></button>
            {(trialNote.code || trialNote.allowance) && <p id="trial-entry-note" className="studio-choice-note">{trialNote.code && <span>{trialNote.code}</span>}{trialNote.allowance && <span>{trialNote.allowance}</span>}</p>}
          </div>
          <button className="studio-choice" disabled={state.checking} onClick={() => choose("classroom")}>수업에 참여하기 <span aria-hidden="true">→</span></button>
          {/* REQ-L12 — a third peer choice, drawn only when the Service sells passes. Chosen by the person; never opened for them. */}
          {purchase?.available && <button className="studio-choice" disabled={state.checking} onClick={openPurchase}>이용권으로 시작하기 <span aria-hidden="true">→</span></button>}
          {state.profile && <button className="studio-text-button" onClick={() => setEditing(false)}>기존 활동으로 돌아가기</button>}
          {purchase?.order && !purchase.stage && <button className="studio-text-button" disabled={state.checking} onClick={() => { setEntry("purchase"); setEditing(true); postToHost({ type: "purchaseRetry" }); }}>결제 중인 이용권 이어서 보기 · {purchase.order.label}</button>}
        </div> : <form onSubmit={connect}>
          <label htmlFor="course-code">{free ? FREE_START_COPY.codeLabel : entry === "trial" ? "체험 참여 코드" : "수업 참여 코드"}</label>
          <input ref={input} id="course-code" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="받은 코드를 여기에 붙여넣으세요" autoComplete="off" spellCheck={false} disabled={state.checking} aria-describedby="code-help connection-error"/>
          <p id="code-help" className="studio-help">코드는 이 기기에 안전하게 저장됩니다.</p>
          <button className="studio-primary" disabled={state.checking || !token.trim()} type="submit">{state.checking ? "코드 확인 중…" : "코드 확인하기"}<span aria-hidden="true">→</span></button>
          {state.profile && <button className="studio-text-button" type="button" onClick={() => setEditing(false)}>기존 활동으로 돌아가기</button>}
          <button className="studio-text-button" type="button" disabled={state.checking} onClick={() => { setEntry(null); setToken(""); }}>{free ? "돌아가기" : "시작 방법 다시 선택"}</button>
        </form>}
        {!!state.activities?.length && !state.candidate && <nav aria-label="저장된 활동" className="studio-saved-activities"><h3>저장된 활동</h3>{state.activities.map(a => <button className="studio-text-button" key={a.ref} disabled={state.checking} onClick={() => postToHost({type:"selectActivity",ref:a.ref})}>{activityLabel(a.kind, a.pass, undefined, !!a.free)} · {a.name}<small>{a.workspace}</small></button>)}</nav>}
        {state.legacyConnection && !state.profile && <p className="studio-help">이전 연결은 이 기기에 보관돼 있습니다. 사용할 서버의 참여 코드를 다시 입력해 주세요.</p>}
        {state.legacyHistory && <button className="studio-text-button" disabled={state.checking} onClick={()=>postToHost({type:'exportLegacyHistory'})}>이전 기록 내보내기</button>}
        <div aria-live="polite" role="status" className="studio-status">{status}</div>
        {state.error && <div className="studio-error" id="connection-error" role="alert">{state.error}{(state.previousConnected ?? (!state.candidate && !!state.profile)) && <p>기존 활동 연결은 유지됩니다.</p>}</div>}
        <div className="studio-card-footer">{freeCard ? "만든 파일과 대화는 이 컴퓨터에 남습니다. 로그인은 이용권을 결제할 때만 합니다." : free && entry === "classroom" && !showProfile ? FREE_START_COPY.codeFooter : buying ? "쓰기 전이면 전액 환불해요. 쓰기 시작한 뒤에는 쓰지 않은 만큼 환불해요." : entry === "trial" && !showProfile ? "체험 코드가 없다면 코드 발급 담당자에게 요청해 주세요. 수업 참여는 기존 코드를 사용합니다." : "참여 코드에 연결된 활동과 이용 조건이 적용됩니다."}</div>
      </section>
    </div>
    <footer className="studio-bottom"><button onClick={() => postToHost({ type: "openLocalFolder" })}>작업 폴더 열기 <span aria-hidden="true">↗</span></button><span>{state.workspace ? `현재 폴더 · ${state.workspace}` : "내 파일은 내 작업 폴더에 남습니다."}</span><span className="studio-build">만들기 · 검토하기 · 내 것으로</span></footer>
  </main>;
}

/**
 * TUX-SP-14/15/16 — the free start card. One question before first use (만 14세 이상인가요?), then one
 * Primary. No 체험/수업 choice: a code is a small secondary link, the pass list another. The host
 * owns the claim; this view sends intents only and never sees the install id or the issued token.
 */
function FreeStartCard({ free, checking, calm, error, purchase, onCode, onPurchase, onBack }: { free: NonNullable<StartState["freeStart"]>; checking: boolean; calm: string | null; error: string | null; purchase: boolean; onCode: () => void; onPurchase: () => void; onBack?: () => void }) {
  const busy = checking || !!free.claiming;
  const links = <div className="studio-free-links">
    <button className="studio-text-button" disabled={busy} onClick={onCode}>{FREE_START_COPY.codeLink}</button>
    {purchase && free.age !== "under14" && <button className="studio-text-button" disabled={busy} onClick={onPurchase}>{FREE_START_COPY.passLink}</button>}
    {onBack && <button className="studio-text-button" disabled={busy} onClick={onBack}>기존 활동으로 돌아가기</button>}
  </div>;
  if (free.age === "under14") return <div className="studio-free" role="group" aria-labelledby="connect-title">
    <button className="studio-text-button studio-free-guardian" onClick={() => postToHost({ type: "freeStartGuardian" })}>{FREE_START_COPY.guardianLink}</button>
    {links}
  </div>;
  // An ended free seat: what can follow, as peer choices (SX-04); the pass opens only on a press (REQ-L12 ①).
  if (free.ended) return <div className="studio-free" role="group" aria-label="무료 사용 이후 고르기">
    {purchase && <div className="studio-entry-options"><button className="studio-choice" disabled={busy} onClick={onPurchase}>{FREE_START_COPY.endedPass} <span aria-hidden="true">→</span></button></div>}
    <div className="studio-free-links"><button className="studio-text-button" disabled={busy} onClick={onCode}>{FREE_START_COPY.codeLink}</button>{onBack && <button className="studio-text-button" disabled={busy} onClick={onBack}>기존 활동으로 돌아가기</button>}</div>
  </div>;
  const tooOld = free.tooOld && !free.claiming;
  return <div className="studio-free" aria-busy={busy}>
    {calm ? null : !free.age ? <div className="studio-entry-options" role="group" aria-labelledby="free-age-question">
      <p id="free-age-question" className="studio-question">{FREE_START_COPY.ageQuestion}</p>
      {/* SX-04 — one Primary; the other answer is a peer choice, not a second emphasized button. */}
      <button className="studio-primary" disabled={busy || tooOld} onClick={() => postToHost({ type: "freeStartAge", answer: "14+" })}>{FREE_START_COPY.ageYes} <span aria-hidden="true">→</span></button>
      <button className="studio-choice" disabled={busy} onClick={() => postToHost({ type: "freeStartAge", answer: "under14" })}>{FREE_START_COPY.ageNo} <span aria-hidden="true">→</span></button>
    </div> : !tooOld && <button className="studio-primary" disabled={busy} onClick={() => postToHost({ type: "freeStartClaim" })}>{free.claiming ? "준비하는 중…" : FREE_START_COPY.start} <span aria-hidden="true">→</span></button>}
    {free.allowance && !calm && <p className="studio-choice-note">{free.allowance}</p>}
    {calm && <p className="studio-notice" role="status">{calm}</p>}
    {tooOld && <div className="studio-error" role="alert">{free.refusal?.code === "app_too_old" ? free.refusal.message : "이 Studio는 바로 시작하기를 지원하지 않는 버전입니다. 최신 Studio로 업데이트한 뒤 다시 열어 주세요."}<p><button className="studio-text-button" onClick={() => postToHost({ type: "freeStartUpdate" })}>{FREE_START_COPY.update}</button></p></div>}
    {error && !tooOld && <div className="studio-error" role="alert">{error}</div>}
    {links}
  </div>;
}

function pushedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}월 ${d.getDate()}일에 올림`;
}

/**
 * The seat's GitHub already holds a class site: continue it (the one Primary) or start new (a
 * peer option, SX-04). Several sites → pick one; the most recently published is preselected.
 */
function GithubChoice({ github, checking }: { github: NonNullable<StartState["github"]>; checking: boolean }) {
  const repos = github.repos ?? [];
  const names = repos.map((r) => r.name).join("\n");
  const [pick, setPick] = useState(repos[0]?.name ?? "");
  useEffect(() => { if (!repos.some((r) => r.name === pick)) setPick(repos[0]?.name ?? ""); }, [names]);
  const busy = checking || !!github.working;
  return <div className="studio-github" role="group" aria-labelledby="studio-github-title">
    <h3 id="studio-github-title">GitHub에 올린 홈페이지가 있어요</h3>
    {repos.length > 1
      ? <fieldset className="studio-repo-list" disabled={busy}>
          <legend>이어서 만들 홈페이지를 고르세요</legend>
          {repos.map((r) => <label key={r.name}><input type="radio" name="studio-github-repo" value={r.name} checked={pick === r.name} onChange={() => setPick(r.name)} /><span>{r.name}</span><small>{pushedLabel(r.pushedAt)}</small></label>)}
        </fieldset>
      : <p className="studio-repo-one"><span>{repos[0]?.name}</span><small>{pushedLabel(repos[0]?.pushedAt ?? "")}</small></p>}
    <button className="studio-primary" disabled={busy || !pick} aria-busy={github.working === "download"} onClick={() => postToHost({ type: "continueFromGithub", repo: pick })}>{github.working === "download" ? "내려받는 중…" : "GitHub에서 이어하기"} <span aria-hidden="true">↗</span></button>
    <button className="studio-choice" disabled={busy} onClick={() => postToHost({ type: "startNew" })}>새로 하기 <span aria-hidden="true">→</span></button>
    <p className="studio-help">이어하기는 고른 홈페이지를 이 컴퓨터로 내려받아 이어서 만들어요. 새로 하기는 새 폴더{github.newFolder ? `(${github.newFolder})` : ""}에서 시작하고, 올릴 때 새 저장소를 만들어요.</p>
  </div>;
}

export function DisconnectedChat({ open, coachName }: { open: () => void; coachName?: string }) {
  const [lead1, lead2] = startPageCopy(coachName).disconnectedLead.split("\n");
  return <main className="studio-disconnected"><Brand/><h1>시작할 준비가 됐나요?</h1><p>{lead1}<br/>{lead2}</p><button className="studio-primary" onClick={open}>시작 화면 열기 <span aria-hidden="true">↗</span></button></main>;
}
