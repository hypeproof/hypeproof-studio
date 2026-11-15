package ai.hypeproof.studio;

import org.junit.Test;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Production transport over a real loopback HTTP server; no live account or provider. */
public class NativeProductExperienceTest {
    static final class Disk implements NativeProductExperience.Store {
        final Map<String,String> files=new HashMap<>();boolean fail;
        public JSONObject loadProductExperience(String a)throws Exception{return new JSONObject(files.getOrDefault(a,NativeProductExperience.empty().toString()));}
        public void saveProductExperience(String a,JSONObject v)throws Exception{if(fail)throw new Exception("disk_full");files.put(a,v.toString());}
    }
    static final class Harness implements AutoCloseable {
        final Disk disk=new Disk();final ReflectionModelTest.Queue worker=new ReflectionModelTest.Queue();final Deque<Runnable> ui=new ArrayDeque<>();
        final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();final TestHttpServer server;final DeviceSignInHttp http;
        final AtomicReference<NativeDeviceSignIn.Credentials> account=new AtomicReference<>(new NativeDeviceSignIn.Credentials("A","session-A","access","refresh",System.currentTimeMillis()+3600000));
        final List<JSONObject> batches=new CopyOnWriteArrayList<>();final List<String> routes=new CopyOnWriteArrayList<>();final List<Boolean> consentWrites=new CopyOnWriteArrayList<>();
        boolean granted,lost,malformed;NativeProductExperience model;
        Harness()throws Exception{
            server=new TestHttpServer(exchange->{
                assertEquals("Bearer "+account.get().bearer(),exchange.headers.get("authorization"));assertNull(exchange.headers.get("origin"));assertNull(exchange.headers.get("cookie"));routes.add(exchange.path);
                JSONObject reply;int status=200;
                if(exchange.path.equals("/v1/me/product-events/consent")){
                    if(exchange.body.length>0){JSONObject body=new JSONObject(new String(exchange.body,StandardCharsets.UTF_8));assertTrue(body.get("granted") instanceof Boolean);assertEquals("team-ux/1",body.getString("notice_version"));granted=body.getBoolean("granted");consentWrites.add(granted);reply=new JSONObject().put("ok",true);}
                    else reply=new JSONObject().put("schema","hps-product-consent/1").put("notice_version","team-ux/1").put("title","사용 경험 공유").put("notice","원문 없이 개선에 필요한 단계만 기록해요.").put("preference",new JSONObject().put("notice_version","team-ux/1").put("granted",granted?1:0));
                }else{
                    assertEquals("/v1/me/product-events",exchange.path);JSONObject body=new JSONObject(new String(exchange.body,StandardCharsets.UTF_8));assertEquals("hps-product-events/1",body.getString("schema"));JSONArray events=body.getJSONArray("events");assertTrue(events.length()>0&&events.length()<=20);batches.add(body);
                    assertEquals(events.getJSONObject(0).getString("id"),disk.loadProductExperience("A").getJSONArray("events").getJSONObject(0).getString("id"));
                    JSONArray accepted=new JSONArray();for(int i=0;i<events.length();i++)accepted.put(events.getJSONObject(i).getString("id"));if(malformed)accepted.put(UUID.randomUUID().toString());
                    reply=new JSONObject().put("schema","hps-product-events/1").put("accepted",accepted).put("deferred",new JSONArray()).put("evidence_kind","client_observed");if(lost)status=503;
                }
                exchange.respond(status,"application/json",reply.toString().getBytes(StandardCharsets.UTF_8),"");
            });http=new DeviceSignInHttp(NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1"),deadlines);reopen();
        }
        void reopen(){if(model!=null)model.invalidate();model=new NativeProductExperience(account::get,http,worker,ui::add,disk,()->{});}
        void drain(){int limit=20;while(!worker.tasks.isEmpty()||!ui.isEmpty()){if(--limit<0)throw new AssertionError("unbounded retry");if(!worker.tasks.isEmpty())worker.one();while(!ui.isEmpty())ui.remove().run();}}
        void refresh(){model.refresh(account.get());drain();}
        void enable(){refresh();model.choose(true);drain();assertTrue(model.granted);}
        public void close()throws Exception{model.invalidate();server.close();deadlines.shutdownNow();worker.shutdown();}
    }
    @Test public void defaultOffAndExplicitBooleanConsentNeverSendProductContent()throws Exception{
        try(Harness h=new Harness()){
            h.refresh();assertTrue(h.model.available);assertFalse(h.model.granted);h.model.record(NativeProductExperience.Kind.QUESTION_PRESENTED);h.drain();assertTrue(h.batches.isEmpty());
            h.model.choose(true);h.drain();assertEquals(List.of(true),h.consentWrites);h.model.record(NativeProductExperience.Kind.QUESTION_PRESENTED);h.drain();assertEquals(1,h.batches.size());
            JSONObject event=h.batches.get(0).getJSONArray("events").getJSONObject(0);Set<String> keys=new HashSet<>();event.keys().forEachRemaining(keys::add);assertEquals(Set.of("id","journey_id","journey","type","platform","app_version"),keys);assertEquals("question.presented",event.getString("type"));assertEquals(0,h.disk.loadProductExperience("A").getJSONArray("events").length());
            h.model.choose(false);h.drain();h.model.record(NativeProductExperience.Kind.REFLECTION_STARTED);h.drain();assertEquals(1,h.batches.size());assertFalse(h.model.granted);assertTrue(h.routes.stream().allMatch(x->x.startsWith("/v1/me/product-events")));
        }
    }
    @Test public void lostReceiptAndReopenRetryExactPersistedIDsAndContent()throws Exception{
        try(Harness h=new Harness()){
            h.enable();h.lost=true;h.model.record(NativeProductExperience.Kind.VOICE_FINISHED);h.drain();String first=h.batches.get(0).getJSONArray("events").toString();assertEquals(1,h.disk.loadProductExperience("A").getJSONArray("events").length());
            h.reopen();h.lost=false;h.refresh();assertEquals(2,h.batches.size());assertEquals(first,h.batches.get(1).getJSONArray("events").toString());assertEquals(0,h.disk.loadProductExperience("A").getJSONArray("events").length());
        }
    }
    @Test public void malformedAckAndFailedSaveCannotInventDurableSuccess()throws Exception{
        try(Harness h=new Harness()){
            h.enable();h.disk.fail=true;h.model.record(NativeProductExperience.Kind.REFLECTION_STARTED);h.drain();assertTrue(h.batches.isEmpty());
            h.disk.fail=false;h.malformed=true;h.model.record(NativeProductExperience.Kind.REFLECTION_STARTED);h.drain();assertEquals(1,h.disk.loadProductExperience("A").getJSONArray("events").length());
            h.malformed=false;h.model.flush();h.worker.one();h.disk.fail=true;while(!h.ui.isEmpty())h.ui.remove().run();assertEquals(1,h.disk.loadProductExperience("A").getJSONArray("events").length());
        }
    }
    @Test public void logoutBeforeQueuedDispatchAndDeclineAfterFailureFenceOldEvents()throws Exception{
        try(Harness h=new Harness()){
            h.enable();h.model.record(NativeProductExperience.Kind.VOICE_FINAL);h.model.invalidate();h.account.set(new NativeDeviceSignIn.Credentials("B","session-B","other","refresh",System.currentTimeMillis()+3600000));h.drain();assertTrue(h.batches.isEmpty());assertEquals(1,h.disk.loadProductExperience("A").getJSONArray("events").length());
        }
        try(Harness h=new Harness()){
            h.enable();h.lost=true;h.model.record(NativeProductExperience.Kind.VOICE_FAILED);h.drain();h.model.choose(false);h.drain();h.reopen();h.refresh();assertFalse(h.model.granted);assertEquals(1,h.batches.size());assertEquals(0,h.disk.loadProductExperience("A").getJSONArray("events").length());
        }
    }
    @Test public void sameSessionRotationUsesOnlyTheCurrentCredential()throws Exception{
        try(Harness h=new Harness()){
            h.enable();h.account.set(new NativeDeviceSignIn.Credentials("A","session-A","rotated-access","rotated-refresh",System.currentTimeMillis()+3600000));h.model.record(NativeProductExperience.Kind.VOICE_RESUMED);h.drain();assertEquals(1,h.batches.size());assertEquals(0,h.disk.loadProductExperience("A").getJSONArray("events").length());
            h.model.choose(false);h.drain();assertFalse(h.model.granted);assertEquals(List.of(true,false),h.consentWrites);
        }
    }
    @Test public void expiredQueueIsRemovedBeforeAnyRetry()throws Exception{
        try(Harness h=new Harness()){
            h.enable();h.lost=true;h.model.record(NativeProductExperience.Kind.QUESTION_ANSWERED);h.drain();JSONObject stored=h.disk.loadProductExperience("A").put("expires_at",1);h.disk.saveProductExperience("A",stored);h.reopen();h.lost=false;h.refresh();assertEquals(1,h.batches.size());assertEquals(0,h.disk.loadProductExperience("A").getJSONArray("events").length());
        }
    }
}
