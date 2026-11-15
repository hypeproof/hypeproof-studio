package ai.hypeproof.studio;

import org.json.*;
import java.util.*;

/** Data-only parser for the existing hps-card/1 API. Never an approval command. */
final class NativeAccountCard {
    final JSONObject json; final String key;
    NativeAccountCard(JSONObject value) throws Exception {
        json=new JSONObject(value.toString());key=text(json,"key",64);
        if(!validKey(key)||!text(json,"schema",32).equals("hps-card/1"))throw new Exception("invalid_card");
        text(json,"kind",128);text(json,"prompt",4000);
        String select=text(json,"select",8);if(!Set.of("tap","pick").contains(select))throw new Exception("invalid_card");
        if(json.getInt("attempt")<1||json.getInt("attempt")>100)throw new Exception("invalid_card");
        for(String key:List.of("title","preface","skip","note"))optional(json,key,4000);
        if(!json.isNull("expires_at"))integer(json,"expires_at");
        for(String key:List.of("choices","actions","segments")){
            JSONArray values=json.getJSONArray(key);if(values.length()>(key.equals("actions")?10:key.equals("choices")?20:30))throw new Exception("invalid_card");
            Set<String> ids=new HashSet<>();
            for(int i=0;i<values.length();i++){
                JSONObject item=values.getJSONObject(i);
                if(key.equals("segments")){if(!Set.of("own_words","ai_summary","text").contains(text(item,"kind",32)))throw new Exception("invalid_card");text(item,"text",4000);optional(item,"label",4000);}
                else {if(!ids.add(text(item,"id",128)))throw new Exception("invalid_card");text(item,"label",4000);if(key.equals("actions")){bool(item,"primary");bool(item,"needs_answer");}}
            }
        }
        if(select.equals("tap")&&json.getJSONArray("actions").length()!=0)throw new Exception("invalid_card");
        if(!json.isNull("text")){JSONObject field=json.getJSONObject("text");long max=integer(field,"max");if(max<1||max>2000)throw new Exception("invalid_card");text(field,"label",4000);optional(field,"placeholder",4000);optional(field,"value",(int)max);}
    }
    static boolean validKey(String key){return key.matches("[a-z][a-z0-9:.-]{1,63}")&&!key.contains("..");}
    static String text(JSONObject j,String k,int max)throws Exception{Object v=j.get(k);if(!(v instanceof String)||((String)v).isEmpty()||((String)v).length()>max||((String)v).indexOf('\0')>=0)throw new Exception("invalid_card");return(String)v;}
    static String optional(JSONObject j,String k,int max)throws Exception{if(j.isNull(k))return null;Object v=j.get(k);if(!(v instanceof String)||((String)v).length()>max||((String)v).indexOf('\0')>=0)throw new Exception("invalid_card");return(String)v;}
    static long integer(JSONObject j,String k)throws Exception{Object v=j.get(k);if(!(v instanceof Number)||!Double.isFinite(((Number)v).doubleValue())||((Number)v).doubleValue()!=((Number)v).longValue())throw new Exception("invalid_card");return((Number)v).longValue();}
    static boolean bool(JSONObject j,String k)throws Exception{Object v=j.get(k);if(!(v instanceof Boolean))throw new Exception("invalid_card");return(Boolean)v;}
    boolean available(){return json.isNull("expires_at")||json.optLong("expires_at")>System.currentTimeMillis();}
    JSONObject item(String family,String id)throws Exception{JSONArray a=json.getJSONArray(family);for(int i=0;i<a.length();i++)if(a.getJSONObject(i).getString("id").equals(id))return a.getJSONObject(i);throw new Exception("invalid_choice");}
    Map<String,String> answer(String action,String choice,String words)throws Exception{
        if(!available()||words.indexOf('\0')>=0)throw new Exception("card_expired");
        if(choice!=null)item("choices",choice);
        JSONObject field=json.optJSONObject("text");if(!words.isEmpty()&&(field==null||words.length()>field.getInt("max")))throw new Exception("invalid_answer");
        if(action!=null){JSONObject a=item("actions",action);if(a.getBoolean("needs_answer")&&choice==null&&words.trim().isEmpty())throw new Exception("answer_required");}
        else if(!json.getString("select").equals("tap")||json.getJSONArray("actions").length()!=0||choice==null)throw new Exception("invalid_answer");
        Map<String,String> body=new HashMap<>();body.put("surface","mobile");if(action!=null)body.put("action",action);if(choice!=null)body.put("choice",choice);if(field!=null)body.put("text",words);return body;
    }
}
