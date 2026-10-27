package ai.hypeproof.companion;

import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Existing personal-account device protocol. No storage, refresh, or workspace authority. */
final class NativeDeviceSignIn {
 static final class Target {
  final String service, site;
  private Target(String service,String site){this.service=service;this.site=site;}
  static Target production(){return new Target("https://api.hypeproof-ai.xyz/v1","https://hypeproof-ai.xyz");}
  static Target debugLoopback(boolean debug,String service) throws Exception {
   URI u=new URI(service);
   if(!debug || !"http".equals(u.getScheme()) || !Set.of("127.0.0.1","10.0.2.2").contains(u.getHost())
    || u.getPort()<1 || u.getPort()>65535 || !"/v1".equals(u.getRawPath()) || u.getRawUserInfo()!=null || u.getRawQuery()!=null || u.getRawFragment()!=null)throw new Exception("invalid_debug_target");
   String site="http://"+u.getHost()+":"+u.getPort();
   if(!service.equals(site+"/v1"))throw new Exception("invalid_debug_target");
   return new Target(service,site);
  }
 }
 static final class Cancel {
  private boolean cancelled;
  private Runnable disconnect;
  synchronized boolean isCancelled(){return cancelled;}
  synchronized void bind(Runnable action) throws Exception {if(cancelled){action.run();throw new Exception("cancelled");}disconnect=action;}
  synchronized void unbind(){disconnect=null;}
  synchronized void cancel(){cancelled=true;if(disconnect!=null)disconnect.run();notifyAll();}
  synchronized void pause(long ms) throws Exception {if(cancelled)throw new Exception("cancelled");if(ms>0)wait(ms);if(cancelled || Thread.currentThread().isInterrupted())throw new Exception("cancelled");}
 }
 record Reply(int status,Map<String,Object> body) {}
 record Challenge(String code,String url) {}
 record Credentials(String account,String session,String bearer) {}
 interface Transport { Reply call(String path,Map<String,String> body,String bearer,Cancel cancel) throws Exception; }
 interface Clock { long now(); void pause(long ms,Cancel cancel) throws Exception; }
 static final Clock MONOTONIC=new Clock(){public long now(){return System.nanoTime()/1_000_000;}public void pause(long ms,Cancel c)throws Exception{c.pause(ms);}};
 private final Target target; private final Transport transport; private final Clock clock;
 NativeDeviceSignIn(Target target,Transport transport,Clock clock){this.target=target;this.transport=transport;this.clock=clock;}
 static String text(Map<String,Object> v,String key) throws Exception {Object s=v.get(key);if(!(s instanceof String))throw new Exception("invalid_response");return (String)s;}
 private static int number(Map<String,Object> v,String key) throws Exception {Object n=v.get(key);if(!(n instanceof Number) || ((Number)n).doubleValue()!=((Number)n).intValue())throw new Exception("invalid_response");return ((Number)n).intValue();}
 private static void ok(Reply r) throws Exception {if(r.status()<200 || r.status()>=300 || r.body().containsKey("error"))throw new Exception("sign_in_denied");}
 private static String identifier(Map<String,Object> body,String key) throws Exception {String s=text(body,key);if(!s.matches("[A-Za-z0-9_-]{1,128}"))throw new Exception("invalid_identity");return s;}
 private static void live(Cancel c,long now,long end) throws Exception {if(c.isCancelled())throw new Exception("cancelled");if(now>=end)throw new Exception("expired");}
 void logout(String bearer){try{transport.call("/auth/logout",Map.of(),bearer,new Cancel());}catch(Exception ignored){/* Best effort; no remote cancellation claim. */}}
 Credentials run(Cancel cancel,Consumer<Challenge> challenge) throws Exception {
  String bearer=null;boolean handedOff=false;
  try {
   if(cancel.isCancelled())throw new Exception("cancelled");
   Reply start=transport.call("/auth/device/start",Map.of("label","HypeProof Android"),null,cancel);ok(start);
   Map<String,Object> b=start.body();String device=text(b,"device_code"),code=text(b,"user_code");
   int expiry=number(b,"expires_in"),interval=number(b,"interval");
   if(!device.matches("[a-f0-9]{64}") || !code.matches("[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}") || expiry<1 || expiry>600 || interval<3 || interval>15)throw new Exception("invalid_response");
   String url=target.site+"/studio/connect?code="+code;
   if(!url.equals(text(b,"verification_uri_complete")) || !(target.site+"/studio/connect").equals(text(b,"verification_uri")))throw new Exception("invalid_approval_url");
   long end=clock.now()+expiry*1000L;live(cancel,clock.now(),end);challenge.accept(new Challenge(code,url));
   for(int polls=0;polls<200;polls++) {
    long next=Math.min(clock.now()+interval*1000L,end);
    while(clock.now()<next){clock.pause(next-clock.now(),cancel);live(cancel,clock.now(),end);}
    live(cancel,clock.now(),end);
    Reply poll=transport.call("/auth/device/poll",Map.of("device_code",device),null,cancel);
    String error=poll.body().get("error") instanceof String?(String)poll.body().get("error"):"";
    if(poll.status()==429 && "slow_down".equals(error)){live(cancel,clock.now(),end);interval=Math.min(15,interval+1);continue;}
    if(poll.status()==202 && "pending".equals(poll.body().get("status"))){live(cancel,clock.now(),end);continue;}
    ok(poll);
    String candidate=text(poll.body(),"access_token");
    if(candidate.isEmpty() || candidate.length()>8192 || candidate.matches("(?s).*[^\\x21-\\x7e].*"))throw new Exception("invalid_token");
    bearer=candidate;
    int tokenExpiry=number(poll.body(),"expires_in");if(tokenExpiry<1 || tokenExpiry>3600)throw new Exception("invalid_token");
    String account=identifier(poll.body(),"account_id"),session=identifier(poll.body(),"session_id");
    live(cancel,clock.now(),end);
    Reply me=transport.call("/me",null,bearer,cancel);ok(me);live(cancel,clock.now(),end);
    if(!account.equals(text(me.body(),"account_id")) || !session.equals(text(me.body(),"session_id")) || !"active".equals(text(me.body(),"account_status")))throw new Exception("identity_changed");
    handedOff=true;return new Credentials(account,session,bearer);
   }
   throw new Exception("expired");
  } finally {if(bearer!=null && !handedOff)logout(bearer);}
 }
}
