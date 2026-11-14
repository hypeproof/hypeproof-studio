package ai.hypeproof.studio;

import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;

/** UI-thread owner. Every asynchronous completion is fenced by account + operation epoch. */
final class ReflectionModel {
    interface Store {
        String loadGuestDraft() throws Exception;
        void saveGuestDraft(String text) throws Exception;
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
    private NativeDeviceSignIn.Cancel stopCancel;
    private ResponseFlight responseFlight;
    private boolean refreshing;
    private QueuedSend queuedSend;
    private static final class QueuedSend {
        final NativeDeviceSignIn.Credentials credentials;final long ticket;final String id,text;
        QueuedSend(NativeDeviceSignIn.Credentials credentials,long ticket,JSONObject request){
            this.credentials=credentials;this.ticket=ticket;id=request.optString("id");text=request.optString("text");
        }
        boolean matches(ReflectionState state){return state!=null&&state.status().equals("local")&&id.equals(state.request.optString("id"))&&text.equals(state.request.optString("text"));}
    }
    private static final class ResponseFlight {
        final NativeDeviceSignIn.Credentials credentials;final NativeDeviceSignIn.Cancel operation;final String id,text;
        boolean suppressed,finished,dispatched;String failure,failureCode;
        ResponseFlight(NativeDeviceSignIn.Credentials c,NativeDeviceSignIn.Cancel operation,JSONObject request){this.credentials=c;this.operation=operation;id=request.optString("id");text=request.optString("text");}
        synchronized boolean claimDispatch(){if(suppressed)return false;dispatched=true;return true;}
        synchronized boolean suppress(){suppressed=true;return !dispatched;}
    }
    private volatile boolean closed;
    final Map<String,String> unsavedDrafts=new HashMap<>();
    NativeDeviceSignIn.Credentials credentials;
    ReflectionState state;
    boolean busy,signing,readOnly,brokenCredentials,guestReadOnly,stoppingResponse;
    String draft="",guestDraft="",error="",notice="";
    ReflectionModel(Store store,NativeDeviceSignIn auth,NativeDeviceSignIn.Transport http,ExecutorService worker,Consumer<Runnable> ui,Runnable changed){this.store=store;this.auth=auth;this.http=http;this.worker=worker;this.ui=ui;this.changed=changed;}
    void restore(){
        try{guestDraft=store.loadGuestDraft();draft=guestDraft;}
        catch(Exception e){guestReadOnly=true;error="로그인 전 글을 읽지 못했어요. 원본을 보존하고 덮어쓰지 않아요.";}
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
    String displayError(){return !error.isEmpty()?error:state==null?"":state.failureMessage();}
    private boolean live(long ticket,String account){return !closed&&epoch==ticket&&Objects.equals(account,account());}
    private void invalidate(){epoch++;if(cancel!=null)cancel.cancel();if(stopCancel!=null)stopCancel.cancel();cancel=null;stopCancel=null;responseFlight=null;queuedSend=null;refreshing=false;busy=false;signing=false;stoppingResponse=false;}
    interface Edit {void apply(ReflectionState next) throws Exception;}
    private boolean save(Edit edit){
        if(state==null||readOnly)return false;
        try{ReflectionState next=state.copy();next.draft=draft;edit.apply(next);store.save(next);state=next;draft=next.draft;unsavedDrafts.remove(next.account);notice="이 기기에 저장했어요.";return true;}
        catch(Exception e){error="기록을 저장하지 못했어요. 작성한 글은 화면에 남아 있어요. 다시 저장하거나 내보내 주세요.";return false;}
    }
    private boolean rememberAdmission(ResponseFlight flight,NativeDeviceSignIn.Reply result){
        String code=String.valueOf(result.body().get("error"));
        if(flight==null||state==null||!state.canRememberFailure(flight.id,flight.text,code))return true;
        return save(next->next.rememberFailure(flight.id,flight.text,code));
    }
    private boolean saveGuest(){
        if(guestReadOnly)return false;
        try{store.saveGuestDraft(guestDraft);notice="로그인 전 글은 이 기기에만 저장돼요.";return true;}
        catch(Exception e){error="글을 저장하지 못했어요. 화면의 글을 복사하거나 다시 저장해 주세요.";return false;}
    }
    void edit(String text){
        if(closed||text.length()>4000||text.indexOf('\0')>=0)return;
        if(account()==null){if(guestReadOnly)return;draft=text;guestDraft=text;saveGuest();}
        else{draft=text;unsavedDrafts.put(account(),text);save(next->{});}
    }
    void retrySave(){if(account()==null)saveGuest();else save(next->{});changed.run();}
    boolean canRestoreGuest(){return !closed&&!busy&&credentials!=null&&state!=null&&!readOnly&&!guestReadOnly&&!guestDraft.isEmpty()&&draft.isEmpty()&&!state.outstanding();}
    boolean restoreGuest(){
        if(!canRestoreGuest())return false;
        // Persist the account copy first. A later guest-clear failure leaves both copies.
        try{ReflectionState next=state.copy();next.draft=guestDraft;store.save(next);state=next;draft=next.draft;unsavedDrafts.remove(next.account);
            store.saveGuestDraft("");guestDraft="";notice="로그인 전 글을 가져왔어요. 보내기를 눌러야 전송돼요.";changed.run();return true;}
        catch(Exception e){error="로그인 전 글을 모두 옮기지 못했어요. 원본은 남아 있어요. 다시 저장하거나 확인해 주세요.";changed.run();return false;}
    }
    boolean canRestoreFailedDraft(){
        return !closed&&!busy&&!signing&&!readOnly&&!brokenCredentials&&credentials!=null&&state!=null
            &&credentials.account().equals(state.account)&&draft.isEmpty()&&state.failedDraftText()!=null;
    }
    boolean restoreFailedDraft(){
        if(!canRestoreFailedDraft())return false;
        boolean restored=save(next->{if(!next.restoreFailedDraft())throw new Exception("restore_not_available");});
        if(restored){error="";notice="입력란에 가져왔어요. 내용을 확인한 뒤 보내 주세요.";}
        changed.run();return restored;
    }
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
                try{store.saveCredentials(received);credentials=received;load();error=readOnly?error:"";restoreGuest();changed.run();refresh();}
                catch(Exception e){revoke(received);error="계정 연결을 저장하지 못했어요. 저장 공간을 확인해 주세요.";changed.run();}
            });
        });
    }
    void cancelLogin(){if(signing){invalidate();error="로그인을 멈췄어요.";changed.run();}}
    private void revoke(NativeDeviceSignIn.Credentials c){java.util.concurrent.CompletableFuture.runAsync(()->auth.logout(c.bearer()));}
    void logout(){
        if(state!=null&&!draft.equals(state.draft)&&!save(next->{})){changed.run();return;}
        NativeDeviceSignIn.Credentials old=credentials;invalidate();
        try{store.forgetCredentials();credentials=null;state=null;draft=guestDraft;readOnly=false;error="";if(old!=null)revoke(old);}
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
                catch(Exception e){if(result!=null)revoke(result);credentials=null;state=null;draft=guestDraft;readOnly=false;error="계정 연결을 다시 확인해 주세요. 저장된 글은 같은 계정으로 돌아오면 남아 있어요.";changed.run();}
            });
        });
    }
    void refresh(){authorized(()->request("/me/reflection",null,false));}
    boolean canSend(){
        return !closed&&credentials!=null&&!brokenCredentials&&!readOnly&&!stoppingResponse
            &&state!=null&&!state.outstanding()&&!draft.trim().isEmpty()&&(!busy||refreshing);
    }
    boolean send(){
        if(!canSend())return false;
        if(!save(ReflectionState::enqueue)){changed.run();return false;}
        if(refreshing){
            // Only this explicit Send may continue after this in-flight read.
            // The durable local outbox survives; this dispatch permission does not.
            queuedSend=new QueuedSend(credentials,epoch,state.request);
            notice="대화를 확인한 뒤 보낼게요. 보낸 글은 기기에 저장했어요.";changed.run();
        }else retry();
        return true;
    }
    void suspendQueuedSend(){
        if(queuedSend!=null){queuedSend=null;notice="전송을 시작하지 않았어요. 글은 기기에 남아 있어요.";changed.run();}
    }
    void retry(){authorized(()->{
        if(state==null||!state.status().equals("local"))return;
        try{request("/me/reflection/turns",state.submission(),true);}catch(Exception e){error="전송할 기록을 확인하지 못했어요.";changed.run();}
    });}
    boolean canStopResponse(){
        if(closed||stoppingResponse||readOnly||credentials==null||state==null||!state.outstanding())return false;
        if(queuedSend!=null&&queuedSend.matches(state)&&queuedSend.credentials.equals(credentials))return true;
        if(busy)return responseFlight!=null&&!responseFlight.suppressed&&credentials.equals(responseFlight.credentials)
            &&responseFlight.id.equals(state.request.optString("id"));
        return Set.of("running","pending").contains(state.status());
    }
    void stopResponse(){
        if(!canStopResponse())return;
        if(queuedSend!=null){suspendQueuedSend();return;}
        if(busy)beginResponseStop();else authorized(this::beginResponseStop);
    }
    private static long stopRemaining(long deadline)throws Exception{
        long remaining=java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime());
        if(remaining<=0)throw new Exception("stop_timeout");return remaining;
    }
    private void beginResponseStop(){
        if(!canStopResponse())return;
        final ReflectionState original;try{original=state.copy();}catch(Exception e){return;}
        final String id=original.request.optString("id"),text=original.request.optString("text");
        final NativeDeviceSignIn.Credentials current=credentials;
        final long ticket=epoch;final ResponseFlight flight=responseFlight;
        if(flight!=null&&flight.suppress()){
            // Stop wins the queued-work race. Nothing has been dispatched, so
            // preserve the local outbox rather than inventing server cancellation.
            flight.operation.cancel();epoch++;cancel=null;responseFlight=null;busy=false;
            notice="전송을 시작하지 않았어요. 글은 기기에 남아 있어요.";changed.run();return;
        }
        final NativeDeviceSignIn.Cancel stopping=new NativeDeviceSignIn.Cancel();stopCancel=stopping;
        stoppingResponse=true;busy=true;error="";notice="답변 중지를 확인하고 있어요. 보낸 글은 남아 있어요.";changed.run();
        worker.execute(()->{
            JSONObject confirmed=null;String problem=null;
            try{
                long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(8);
                for(int check=0;check<10&&!stopping.isCancelled();check++){
                    NativeDeviceSignIn.Reply read=http.call("/me/reflection",null,current.bearer(),stopping,stopRemaining(deadline));
                    if(read.status()<200||read.status()>=300||read.body().containsKey("error"))throw new Exception("stop_read_failed");
                    JSONObject snapshot=new JSONObject(read.body());ReflectionState checked=original.copy();checked.apply(snapshot);
                    JSONObject turn=snapshot.getJSONObject("state").optJSONObject("turn");
                    // /cancel before registration is a no-op. Observe this exact
                    // submitted text first, without replaying the original POST.
                    if(turn!=null&&id.equals(turn.optString("id"))&&text.equals(turn.optString("text"))){
                        if(Set.of("pending","running").contains(turn.optString("status"))){
                            NativeDeviceSignIn.Reply reply=http.call("/me/reflection/turns/"+id+"/cancel",Map.of(),current.bearer(),stopping,stopRemaining(deadline));
                            if(reply.status()<200||reply.status()>=300||reply.body().containsKey("error"))throw new Exception("stop_not_acknowledged");
                            snapshot=new JSONObject(reply.body());checked=original.copy();checked.apply(snapshot);
                            turn=snapshot.getJSONObject("state").optJSONObject("turn");
                        }
                        if(turn==null||!id.equals(turn.optString("id"))||!text.equals(turn.optString("text"))
                            ||!Set.of("cancelled","completed","failed","unknown").contains(turn.optString("status")))throw new Exception("stop_not_acknowledged");
                        confirmed=snapshot;break;
                    }
                    if(check<9)stopping.pause(Math.min(200,stopRemaining(deadline)));
                }
                if(confirmed==null)throw new Exception("stop_not_registered");
            }catch(Exception e){problem="아직 중지를 확인하지 못했어요. 보낸 글은 남아 있어요. 대화를 다시 확인해 주세요.";}
            JSONObject result=confirmed;String failure=problem;
            ui.accept(()->{
                if(!live(ticket,current.account())||!current.equals(credentials)||stopCancel!=stopping)return;
                stopCancel=null;stoppingResponse=false;
                boolean waitForFailure=false;
                if(result!=null&&state!=null&&state.request!=null&&id.equals(state.request.optString("id"))&&text.equals(state.request.optString("text"))){
                    if(save(next->{next.apply(result);if(next.status().equals("failed")&&flight!=null)next.rememberFailure(flight.id,flight.text,flight.failureCode);})){
                        String status=state.status();waitForFailure=status.equals("failed")&&flight!=null&&!flight.finished;
                        error=status.equals("failed")&&flight!=null&&flight.failure!=null?flight.failure:"";
                        notice=status.equals("cancelled")?"답변 받기를 중지했어요. 이미 실행된 AI 비용은 발생할 수 있어요.":status.equals("completed")?"답변이 이미 도착했어요. 대화에서 확인해 주세요.":status.equals("failed")?"답변을 받지 못했어요. 보낸 이야기는 남아 있어요.":"완료 여부를 확인하지 못했어요. 자동으로 다시 보내지 않아요.";
                    }
                }else if(failure!=null)error=failure;
                // A failed row may precede its typed admission error body. Keep
                // that bounded original response only until its reason arrives.
                if(flight!=null&&!waitForFailure)flight.operation.cancel();
                busy=waitForFailure;changed.run();
            });
        });
    }
    void abandon(){authorized(()->{
        if(state==null||!Set.of("running","pending").contains(state.status()))return;
        request("/me/reflection/turns/"+state.request.optString("id")+"/abandon",Map.of(),false);
    });}
    private void request(String path,Map<String,String> body,boolean sending){
        if(closed||busy||credentials==null)return;
        NativeDeviceSignIn.Credentials current=credentials;busy=true;refreshing=body==null&&path.equals("/me/reflection");long ticket=++epoch;NativeDeviceSignIn.Cancel operation=new NativeDeviceSignIn.Cancel();cancel=operation;error="";
        final ResponseFlight flight=sending?new ResponseFlight(current,operation,state.request):null;
        responseFlight=flight;changed.run();
        worker.execute(()->{
            NativeDeviceSignIn.Reply received=null;try{if(flight==null||flight.claimDispatch())received=http.call(path,body,current.bearer(),operation);}catch(Exception ignored){}
            NativeDeviceSignIn.Reply result=received;
            ui.accept(()->{
                if(!live(ticket,current.account())||!current.equals(credentials))return;
                if(flight!=null){
                    flight.finished=true;
                    if(flight.suppressed){
                        if(result!=null&&result.status()==401){logout();error="같은 계정으로 다시 연결해 주세요. 저장한 글은 남아 있어요.";changed.run();return;}
                        if(result!=null&&result.status()>=400&&result.body().containsKey("error")){flight.failure=responseError(result);flight.failureCode=String.valueOf(result.body().get("error"));}
                        if(state!=null&&state.status().equals("failed")&&flight.id.equals(state.request.optString("id"))&&flight.text.equals(state.request.optString("text"))&&flight.failure!=null&&rememberAdmission(flight,result))error=flight.failure;
                        if(!stoppingResponse){busy=false;responseFlight=null;}changed.run();return;
                    }
                }
                responseFlight=null;busy=false;refreshing=false;
                QueuedSend queued=queuedSend;queuedSend=null;
                if(result==null){error="연결을 확인하지 못했어요. 전송한 글은 남아 있어요. 대화를 확인한 뒤 같은 요청으로 다시 시도할 수 있어요.";changed.run();return;}
                if(result.status()==401){logout();error="같은 계정으로 다시 연결해 주세요. 저장한 글은 남아 있어요.";changed.run();return;}
                if(result.status()<200||result.status()>=300||result.body().containsKey("error")){
                    String code=String.valueOf(result.body().get("error"));
                    if(sending&&Set.of("reflection_changed","reflection_busy","invalid_reflection_turn").contains(code)){
                        // The server rejected this ID before dispatch. Preserve its words as a draft.
                        save(next->{if(next.status().equals("local")){String submitted=next.request.getString("text");if(!next.draft.isEmpty()&&!next.draft.equals(submitted))throw new Exception("preserve_both");next.draft=submitted;next.request=null;}});
                    }
                    if(!sending||rememberAdmission(flight,result))error=responseError(result);
                    changed.run();return;
                }
                try{
                    JSONObject snapshot=new JSONObject(result.body());ReflectionState candidate=state.copy();candidate.apply(snapshot);
                    boolean continueSend=queued!=null&&queued.ticket==ticket&&queued.credentials.equals(credentials)&&queued.matches(candidate);
                    JSONObject remote=snapshot.getJSONObject("state").optJSONObject("turn");
                    boolean remoteBusy=remote!=null&&Set.of("pending","running").contains(remote.optString("status"));
                    if(save(next->{
                        next.apply(snapshot);
                        // This ID has never been dispatched. An uncertain prior POST
                        // has no queued permission and keeps its original revision.
                        if(continueSend&&!remoteBusy)next.request.put("expected_revision",next.revision);
                    })){
                        notice="같은 계정의 대화를 확인했어요.";
                        if(continueSend&&!remoteBusy){
                            if(credentials.expiresAt()>System.currentTimeMillis()+90000)retry();
                            else error="계정 연결을 다시 확인한 뒤 보내 주세요. 보낸 글은 기기에 남아 있어요.";
                        }else if(continueSend)error="다른 기기에서 답변을 받고 있어요. 보낸 글은 남아 있으니 대화를 확인한 뒤 다시 시도해 주세요.";
                    }
                }catch(Exception e){error="이전 상태이거나 올바르지 않은 응답이라 반영하지 않았어요. 기존 글은 남아 있어요.";}
                changed.run();
            });
        });
    }
    private static String responseError(NativeDeviceSignIn.Reply result){
        String code=String.valueOf(result.body().get("error"));
        String admission=ReflectionState.admissionMessage(code);if(admission!=null)return admission;
        return result.status()==403?"이 계정의 AI 이용 권한을 확인해 주세요. 글과 대화는 보존돼요.":result.status()==429?"이용 한도에 도달했어요. 잠시 후 대화를 확인해 주세요.":"대화 상태가 바뀌었거나 응답을 받지 못했어요. 먼저 대화를 확인해 주세요.";
    }
    void close(){closed=true;invalidate();}
}
