package org.json;
import com.google.gson.*;import java.util.*;
/** JVM-only JSON port backed by Gson. Android's org.json remains the product implementation. */
public final class JSONObject {
 public static final Object NULL=new Object();private final JsonObject value;
 public JSONObject(){value=new JsonObject();}public JSONObject(String raw){value=JsonParser.parseString(raw).getAsJsonObject();}private JSONObject(JsonObject v){value=v;}
 public JSONObject put(String k,Object v){value.add(k,v==NULL||v==null?JsonNull.INSTANCE:v instanceof JSONObject?((JSONObject)v).value:new Gson().toJsonTree(v));return this;}
 public Object get(String k){JsonElement x=value.get(k);if(x==null)throw new IllegalArgumentException(k);if(x.isJsonNull())return NULL;if(x.isJsonObject())return new JSONObject(x.getAsJsonObject());if(x.isJsonArray())return x;var p=x.getAsJsonPrimitive();if(p.isString())return p.getAsString();if(p.isBoolean())return p.getAsBoolean();return p.getAsNumber();}
 public String getString(String k){Object x=get(k);if(!(x instanceof String))throw new IllegalArgumentException();return(String)x;}
 public JSONObject getJSONObject(String k){return(JSONObject)get(k);}public JSONObject optJSONObject(String k){return value.has(k)&&value.get(k).isJsonObject()?getJSONObject(k):null;}
 public Object remove(String k){return value.remove(k);}public Iterator<String> keys(){return value.keySet().iterator();}public String toString(){return value.toString();}
}
