package ai.hypeproof.studio;

import org.junit.Test;
import org.json.*;
import java.util.*;
import static org.junit.Assert.*;

/** Real model and serialized cache; controlled worker/HTTP completion ordering. */
public class ReflectionSendDuringSyncTest {
    @Test public void explicitSendDuringReadPersistsOnceAndUsesReconciledRevision() throws Exception {
        var h=new ReflectionModelTest.Harness();h.model.edit("동기화 중에도 보낼 내 생각");
        h.model.refresh();assertTrue(h.model.busy);
        assertTrue("One explicit Send must be accepted while a history GET waits",h.model.send());
        ReflectionState saved=h.store.load("A");String id=saved.request.getString("id");
        assertEquals("동기화 중에도 보낼 내 생각",saved.request.getString("text"));assertEquals("",saved.draft);assertTrue(h.submitted.isEmpty());
        h.model.edit("뒤에 따로 적은 글");assertFalse(h.model.send());assertEquals(id,h.store.load("A").request.getString("id"));
        h.snapshot(ReflectionStateTest.reply(7,new JSONArray(),null));h.finish();
        assertEquals("7",h.store.load("A").submission().get("revision"));assertEquals("뒤에 따로 적은 글",h.store.load("A").draft);
        h.networkFailure=true;h.finish();assertEquals(1,h.submitted.size());Map<String,String> sent=h.submitted.get(0);
        assertEquals(id,sent.get("id"));assertEquals("동기화 중에도 보낼 내 생각",sent.get("text"));assertEquals("7",sent.get("revision"));
        h.networkFailure=false;h.snapshot(ReflectionStateTest.reply(9,new JSONArray(),null));h.model.refresh();h.finish();
        assertTrue(h.worker.tasks.isEmpty());assertEquals(sent,h.store.load("A").submission());assertEquals(1,h.submitted.size());
        h.model.retry();h.finish();assertEquals(sent,h.submitted.get(1)); // Only a later explicit retry reuses uncertain bytes.
    }
    @Test public void stopCloseAndChangedSessionCannotDispatchTheQueuedQuestion() throws Exception {
        for(String boundary:List.of("stop","close","account","session")){
            var h=new ReflectionModelTest.Harness();h.model.edit("그대로 남겨 둘 말");h.model.refresh();assertTrue(h.model.send());
            String disk=h.store.records.get("A");
            if(boundary.equals("stop")){assertTrue(h.model.canStopResponse());h.model.stopResponse();}
            else if(boundary.equals("close"))h.model.close();
            else if(boundary.equals("account")){h.model.logout();h.model.credentials=new NativeDeviceSignIn.Credentials("B","other","other","other",Long.MAX_VALUE);h.model.state=new ReflectionState("B");}
            else h.model.credentials=new NativeDeviceSignIn.Credentials("A","replacement","other","other",Long.MAX_VALUE);
            h.snapshot(ReflectionStateTest.reply(5,new JSONArray(),null));h.finish();
            assertTrue(boundary,h.submitted.isEmpty());assertTrue(boundary,h.worker.tasks.isEmpty());
            ReflectionState kept=h.store.load("A");assertEquals(new JSONObject(disk).getJSONObject("request").toString(),kept.request.toString());
            if(boundary.equals("stop")){h.model.refresh();h.finish();assertTrue(h.worker.tasks.isEmpty());assertTrue(h.submitted.isEmpty());}
        }
    }
    @Test public void failedReadSaveOrRemoteBusyNeverDispatchesOrLosesTheAcceptedWords() throws Exception {
        for(String failure:List.of("network","snapshot","save","remote-busy")){
            var h=new ReflectionModelTest.Harness();h.model.edit("안전하게 보관할 질문");h.model.state.revision=3;
            h.model.refresh();assertTrue(h.model.send());String id=h.store.load("A").request.getString("id");
            JSONObject remote=failure.equals("remote-busy")?new JSONObject().put("id","other-turn").put("text","다른 기기의 말").put("status","running").put("created_at",1000).put("updated_at",1000):null;
            h.snapshot(ReflectionStateTest.reply(failure.equals("snapshot")?2:5,new JSONArray(),remote));
            h.networkFailure=failure.equals("network");h.store.fail=failure.equals("save");h.finish();
            assertTrue(failure,h.submitted.isEmpty());assertTrue(failure,h.worker.tasks.isEmpty());
            ReflectionState kept=h.store.load("A");assertEquals(id,kept.request.getString("id"));assertEquals("안전하게 보관할 질문",kept.request.getString("text"));assertEquals("3",kept.submission().get("revision"));assertFalse(h.model.error.isEmpty());
        }
    }
    @Test public void rejectedEnqueueAndRestartNeverManufactureDispatchPermission() throws Exception {
        var h=new ReflectionModelTest.Harness();h.model.edit("저장되어야만 보낼 말");h.model.refresh();h.store.fail=true;
        assertFalse(h.model.send());assertNull(h.model.state.request);assertEquals("저장되어야만 보낼 말",h.model.draft);
        h.store.fail=false;assertTrue(h.model.send());String id=h.store.load("A").request.getString("id");h.model.close();
        h.snapshot(ReflectionStateTest.reply(4,new JSONArray(),null));h.finish();
        h.model=new ReflectionModel(h.store,new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),(p,b,t,c)->h.answer,NativeDeviceSignIn.MONOTONIC),(p,b,t,c)->{if(b!=null)h.submitted.add(new HashMap<>(b));return h.answer;},h.worker,h.ui::add,()->{});
        h.model.restore();h.model.refresh();h.finish();assertTrue(h.worker.tasks.isEmpty());assertTrue(h.submitted.isEmpty());assertEquals(id,h.store.load("A").request.getString("id"));assertEquals("0",h.store.load("A").submission().get("revision"));
    }
}
