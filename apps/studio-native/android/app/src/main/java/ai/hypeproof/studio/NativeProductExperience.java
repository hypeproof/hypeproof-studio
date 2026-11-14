package ai.hypeproof.studio;

import org.json.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.*;

/** Opt-in, content-free observations. This queue never invokes card/approval/conversation actions. */
final class NativeProductExperience {
    enum Kind {
        QUESTION_PRESENTED("question.presented","question"),QUESTION_ANSWERED("question.answered","question"),QUESTION_SKIPPED("question.skipped","question"),
        VOICE_FINISHED("voice.tts_finished","voice"),VOICE_RESUMED("voice.listening_resumed","voice"),VOICE_FINAL("voice.final","voice"),VOICE_FAILED("journey.failed","voice"),
        REFLECTION_STARTED("reflection.send_started","reflection"),REFLECTION_ANSWERED("reflection.answer_received","reflection");
        final String type,journey;Kind(String type,String journey){this.type=type;this.journey=journey;}
    }
    interface Store {JSONObject loadProductExperience(String account)throws Exception;void saveProductExperience(String account,JSONObject state)throws Exception;}
    private final Supplier<NativeDeviceSignIn.Credentials> current;private final NativeDeviceSignIn.Transport http;private final ExecutorService worker;private final Consumer<Runnable> ui;private final Store store;private final Runnable changed;
    private NativeDeviceSignIn.Credentials binding;private NativeDeviceSignIn.Cancel operation;private long generation,lastAttempt;private boolean sending;
    private JSONObject saved=empty();private final Map<String,String> journeys=new HashMap<>();
    boolean available,busy,granted;String title="사용 경험 공유",notice="",status="";
    NativeProductExperience(Supplier<NativeDeviceSignIn.Credentials> current,NativeDeviceSignIn.Transport http,ExecutorService worker,Consumer<Runnable> ui,Store store,Runnable changed){this.current=current;this.http=http;this.worker=worker;this.ui=ui;this.store=store;this.changed=changed;}
    static JSONObject empty(){try{return new JSONObject().put("version",1).put("denied",false).put("expires_at",0).put("events",new JSONArray());}catch(JSONException e){throw new IllegalStateException(e);}}
    static void validate(JSONObject state)throws Exception{
        if(NativeAccountCard.integer(state,"version")!=1||state.getJSONArray("events").length()>40)throw new Exception("invalid_queue");NativeAccountCard.bool(state,"denied");NativeAccountCard.integer(state,"expires_at");
        Set<String> ids=new HashSet<>();JSONArray events=state.getJSONArray("events");
        for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);Kind kind=Arrays.stream(Kind.values()).filter(k->k.type.equals(e.optString("type"))).findFirst().orElseThrow();
            Set<String> keys=new HashSet<>();e.keys().forEachRemaining(keys::add);Set<String> allowed=new HashSet<>(Set.of("id","journey_id","journey","type","platform","app_version"));if(kind==Kind.VOICE_FAILED)allowed.add("failure_class");
            if(!keys.equals(allowed)||!kind.journey.equals(e.getString("journey"))||!e.getString("platform").equals("android")||!e.getString("app_version").matches("[0-9]{1,4}\\.[0-9]{1,6}\\.[0-9]{1,6}([-+][a-z0-9.]{1,32})?")||!ids.add(e.getString("id")))throw new Exception("invalid_event");
            for(String key:List.of("id","journey_id"))if(!UUID.fromString(e.getString(key)).toString().equals(e.getString(key)))throw new Exception("invalid_event");
            if(kind==Kind.VOICE_FAILED&&!e.getString("failure_class").equals("unexpected_state"))throw new Exception("invalid_event");
        }
    }
    void invalidate(){generation++;if(operation!=null)operation.cancel();binding=null;available=busy=granted=sending=false;title="사용 경험 공유";notice=status="";saved=empty();journeys.clear();}
    private boolean live(long g,NativeDeviceSignIn.Credentials c){return generation==g&&NativeTeamModel.same(binding,c)&&NativeTeamModel.same(c,current.get());}
    private JSONObject call(String path,Map<String,String> body,NativeDeviceSignIn.Credentials c,NativeDeviceSignIn.Cancel cancel)throws Exception{
        if(cancel.isCancelled())throw new Exception("cancelled");var reply=http.call(path,body,c.bearer(),cancel);if(cancel.isCancelled()||reply.status()<200||reply.status()>=300||reply.body().containsKey("error"))throw new Exception("unavailable");return new JSONObject(reply.body());
    }
    void refresh(NativeDeviceSignIn.Credentials c){
        if(busy||sending||c==null||!NativeTeamModel.same(c,current.get()))return;if(!NativeTeamModel.same(c,binding)){invalidate();}binding=c;
        long g=generation;operation=new NativeDeviceSignIn.Cancel();var cancel=operation;busy=true;granted=false;changed.run();
        worker.execute(()->{JSONObject result=null,queue=null;try{queue=store.loadProductExperience(c.account());validate(queue);if(queue.getLong("expires_at")<System.currentTimeMillis()){queue.put("events",new JSONArray());store.saveProductExperience(c.account(),queue);}result=call("/me/product-events/consent",null,c,cancel);validateConsent(result);}catch(Exception ignored){result=null;}
            JSONObject consent=result,loaded=queue;ui.accept(()->{if(!live(g,c))return;busy=false;if(consent==null){available=false;status="공유 설정을 확인하지 못했어요. 대화와 질문은 그대로 사용할 수 있어요.";}else{saved=loaded;available=true;title=consent.optString("title");notice=consent.optString("notice");granted=remoteGranted(consent)&&!saved.optBoolean("denied");status="";}changed.run();flush();});});
    }
    private static void validateConsent(JSONObject c)throws Exception{
        if(!c.getString("schema").equals("hps-product-consent/1")||!c.getString("notice_version").equals("team-ux/1"))throw new Exception("invalid_consent");NativeAccountCard.text(c,"title",200);NativeAccountCard.text(c,"notice",4000);
        if(!c.isNull("preference")){JSONObject p=c.getJSONObject("preference");Object value=p.get("granted");if(!p.getString("notice_version").equals("team-ux/1")||!(value instanceof Boolean||(value instanceof Number&&(NativeAccountCard.integer(p,"granted")==0||NativeAccountCard.integer(p,"granted")==1))))throw new Exception("invalid_consent");}
    }
    private static boolean remoteGranted(JSONObject c){JSONObject p=c.optJSONObject("preference");return p!=null&&(Boolean.TRUE.equals(p.opt("granted"))||Integer.valueOf(1).equals(p.opt("granted"))||Long.valueOf(1).equals(p.opt("granted")));}
    void choose(boolean allow){
        NativeDeviceSignIn.Credentials c=current.get();if(!available||busy||!NativeTeamModel.same(c,binding))return;generation++;if(operation!=null)operation.cancel();sending=false;long g=generation;operation=new NativeDeviceSignIn.Cancel();var cancel=operation;busy=true;granted=false;changed.run();
        try{if(!allow){JSONObject next=new JSONObject(saved.toString()).put("denied",true).put("events",new JSONArray());store.saveProductExperience(c.account(),next);saved=next;}}catch(Exception e){busy=false;status="공유 설정을 저장하지 못했어요. 이 화면에서는 수집을 멈췄어요.";changed.run();return;}
        worker.execute(()->{boolean success=false;try{JSONObject response=call("/me/product-events/consent",Map.of("notice_version","team-ux/1","granted",String.valueOf(allow)),c,cancel);success=NativeAccountCard.bool(response,"ok");}catch(Exception ignored){}boolean ok=success;ui.accept(()->{if(!live(g,c))return;busy=false;try{if(!ok)throw new Exception("unavailable");JSONObject next=new JSONObject(saved.toString()).put("denied",!allow);if(!allow)next.put("events",new JSONArray());store.saveProductExperience(c.account(),next);saved=next;granted=allow;status=allow?"사용 경험 공유를 켰어요.":"사용 경험을 공유하지 않아요.";}catch(Exception e){status="공유 설정을 저장하지 못했어요. 이 화면에서는 수집을 멈췄어요.";}changed.run();});});
    }
    void record(Kind kind){
        NativeDeviceSignIn.Credentials c=current.get();if(!granted||saved.optBoolean("denied")||!NativeTeamModel.same(c,binding))return;
        try{JSONObject next=new JSONObject(saved.toString());if(next.getLong("expires_at")<System.currentTimeMillis())next.put("events",new JSONArray());JSONArray rows=next.getJSONArray("events");if(rows.length()>=40)return;
            if(!journeys.containsKey(kind.journey)||Set.of(Kind.QUESTION_PRESENTED,Kind.REFLECTION_STARTED,Kind.VOICE_FINAL).contains(kind))journeys.put(kind.journey,UUID.randomUUID().toString());
            JSONObject event=new JSONObject().put("id",UUID.randomUUID().toString()).put("journey_id",journeys.get(kind.journey)).put("journey",kind.journey).put("type",kind.type).put("platform","android").put("app_version",BuildConfig.VERSION_NAME);if(kind==Kind.VOICE_FAILED)event.put("failure_class","unexpected_state");
            if(rows.length()==0)next.put("expires_at",System.currentTimeMillis()+30L*86400000);rows.put(event);validate(next);store.saveProductExperience(c.account(),next);saved=next;
            if(System.currentTimeMillis()-lastAttempt>=30000)flush();
        }catch(Exception ignored){/* Never block or change the product operation for metrics. */}
    }
    void flush(){
        NativeDeviceSignIn.Credentials c=current.get();if(!granted||sending||saved.optBoolean("denied")||!NativeTeamModel.same(c,binding))return;
        try{JSONArray rows=saved.getJSONArray("events"),batch=new JSONArray();for(int i=0;i<Math.min(rows.length(),20);i++)batch.put(rows.getJSONObject(i));if(batch.length()==0)return;long g=generation;sending=true;lastAttempt=System.currentTimeMillis();operation=new NativeDeviceSignIn.Cancel();var cancel=operation;
            worker.execute(()->{Set<String> accepted=new HashSet<>();boolean success=false;try{JSONObject reply=call("/me/product-events",Map.of("schema","hps-product-events/1","events",batch.toString()),c,cancel);if(!reply.getString("schema").equals("hps-product-events/1")||!reply.getString("evidence_kind").equals("client_observed"))throw new Exception("invalid_receipt");Set<String> expected=new HashSet<>(),all=new HashSet<>();for(int i=0;i<batch.length();i++)expected.add(batch.getJSONObject(i).getString("id"));for(String group:List.of("accepted","deferred")){JSONArray ids=reply.getJSONArray(group);for(int i=0;i<ids.length();i++){String id=ids.getString(i);if(!all.add(id))throw new Exception("invalid_receipt");if(group.equals("accepted"))accepted.add(id);}}if(!all.equals(expected))throw new Exception("invalid_receipt");success=true;}catch(Exception ignored){}boolean ok=success;ui.accept(()->{if(!live(g,c))return;sending=false;if(ok)try{JSONObject next=new JSONObject(saved.toString());JSONArray kept=new JSONArray(),currentRows=next.getJSONArray("events");for(int i=0;i<currentRows.length();i++)if(!accepted.contains(currentRows.getJSONObject(i).getString("id")))kept.put(currentRows.getJSONObject(i));next.put("events",kept);store.saveProductExperience(c.account(),next);saved=next;}catch(Exception ignored){/* Retain identical IDs on uncertain local persistence. */}});});
        }catch(Exception ignored){sending=false;}
    }
}
