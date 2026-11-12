package ai.hypeproof.studio;

import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;

/** UI-thread owner. Every asynchronous completion is fenced by account + operation epoch. */
final class ReflectionModel {
    interface Store {
        ReflectionState load(String account) throws Exception;
        void save(ReflectionState value) throws Exception;
        NativeDeviceSignIn.Credentials loadCredentials() throws Exception;
        void saveCredentials(NativeDeviceSignIn.Credentials value) throws Exception;
        void markRefreshSpent() throws Exception;
        void forgetCredentials() throws Exception;
    }
    private final Store store;
    private final NativeDeviceSignIn auth;
    private final NativeDeviceSignIn.Transport http;
    private final ExecutorService worker;
    private final Consumer<Runnable> ui;
    private final Runnable changed;
    private NativeDeviceSignIn.Cancel cancel;
    private long epoch;
    private volatile boolean closed;
    final Map<String,String> unsavedDrafts=new HashMap<>();
    NativeDeviceSignIn.Credentials credentials;
    ReflectionState state;
    boolean busy,signing,readOnly,brokenCredentials;
    String draft="",error="",notice="";
    ReflectionModel(Store store,NativeDeviceSignIn auth,NativeDeviceSignIn.Transport http,ExecutorService worker,Consumer<Runnable> ui,Runnable changed){this.store=store;this.auth=auth;this.http=http;this.worker=worker;this.ui=ui;this.changed=changed;}
    void restore(){
        try{credentials=store.loadCredentials();if(credentials!=null)load();}
        catch(Exception e){credentials=null;brokenCredentials=true;error="계정 연결 정보를 읽지 못했어요. 보존한 뒤 다시 연결해 주세요.";}
        changed.run();
    }
    private void load(){
        readOnly=false;draft="";
        try{state=store.load(credentials.account());draft=unsavedDrafts.getOrDefault(credentials.account(),state.draft);}
        catch(Exception e){readOnly=true;try{state=new ReflectionState(credentials.account());}catch(Exception ignored){}error="대화 파일을 읽지 못했어요. 원본을 보존하고 전송을 멈췄어요. 내보내기로 보관할 수 있어요.";}
    }
    String account(){return credentials==null?null:credentials.account();}
    private boolean live(long ticket,String account){return !closed&&epoch==ticket&&Objects.equals(account,account());}
    private void invalidate(){epoch++;if(cancel!=null)cancel.cancel();cancel=null;busy=false;signing=false;}
    interface Edit {void apply(ReflectionState next) throws Exception;}
    private boolean save(Edit edit){
        if(state==null||readOnly)return false;
        try{ReflectionState next=state.copy();next.draft=draft;edit.apply(next);store.save(next);state=next;draft=next.draft;unsavedDrafts.remove(next.account);notice="이 기기에 저장했어요.";return true;}
        catch(Exception e){error="기록을 저장하지 못했어요. 작성한 글은 화면에 남아 있어요. 다시 저장하거나 내보내 주세요.";return false;}
    }
    void edit(String text){draft=text;if(account()!=null)unsavedDrafts.put(account(),text);save(next->{});}
    void retrySave(){save(next->{});changed.run();}
    void login(Consumer<String> approval){
        if(closed||busy||credentials!=null||brokenCredentials)return;
        invalidate();error="";busy=true;signing=true;long ticket=epoch;NativeDeviceSignIn.Cancel operation=new NativeDeviceSignIn.Cancel();cancel=operation;changed.run();
        worker.execute(()->{
            NativeDeviceSignIn.Credentials result=null;Exception failure=null;
            try{result=auth.run(operation,c->ui.accept(()->{if(live(ticket,null)&&signing)approval.accept(c.url());}));}catch(Exception e){failure=e;}
            NativeDeviceSignIn.Credentials received=result;Exception problem=failure;
            ui.accept(()->{
                if(!live(ticket,null)){if(received!=null)revoke(received);return;}
                busy=false;signing=false;
                if(problem!=null){error="로그인을 완료하지 못했어요. 다시 연결할 수 있어요.";changed.run();return;}
                try{store.saveCredentials(received);credentials=received;load();error=readOnly?error:"";changed.run();refresh();}
                catch(Exception e){revoke(received);error="계정 연결을 저장하지 못했어요. 저장 공간을 확인해 주세요.";changed.run();}
            });
        });
    }
    void cancelLogin(){if(signing){invalidate();error="로그인을 멈췄어요.";changed.run();}}
    private void revoke(NativeDeviceSignIn.Credentials c){java.util.concurrent.CompletableFuture.runAsync(()->auth.logout(c.bearer()));}
    void logout(){
        if(state!=null&&!draft.equals(state.draft)&&!save(next->{})){changed.run();return;}
        NativeDeviceSignIn.Credentials old=credentials;invalidate();
        try{store.forgetCredentials();credentials=null;state=null;draft="";readOnly=false;error="";if(old!=null)revoke(old);}
        catch(Exception e){error="기기의 계정 연결을 지우지 못했어요. 다시 시도해 주세요.";}
        changed.run();
    }
    private void authorized(Runnable next){
        if(closed||busy||credentials==null||readOnly)return;
        if(credentials.expiresAt()>System.currentTimeMillis()+90000){next.run();return;}
        NativeDeviceSignIn.Credentials old=credentials;
        try{store.markRefreshSpent();}catch(Exception e){error="계정 연결을 안전하게 갱신할 수 없어 전송을 멈췄어요.";changed.run();return;}
        busy=true;long ticket=++epoch;NativeDeviceSignIn.Cancel operation=new NativeDeviceSignIn.Cancel();cancel=operation;changed.run();
        worker.execute(()->{
            NativeDeviceSignIn.Credentials rotated=null;try{rotated=auth.refresh(old,operation);}catch(Exception ignored){}
            NativeDeviceSignIn.Credentials result=rotated;
            ui.accept(()->{
                if(!live(ticket,old.account())){if(result!=null)revoke(result);return;}
                busy=false;
                try{if(result==null)throw new Exception("rotation_uncertain");store.saveCredentials(result);credentials=result;next.run();}
                catch(Exception e){if(result!=null)revoke(result);credentials=null;state=null;draft="";error="계정 연결을 다시 확인해 주세요. 저장된 글은 같은 계정으로 돌아오면 남아 있어요.";changed.run();}
            });
        });
    }
    void refresh(){authorized(()->request("/me/reflection",null,false));}
    boolean send(){
        if(busy||state==null||state.outstanding()||draft.trim().isEmpty()||readOnly)return false;
        if(!save(ReflectionState::enqueue)){changed.run();return false;}
        retry();return true;
    }
    void retry(){authorized(()->{
        if(state==null||!state.status().equals("local"))return;
        try{request("/me/reflection/turns",state.submission(),true);}catch(Exception e){error="전송할 기록을 확인하지 못했어요.";changed.run();}
    });}
    void stopResponse(){authorized(()->{
        if(state==null||!Set.of("running","pending").contains(state.status()))return;
        request("/me/reflection/turns/"+state.request.optString("id")+"/cancel",Map.of(),false);
    });}
    void abandon(){authorized(()->{
        if(state==null||!Set.of("running","pending").contains(state.status()))return;
        request("/me/reflection/turns/"+state.request.optString("id")+"/abandon",Map.of(),false);
    });}
    private void request(String path,Map<String,String> body,boolean sending){
        if(closed||busy||credentials==null)return;
        NativeDeviceSignIn.Credentials current=credentials;busy=true;long ticket=++epoch;NativeDeviceSignIn.Cancel operation=new NativeDeviceSignIn.Cancel();cancel=operation;error="";changed.run();
        worker.execute(()->{
            NativeDeviceSignIn.Reply received=null;try{received=http.call(path,body,current.bearer(),operation);}catch(Exception ignored){}
            NativeDeviceSignIn.Reply result=received;
            ui.accept(()->{
                if(!live(ticket,current.account()))return;busy=false;
                if(result==null){error="연결을 확인하지 못했어요. 전송한 글은 남아 있어요. 대화를 확인한 뒤 같은 요청으로 다시 시도할 수 있어요.";changed.run();return;}
                if(result.status()==401){logout();error="같은 계정으로 다시 연결해 주세요. 저장한 글은 남아 있어요.";changed.run();return;}
                if(result.status()<200||result.status()>=300||result.body().containsKey("error")){
                    String code=String.valueOf(result.body().get("error"));
                    if(sending&&Set.of("reflection_changed","reflection_busy","invalid_reflection_turn").contains(code)){
                        // The server rejected this ID before dispatch. Preserve its words as a draft.
                        save(next->{if(next.status().equals("local")){String submitted=next.request.getString("text");if(!next.draft.isEmpty()&&!next.draft.equals(submitted))throw new Exception("preserve_both");next.draft=submitted;next.request=null;}});
                    }
                    error=result.status()==403?"이 계정의 AI 이용 권한을 확인해 주세요. 글과 대화는 보존돼요.":result.status()==429?"이용 한도에 도달했어요. 잠시 후 대화를 확인해 주세요.":"대화 상태가 바뀌었거나 응답을 받지 못했어요. 먼저 대화를 확인해 주세요.";changed.run();return;
                }
                try{JSONObject snapshot=new JSONObject(result.body());ReflectionState candidate=state.copy();candidate.apply(snapshot);if(save(next->next.apply(snapshot)))notice="같은 계정의 대화를 확인했어요.";}
                catch(Exception e){error="이전 상태이거나 올바르지 않은 응답이라 반영하지 않았어요. 기존 글은 남아 있어요.";}
                changed.run();
            });
        });
    }
    void close(){closed=true;invalidate();}
}
