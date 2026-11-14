package ai.hypeproof.studio;

import org.json.*;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** Production model and serialized account store, with controlled HTTP completion. */
public class ReflectionAdmissionTest {
    private static ReflectionModelTest.Harness denied(String code)throws Exception{
        var h=new ReflectionModelTest.Harness();h.model.edit("한도에 닿아도 지킬 질문");assertTrue(h.model.send());
        h.answer=new NativeDeviceSignIn.Reply(code.equals("reflection_access_required")?403:code.equals("reflection_admission_unavailable")?503:429,Map.of("error",code,"message","PRIVATE_PROVIDER_DETAIL"));h.finish();return h;
    }
    private static void read(ReflectionModelTest.Harness h,String status,long revision)throws Exception{
        JSONObject request=status==null?null:new JSONObject(h.model.state.request.toString()).put("status",status);
        JSONArray messages=request==null?new JSONArray():new JSONArray().put(ReflectionStateTest.message(request.getString("id"),"user",request.getString("text")));
        h.snapshot(ReflectionStateTest.reply(revision,messages,request));h.model.refresh();h.finish();
    }
    private static void reopen(ReflectionModelTest.Harness h){
        h.model.close();NativeDeviceSignIn.Transport http=(p,b,t,c)->{if(b!=null)h.submitted.add(new HashMap<>(b));return h.answer;};
        h.model=new ReflectionModel(h.store,new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),http,NativeDeviceSignIn.MONOTONIC),http,h.worker,h.ui::add,()->{});h.model.restore();
    }
    @Test public void typedReasonSurvivesHistoryRestartAndDraftRestoreWithoutReplaying()throws Exception{
        for(var reason:Map.of("reflection_monthly_limit","이번 달", "reflection_access_required","이 계정", "reflection_budget_limit","AI 이용 한도", "reflection_admission_unavailable","AI 이용 상태").entrySet()){
            var h=denied(reason.getKey());String id=h.model.state.request.getString("id"),words=h.model.state.request.getString("text");
            assertTrue(h.model.displayError(),h.model.displayError().startsWith(reason.getValue()));String shown=h.model.displayError();
            h.model.edit("다음에 따로 적을 생각");read(h,"failed",3);assertEquals(shown,h.model.displayError());
            assertEquals("다음에 따로 적을 생각",h.store.load("A").draft);assertFalse(h.store.records.get("A").contains("PRIVATE_PROVIDER_DETAIL"));
            reopen(h);assertEquals(shown,h.model.displayError());assertEquals(id,h.model.state.request.getString("id"));assertEquals(words,h.model.state.request.getString("text"));
            h.model.edit("");assertTrue(h.model.restoreFailedDraft());assertEquals(words,h.model.draft);assertEquals(shown,h.model.displayError());
            read(h,"unknown",4);assertEquals(shown,h.model.displayError());read(h,null,5);assertEquals(shown,h.model.displayError());reopen(h);assertEquals(shown,h.model.displayError());
            assertEquals(1,h.submitted.size());assertTrue(h.worker.tasks.isEmpty());h.model.close();
        }
    }
    @Test public void onlyNewIntentOrValidatedResolutionClearsTheReason()throws Exception{
        for(String resolved:List.of("completed","cancelled","new-turn","enqueue")){
            var h=denied("reflection_monthly_limit");read(h,"failed",3);String before=h.store.records.get("A");
            h.snapshot(ReflectionStateTest.reply(2,new JSONArray(),null));h.model.refresh();h.finish();assertEquals(before,h.store.records.get("A"));
            if(resolved.equals("enqueue")){h.model.edit("다른 질문");assertTrue(h.model.send());assertEquals("",h.model.displayError());assertEquals(1,h.submitted.size());}
            else if(resolved.equals("new-turn")){JSONObject other=new JSONObject(h.model.state.request.toString()).put("id","other-turn");h.snapshot(ReflectionStateTest.reply(4,new JSONArray().put(ReflectionStateTest.message("other-turn","user",other.getString("text"))),other));h.model.refresh();h.finish();}
            else read(h,resolved,4);
            assertEquals("",h.store.load("A").failureMessage());assertFalse(h.store.records.get("A").contains("request_failure"));h.model.close();
        }
    }
    @Test public void failedPersistenceAndLateAccountOrSessionResponsesDoNotInventADurableReason()throws Exception{
        var h=new ReflectionModelTest.Harness();h.model.edit("원래 보낸 말");assertTrue(h.model.send());String disk=h.store.records.get("A");
        h.answer=new NativeDeviceSignIn.Reply(429,Map.of("error","reflection_monthly_limit"));h.store.fail=true;h.finish();
        assertEquals(disk,h.store.records.get("A"));assertEquals("",h.model.state.failureMessage());assertTrue(h.model.displayError().contains("저장하지 못했어요"));h.model.close();
        for(String boundary:List.of("account","session","close")){
            var next=new ReflectionModelTest.Harness();next.model.edit("늦게 돌아올 응답");assertTrue(next.model.send());String original=next.store.records.get("A");
            next.answer=new NativeDeviceSignIn.Reply(403,Map.of("error","reflection_access_required"));next.worker.one();
            if(boundary.equals("close"))next.model.close();else{String account=boundary.equals("account")?"B":"A";next.model.credentials=new NativeDeviceSignIn.Credentials(account,"different-session","other","other",Long.MAX_VALUE);if(account.equals("B"))next.model.state=new ReflectionState("B");}
            next.ui.remove().run();assertEquals(original,next.store.records.get("A"));assertFalse(next.store.records.containsKey("B"));assertEquals("",next.model.state.failureMessage());next.model.close();
        }
        var other=denied("reflection_monthly_limit");other.store.token=new NativeDeviceSignIn.Credentials("B","B-session","B-token","B-refresh",Long.MAX_VALUE);reopen(other);assertEquals("B",other.model.account());assertEquals("",other.model.displayError());other.model.close();
    }
    @Test public void legacyCacheAndUnknownProviderErrorsNeverBecomeArbitraryPersistentText()throws Exception{
        ReflectionState legacy=new ReflectionState("A");legacy.draft="호환되는 예전 초안";String encoded=legacy.json().toString();assertFalse(encoded.contains("request_failure"));assertEquals(legacy.draft,new ReflectionState("A",encoded).draft);
        var h=denied("arbitrary-provider-error PRIVATE_PROVIDER_DETAIL");assertEquals("",h.store.load("A").failureMessage());assertFalse(h.store.records.get("A").contains("PRIVATE_PROVIDER_DETAIL"));h.model.close();
        var valid=denied("reflection_access_required");JSONObject bad=valid.model.state.json();bad.getJSONObject("request_failure").put("code","PRIVATE_PROVIDER_DETAIL");assertThrows(Exception.class,()->new ReflectionState("A",bad.toString()));assertThrows(Exception.class,()->new ReflectionState("B",valid.store.records.get("A")));valid.model.close();
    }
}
