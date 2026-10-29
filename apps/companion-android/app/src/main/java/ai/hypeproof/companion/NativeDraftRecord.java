package ai.hypeproof.companion;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
/** Exact data-only grammar at the native boundary. No expiry or execution interpretation. */
final class NativeDraftRecord {
 static final int LIMIT=8192;
 static final String SCHEMA="hps-companion-android-draft/1";
 static final Set<String> SELECTION=Set.of("schema","requestId","actorId","deviceId","hostId","workspaceId","projectId","taskId","version","epoch","consentRevision","artifactId","artifactVersion","operation");
 static void require(boolean v)throws Exception{if(!v)throw new Exception("draft_invalid");}
 static Set<String> keys(JSONObject v){Set<String>s=new HashSet<>();v.keys().forEachRemaining(s::add);return s;}
 static String string(JSONObject v,String k)throws Exception{Object o=v.get(k);require(o instanceof String);return (String)o;}
 static long number(JSONObject v,String k)throws Exception{Object o=v.get(k);require(o instanceof Number);double n=((Number)o).doubleValue();require(Double.isFinite(n)&&n>=0&&n<=9007199254740991L&&n==Math.floor(n));return ((Number)o).longValue();}
 static String hash(byte[] b)throws Exception{byte[] d=MessageDigest.getInstance("SHA-256").digest(b);StringBuilder s=new StringBuilder();for(byte x:d)s.append(String.format("%02x",x&255));return s.toString();}
 static String hash(String s)throws Exception{return hash(s.getBytes(StandardCharsets.UTF_8));}
 static void selection(JSONObject s)throws Exception{
  require(keys(s).equals(SELECTION)&&string(s,"schema").equals("hps-companion-host-request/1")&&string(s,"operation").equals("preview.read"));
  for(String k:List.of("requestId","actorId","deviceId","hostId","workspaceId","projectId","taskId","artifactId"))require(string(s,k).matches("[A-Za-z0-9_-]{1,128}"));
  require(string(s,"requestId").length()<=96&&string(s,"artifactVersion").matches("[a-f0-9]{64}"));
  for(String k:List.of("version","epoch","consentRevision"))number(s,k);
 }
 // ECMAScript WhiteSpace + LineTerminator, matching the existing intent parser trim().
 static boolean blankIntent(String s){return s.codePoints().allMatch(c->c==0x9||c==0xa||c==0xb||c==0xc||c==0xd||c==0x20||c==0xa0||c==0x1680||(c>=0x2000&&c<=0x200a)||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000||c==0xfeff);}
 static boolean same(JSONObject a,JSONObject b)throws Exception{if(!keys(a).equals(keys(b)))return false;for(String k:keys(a))if(!a.get(k).toString().equals(b.get(k).toString()))return false;return true;}
 static JSONObject value(JSONObject v,String account)throws Exception{
  String phase=string(v,"phase");Set<String> allowed=new HashSet<>(Set.of("phase","selection","text"));
  if(phase.equals("attempted_unknown"))allowed.addAll(Set.of("packet","requestId","requestHash"));else require(phase.equals("editing"));
  require(keys(v).equals(allowed));JSONObject s=v.getJSONObject("selection");selection(s);require(string(s,"actorId").equals(account));
  String text=string(v,"text");require(text.indexOf('\0')<0&&text.getBytes(StandardCharsets.UTF_8).length<=1024);
  if(phase.equals("attempted_unknown")){
   String packet=string(v,"packet");require(packet.getBytes(StandardCharsets.UTF_8).length<=2032);JSONObject i=new JSONObject(packet);
   require(keys(i).equals(Set.of("schema","requestId","pairingId","selection","text"))&&string(i,"schema").equals("hps-companion-authoring-intent/1"));
   require(string(i,"requestId").matches("[A-Za-z0-9][A-Za-z0-9_-]{0,95}")&&string(i,"pairingId").matches("[A-Za-z0-9_-]{1,128}")&&!blankIntent(text));
   require(string(i,"requestId").equals(string(v,"requestId"))&&!string(i,"requestId").equals(string(s,"requestId"))&&string(i,"text").equals(text)
    &&same(i.getJSONObject("selection"),s)&&hash(packet).equals(string(v,"requestHash")));
  }
  return new JSONObject(v.toString());
 }
 static JSONObject parse(String raw,String account,String service)throws Exception{
  require(raw.getBytes(StandardCharsets.UTF_8).length<=LIMIT);JSONObject v=new JSONObject(raw);
  require(string(v,"schema").equals(SCHEMA)&&string(v,"accountId").equals(account)&&string(v,"service").equals(service));
  require(number(v,"revision")>0);number(v,"createdAt");number(v,"updatedAt");
  JSONObject payload=new JSONObject(v.toString());for(String k:List.of("schema","accountId","service","revision","createdAt","updatedAt"))payload.remove(k);value(payload,account);return v;
 }
}
