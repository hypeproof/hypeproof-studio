package ai.hypeproof.studio;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;

/** Native-only, fixed-target JSON transport; tokens never enter Intent extras or WebView. */
final class DeviceSignInHttp implements NativeDeviceSignIn.Transport {
 private final NativeDeviceSignIn.Target target;
 private final java.util.concurrent.ScheduledExecutorService deadlines;
 DeviceSignInHttp(NativeDeviceSignIn.Target target,java.util.concurrent.ScheduledExecutorService deadlines){this.target=target;this.deadlines=deadlines;}
 public NativeDeviceSignIn.Reply call(String path,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel cancel) throws Exception {
  return call(path,body,bearer,cancel,path.equals("/me/reflection/turns")?90000:12000);
 }
 public NativeDeviceSignIn.Reply call(String path,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel cancel,long timeoutMillis) throws Exception {
  return exchange(path,body,bearer,cancel,timeoutMillis,body==null?"GET":"POST",false);
 }
 NativeDeviceSignIn.Reply push(String method,String id,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel cancel)throws Exception {
  if(!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:/opened)?")||bearer==null||!Set.of("PUT","DELETE","POST").contains(method)||method.equals("POST")!=id.endsWith("/opened")||method.equals("DELETE")!=(body==null))throw new Exception("invalid_route");
  return exchange("/me/push-devices/"+id,body,bearer,cancel,12000,method,true);
 }
 private NativeDeviceSignIn.Reply exchange(String path,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel cancel,long timeoutMillis,String method,boolean push)throws Exception {
  if(timeoutMillis<1)throw new Exception("native_deadline");
  boolean experience=path.equals("/me/product-events/consent")||path.equals("/me/product-events");
  if(experience&&(bearer==null||(path.equals("/me/product-events")&&body==null)))throw new Exception("invalid_route");
  boolean cardRead=path.equals("/me/cards?surface=mobile")||path.equals("/me/approval-inbox")||path.matches("/me/approval-inbox/[A-Za-z0-9._:-]{1,128}");
  boolean cardWrite=path.equals("/me/question-triggers")||path.matches("/me/cards/[a-z][a-z0-9:.-]{1,63}/(?:shown|answer|skip)")||path.matches("/me/approval-inbox/[A-Za-z0-9._:-]{1,128}/decisions");
  if((cardRead||cardWrite)&&(bearer==null||(path.contains("/../")||path.endsWith("/..")||path.contains("/./")||path.endsWith("/."))||cardRead!=(body==null)))throw new Exception("invalid_route");
  if(!Set.of("/auth/device/start","/auth/device/poll","/me","/auth/logout","/auth/refresh","/me/reflection","/me/reflection/turns").contains(path) && !path.matches("/me/reflection/turns/[A-Za-z0-9._:-]{1,120}/(?:abandon|cancel)")&&!cardRead&&!cardWrite&&!experience&&!push)throw new Exception("invalid_route");
  HttpURLConnection c=(HttpURLConnection)new URL(target.service+path).openConnection();
  try (NativeHttpDeadline deadline=new NativeHttpDeadline(cancel,deadlines,Math.min(timeoutMillis,path.equals("/me/reflection/turns")?90000:12000))) {
   cancel.bind(c::disconnect);c.setInstanceFollowRedirects(false);c.setConnectTimeout(Math.min(10000,deadline.remaining()));c.setReadTimeout(deadline.remaining());
   c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");
   if(bearer!=null)c.setRequestProperty("Authorization","Bearer "+bearer);
   if(cancel.isCancelled())throw new Exception("cancelled");
   if(body!=null){JSONObject payload=new JSONObject(body);if(path.equals("/me/reflection/turns"))payload.put("revision",Long.parseLong(body.get("revision")));if(path.equals("/me/question-triggers"))payload.put("source_revision",Long.parseLong(body.get("source_revision")));if(path.equals("/me/product-events/consent")){if(!Set.of("true","false").contains(body.get("granted")))throw new Exception("invalid_consent");payload.put("granted",Boolean.parseBoolean(body.get("granted")));}if(path.equals("/me/product-events"))payload.put("events",new org.json.JSONArray(body.get("events")));byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);c.setRequestProperty("Content-Type","application/json");try(var out=c.getOutputStream()){out.write(bytes);}}
   if(cancel.isCancelled())throw new Exception("cancelled");
   c.setReadTimeout(deadline.remaining());
   int status=c.getResponseCode();String type=c.getHeaderField("Content-Type");
   if(type==null || !type.toLowerCase(java.util.Locale.ROOT).matches("application/json(?:;.*)?") || c.getContentLengthLong()>4194304)throw new Exception("invalid_response");
   ByteArrayOutputStream out=new ByteArrayOutputStream();
   try(InputStream in=status>=400?c.getErrorStream():c.getInputStream()){
    if(in==null)throw new Exception("invalid_response");byte[] buf=new byte[4096];int n;
    while(true){c.setReadTimeout(deadline.remaining());n=in.read(buf);if(n==-1)break;if(out.size()+n>4194304)throw new Exception("invalid_response");out.write(buf,0,n);}
    deadline.remaining();
   }
   String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(out.toByteArray())).toString();
   JSONObject v=new JSONObject(json);Map<String,Object> fields=new HashMap<>();
   for(String k:Set.of("error","status","device_code","user_code","verification_uri","verification_uri_complete","expires_in","interval","access_token","refresh_token","session_id","state","opening","hint","acknowledged_id"))if(v.has(k))fields.put(k,v.get(k));
   JSONObject account=v.optJSONObject("account");if(account!=null){fields.put("account_id",account.opt("id"));fields.put("account_status",account.opt("status"));}
   if(account!=null&&account.opt("display_name") instanceof String)fields.put("display_name",account.getString("display_name"));
   if(cardRead||cardWrite){for(String k:Set.of("schema","availability","cards","card","key","id","request_digest","source","reviewer","brief","state","created_at","expires_at","lease_expires_at","can_decide","unavailable_reason","decision","review","ok","thanks","message","final","change_until","source_revision","reentry","model_calls","policy","created"))if(v.has(k))fields.put(k,v.get(k));}
   if(experience)for(String k:Set.of("schema","notice_version","preference","title","notice","ok","accepted","deferred","evidence_kind"))if(v.has(k))fields.put(k,v.get(k));
   if(push)for(String k:Set.of("schema","id","generation","active","recorded","evidence_kind"))if(v.has(k))fields.put(k,v.get(k));
   // Keep only the current account/card protocol fields; arbitrary server fields stay out of UI.
   deadline.remaining();return new NativeDeviceSignIn.Reply(status,fields);
  } finally {cancel.unbind();c.disconnect();}
 }
}
