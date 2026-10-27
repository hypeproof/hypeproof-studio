package ai.hypeproof.companion;

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
  if(!Set.of("/auth/device/start","/auth/device/poll","/me","/auth/logout").contains(path))throw new Exception("invalid_route");
  HttpURLConnection c=(HttpURLConnection)new URL(target.service+path).openConnection();
  try (NativeHttpDeadline deadline=new NativeHttpDeadline(cancel,deadlines,12000)) {
   cancel.bind(c::disconnect);c.setInstanceFollowRedirects(false);c.setConnectTimeout(Math.min(10000,deadline.remaining()));c.setReadTimeout(deadline.remaining());
   c.setRequestMethod(body==null?"GET":"POST");c.setRequestProperty("Accept","application/json");
   if(bearer!=null)c.setRequestProperty("Authorization","Bearer "+bearer);
   if(cancel.isCancelled())throw new Exception("cancelled");
   if(body!=null){byte[] bytes=new JSONObject(body).toString().getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);c.setRequestProperty("Content-Type","application/json");try(var out=c.getOutputStream()){out.write(bytes);}}
   if(cancel.isCancelled())throw new Exception("cancelled");
   c.setReadTimeout(deadline.remaining());
   int status=c.getResponseCode();String type=c.getHeaderField("Content-Type");
   if(type==null || !type.toLowerCase(java.util.Locale.ROOT).matches("application/json(?:;.*)?") || c.getContentLengthLong()>65536)throw new Exception("invalid_response");
   ByteArrayOutputStream out=new ByteArrayOutputStream();
   try(InputStream in=status>=400?c.getErrorStream():c.getInputStream()){
    if(in==null)throw new Exception("invalid_response");byte[] buf=new byte[4096];int n;
    while(true){c.setReadTimeout(deadline.remaining());n=in.read(buf);if(n==-1)break;if(out.size()+n>65536)throw new Exception("invalid_response");out.write(buf,0,n);}
    deadline.remaining();
   }
   String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(out.toByteArray())).toString();
   JSONObject v=new JSONObject(json);Map<String,Object> fields=new HashMap<>();
   for(String k:Set.of("error","status","device_code","user_code","verification_uri","verification_uri_complete","expires_in","interval","access_token","session_id"))if(v.has(k))fields.put(k,v.get(k));
   JSONObject account=v.optJSONObject("account");if(account!=null){fields.put("account_id",account.opt("id"));fields.put("account_status",account.opt("status"));}
   // Deliberately drop refresh_token and all other account/consent/profile fields.
   deadline.remaining();return new NativeDeviceSignIn.Reply(status,fields);
  } finally {cancel.unbind();c.disconnect();}
 }
}
