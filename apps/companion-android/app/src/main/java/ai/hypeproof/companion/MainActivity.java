package ai.hypeproof.companion;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/** Trusted assets and native fixed-route HTTP only; artifact code has no native port. */
public class MainActivity extends Activity {
 static final String ORIGIN = "https://appassets.androidplatform.net";
 static final int REQUEST_LIMIT = 8192, RESPONSE_LIMIT = 65536;
 protected static final class Session {
  final String service, accountId, sessionId;
  String bearer;
  volatile boolean verified;
  Session(String service, String accountId, String sessionId, String bearer) {
   this.service=service; this.accountId=accountId; this.sessionId=sessionId; this.bearer=bearer;
  }
  static Session parse(JSONObject v) throws Exception {
   String service=v.getString("service"), account=v.getString("accountId"), session=v.getString("sessionId"), bearer=v.getString("bearer");
   URI uri=new URI(service);
   if (!Set.of("10.0.2.2","127.0.0.1").contains(uri.getHost()) || !"http".equals(uri.getScheme())
    || !"/v1".equals(uri.getPath()) || uri.getRawUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null
    || account.isEmpty() || session.isEmpty() || bearer.isEmpty() || bearer.length()>8192 || bearer.matches("(?s).*[^\\x21-\\x7e].*")) throw new Exception();
   return new Session(service,account,session,bearer);
  }
 }
 protected Session provision() { return null; }
 protected void requestProvision(java.util.function.Consumer<Session> receive) { receive.accept(provision()); }
 private Session session;
 private WebView web;
 private volatile boolean closed;
 private final Map<String,Pending> pending=new ConcurrentHashMap<>();
 private final ThreadPoolExecutor workers=new ThreadPoolExecutor(4,4,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
 private final ScheduledThreadPoolExecutor deadlines=new ScheduledThreadPoolExecutor(1);
 private static final class Pending { volatile HttpURLConnection connection; final AtomicBoolean cancelled=new AtomicBoolean(); void cancel(){cancelled.set(true);HttpURLConnection c=connection;if(c!=null)c.disconnect();} }

 @Override public void onCreate(Bundle state) {
  super.onCreate(state); deadlines.setRemoveOnCancelPolicy(true);
  TextView waiting=new TextView(this);waiting.setText("DEV 기기 연결을 준비하고 있어요.");waiting.setPadding(24,48,24,24);setContentView(waiting);
  requestProvision(value->runOnUiThread(()->{if(closed){if(value!=null)value.bearer=null;return;}session=value;initializeWebView();}));
 }
 private void initializeWebView() {
  if(session==null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
   TextView text=new TextView(this);text.setText("DEV 기기 연결 준비가 필요해요. 이 앱은 출시용 로그인을 제공하지 않아요.");text.setPadding(24,48,24,24);setContentView(text);return;
  }
  web=new WebView(this);setContentView(web);
  web.getSettings().setJavaScriptEnabled(true);
  web.getSettings().setDomStorageEnabled(false);
  web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
  web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);web.getSettings().setSupportMultipleWindows(false);
  web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(false);
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
  WebViewAssetLoader assets=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    android.net.Uri uri=request.getUrl();
    if(ORIGIN.equals(uri.getScheme()+"://"+uri.getHost()) && uri.getPath()!=null && uri.getPath().startsWith("/assets/ui/")){
     WebResourceResponse response=assets.shouldInterceptRequest(uri);if(response!=null)return response;
    }
    return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));
   }
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
  });
  WebViewCompat.addWebMessageListener(web,"CompanionNative",Set.of(ORIGIN),(view,message,origin,isMainFrame,reply)->{
   if(closed || !isMainFrame || !ORIGIN.equals(origin.toString()) || message.getData()==null)return;
   accept(message.getData(),reply);
  });
  web.loadUrl(ORIGIN+"/assets/ui/index.html");
 }
 private void reply(JavaScriptReplyProxy proxy,String id,JSONObject value,String error){
  if(closed)return;
  runOnUiThread(()->{if(closed)return;try{JSONObject result=new JSONObject().put("id",id).put("ok",error==null);if(error==null)result.put("value",value);else result.put("error",error);proxy.postMessage(result.toString());}catch(Exception ignored){}});
 }
 private void accept(String raw,JavaScriptReplyProxy reply) {
  String id="";
  try{
   if(raw.getBytes(StandardCharsets.UTF_8).length>REQUEST_LIMIT)throw new Exception();
   JSONObject request=new JSONObject(raw);id=request.getString("id");
   if(!id.matches("[A-Za-z0-9._-]{1,96}"))throw new Exception();
   String kind=request.getString("kind");
   if(kind.equals("cancel")){Pending item=pending.get(request.getString("target"));if(item!=null)item.cancel();return;}
   if(kind.equals("close")){closeSession();return;}
   if(pending.size()>=32 || pending.containsKey(id)){reply(reply,id,null,"native_overloaded");return;}
   Pending item=new Pending();pending.put(id,item);final String key=id;
   try { workers.execute(()->{
    ScheduledFuture<?> deadline=deadlines.schedule(item::cancel,12,TimeUnit.SECONDS);
    try { JSONObject value=request(request,item);if(!item.cancelled.get())reply(reply,key,value,null); }
    catch(Exception e){String code=e instanceof SafeFailure?e.getMessage():"native_unavailable";if(!item.cancelled.get())reply(reply,key,null,code);}
    finally{deadline.cancel(false);item.cancel();pending.remove(key,item);}
   }); } catch(Exception e){pending.remove(key,item);item.cancel();reply(reply,id,null,"native_overloaded");}
  }catch(Exception ignored){reply(reply,id,null,"native_invalid_request");}
 }
 private static final class SafeFailure extends Exception { SafeFailure(String code){super(code);} }
 private JSONObject request(JSONObject r,Pending item) throws Exception {
  Session current=session;if(closed || current==null || item.cancelled.get())throw new SafeFailure("native_closed");
  String kind=r.getString("kind"),path,body=null;
  if(kind.equals("identity")) path="/me";
  else{
   if(!current.verified)throw new SafeFailure("native_identity_required");
   String id=r.getString("invitationId"),action=r.getString("action");
   if(!id.matches("ci_[a-f0-9]{32}"))throw new SafeFailure("native_invalid_request");
   if(kind.equals("pairing") && Set.of("inspect","claim","status","consume").contains(action)){path="/companion/invitations/"+id+"/"+action;body=r.getJSONObject("payload").toString();}
   else if(kind.equals("relay") && Set.of("offer","keys","send","receive","ack").contains(action)){path="/companion/invitations/"+id+"/relay/"+action;body=r.getString("raw");new JSONObject(body);}
   else throw new SafeFailure("native_invalid_request");
   if(body.getBytes(StandardCharsets.UTF_8).length>REQUEST_LIMIT)throw new SafeFailure("native_invalid_request");
  }
  HttpURLConnection c=(HttpURLConnection)new URL(current.service+path).openConnection();item.connection=c;
  c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(12000);
  c.setRequestMethod(body==null?"GET":"POST");c.setRequestProperty("Accept","application/json");c.setRequestProperty("Authorization","Bearer "+current.bearer);
  try{
   if(item.cancelled.get() || closed || session!=current)throw new SafeFailure("native_closed");
   if(body!=null){byte[] bytes=body.getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);c.setRequestProperty("Content-Type","application/json");try(var out=c.getOutputStream()){out.write(bytes);}}
   int status=c.getResponseCode();String type=c.getHeaderField("Content-Type");
   if(type==null || !type.toLowerCase(java.util.Locale.ROOT).matches("application/json(?:;.*)?") || c.getContentLengthLong()>RESPONSE_LIMIT)throw new SafeFailure("native_invalid_response");
   ByteArrayOutputStream output=new ByteArrayOutputStream();
   try(InputStream input=status>=400?c.getErrorStream():c.getInputStream()){
    if(input==null)throw new SafeFailure("native_invalid_response");
    byte[] chunk=new byte[4096];int count;
    while((count=input.read(chunk))!=-1){if(closed || item.cancelled.get() || session!=current)throw new SafeFailure("native_closed");if(output.size()+count>RESPONSE_LIMIT)throw new SafeFailure("native_response_too_large");output.write(chunk,0,count);}
   }
   String decoded=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString();
   JSONObject value=new JSONObject(decoded);
   if(status<200 || status>=300 || value.has("error")){String error=value.optString("error","");throw new SafeFailure(error.matches("[a-z0-9_]{1,64}")?error:"native_denied");}
   if(closed || item.cancelled.get() || session!=current)throw new SafeFailure("native_closed");
   if(kind.equals("identity")){
    if(!current.accountId.equals(value.getJSONObject("account").getString("id")) || !current.sessionId.equals(value.getString("session_id"))) {closeSession();throw new SafeFailure("native_binding_changed");}
    current.verified=true;return new JSONObject().put("accountId",current.accountId).put("sessionId",current.sessionId);
   }
   if(value.optBoolean("execution_authorized",true) || !"authenticated_declaration".equals(value.optString("scope_authority")))throw new SafeFailure("native_invalid_response");
   if(kind.equals("pairing")){
    JSONObject invitation=value.optJSONObject("invitation");
    if(invitation==null || !current.accountId.equals(invitation.optString("account_id")))throw new SafeFailure("native_binding_changed");
    if(invitation.has("device_session_id") && !invitation.isNull("device_session_id")
     && !current.sessionId.equals(invitation.getString("device_session_id")))throw new SafeFailure("native_binding_changed");
   }
   return value;
  }finally{c.disconnect();item.connection=null;}
 }
 private void closeSession(){
  if(closed)return;closed=true;
  Session prior=session;session=null;if(prior!=null){prior.verified=false;prior.bearer=null;}
  for(Pending item:pending.values())item.cancel();pending.clear();
 }
 @Override protected void onDestroy(){closeSession();workers.shutdownNow();deadlines.shutdownNow();if(web!=null){WebViewCompat.removeWebMessageListener(web,"CompanionNative");web.destroy();web=null;}super.onDestroy();}
}
