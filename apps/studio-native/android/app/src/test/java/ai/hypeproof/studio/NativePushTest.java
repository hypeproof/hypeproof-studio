package ai.hypeproof.studio;

import org.junit.Test;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Actual loopback HTTP tests of current-account registration and stale-open refusal. */
public class NativePushTest {
    static Set<String> keys(JSONObject v){Set<String> keys=new HashSet<>();v.keys().forEachRemaining(keys::add);return keys;}
    static final class Disk implements NativePush.Store {String bytes;boolean fail;public JSONObject loadPush()throws Exception{return bytes==null?null:new JSONObject(bytes);}public void savePush(JSONObject value)throws Exception{if(fail)throw new Exception("disk_full");bytes=value.toString();}}
    static final class Harness implements AutoCloseable {
        final Disk disk=new Disk();final ReflectionModelTest.Queue worker=new ReflectionModelTest.Queue();final Deque<Runnable> ui=new ArrayDeque<>();
        final AtomicReference<NativeDeviceSignIn.Credentials> account=new AtomicReference<>(new NativeDeviceSignIn.Credentials("A","session-A","access","refresh",System.currentTimeMillis()+3600000));
        final List<String> routes=new ArrayList<>();final List<JSONObject> bodies=new ArrayList<>();final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();final TestHttpServer server;final DeviceSignInHttp http;
        boolean lost,malformed,recorded=true;NativePush push;
        Harness()throws Exception {
            server=new TestHttpServer(x->{assertEquals("Bearer access",x.headers.get("authorization"));assertNull(x.headers.get("origin"));assertNull(x.headers.get("cookie"));routes.add(x.method+" "+x.path);JSONObject body=x.body.length==0?null:new JSONObject(new String(x.body,StandardCharsets.UTF_8));if(body!=null)bodies.add(body);
                String id=x.path.split("/")[4];JSONObject reply;
                if(x.path.endsWith("/opened")){assertEquals("POST",x.method);assertEquals("hps-push-open/1",body.getString("schema"));reply=new JSONObject().put("recorded",recorded).put("evidence_kind","client_observed");}
                else if(x.method.equals("DELETE")){assertNull(body);reply=new JSONObject().put("schema","hps-push-device/1").put("id",id).put("active",false);}
                else{assertEquals("PUT",x.method);assertTrue(NativePush.owns(disk.loadPush(),account.get()));assertEquals(Set.of("schema","platform","token","permission"),keys(body));assertEquals("android",body.getString("platform"));reply=new JSONObject().put("schema","hps-push-device/1").put("id",id).put("active",malformed?1:true).put("generation",1);}
                x.respond(lost?503:200,"application/json",reply.toString().getBytes(StandardCharsets.UTF_8),"");
            });http=new DeviceSignInHttp(NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1"),deadlines);reopen();
        }
        void reopen(){if(push!=null)push.invalidate();push=new NativePush(account::get,http::push,disk,worker,ui::add,()->{});}
        void drain(){while(!worker.tasks.isEmpty())worker.one();while(!ui.isEmpty())ui.remove().run();}
        public void close()throws Exception{server.close();deadlines.shutdownNow();}
    }
    @Test public void registrationRequiresDurableExplicitChoiceAndReusesInstallationAfterLostReply()throws Exception{
        try(Harness h=new Harness()){h.push.register("synthetic_provider_token_0001");h.drain();assertTrue(h.routes.isEmpty());assertTrue(h.push.enable());String id=h.disk.loadPush().getString("installation");h.lost=true;h.push.register("synthetic_provider_token_0001");h.drain();assertFalse(h.push.status.contains("켰어요"));h.reopen();h.lost=false;h.push.register("synthetic_provider_token_0002");h.drain();assertEquals(id,h.disk.loadPush().getString("installation"));assertEquals(2,h.routes.size());assertEquals(h.routes.get(0),h.routes.get(1));assertTrue(h.push.status.contains("켰어요"));assertFalse(h.disk.bytes.contains("synthetic_provider"));}
    }
    @Test public void failedSaveAndMalformedRegistrationNeverClaimEnabledDelivery()throws Exception{
        try(Harness h=new Harness()){h.disk.fail=true;assertFalse(h.push.enable());h.push.register("synthetic_provider_token_0001");h.drain();assertTrue(h.routes.isEmpty());h.disk.fail=false;assertTrue(h.push.enable());h.malformed=true;h.push.register("synthetic_provider_token_0001");h.drain();assertFalse(h.push.status.contains("켰어요"));}
    }
    @Test public void ownOpenOnlyFetchesAfterRecordedCurrentGenerationAndNeverSubmitsAnAction()throws Exception{
        try(Harness h=new Harness()){assertTrue(h.push.enable());AtomicInteger opened=new AtomicInteger();NativePush.Open ref=NativePush.Open.parse(new JSONObject().put("schema","hps-push/1").put("delivery_id",UUID.randomUUID().toString()).put("kind","approval").put("id","review-1").put("revision","23"));h.recorded=false;h.push.open(ref,b->opened.incrementAndGet());h.drain();assertEquals(0,opened.get());h.recorded=true;h.push.open(ref,b->{assertTrue(b);opened.incrementAndGet();});h.drain();assertEquals(1,opened.get());assertTrue(h.routes.stream().allMatch(p->p.endsWith("/opened")));assertEquals(2,h.routes.size());}
    }
    @Test public void accountSwitchDiscardsLateReceiptAndOldOptInCannotRegisterNewAccount()throws Exception{
        try(Harness h=new Harness()){assertTrue(h.push.enable());h.push.register("synthetic_provider_token_0001");while(!h.worker.tasks.isEmpty())h.worker.one();h.account.set(new NativeDeviceSignIn.Credentials("B","session-B","other","refresh",System.currentTimeMillis()+3600000));h.push.invalidate();while(!h.ui.isEmpty())h.ui.remove().run();assertFalse(h.push.status.contains("켰어요"));h.push.register("synthetic_provider_token_0001");h.drain();assertEquals(1,h.routes.size());assertFalse(h.push.enabled());}
    }
    @Test public void staleSystemPermissionCallbackCannotAffectAnotherOrNewerOptIn()throws Exception{
        try(Harness h=new Harness()){assertTrue(h.push.enable());NativePush.Permission old=h.push.permissionTicket();assertTrue(h.push.accepts(old));h.account.set(new NativeDeviceSignIn.Credentials("B","session-B","other","refresh",System.currentTimeMillis()+3600000));assertFalse(h.push.accepts(old));assertTrue(h.push.enable());NativePush.Permission newer=h.push.permissionTicket();assertTrue(h.push.accepts(newer));assertFalse(h.push.accepts(old));h.push.invalidate();assertFalse(h.push.accepts(newer));assertTrue(h.routes.isEmpty());}
    }
    @Test public void disablePersistsBeforeOwnDeleteAndMalformedPayloadNeverGetsAuthority()throws Exception{
        try(Harness h=new Harness()){assertTrue(h.push.enable());h.push.disable();assertFalse(h.disk.loadPush().getBoolean("enabled"));h.drain();assertTrue(h.routes.get(0).startsWith("DELETE "));assertFalse(h.disk.bytes.contains("token"));}
        for(Object revision:List.of(true,0,-1,1.5,"1.5")){try{NativePush.Open.parse(new JSONObject().put("schema","hps-push/1").put("delivery_id",UUID.randomUUID().toString()).put("kind","approval").put("id","review-1").put("revision",revision));fail("malformed revision");}catch(Exception expected){}}
    }
}
