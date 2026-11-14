package ai.hypeproof.studio;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class DeviceSignInHttpTest {
    @Test public void typedAdmissionErrorsCrossActualHTTPWithoutLosingAccountOutboxOrDraft() throws Exception {
        record Case(int status,String code,String message) {}
        for(var sample:List.of(
            new Case(429,"reflection_monthly_limit","이번 달 이용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다."),
            new Case(503,"reflection_admission_unavailable","AI 이용 상태를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요. 보낸 이야기와 기록은 남아 있어요."),
            new Case(429,"reflection_budget_limit","이용 한도에 도달했어요. 잠시 후 대화를 확인해 주세요."),
            new Case(429,"provider_quota","이용 한도에 도달했어요. 잠시 후 대화를 확인해 주세요."),
            new Case(403,"reflection_access_required","이 계정의 AI 이용 권한을 확인해 주세요. 글과 대화는 보존돼요.")
        )) {
            ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();List<JSONObject> received=Collections.synchronizedList(new ArrayList<>());
            try(TestHttpServer server=new TestHttpServer(e->{
                assertEquals("/v1/me/reflection/turns",e.path);assertEquals("Bearer bearer",e.headers.get("authorization"));
                received.add(new JSONObject(new String(e.body,StandardCharsets.UTF_8)));
                e.respond(sample.status(),"application/json",new JSONObject().put("error",sample.code()).toString().getBytes(StandardCharsets.UTF_8),"");
            })) {
                var target=NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1");var wire=new DeviceSignInHttp(target,deadlines);
                var store=new ReflectionModelTest.Store();var originalAccount=store.token;var worker=new ReflectionModelTest.Queue();Deque<Runnable> ui=new ArrayDeque<>();
                var model=new ReflectionModel(store,new NativeDeviceSignIn(target,wire,NativeDeviceSignIn.MONOTONIC),wire,worker,ui::add,()->{});
                model.restore();model.edit("보낸 생각 🙂");assertTrue(model.send());
                String id=model.state.request.getString("id");model.edit("응답을 기다리며 쓰는 다른 초안");
                worker.one();ui.remove().run();server.check();
                assertEquals(sample.code(),sample.message(),model.error);
                assertEquals(originalAccount,model.credentials);assertEquals(originalAccount,store.loadCredentials());
                var saved=store.load("A");assertEquals(id,saved.request.getString("id"));assertEquals("local",saved.status());
                assertEquals("보낸 생각 🙂",saved.request.getString("text"));assertEquals("응답을 기다리며 쓰는 다른 초안",saved.draft);assertEquals(saved.draft,model.draft);
                assertEquals(1,received.size());assertEquals(id,received.get(0).getString("id"));assertTrue(received.get(0).get("revision") instanceof Number);
                assertTrue(worker.tasks.isEmpty());assertTrue(ui.isEmpty());assertFalse(model.busy);model.close();
            } finally {deadlines.shutdownNow();}
        }
    }
    @Test public void unauthorizedHistoryHTTPKeepsAccountRecordsButStillClearsLogin() throws Exception {
        ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();CountDownLatch logout=new CountDownLatch(1);List<String> paths=Collections.synchronizedList(new ArrayList<>());
        try(TestHttpServer server=new TestHttpServer(e->{
            paths.add(e.path);assertEquals("Bearer bearer",e.headers.get("authorization"));
            if(e.path.equals("/v1/me/reflection"))e.respond(401,"application/json","{\"error\":\"session_revoked\"}".getBytes(StandardCharsets.UTF_8),"");
            else {assertEquals("/v1/auth/logout",e.path);e.respond(200,"application/json","{\"ok\":true}".getBytes(StandardCharsets.UTF_8),"");logout.countDown();}
        })) {
            var target=NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1");var wire=new DeviceSignInHttp(target,deadlines);
            var store=new ReflectionModelTest.Store();var worker=new ReflectionModelTest.Queue();Deque<Runnable> ui=new ArrayDeque<>();
            var pending=new ReflectionState("A");pending.draft="로그인이 만료되어도 남길 글";pending.enqueue();store.save(pending);String id=pending.request.getString("id");
            var model=new ReflectionModel(store,new NativeDeviceSignIn(target,wire,NativeDeviceSignIn.MONOTONIC),wire,worker,ui::add,()->{});
            model.restore();model.refresh();model.edit("아직 쓰고 있는 글");worker.one();ui.remove().run();
            assertTrue(logout.await(2,TimeUnit.SECONDS));server.check();
            assertNull(model.credentials);assertNull(store.loadCredentials());assertEquals("같은 계정으로 다시 연결해 주세요. 저장한 글은 남아 있어요.",model.error);
            assertEquals(id,store.load("A").request.getString("id"));assertEquals("아직 쓰고 있는 글",store.load("A").draft);
            assertEquals(List.of("/v1/me/reflection","/v1/auth/logout"),paths);assertTrue(worker.tasks.isEmpty());model.close();
        } finally {deadlines.shutdownNow();}
    }
    @Test public void actualJSONWireKeepsNumericRevisionAndRejectsRedirectsAndInvalidBodies() throws Exception {
        ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();List<String> paths=new ArrayList<>();
        TestHttpServer server=new TestHttpServer(e->{switch(e.path){
            case "/v1/me/reflection/turns":
                assertEquals("Bearer synthetic",e.headers.get("authorization"));JSONObject body=new JSONObject(new String(e.body,StandardCharsets.UTF_8));assertTrue(body.get("revision") instanceof Number);assertEquals(7,body.getLong("revision"));e.respond(200,"application/json",ReflectionStateTest.reply(8,new JSONArray(),null).toString().getBytes(StandardCharsets.UTF_8),"");break;
            case "/v1/me":paths.add("redirect");e.respond(302,"application/json","{}".getBytes(StandardCharsets.UTF_8),"Location: /stolen\r\n");break;
            case "/stolen":paths.add("stolen");e.respond(200,"application/json","{}".getBytes(StandardCharsets.UTF_8),"");break;
            case "/v1/auth/device/start":e.respond(200,"application/json",new byte[]{(byte)0xc3,0x28},"");break;
            default:throw new AssertionError("unexpected route");
        }});
        try{
            var target=NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1");var http=new DeviceSignInHttp(target,deadlines);
            var answer=http.call("/me/reflection/turns",Map.of("id","turn","text","hi","revision","7"),"synthetic",new NativeDeviceSignIn.Cancel());assertEquals(200,answer.status());assertTrue(answer.body().get("state") instanceof JSONObject);
            var redirect=http.call("/me",null,"synthetic",new NativeDeviceSignIn.Cancel());assertEquals(302,redirect.status());assertEquals(List.of("redirect"),paths);
            assertThrows(Exception.class,()->http.call("/auth/device/start",Map.of(),null,new NativeDeviceSignIn.Cancel()));assertThrows(Exception.class,()->http.call("/../stolen",null,"synthetic",new NativeDeviceSignIn.Cancel()));
        }finally{server.close();deadlines.shutdownNow();}
    }
    @Test public void rotatedSessionMustBelongToOriginalAccountAndBeRevokedOnMismatch() throws Exception {
        List<String> calls=new ArrayList<>();NativeDeviceSignIn.Transport wire=(p,b,t,c)->{calls.add(p);if(p.equals("/auth/refresh"))return new NativeDeviceSignIn.Reply(200,Map.of("access_token","rotated","refresh_token","new-refresh","session_id","new-session","expires_in",3600));if(p.equals("/me"))return new NativeDeviceSignIn.Reply(200,Map.of("account_id","wrong-account","session_id","new-session","account_status","active"));return new NativeDeviceSignIn.Reply(200,Map.of("ok",true));};
        var auth=new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),wire,NativeDeviceSignIn.MONOTONIC);
        assertThrows(Exception.class,()->auth.refresh(new NativeDeviceSignIn.Credentials("account","session","access","refresh",0),new NativeDeviceSignIn.Cancel()));assertEquals(List.of("/auth/refresh","/me","/auth/logout"),calls);
    }
}
