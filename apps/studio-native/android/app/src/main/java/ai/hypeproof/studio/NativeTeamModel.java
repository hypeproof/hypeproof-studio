package ai.hypeproof.studio;

import org.json.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.*;

/** UI-thread presentation owner; network work is bounded by the existing native transport. */
final class NativeTeamModel {
    interface Store {JSONArray loadApprovalPending(String account)throws Exception;void saveApprovalPending(String account,JSONArray value)throws Exception;JSONObject loadQuestionIntent(String account)throws Exception;void saveQuestionIntent(String account,JSONObject value)throws Exception;}
    private final Supplier<NativeDeviceSignIn.Credentials> current;
    private final NativeDeviceSignIn.Transport http;private final ExecutorService worker;private final Consumer<Runnable> ui;private final Store store;private final Runnable changed;
    private NativeDeviceSignIn.Credentials binding;private NativeDeviceSignIn.Cancel operation,profileCancel,exposureCancel;private long generation;private String draftKey,shownKey;
    String displayName="",message="",words="",choice,pendingChoice;boolean busy,canStart;NativeAccountCard question;
    List<NativeApprovalCard> approvals=new ArrayList<>();Set<String> pending=new HashSet<>();String availability="";
    NativeTeamModel(Supplier<NativeDeviceSignIn.Credentials> current,NativeDeviceSignIn.Transport http,ExecutorService worker,Consumer<Runnable> ui,Store store,Runnable changed){this.current=current;this.http=http;this.worker=worker;this.ui=ui;this.store=store;this.changed=changed;}
    static boolean same(NativeDeviceSignIn.Credentials a,NativeDeviceSignIn.Credentials b){return a!=null&&b!=null&&a.account().equals(b.account())&&a.session().equals(b.session());}
    void invalidate(){generation++;if(operation!=null)operation.cancel();if(profileCancel!=null)profileCancel.cancel();if(exposureCancel!=null)exposureCancel.cancel();binding=null;question=null;approvals=new ArrayList<>();pending.clear();displayName="";message="";words="";choice=null;draftKey=null;shownKey=null;pendingChoice=null;busy=false;canStart=false;availability="";}
    void dismiss(){generation++;if(operation!=null)operation.cancel();if(exposureCancel!=null)exposureCancel.cancel();busy=false;question=null;approvals=new ArrayList<>();}
    private boolean bind(NativeDeviceSignIn.Credentials c){if(!same(c,current.get()))return false;if(!same(c,binding))invalidate();binding=c;return true;}
    private boolean live(long g,NativeDeviceSignIn.Credentials c){return generation==g&&same(c,current.get())&&same(c,binding);}
    private static void check(NativeDeviceSignIn.Cancel cancel)throws Exception{if(cancel.isCancelled())throw new Exception("cancelled");}
    private JSONObject call(String path,Map<String,String> body,NativeDeviceSignIn.Credentials c,NativeDeviceSignIn.Cancel cancel)throws Exception{
        check(cancel);NativeDeviceSignIn.Reply reply=http.call(path,body,c.bearer(),cancel);check(cancel);
        if(reply.status()<200||reply.status()>=300||reply.body().containsKey("error"))throw new Exception("request_failed");return new JSONObject(reply.body());
    }
    private String verify(NativeDeviceSignIn.Credentials c,NativeDeviceSignIn.Cancel cancel)throws Exception{
        JSONObject me=call("/me",null,c,cancel);
        if(!c.account().equals(me.optString("account_id"))||!c.session().equals(me.optString("session_id"))||!"active".equals(me.optString("account_status")))throw new Exception("identity_changed");
        String name=me.optString("display_name","").trim();return name.length()<=100&&!name.matches("(?s).*[\\p{Cntrl}].*")?name:"";
    }
    void profile(NativeDeviceSignIn.Credentials c){
        if(busy||c==null||c.expiresAt()<=System.currentTimeMillis()+90000||!bind(c))return;
        long g=generation;if(profileCancel!=null)profileCancel.cancel();NativeDeviceSignIn.Cancel cancel=new NativeDeviceSignIn.Cancel();profileCancel=cancel;
        worker.execute(()->{try{String name=verify(c,cancel);ui.accept(()->{if(live(g,c)){displayName=name;changed.run();}});}catch(Exception ignored){/* Neutral greeting; no false membership. */}});
    }
    void questions(NativeDeviceSignIn.Credentials c){
        if(busy||!bind(c))return;long g=++generation;operation=new NativeDeviceSignIn.Cancel();NativeDeviceSignIn.Cancel cancel=operation;busy=true;canStart=false;question=null;message="질문을 불러오고 있어요.";changed.run();
        worker.execute(()->{NativeAccountCard found=null;String name="",pending=null;boolean failed=false;try{name=verify(c,cancel);JSONObject intent=questionIntent(c);pending=intent==null?null:intent.getString("choice");JSONObject result=call("/me/cards?surface=mobile",null,c,cancel);if(!result.isNull("card"))found=new NativeAccountCard(result.getJSONObject("card"));}catch(Exception e){failed=true;}
            NativeAccountCard card=found;String greeting=name,pendingStart=pending;boolean error=failed;ui.accept(()->{if(!live(g,c))return;busy=false;if(error){message="질문을 불러오지 못했어요. 작성한 답은 남겨 두었어요.";}else{displayName=greeting;pendingChoice=pendingStart;question=card!=null&&card.available()?card:null;canStart=question==null&&words.isEmpty();message=question==null?(pendingChoice==null?"지금 도착한 질문이 없어요. 어떤 생각부터 정리할까요?":"아직 결과를 확인하지 못한 선택이 있어요. 같은 선택을 누르면 같은 요청으로 확인해요."):"";if(question!=null&&!Objects.equals(draftKey,question.key)){draftKey=question.key;choice=null;words=question.json.optJSONObject("text")==null||question.json.optJSONObject("text").isNull("value")?"":question.json.optJSONObject("text").optString("value","");}}changed.run();});});
    }
    void begin(NativeDeviceSignIn.Credentials c,String choice){
        if(busy||!canStart||!words.isEmpty()||(pendingChoice!=null&&!pendingChoice.equals(choice))||!Set.of("goal","method","decision").contains(choice)||!same(c,binding)||!bind(c))return;
        long g=++generation;operation=new NativeDeviceSignIn.Cancel();NativeDeviceSignIn.Cancel cancel=operation;busy=true;canStart=false;changed.run();
        worker.execute(()->{boolean success=false;try{
            verify(c,cancel);JSONObject intent=questionIntent(c);if(intent==null)intent=new JSONObject().put("account",c.account()).put("id",UUID.randomUUID().toString()).put("choice",choice);if(!intent.getString("choice").equals(choice))throw new Exception("pending_choice");check(cancel);store.saveQuestionIntent(c.account(),intent);check(cancel);String id=intent.getString("id");JSONObject result=call("/me/question-triggers",Map.of("schema","hps-question-trigger/1","id",id,"kind","choice","source_id",id,"source_revision","1","choice",choice),c,cancel);
            JSONObject source=result.getJSONObject("source"),reentry=result.getJSONObject("reentry");
            if(!result.getString("schema").equals("hps-question-trigger/1")||!NativeAccountCard.validKey(result.getString("key"))||!result.getString("key").startsWith("growth:")||!result.getString("policy").equals("team-question/1")||!(result.get("created") instanceof Boolean)||!source.getString("kind").equals("choice")||!source.getString("id").equals(id)||NativeAccountCard.integer(source,"revision")!=1||!reentry.getString("method").equals("GET")||!reentry.getString("path").equals("/v1/me/cards")||NativeAccountCard.integer(result,"model_calls")!=0)throw new Exception("invalid_trigger");check(cancel);store.saveQuestionIntent(c.account(),null);success=true;
        }catch(Exception ignored){}boolean ok=success;ui.accept(()->{if(!live(g,c))return;busy=false;if(ok)questions(c);else{message="질문을 준비한 결과를 확인하지 못했어요. 새로고침으로 확인해 주세요. 자동으로 다시 요청하지 않아요.";changed.run();}});});
    }
    void presented(){
        NativeAccountCard card=question;NativeDeviceSignIn.Credentials c=binding;if(card==null||busy||!same(c,current.get()))return;String marker=card.key+":"+card.json.optInt("attempt");if(Objects.equals(shownKey,marker))return;shownKey=marker;
        NativeDeviceSignIn.Cancel cancel=new NativeDeviceSignIn.Cancel();exposureCancel=cancel;worker.execute(()->{try{verify(c,cancel);call("/me/cards/"+card.key+"/shown",Map.of("surface","mobile"),c,cancel);}catch(Exception ignored){/* Never infer answer success or retry exposure automatically. */}});
    }
    void answer(NativeDeviceSignIn.Credentials c,String action,String selected,boolean skip){
        if(busy||question==null||!same(c,binding)||!bind(c))return;NativeAccountCard card=question;Map<String,String> body;
        try{if(skip){if(card.json.isNull("skip")||!card.available())return;body=Map.of("surface","mobile");}else body=card.answer(action,selected==null?choice:selected,words);}catch(Exception e){message="답이나 선택을 먼저 확인해 주세요.";changed.run();return;}
        long g=++generation;operation=new NativeDeviceSignIn.Cancel();NativeDeviceSignIn.Cancel cancel=operation;busy=true;changed.run();
        worker.execute(()->{String outcome=null;try{verify(c,cancel);if(!card.available())throw new Exception("expired");JSONObject result=call("/me/cards/"+card.key+(skip?"/skip":"/answer"),body,c,cancel);if(!NativeAccountCard.bool(result,"ok"))throw new Exception("invalid_reply");outcome=NativeAccountCard.text(result,skip?"message":"thanks",4000);}catch(Exception ignored){}
            String result=outcome;ui.accept(()->{if(!live(g,c))return;busy=false;question=null;if(result==null)message="처리 결과를 확인하지 못했어요. 작성한 답은 남겨 두었어요. 자동으로 다시 보내지 않아요.";else{message=result;words="";choice=null;draftKey=null;}changed.run();});});
    }
    private JSONObject questionIntent(NativeDeviceSignIn.Credentials c)throws Exception{
        JSONObject value=store.loadQuestionIntent(c.account());if(value==null)return null;
        String id=value.getString("id");if(!c.account().equals(value.getString("account"))||!id.equals(UUID.fromString(id).toString())||!Set.of("goal","method","decision").contains(value.getString("choice")))throw new Exception("invalid_question_intent");return value;
    }
    private JSONArray pending(NativeDeviceSignIn.Credentials c)throws Exception{
        JSONArray rows=store.loadApprovalPending(c.account());if(rows.length()>50)throw new Exception("invalid_pending");Set<String> ids=new HashSet<>();
        for(int i=0;i<rows.length();i++){JSONObject p=rows.getJSONObject(i);String id=p.getString("id");if(!c.account().equals(p.getString("account"))||!NativeApprovalCard.validID(p.getString("session"))||!NativeApprovalCard.validID(p.getString("card"))||!id.equals(UUID.fromString(id).toString())||!ids.add(id)||!Set.of("approve","reject","question").contains(p.getString("choice")))throw new Exception("invalid_pending");NativeApprovalCard.hex(p,"request_digest",64);}
        return rows;
    }
    void approvals(NativeDeviceSignIn.Credentials c){
        if(busy||!bind(c))return;long g=++generation;operation=new NativeDeviceSignIn.Cancel();NativeDeviceSignIn.Cancel cancel=operation;busy=true;approvals=new ArrayList<>();availability="loading";message="확인 요청을 불러오고 있어요.";changed.run();
        worker.execute(()->{List<NativeApprovalCard> cards=new ArrayList<>();Set<String> uncertain=new HashSet<>();String available="error";try{verify(c,cancel);JSONObject inbox=call("/me/approval-inbox",null,c,cancel);available=NativeAccountCard.text(inbox,"availability",32);if(!inbox.getString("schema").equals("hps-member-approval-inbox/1")||!Set.of("ready","not_enrolled","unavailable").contains(available))throw new Exception("invalid_inbox");JSONArray rows=inbox.getJSONArray("cards");if(rows.length()>50)throw new Exception("invalid_inbox");Set<String> ids=new HashSet<>();for(int i=0;i<rows.length();i++){NativeApprovalCard card=new NativeApprovalCard(rows.getJSONObject(i));if(!ids.add(card.id))throw new Exception("invalid_inbox");if(available.equals("ready"))cards.add(card);}
            if(available.equals("ready")){JSONArray kept=new JSONArray(),saved=pending(c);for(int i=0;i<saved.length();i++){JSONObject p=saved.getJSONObject(i);NativeApprovalCard found=new NativeApprovalCard(call("/me/approval-inbox/"+p.getString("card"),null,c,cancel));if(!found.id.equals(p.getString("card"))||!found.digest.equals(p.getString("request_digest")))throw new Exception("changed_card");cards.removeIf(x->x.id.equals(found.id));cards.add(found);if(!found.terminal()){kept.put(p);uncertain.add(found.id);}}check(cancel);store.saveApprovalPending(c.account(),kept);}
        }catch(Exception e){cards.clear();available="error";}String result=available;ui.accept(()->{if(!live(g,c))return;busy=false;availability=result;approvals=cards;pending=uncertain;message=switch(result){case "ready"->cards.isEmpty()?"지금 확인할 요청이 없어요.":"";case "not_enrolled"->"아직 승인 담당자로 등록되지 않았어요.";case "unavailable"->"지금은 확인 요청함을 이용할 수 없어요.";default->"요청함을 확인하지 못했어요. 다시 확인해 주세요.";};changed.run();});});
    }
    void decide(NativeDeviceSignIn.Credentials c,NativeApprovalCard candidate,String choice){
        if(busy||!availability.equals("ready")||!Set.of("approve","reject","question").contains(choice)||!candidate.canDecide()||pending.contains(candidate.id)||!bind(c)||approvals.stream().noneMatch(x->x.id.equals(candidate.id)&&x.digest.equals(candidate.digest)))return;
        long g=++generation;operation=new NativeDeviceSignIn.Cancel();NativeDeviceSignIn.Cancel cancel=operation;busy=true;changed.run();
        worker.execute(()->{NativeApprovalCard result=null;boolean saved=false;try{verify(c,cancel);NativeApprovalCard fresh=new NativeApprovalCard(call("/me/approval-inbox/"+candidate.id,null,c,cancel));if(!fresh.id.equals(candidate.id)||!fresh.digest.equals(candidate.digest)||!fresh.canDecide())throw new Exception("changed_card");JSONArray rows=pending(c);for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).getString("card").equals(candidate.id))throw new Exception("already_pending");if(rows.length()>=50)throw new Exception("pending_limit");String id=UUID.randomUUID().toString();rows.put(new JSONObject().put("account",c.account()).put("session",c.session()).put("card",fresh.id).put("request_digest",fresh.digest).put("id",id).put("choice",choice));check(cancel);store.saveApprovalPending(c.account(),rows);saved=true;check(cancel);if(!fresh.canDecide())throw new Exception("expired");result=new NativeApprovalCard(call("/me/approval-inbox/"+fresh.id+"/decisions",Map.of("id",id,"request_digest",fresh.digest,"choice",choice),c,cancel));if(!result.id.equals(fresh.id)||!result.digest.equals(fresh.digest))throw new Exception("changed_card");}catch(Exception ignored){result=null;}
            NativeApprovalCard outcome=result;boolean durable=saved;ui.accept(()->{if(!live(g,c))return;busy=false;if(durable)pending.add(candidate.id);if(outcome==null){approvals=new ArrayList<>();availability="error";message=durable?"처리 결과를 확인하지 못했어요. 다시 조회해 주세요. 자동으로 다시 보내지 않아요.":"선택을 안전하게 저장하지 못했어요. 전송하지 않았어요.";}else{approvals.replaceAll(x->x.id.equals(outcome.id)?outcome:x);message="선택을 전달했어요. 실제 처리 결과를 확인해 주세요.";}changed.run();});});
    }
}
