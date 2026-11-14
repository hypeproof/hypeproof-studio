package ai.hypeproof.studio;

import org.junit.Test;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

public class NativeTeamModelTest {
    static JSONObject question()throws Exception{return new JSONObject().put("schema","hps-card/1").put("key","growth:choice-a").put("kind","team:choice").put("attempt",1).put("expires_at",System.currentTimeMillis()+60000).put("title","오늘의 질문").put("preface",JSONObject.NULL).put("prompt","어디에서 막혔나요?").put("segments",new JSONArray().put(new JSONObject().put("kind","own_words").put("label","내가 남긴 말").put("text","진행할 방법을 찾고 있어요"))).put("choices",new JSONArray().put(new JSONObject().put("id","method").put("label","방법이 막혔어요"))).put("select","pick").put("text",new JSONObject().put("label","내 생각").put("placeholder","덧붙일 말").put("max",2000).put("value",JSONObject.NULL)).put("actions",new JSONArray().put(new JSONObject().put("id","continue").put("label","이 생각으로 이어가기").put("primary",true).put("needs_answer",true))).put("skip","나중에").put("note",JSONObject.NULL);}
    static JSONObject approval()throws Exception{long now=System.currentTimeMillis()/1000;return new JSONObject().put("id","review-1").put("request_digest","d".repeat(64)).put("source",new JSONObject().put("repo","hypeproof/hypeproof-studio").put("pr",4111).put("head","a".repeat(40)).put("base","b".repeat(40)).put("policy_digest","c".repeat(64)).put("evidence_digest","e".repeat(64)).put("context_digest","f".repeat(64))).put("reviewer","synthetic-reviewer").put("brief",new JSONObject().put("authored",new JSONArray().put("summary: 계정의 질문을 바로 볼 수 있어요")).put("verified",new JSONArray().put("물리 기기 확인 전"))).put("state","pending").put("created_at",now-10).put("expires_at",now+600).put("lease_expires_at",now+50).put("can_decide",true).put("unavailable_reason",JSONObject.NULL).put("decision",JSONObject.NULL).put("review",JSONObject.NULL);}
    static final class Disk implements NativeTeamModel.Store {
        final Map<String,String> files=new ConcurrentHashMap<>(),intents=new ConcurrentHashMap<>();boolean fail;
        public JSONArray loadApprovalPending(String a)throws Exception{return new JSONArray(files.getOrDefault(a,"[]"));}
        public void saveApprovalPending(String a,JSONArray value)throws Exception{if(fail)throw new Exception("disk_full");files.put(a,value.toString());}
        public JSONObject loadQuestionIntent(String a)throws Exception{return intents.containsKey(a)?new JSONObject(intents.get(a)):null;}
        public void saveQuestionIntent(String a,JSONObject v)throws Exception{if(fail)throw new Exception("disk_full");if(v==null)intents.remove(a);else intents.put(a,v.toString());}
    }
    static final class Harness implements AutoCloseable {
        final TestHttpServer server;final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
        final ReflectionModelTest.Queue worker=new ReflectionModelTest.Queue();final Deque<Runnable> ui=new ArrayDeque<>();final Disk disk=new Disk();
        final AtomicReference<NativeDeviceSignIn.Credentials> account=new AtomicReference<>(new NativeDeviceSignIn.Credentials("A","session-A","test-access","test-refresh",System.currentTimeMillis()+3600000));
        final List<String> requests=new CopyOnWriteArrayList<>();final List<JSONObject> answers=new CopyOnWriteArrayList<>(),decisions=new CopyOnWriteArrayList<>();
        volatile int capabilityStatus=200;volatile boolean capabilityMalformed;volatile String malformedTrigger;volatile boolean wrongSession,uncertain,changedDigest,emptyQuestions,lostTrigger;volatile int attempt=1;volatile JSONObject served;final NativeTeamModel model;final DeviceSignInHttp http;
        final List<JSONObject> triggers=new CopyOnWriteArrayList<>();
        Harness()throws Exception{
            served=approval();server=new TestHttpServer(exchange->{
                String path=exchange.path.split("\\?",2)[0].substring(3),method=exchange.body.length==0?"GET":"POST";requests.add(method+" "+path);
                assertEquals("Bearer test-access",exchange.headers.get("authorization"));assertNull(exchange.headers.get("origin"));
                JSONObject out;int code=200;
                if(path.equals("/me"))out=new JSONObject().put("account",new JSONObject().put("id","A").put("status","active").put("display_name","지윤")).put("session_id",wrongSession?"other-session":"session-A");
                else if(path.equals("/me/product-events/consent")){code=capabilityStatus;out=new JSONObject().put("schema",capabilityMalformed?"bad":"hps-product-consent/1").put("notice_version","team-ux/1").put("title","사용 경험 공유").put("notice","거절해도 질문을 사용할 수 있어요").put("preference",new JSONObject().put("notice_version","team-ux/1").put("granted",0));}
                else if(path.equals("/me/cards")){assertEquals("/v1/me/cards?surface=mobile",exchange.path);out=new JSONObject().put("card",emptyQuestions?JSONObject.NULL:question().put("attempt",attempt));}
                else if(path.equals("/me/question-triggers")){JSONObject body=new JSONObject(new String(exchange.body,StandardCharsets.UTF_8));assertTrue(body.get("source_revision") instanceof Number);assertEquals(1,body.getInt("source_revision"));assertEquals(body.getString("id"),body.getString("source_id"));assertEquals(UUID.fromString(body.getString("id")).toString(),body.getString("id"));triggers.add(body);if(lostTrigger){code=503;}else emptyQuestions=false;out=new JSONObject().put("schema","hps-question-trigger/1").put("key","growth:choice-a").put("source",new JSONObject().put("kind","choice").put("id",body.getString("id")).put("revision",1)).put("reentry",new JSONObject().put("method","GET").put("path","/v1/me/cards")).put("model_calls",0).put("policy","team-question/1").put("created",true);if(malformedTrigger!=null)switch(malformedTrigger){case "policy"->out.put("policy","unreviewed/2");case "created"->out.put("created",1);case "key"->out.put("key","pmf:other");default->out.remove(malformedTrigger);}}
                else if(path.endsWith("/shown"))out=new JSONObject().put("ok",true);
                else if(path.endsWith("/answer")){JSONObject body=new JSONObject(new String(exchange.body,StandardCharsets.UTF_8));answers.add(body);out=new JSONObject().put("ok",true).put("thanks","선택한 생각을 남겼어요");}
                else if(path.equals("/me/approval-inbox"))out=new JSONObject().put("schema","hps-member-approval-inbox/1").put("availability","ready").put("cards",new JSONArray().put(served));
                else if(path.endsWith("/decisions")){
                    JSONObject body=new JSONObject(new String(exchange.body,StandardCharsets.UTF_8));
                    JSONArray saved=disk.loadApprovalPending("A");assertEquals(1,saved.length());assertEquals(body.getString("id"),saved.getJSONObject(0).getString("id"));decisions.add(body);
                    if(uncertain){code=503;out=new JSONObject().put("error","unavailable");}else{served=new JSONObject(served.toString()).put("state","submitting").put("can_decide",false).put("decision",new JSONObject().put("id",body.getString("id")).put("choice",body.getString("choice")).put("status","awaiting_processing").put("created_at",System.currentTimeMillis()/1000));out=served;}
                }else if(path.equals("/me/approval-inbox/review-1")){out=new JSONObject(served.toString());if(changedDigest)out.put("request_digest","e".repeat(64));}
                else{code=404;out=new JSONObject().put("error","unexpected_route");}
                exchange.respond(code,"application/json",out.toString().getBytes(StandardCharsets.UTF_8),"");
            });
            http=new DeviceSignInHttp(NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1"),deadlines);
            model=new NativeTeamModel(account::get,http,worker,ui::add,disk,()->{});model.startingAvailable=c->true;
        }
        void finish(){worker.one();while(!ui.isEmpty())ui.remove().run();}
        public void close()throws Exception{try{server.close();}finally{deadlines.shutdownNow();worker.shutdown();}}
    }
    @Test public void actualHTTPShowsVerifiedNameAndQuestionsWithoutAutomaticAnswer()throws Exception{
        try(Harness h=new Harness()){
            h.model.profile(h.account.get());h.finish();assertEquals("지윤",h.model.displayName);
            h.model.questions(h.account.get());h.finish();assertNotNull(h.model.question);assertEquals("",h.model.words);assertEquals("어디에서 막혔나요?",h.model.question.json.getString("prompt"));
            assertTrue(h.answers.isEmpty());assertFalse(h.requests.stream().anyMatch(x->x.endsWith("/shown")));
            h.model.presented();h.finish();h.model.presented();assertTrue(h.worker.tasks.isEmpty());h.attempt=2;h.model.questions(h.account.get());h.finish();h.model.presented();h.finish();assertEquals(2,h.requests.stream().filter(x->x.endsWith("/shown")).count());
            h.model.words="직접 쓴 답";h.model.choice="method";h.model.answer(h.account.get(),"continue",null,false);h.finish();
            assertEquals(1,h.answers.size());assertEquals("직접 쓴 답",h.answers.get(0).getString("text"));assertEquals("method",h.answers.get(0).getString("choice"));assertEquals("mobile",h.answers.get(0).getString("surface"));assertNull(h.model.question);assertEquals("선택한 생각을 남겼어요",h.model.message);
            assertTrue(h.requests.stream().noneMatch(x->x.contains("reflection")||x.endsWith("/decisions")));
        }
    }
    @Test public void wrongSessionAndLateOtherAccountCannotPopulateHome()throws Exception{
        try(Harness h=new Harness()){
            h.wrongSession=true;h.model.questions(h.account.get());h.finish();assertNull(h.model.question);assertEquals("",h.model.displayName);assertFalse(h.requests.contains("GET /me/cards"));
            h.wrongSession=false;h.model.questions(h.account.get());h.worker.one();h.account.set(new NativeDeviceSignIn.Credentials("B","session-B","other","refresh",System.currentTimeMillis()+3600000));h.model.invalidate();while(!h.ui.isEmpty())h.ui.remove().run();assertNull(h.model.question);assertEquals("",h.model.displayName);assertTrue(h.answers.isEmpty());
        }
    }
    @Test public void emptyInboxOnlyCreatesQuestionAfterAnExplicitStartingChoice()throws Exception{
        try(Harness h=new Harness()){
            h.emptyQuestions=true;h.model.questions(h.account.get());h.finish();assertTrue(h.model.canStart);assertTrue(h.triggers.isEmpty());
            h.model.begin(h.account.get(),"method");h.model.begin(h.account.get(),"method");h.finish();h.finish();
            assertEquals(1,h.triggers.size());assertEquals("method",h.triggers.get(0).getString("choice"));assertNotNull(h.model.question);assertTrue(h.answers.isEmpty());assertTrue(h.decisions.isEmpty());
            h.model.questions(h.account.get());h.finish();assertEquals(1,h.triggers.size());assertFalse(h.model.canStart);
        }
    }
    @Test public void lostStartingReceiptSurvivesNewControllerAndCannotChangeChoice()throws Exception{
        try(Harness h=new Harness()){
            h.emptyQuestions=true;h.lostTrigger=true;h.model.questions(h.account.get());h.finish();h.model.begin(h.account.get(),"method");h.finish();
            assertEquals(1,h.triggers.size());String id=h.disk.loadQuestionIntent("A").getString("id");
            NativeTeamModel reopened=new NativeTeamModel(h.account::get,h.http,h.worker,h.ui::add,h.disk,()->{});
            reopened.startingAvailable=c->true;reopened.questions(h.account.get());h.finish();assertEquals("method",reopened.pendingChoice);reopened.begin(h.account.get(),"goal");assertTrue(h.worker.tasks.isEmpty());assertEquals(1,h.triggers.size());
            h.lostTrigger=false;reopened.begin(h.account.get(),"method");h.finish();h.finish();assertEquals(2,h.triggers.size());assertEquals(id,h.triggers.get(1).getString("id"));assertNull(h.disk.loadQuestionIntent("A"));assertNotNull(reopened.question);
        }
        try(Harness h=new Harness()){
            h.emptyQuestions=true;h.model.questions(h.account.get());h.finish();h.disk.fail=true;h.model.begin(h.account.get(),"goal");h.finish();assertTrue(h.triggers.isEmpty());
        }
    }
    @Test public void malformedTriggerPolicyCreatedAndKeyRetainTheSameDurableIntent()throws Exception{
        for(String invalid:List.of("policy","created","key"))try(Harness h=new Harness()){
            h.emptyQuestions=true;h.malformedTrigger=invalid;h.model.questions(h.account.get());h.finish();
            h.model.begin(h.account.get(),"method");h.finish();assertNotNull("Invalid "+invalid+" must not consume saved intent",h.disk.loadQuestionIntent("A"));String id=h.disk.loadQuestionIntent("A").getString("id");
            assertEquals(id,h.triggers.get(0).getString("id"));assertNull(h.model.question);assertTrue(h.answers.isEmpty());
        }
    }
    @Test public void realConsentCapabilityGatesOnlyStartingChoiceAndPreservesUnknownIntent()throws Exception{
        try(Harness h=new Harness()){
            NativeProductExperience experience=new NativeProductExperience(h.account::get,h.http,h.worker,h.ui::add,new NativeProductExperienceTest.Disk(),h.model::startAvailabilityChanged);
            h.model.startingAvailable=experience::availableFor;h.emptyQuestions=true;
            h.model.questions(h.account.get());h.finish();h.model.begin(h.account.get(),"method");assertFalse(h.model.canStart);assertTrue(h.worker.tasks.isEmpty());assertTrue(h.triggers.isEmpty());
            experience.refresh(h.account.get());h.finish();assertTrue(experience.available);assertFalse(experience.granted);assertTrue(h.model.canStart);
            h.lostTrigger=true;h.model.begin(h.account.get(),"method");h.finish();String id=h.disk.loadQuestionIntent("A").getString("id");assertEquals(1,h.triggers.size());
            for(int status:new int[]{403,404,503,200}){
                h.capabilityStatus=status;h.capabilityMalformed=status==200;experience.refresh(h.account.get());h.finish();h.model.questions(h.account.get());h.finish();
                assertFalse(h.model.canStart);h.model.begin(h.account.get(),"method");assertTrue(h.worker.tasks.isEmpty());assertEquals(1,h.triggers.size());assertEquals(id,h.disk.loadQuestionIntent("A").getString("id"));
            }
            h.emptyQuestions=false;h.model.questions(h.account.get());h.finish();assertNotNull(h.model.question);h.model.words="아직 작성 중인 답";h.model.choice="method";h.model.answer(h.account.get(),"continue",null,false);h.finish();assertEquals(1,h.answers.size());
            h.capabilityMalformed=false;experience.refresh(h.account.get());h.finish();assertTrue(experience.availableFor(h.account.get()));
            h.account.set(new NativeDeviceSignIn.Credentials("B","session-B","other","refresh",System.currentTimeMillis()+3600000));assertFalse(experience.availableFor(h.account.get()));
            assertEquals(1,h.triggers.size());assertTrue(h.decisions.isEmpty());assertTrue(h.requests.stream().noneMatch(x->x.equals("POST /me/product-events")));
        }
    }
    @Test public void failedDecisionStorageAndChangedVersionSendNothing()throws Exception{
        for(boolean changed:new boolean[]{false,true})try(Harness h=new Harness()){
            h.model.approvals(h.account.get());h.finish();NativeApprovalCard card=h.model.approvals.get(0);h.disk.fail=!changed;h.changedDigest=changed;
            h.model.decide(h.account.get(),card,"approve");h.finish();assertTrue(h.decisions.isEmpty());assertFalse(h.model.message.contains("반영됨"));assertTrue(h.disk.files.getOrDefault("A","[]").equals("[]"));
        }
    }
    @Test public void uncertainDecisionIsDurableAndRefreshNeverReplaysIt()throws Exception{
        try(Harness h=new Harness()){
            h.model.approvals(h.account.get());h.finish();NativeApprovalCard card=h.model.approvals.get(0);h.uncertain=true;
            h.model.decide(h.account.get(),card,"approve");h.model.decide(h.account.get(),card,"approve");h.finish();assertEquals(1,h.decisions.size());assertEquals(1,h.disk.loadApprovalPending("A").length());assertTrue(h.model.message.contains("자동으로 다시 보내지 않아요"));
            String id=h.decisions.get(0).getString("id");h.model.approvals(h.account.get());h.finish();assertTrue(h.model.pending.contains(card.id));h.model.decide(h.account.get(),h.model.approvals.get(0),"approve");assertTrue(h.worker.tasks.isEmpty());assertEquals(1,h.decisions.size());assertEquals(id,h.disk.loadApprovalPending("A").getJSONObject(0).getString("id"));
        }
    }
    @Test public void processingReceiptIsNotSuccessfulGitHubReviewAndLeaseMustBeCurrent()throws Exception{
        try(Harness h=new Harness()){
            h.model.approvals(h.account.get());h.finish();h.model.decide(h.account.get(),h.model.approvals.get(0),"approve");h.finish();assertEquals("선택을 전달했어요 · 처리 대기",h.model.approvals.get(0).status());assertFalse(h.model.approvals.get(0).canDecide());
            JSONObject wrong=approval().put("lease_expires_at",0);assertFalse(new NativeApprovalCard(wrong).canDecide());
            wrong=approval().put("review",new JSONObject().put("id",1).put("state","APPROVED").put("commit_id","b".repeat(40)).put("html_url","https://github.com/hypeproof/hypeproof-studio/pull/4111#pullrequestreview-1").put("user",new JSONObject().put("login","synthetic-reviewer")));
            try{new NativeApprovalCard(wrong);fail("Wrong head cannot become a successful review");}catch(Exception expected){}
        }
    }
}
