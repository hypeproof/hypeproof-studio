package ai.hypeproof.studio;

import org.json.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.*;

/** Account-bound registration. Notification contents are references, never capabilities. */
final class NativePush {
    interface Store { JSONObject loadPush()throws Exception; void savePush(JSONObject value)throws Exception; }
    interface Transport { NativeDeviceSignIn.Reply call(String method,String id,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel cancel)throws Exception; }
    record Open(String delivery,String kind,String id,long revision) {
        static Open parse(JSONObject value)throws Exception {
            String delivery=value.getString("delivery_id"),kind=value.getString("kind"),id=value.getString("id");
            Object revision=value.get("revision");long number;
            if(revision instanceof String s&&s.matches("[1-9][0-9]{0,15}"))number=Long.parseLong(s);
            else number=NativeAccountCard.integer(value,"revision");
            if(!value.getString("schema").equals("hps-push/1")||!uuid(delivery)||!Set.of("question","approval").contains(kind)||!id.matches("[A-Za-z0-9:._-]{1,128}")||number<=0||number>9007199254740991L)throw new Exception("invalid_notification");
            return new Open(delivery,kind,id,number);
        }
        JSONObject json()throws Exception{return new JSONObject().put("schema","hps-push/1").put("delivery_id",delivery).put("kind",kind).put("id",id).put("revision",revision);}
    }
    static boolean uuid(String value){try{return UUID.fromString(value).toString().equals(value);}catch(Exception e){return false;}}
    private final Supplier<NativeDeviceSignIn.Credentials> current;private final Transport http;private final Store store;private final ExecutorService worker;private final Consumer<Runnable> ui;private final Runnable changed;
    private long generation,permissionVersion;private NativeDeviceSignIn.Cancel operation;private String registeredToken="",pendingToken;private NativeDeviceSignIn.Credentials registeredAccount;
    boolean busy;String status="알림을 켜면 새 질문과 확인 요청을 알려드려요.";
    NativePush(Supplier<NativeDeviceSignIn.Credentials> current,Transport http,Store store,ExecutorService worker,Consumer<Runnable> ui,Runnable changed){this.current=current;this.http=http;this.store=store;this.worker=worker;this.ui=ui;this.changed=changed;}
    private JSONObject state()throws Exception {
        JSONObject value=store.loadPush();if(value==null){value=new JSONObject().put("installation",UUID.randomUUID().toString()).put("enabled",false);store.savePush(value);}
        if(!uuid(value.getString("installation"))||!(value.get("enabled") instanceof Boolean))throw new Exception("invalid_push_state");return value;
    }
    static boolean owns(JSONObject state,NativeDeviceSignIn.Credentials c){return c!=null&&state!=null&&state.optBoolean("enabled")&&c.account().equals(state.optString("account"))&&c.session().equals(state.optString("session"));}
    boolean enabled(){try{return owns(state(),current.get());}catch(Exception e){status="알림 설정을 읽지 못했어요. 대화는 계속 사용할 수 있어요.";return false;}}
    record Permission(long version,String account,String session) {}
    Permission permissionTicket(){NativeDeviceSignIn.Credentials c=current.get();return c==null?null:new Permission(permissionVersion,c.account(),c.session());}
    boolean accepts(Permission ticket){NativeDeviceSignIn.Credentials c=current.get();return ticket!=null&&c!=null&&ticket.version()==permissionVersion&&ticket.account().equals(c.account())&&ticket.session().equals(c.session())&&enabled();}
    boolean enable(){permissionVersion++;NativeDeviceSignIn.Credentials c=current.get();if(c==null)return false;try{JSONObject s=state();s.put("account",c.account()).put("session",c.session()).put("enabled",true);store.savePush(s);status="시스템 알림 권한을 확인할게요.";changed.run();return true;}catch(Exception e){status="알림 설정을 저장하지 못했어요.";changed.run();return false;}}
    void invalidate(){generation++;permissionVersion++;if(operation!=null)operation.cancel();operation=null;busy=false;pendingToken=null;registeredToken="";registeredAccount=null;}
    void unavailable(String message){status=message;changed.run();}
    void register(String token){
        NativeDeviceSignIn.Credentials c=current.get();if(busy){pendingToken=token;return;}if(!enabled()||c==null||token==null||token.length()<16||token.length()>4096)return;
        if(token.equals(registeredToken)&&NativeTeamModel.same(c,registeredAccount))return;
        run("PUT",Map.of("schema","hps-push-device/1","platform","android","token",token,"permission","granted"),null,(reply,id)->{
            if(reply.status()!=200||!"hps-push-device/1".equals(reply.body().get("schema"))||!id.equals(reply.body().get("id"))||!Boolean.TRUE.equals(reply.body().get("active"))||NativeAccountCard.integer(new JSONObject(reply.body()),"generation")<1)throw new Exception("invalid_registration");
            registeredToken=token;registeredAccount=c;status="이 계정의 알림을 켰어요.";
        });
    }
    void disable(){
        NativeDeviceSignIn.Credentials c=current.get();invalidate();
        try{JSONObject s=state();boolean own=owns(s,c);s.put("enabled",false);store.savePush(s);status="이 기기의 알림을 껐어요.";changed.run();
            if(own){String id=s.getString("installation");worker.execute(()->{try{http.call("DELETE",id,null,c.bearer(),new NativeDeviceSignIn.Cancel());}catch(Exception ignored){}});}
        }catch(Exception e){status="알림 설정을 저장하지 못했어요. 시스템 설정에서도 알림을 꺼 주세요.";changed.run();}
    }
    void open(Open reference,Consumer<Boolean> ready){
        if(!enabled()||busy){status="현재 계정에서 알림을 다시 확인해 주세요.";changed.run();return;}
        run("POST",Map.of("schema","hps-push-open/1","delivery_id",reference.delivery()),reference,(reply,id)->{
            if(reply.status()!=200||!Boolean.TRUE.equals(reply.body().get("recorded"))||!"client_observed".equals(reply.body().get("evidence_kind")))throw new Exception("stale_notification");
            status="현재 계정의 내용을 확인해요.";ready.accept(reference.kind().equals("approval"));
        });
    }
    private static String tokenOf(Map<String,String> body){return body==null?null:body.get("token");}
    interface Applied{void apply(NativeDeviceSignIn.Reply reply,String id)throws Exception;}
    private void run(String method,Map<String,String> body,Open open,Applied apply){
        NativeDeviceSignIn.Credentials c=current.get();if(c==null)return;final String id;
        try{JSONObject s=state();if(!owns(s,c))return;id=s.getString("installation");}catch(Exception e){unavailable("알림 설정을 읽지 못했어요.");return;}
        long g=++generation;NativeDeviceSignIn.Cancel cancel=new NativeDeviceSignIn.Cancel();operation=cancel;busy=true;changed.run();
        worker.execute(()->{NativeDeviceSignIn.Reply value=null;try{if(!cancel.isCancelled())value=http.call(method,id+(open==null?"":"/opened"),body,c.bearer(),cancel);}catch(Exception ignored){}NativeDeviceSignIn.Reply result=value;
            ui.accept(()->{if(g!=generation||!NativeTeamModel.same(c,current.get())||!enabled())return;busy=false;operation=null;try{if(result==null)throw new Exception("unavailable");apply.apply(result,id);}catch(Exception e){status="알림을 확인하지 못했어요. 질문과 확인 요청에서 직접 확인할 수 있어요.";}changed.run();String next=pendingToken;pendingToken=null;if(next!=null&&!next.equals(tokenOf(body)))register(next);});
        });
    }
}
