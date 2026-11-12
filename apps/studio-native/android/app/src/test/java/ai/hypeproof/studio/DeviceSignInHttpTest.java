package ai.hypeproof.studio;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class DeviceSignInHttpTest {
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
