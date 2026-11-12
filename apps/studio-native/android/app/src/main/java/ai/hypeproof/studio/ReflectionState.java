package ai.hypeproof.studio;

import org.json.*;
import java.util.*;

/** Account-scoped durable transcript + outbox. Mutate a copy, persist, then adopt. */
final class ReflectionState {
    static final String OPENING="요즘 어떤 일에 시간을 많이 쓰세요?";
    static final String HINT="일, 공부, 돌봄, 쉬는 시간까지 어떤 이야기든 좋아요. 아직 정리되지 않아도 괜찮아요.";
    final String account;
    long revision;
    String draft="",opening=OPENING,hint=HINT;
    JSONArray messages=new JSONArray();
    JSONObject request;
    boolean earlier;
    ReflectionState(String account) throws Exception {if(!account.matches("[A-Za-z0-9_-]{1,128}"))throw new Exception("invalid_account");this.account=account;}
    ReflectionState(String account,String encoded) throws Exception {
        this(account);JSONObject v=new JSONObject(encoded);
        if(integer(v,"version")!=1 || !account.equals(string(v,"account",128)))throw new Exception("invalid_cache");
        revision=integer(v,"revision");draft=string(v,"draft",4000);opening=string(v,"opening",500);hint=string(v,"hint",1000);
        messages=v.getJSONArray("messages");validateMessages(messages);earlier=bool(v,"has_earlier");
        request=v.isNull("request")?null:v.getJSONObject("request");validateRequest(request,true);
    }
    ReflectionState copy() throws Exception {return new ReflectionState(account,json().toString());}
    JSONObject json() throws Exception {return new JSONObject().put("version",1).put("account",account).put("revision",revision).put("draft",draft).put("opening",opening).put("hint",hint).put("messages",messages).put("has_earlier",earlier).put("request",request==null?JSONObject.NULL:request);}
    static String string(JSONObject v,String key,int limit) throws Exception {Object s=v.get(key);if(!(s instanceof String)||((String)s).length()>limit||((String)s).indexOf('\0')>=0)throw new Exception("invalid_response");return (String)s;}
    static long integer(JSONObject v,String key) throws Exception {Object n=v.get(key);if(!(n instanceof Number)||!Double.isFinite(((Number)n).doubleValue())||((Number)n).doubleValue()!=((Number)n).longValue()||((Number)n).longValue()<0||((Number)n).doubleValue()>9007199254740991d)throw new Exception("invalid_response");return ((Number)n).longValue();}
    private static boolean bool(JSONObject v,String key) throws Exception {if(!(v.get(key) instanceof Boolean))throw new Exception("invalid_response");return v.getBoolean(key);}
    private static String id(JSONObject v,String key) throws Exception {String id=string(v,key,128);if(!id.matches("[A-Za-z0-9._:-]{1,128}"))throw new Exception("invalid_response");return id;}
    private static void validateMessages(JSONArray messages) throws Exception {
        if(messages.length()>80)throw new Exception("invalid_response");Set<String> ids=new HashSet<>();
        for(int i=0;i<messages.length();i++){JSONObject m=messages.getJSONObject(i);if(!ids.add(id(m,"id"))||!Set.of("user","assistant").contains(string(m,"role",9)))throw new Exception("invalid_response");string(m,"content",32000);integer(m,"created_at");}
    }
    private static void validateRequest(JSONObject r,boolean local) throws Exception {
        if(r==null)return;id(r,"id");string(r,"text",4000);integer(r,"created_at");integer(r,"updated_at");
        String status=string(r,"status",20);if(!Set.of("pending","running","completed","failed","unknown","cancelled").contains(status)&&!(local&&status.equals("local")))throw new Exception("invalid_response");
        if(status.equals("local")){if(string(r,"text",4000).trim().isEmpty())throw new Exception("invalid_response");integer(r,"expected_revision");}
    }
    String status(){return request==null?"":request.optString("status");}
    boolean outstanding(){return Set.of("local","pending","running").contains(status());}
    void enqueue() throws Exception {
        String text=draft.trim();if(outstanding()||text.isEmpty()||text.length()>4000||text.indexOf('\0')>=0)throw new Exception("invalid_turn");
        long now=System.currentTimeMillis();request=new JSONObject().put("id",UUID.randomUUID().toString()).put("text",text).put("status","local").put("created_at",now).put("updated_at",now).put("expected_revision",revision);draft="";
    }
    Map<String,String> submission() throws Exception {
        if(!status().equals("local"))throw new Exception("invalid_turn");
        return Map.of("id",request.getString("id"),"text",request.getString("text"),"revision",String.valueOf(integer(request,"expected_revision")));
    }
    void apply(JSONObject reply) throws Exception {
        JSONObject state=reply.getJSONObject("state");long next=integer(state,"revision");
        if(!"personal-reflection".equals(string(state,"id",128))||next<revision)throw new Exception("stale_response");
        JSONArray transcript=state.getJSONArray("messages");validateMessages(transcript);
        JSONObject turn=state.isNull("turn")?null:state.getJSONObject("turn");validateRequest(turn,false);
        if(request!=null&&turn!=null&&request.optString("id").equals(turn.optString("id"))&&!request.optString("text").equals(turn.optString("text")))throw new Exception("conflicting_turn");
        String nextOpening=string(reply,"opening",500),nextHint=string(reply,"hint",1000);boolean nextEarlier=bool(state,"has_earlier");
        boolean acknowledged=request!=null&&request.optString("id").equals(reply.optString("acknowledged_id"));
        if(request!=null)for(int i=0;i<transcript.length();i++){JSONObject m=transcript.getJSONObject(i);if(request.optString("id").equals(m.getString("id"))&&"user".equals(m.getString("role"))&&request.optString("text").equals(m.getString("content")))acknowledged=true;}
        if(!status().equals("local")||(turn!=null&&request.optString("id").equals(turn.optString("id")))||acknowledged)request=turn;
        messages=transcript;revision=next;opening=nextOpening;hint=nextHint;earlier=nextEarlier;
    }
    /** Voice may read only the answer attached to its own user turn. */
    String voiceAnswer(String id) throws Exception {
        if(request==null||!id.equals(request.optString("id"))||!status().equals("completed"))return null;
        boolean found=false;String answer=null;
        for(int i=0;i<messages.length();i++){JSONObject m=messages.getJSONObject(i);if(found){if(m.getString("role").equals("user"))break;answer=m.getString("content");}else if(m.getString("id").equals(id)&&m.getString("role").equals("user"))found=true;}
        return answer;
    }
}
