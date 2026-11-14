package ai.hypeproof.studio;
import org.json.*;
import java.util.*;

/** Same source/digest/lease and actual-review checks as the existing iOS inbox. */
final class NativeApprovalCard {
    final JSONObject json;final String id,digest;
    NativeApprovalCard(JSONObject value)throws Exception{
        json=new JSONObject(value.toString());id=NativeAccountCard.text(json,"id",128);digest=hex(json,"request_digest",64);
        if(!validID(id))throw new Exception("invalid_card");
        JSONObject source=json.getJSONObject("source");String repo=NativeAccountCard.text(source,"repo",256);
        if(!repo.matches("hypeproof/[A-Za-z0-9._-]+")||NativeAccountCard.integer(source,"pr")<1)throw new Exception("invalid_card");
        hex(source,"head",40);hex(source,"base",40);for(String key:List.of("policy_digest","evidence_digest","context_digest"))hex(source,key,64);
        NativeAccountCard.text(json,"reviewer",100);NativeAccountCard.bool(json,"can_decide");
        if(!Set.of("pending","delivered","questioned","declined","superseded","expired","submitting","submitted","unknown").contains(NativeAccountCard.text(json,"state",32)))throw new Exception("invalid_card");
        for(String key:List.of("created_at","expires_at","lease_expires_at"))NativeAccountCard.integer(json,key);
        NativeAccountCard.optional(json,"unavailable_reason",500);
        JSONObject brief=json.getJSONObject("brief");for(String key:List.of("authored","verified")){JSONArray facts=brief.getJSONArray(key);if(facts.length()<1||facts.length()>30)throw new Exception("invalid_card");for(int i=0;i<facts.length();i++){Object f=facts.get(i);if(!(f instanceof String)||((String)f).isEmpty()||((String)f).codePointCount(0,((String)f).length())>2000||((String)f).indexOf('\0')>=0)throw new Exception("invalid_card");}}
        JSONObject decision=json.optJSONObject("decision");if(decision!=null){if(!validID(NativeAccountCard.text(decision,"id",128))||!Set.of("approve","reject","question").contains(NativeAccountCard.text(decision,"choice",32))||!Set.of("awaiting_processing","needs_fresh_confirmation","submitted","declined","questioned","superseded","expired","unknown").contains(NativeAccountCard.text(decision,"status",64)))throw new Exception("invalid_card");NativeAccountCard.integer(decision,"created_at");}
        JSONObject review=json.optJSONObject("review");if(review!=null){long reviewID=NativeAccountCard.integer(review,"id");String url="https://github.com/"+repo+"/pull/"+source.getLong("pr")+"#pullrequestreview-"+reviewID;
            if(reviewID<1||!review.getString("state").equals("APPROVED")||!review.getString("commit_id").equals(source.getString("head"))||!review.getJSONObject("user").getString("login").equals(json.getString("reviewer"))||!review.getString("html_url").equals(url))throw new Exception("invalid_review");}
    }
    static boolean validID(String id){return id.matches("[A-Za-z0-9._:-]{1,128}")&&!id.equals(".")&&!id.equals("..");}
    static String hex(JSONObject j,String key,int n)throws Exception{String value=NativeAccountCard.text(j,key,n);if(!value.matches("[a-f0-9]{"+n+"}"))throw new Exception("invalid_digest");return value;}
    boolean canDecide(){double now=System.currentTimeMillis()/1000.0;return json.optBoolean("can_decide")&&Set.of("pending","delivered").contains(json.optString("state"))&&json.isNull("decision")&&json.isNull("review")&&json.optDouble("expires_at")>now&&json.optDouble("lease_expires_at")>now&&json.optDouble("lease_expires_at")<=now+60;}
    boolean terminal(){String decision=json.optJSONObject("decision")==null?"":json.optJSONObject("decision").optString("status");return !json.optBoolean("can_decide")&&!Set.of("awaiting_processing","unknown").contains(decision)&&(Set.of("declined","questioned","superseded","expired").contains(json.optString("state"))||(json.optString("state").equals("submitted")&&json.optJSONObject("review")!=null));}
    String status(){if(json.optJSONObject("review")!=null&&json.optString("state").equals("submitted"))return "GitHub 승인 반영됨";JSONObject d=json.optJSONObject("decision");if(d!=null&&d.optString("status").equals("awaiting_processing"))return "선택을 전달했어요 · 처리 대기";return switch(json.optString("state")){case "pending","delivered"->"확인을 기다려요";case "declined"->"보류했어요";case "questioned"->"설명을 요청했어요";case "superseded"->"버전이 바뀌었어요";case "expired"->"확인 시간이 지났어요";default->"처리 결과를 확인하고 있어요";};}
}
