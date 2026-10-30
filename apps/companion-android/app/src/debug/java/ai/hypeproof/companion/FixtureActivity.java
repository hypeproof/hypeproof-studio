package ai.hypeproof.companion;

import org.json.JSONObject;
import java.net.URI;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledExecutorService;

/** Debug-only native fixture handoff. Intent arguments contain no account credentials. */
public final class FixtureActivity extends MainActivity {
 private volatile HttpURLConnection provisioning;
 private volatile boolean destroyed;
 private final ScheduledExecutorService deadline=Executors.newSingleThreadScheduledExecutor();
 @Override public void onCreate(android.os.Bundle state){if(state!=null)getIntent().removeExtra("fixtureUrl");super.onCreate(state);}
 @Override protected void requestProvision(java.util.function.Consumer<Session> receive) {
  String fixtureUrl=getIntent().getStringExtra("fixtureUrl");getIntent().removeExtra("fixtureUrl");
  new Thread(()->{
   Session value=null;
   try{
    if(destroyed || !BuildConfig.DEBUG || fixtureUrl==null || fixtureUrl.length()>512)throw new Exception();
    URI uri=new URI(fixtureUrl);
    if(!"http".equals(uri.getScheme()) || !Set.of("10.0.2.2","127.0.0.1").contains(uri.getHost())
     || !"/__android_fixture/session".equals(uri.getPath()) || uri.getRawUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null)throw new Exception();
    HttpURLConnection connection=(HttpURLConnection)uri.toURL().openConnection();provisioning=connection;
    var timer=deadline.schedule(connection::disconnect,12,TimeUnit.SECONDS);
    try{
     if(destroyed)throw new Exception();
     connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(12000);
     connection.setRequestProperty("Accept","application/json");
     if(connection.getResponseCode()!=200 || connection.getContentLengthLong()>4096)throw new Exception();
     String type=connection.getHeaderField("Content-Type");if(type==null || !type.toLowerCase(java.util.Locale.ROOT).matches("application/json(?:;.*)?"))throw new Exception();
     ByteArrayOutputStream out=new ByteArrayOutputStream();
     try(var input=connection.getInputStream()){byte[] bytes=new byte[1024];int count;while((count=input.read(bytes))!=-1){if(destroyed || out.size()+count>4096)throw new Exception();out.write(bytes,0,count);}}
     String decoded=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();
     value=Session.parse(new JSONObject(decoded));
     if(!value.service.equals("http://"+uri.getRawAuthority()+"/v1")){value.bearer=null;value=null;throw new Exception();}
    }finally{timer.cancel(false);connection.disconnect();provisioning=null;}
   }catch(Exception ignored){}finally{HttpURLConnection c=provisioning;if(c!=null)c.disconnect();provisioning=null;deadline.shutdownNow();}
   if(destroyed){if(value!=null)value.bearer=null;return;}receive.accept(value);
  },"companion-debug-fixture").start();
 }
 @Override protected void onDestroy(){destroyed=true;HttpURLConnection connection=provisioning;if(connection!=null)connection.disconnect();deadline.shutdownNow();super.onDestroy();}
}
