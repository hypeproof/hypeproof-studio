package ai.hypeproof.companion;
import java.util.*;
import java.util.function.Consumer;

/** Protocol controls with no live account, browser, Android runtime, or token fixture bootstrap. */
public final class NativeDeviceSignInTest {
 static void check(boolean v){if(!v)throw new AssertionError();}
 static final class Time implements NativeDeviceSignIn.Clock {
  long now;public long now(){return now;}public void pause(long ms,NativeDeviceSignIn.Cancel c)throws Exception{check(ms>0);if(c.isCancelled())throw new Exception("cancelled");now+=ms;}
 }
 static final class Wire implements NativeDeviceSignIn.Transport {
  final Time time=new Time();final List<String> calls=new ArrayList<>();final List<Long> polls=new ArrayList<>();
  final NativeDeviceSignIn.Cancel cancel=new NativeDeviceSignIn.Cancel();
  Map<String,Object> start=new HashMap<>(Map.of("device_code","a".repeat(64),"user_code","ABCD-EFGH","verification_uri","https://hypeproof-ai.xyz/studio/connect","verification_uri_complete","https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH","expires_in",600,"interval",3));
  Map<String,Object> approved=new HashMap<>(Map.of("access_token","test-native-memory-only","expires_in",3600,"account_id","acct_1","session_id","ses_1"));
  Map<String,Object> me=new HashMap<>(Map.of("account_id","acct_1","session_id","ses_1","account_status","active"));
  int pending,slow;boolean late,cancelMe,deny;
  public NativeDeviceSignIn.Reply call(String path,Map<String,String> body,String bearer,NativeDeviceSignIn.Cancel c){
   calls.add(path);
   if(path.equals("/auth/device/start")){check(!body.containsKey("return_uri"));return new NativeDeviceSignIn.Reply(200,start);}
   if(path.equals("/auth/device/poll")){
    polls.add(time.now);check(body.equals(Map.of("device_code","a".repeat(64))) && bearer==null);
    if(slow-->0)return new NativeDeviceSignIn.Reply(429,Map.of("error","slow_down"));
    if(pending-->0)return new NativeDeviceSignIn.Reply(202,Map.of("status","pending"));
    if(deny)return new NativeDeviceSignIn.Reply(403,Map.of("error","access_denied"));
    if(late)cancel.cancel();return new NativeDeviceSignIn.Reply(200,approved);
   }
   check(bearer.equals("test-native-memory-only"));
   if(path.equals("/me")){if(cancelMe)cancel.cancel();return new NativeDeviceSignIn.Reply(200,me);}
   check(path.equals("/auth/logout"));return new NativeDeviceSignIn.Reply(200,Map.of("ok",true));
  }
  NativeDeviceSignIn.Credentials run(Consumer<NativeDeviceSignIn.Challenge> c)throws Exception{return new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),this,time).run(cancel,c);}
 }
 interface Action {void run()throws Exception;}
 static void fails(Action a)throws Exception{try{a.run();throw new AssertionError("unexpected credentials");}catch(AssertionError e){throw e;}catch(Exception expected){}}
 static void test(String name,Action a)throws Exception{a.run();System.out.println("PASS "+name);}
 public static void main(String[] args)throws Exception{
  test("pending and slow-down retain exact existing protocol and verify me",()->{Wire w=new Wire();w.slow=1;w.pending=1;var c=w.run(ch->{check(ch.url().equals("https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH"));});check(c.account().equals("acct_1") && w.polls.equals(List.of(3000L,7000L,11000L)));check(w.calls.equals(List.of("/auth/device/start","/auth/device/poll","/auth/device/poll","/auth/device/poll","/me")));});
  test("untrusted approval and mixed code never open or poll",()->{for(String bad:List.of("https://evil.example/studio/connect?code=ABCD-EFGH","https://hypeproof-ai.xyz/studio/connect?code=JKLM-NPQR","https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH&state=secret")){Wire w=new Wire();w.start.put("verification_uri_complete",bad);fails(()->w.run(ch->{throw new AssertionError("opened");}));check(w.calls.size()==1);}});
  test("expiry bounds pending polling and never verifies me",()->{Wire w=new Wire();w.pending=999;w.start.put("expires_in",10);fails(()->w.run(ch->{}));check(w.time.now==10000 && w.polls.equals(List.of(3000L,6000L,9000L)));});
  test("pre-abort and challenge cancel install nothing",()->{Wire w=new Wire();w.cancel.cancel();fails(()->w.run(ch->{}));check(w.calls.isEmpty());Wire x=new Wire();fails(()->x.run(ch->x.cancel.cancel()));check(x.calls.size()==1);});
  test("late approved token after cancel is revoked without me",()->{Wire w=new Wire();w.late=true;fails(()->w.run(ch->{}));check(w.calls.equals(List.of("/auth/device/start","/auth/device/poll","/auth/logout")));});
  test("me mismatch revocation and cancellation cannot hand off",()->{for(String key:List.of("account_id","session_id","account_status")){Wire w=new Wire();w.me.put(key,"changed");fails(()->w.run(ch->{}));check(w.calls.get(w.calls.size()-1).equals("/auth/logout"));}Wire x=new Wire();x.cancelMe=true;fails(()->x.run(ch->{}));check(x.calls.get(x.calls.size()-1).equals("/auth/logout"));Wire y=new Wire();y.deny=true;fails(()->y.run(ch->{}));check(!y.calls.contains("/me"));});
  test("debug loopback is canonical and unavailable without debug",()->{check(NativeDeviceSignIn.Target.debugLoopback(true,"http://10.0.2.2:8765/v1").site.equals("http://10.0.2.2:8765"));for(String url:List.of("https://evil.example/v1","http://127.0.0.1:8765/v1?token=x","http://user@127.0.0.1:8765/v1","http://localhost:8765/v1"))fails(()->NativeDeviceSignIn.Target.debugLoopback(true,url));fails(()->NativeDeviceSignIn.Target.debugLoopback(false,"http://127.0.0.1:8765/v1"));});
 }
}
