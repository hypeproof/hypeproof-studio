package ai.hypeproof.companion;
import org.json.JSONObject;import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.util.function.BooleanSupplier;
/** Real native store/grammar with owned real disk; AtomicFile port is JVM filesystem implementation, not Android execution. */
public final class NativeDraftStoreTest {
 static void check(boolean v){if(!v)throw new AssertionError();}interface Action{void run()throws Exception;}
 static void fails(Action a)throws Exception{try{a.run();throw new AssertionError("unexpected success");}catch(AssertionError e){throw e;}catch(Exception expected){}}
 static void test(String n,Action a)throws Exception{a.run();System.out.println("PASS "+n);}
 static final class Disk implements NativeDraftStore.AtomicIO {
  boolean fail;CountDownLatch entered,release;
  public void replace(File base,byte[] bytes,BooleanSupplier live)throws Exception{
   Path temp=Path.of(base+".new");try{try(var out=new FileOutputStream(temp.toFile())){out.write(bytes);out.getFD().sync();}if(entered!=null){entered.countDown();check(release.await(5,TimeUnit.SECONDS));}if(fail||!live.getAsBoolean())throw new IOException("refused");Files.move(temp,base.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{Files.deleteIfExists(temp);}
  }
  public void erase(File base)throws Exception{if(fail)throw new IOException("erase_refused");for(String suffix:List.of("",".bak",".new"))Files.deleteIfExists(Path.of(base+suffix));}
 }
 static final class Fixture implements AutoCloseable {
  final Path dir=Files.createTempDirectory("native-draft-");final Disk io=new Disk();final AtomicBoolean live=new AtomicBoolean(true);final NativeDraftStore store=new NativeDraftStore(dir.toFile(),"account","https://owned.invalid/v1",io,live::get);
  Fixture()throws Exception{}public void close()throws Exception{try(var paths=Files.walk(dir)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.delete(p);}}
  JSONObject read()throws Exception{return store.read();}
  JSONObject request(String kind,JSONObject state,JSONObject value){JSONObject r=new JSONObject().put("id","native-1").put("kind",kind).put("generation",state.get("generation")).put("expectedVersion",state.get("version"));if(value!=null)r.put("value",value);return r;}
  JSONObject save(JSONObject state,JSONObject value)throws Exception{return store.operate(request("draft.replace",state,value));}
 }
 static JSONObject selection(){return new JSONObject().put("schema","hps-companion-host-request/1").put("requestId","preview").put("actorId","account").put("deviceId","device").put("hostId","host").put("workspaceId","workspace").put("projectId","project").put("taskId","task").put("version",1).put("epoch",0).put("consentRevision",239367519982534L).put("artifactId","html").put("artifactVersion","a".repeat(64)).put("operation","preview.read");}
 static JSONObject editing(String text){return new JSONObject().put("phase","editing").put("selection",selection()).put("text",text);}
 static JSONObject unknown(String text)throws Exception{String p=new JSONObject().put("schema","hps-companion-authoring-intent/1").put("requestId","intent").put("pairingId","pair").put("selection",selection()).put("text",text).toString();return editing(text).put("phase","attempted_unknown").put("packet",p).put("requestId","intent").put("requestHash",NativeDraftRecord.hash(p));}
 public static void main(String[] args)throws Exception{
  test("actual fixed broker rejects unverified owner, caller identity and non-main-frame origin",()->{try(var f=new Fixture()){
   AtomicBoolean eligible=new AtomicBoolean(false);AtomicInteger created=new AtomicInteger();var broker=new NativeDraftBroker(()->{created.incrementAndGet();return f.store;},eligible::get);
   var read=new JSONObject().put("id","n").put("kind","draft.read");fails(()->broker.request(read));check(created.get()==0);eligible.set(true);
   fails(()->broker.request(new JSONObject(read.toString()).put("accountId","forged")));check(created.get()==0);
   check(broker.request(read).getString("state").equals("empty"));eligible.set(false);fails(()->broker.request(read));
   check(NativeDraftBroker.trustedFrame(true,"https://appassets.androidplatform.net"));check(!NativeDraftBroker.trustedFrame(false,"https://appassets.androidplatform.net"));check(!NativeDraftBroker.trustedFrame(true,"https://evil.invalid"));
  }});
  test("same broker reload rotates generation and fences old writes and erase",()->{try(var f=new Fixture()){
   var broker=new NativeDraftBroker(()->f.store,()->true);var request=new JSONObject().put("id","load").put("kind","draft.read");
   var first=broker.request(request);var saved=broker.request(f.request("draft.replace",first,editing("saved")));
   var next=broker.request(request);check(!next.get("generation").equals(saved.get("generation")));
   fails(()->broker.request(f.request("draft.replace",saved,editing("stale"))));fails(()->broker.request(f.request("draft.erase",saved,null)));
   check(broker.request(f.request("draft.replace",next,editing("new owner"))).getJSONObject("record").getString("text").equals("new owner"));
  }});
  test("lost erase ACK retry stays empty but never erases a successor",()->{try(var f=new Fixture()){
   var saved=f.save(f.read(),editing("saved"));var erase=f.request("draft.erase",saved,null);var empty=f.store.operate(erase);
   check(f.store.operate(erase).getString("state").equals("empty"));var successor=f.save(empty,editing("successor"));
   fails(()->f.store.operate(erase));check(f.read().getJSONObject("record").getString("text").equals("successor"));
  }});
  test("attempted intent uses JS blank grammar while editing preserves whitespace",()->{for(String text:List.of("\u3000","\u00a0","\ufeff"," \n\u3000")){NativeDraftRecord.value(editing(text),"account");fails(()->NativeDraftRecord.value(unknown(text),"account"));}NativeDraftRecord.value(unknown("\u3000한글\ufeff"),"account");});
  test("native identity scoped acknowledged text survives reopen and old generation refuses",()->{try(var f=new Fixture()){var first=f.save(f.read(),editing("  한글\n "));NativeDraftStore next=new NativeDraftStore(f.dir.toFile(),"account","https://owned.invalid/v1",f.io,()->true);var reopened=next.read();check(reopened.getJSONObject("record").getString("text").equals("  한글\n "));fails(()->f.save(first,editing("old")));check(next.read().getJSONObject("record").getString("text").equals("  한글\n "));}});
  test("one global slot refuses foreign identity without reading or erasing it",()->{try(var f=new Fixture()){f.save(f.read(),editing("private"));for(String service:List.of("https://owned.invalid/v1","https://other.invalid/v1")){var other=new NativeDraftStore(f.dir.toFile(),service.contains("other")?"account":"other",service,f.io,()->true);var state=other.read();check(state.getString("state").equals("foreign")&&state.optJSONObject("record")==null);fails(()->other.operate(f.request("draft.erase",state,null)));fails(()->other.operate(f.request("draft.replace",state,editing("replace"))));}check(Files.list(f.dir).count()==1);}});
  test("marker immutable, mismatched hashes and forbidden fields refuse; epoch0 and48bit remain valid",()->{try(var f=new Fixture()){var state=f.save(f.read(),editing("text"));for(JSONObject invalid:List.of(editing("text").put("bearer","secret"),unknown("text").put("requestHash","b".repeat(64)),editing("x".repeat(1025)),editing("text").put("selection",selection().put("epoch",-1))))fails(()->f.save(state,invalid));var held=f.save(state,unknown("text"));fails(()->f.save(held,editing("late")));fails(()->f.save(held,unknown("changed")));check(f.read().getJSONObject("record").getString("text").equals("text"));}});
  test("corrupt payload remains owned and only explicit same-owner erase removes it",()->{try(var f=new Fixture()){var state=f.save(f.read(),editing("keep"));Path base=Files.list(f.dir).findFirst().get();Files.writeString(base,"{corrupt");var corrupt=f.read();check(corrupt.getString("state").equals("corrupt"));fails(()->f.save(corrupt,editing("overwrite")));check(Files.readString(base).equals("{corrupt"));var erased=f.store.operate(f.request("draft.erase",corrupt,null));check(erased.getString("state").equals("empty"));fails(()->f.save(state,editing("stale before erase")));}});
  test("base backup new orphan and foreign transaction leftovers never disappear during read",()->{for(String suffix:List.of(".bak",".new")){try(var f=new Fixture()){f.save(f.read(),editing("acknowledged"));Path base=Files.list(f.dir).findFirst().get();Files.writeString(Path.of(base+suffix),"interrupted");var s=f.read();check(s.getString("state").equals("corrupt"));check(Files.readString(base).contains("acknowledged"));fails(()->f.save(s,editing("overwrite")));check(Files.exists(Path.of(base+suffix)));f.store.operate(f.request("draft.erase",s,null));check(Files.list(f.dir).count()==0);}}try(var f=new Fixture()){Files.writeString(f.dir.resolve("unknown.new"),"retain");check(f.read().getString("state").equals("foreign"));fails(()->f.store.operate(f.request("draft.erase",f.read(),null)));check(Files.exists(f.dir.resolve("unknown.new")));}});
  test("write and erase failures preserve acknowledged bytes and revision",()->{try(var f=new Fixture()){var state=f.save(f.read(),editing("old"));f.io.fail=true;fails(()->f.save(state,editing("new")));check(f.read().get("version").equals(state.get("version")));fails(()->f.store.operate(f.request("draft.erase",state,null)));check(f.read().getJSONObject("record").getString("text").equals("old"));}});
  test("delayed marker serializes lifecycle replacement and queued edit cannot undo committed attempt",()->{try(var f=new Fixture()){var state=f.save(f.read(),editing("text"));f.io.entered=new CountDownLatch(1);f.io.release=new CountDownLatch(1);ExecutorService pool=Executors.newFixedThreadPool(3);try{var marker=pool.submit(()->f.save(state,unknown("text")));check(f.io.entered.await(5,TimeUnit.SECONDS));var late=pool.submit(()->{fails(()->f.save(state,editing("late")));return true;});var invalidation=pool.submit(()->{NativeDraftStore.lifecycle(()->f.live.set(false));return true;});check(!invalidation.isDone());f.io.release.countDown();marker.get(5,TimeUnit.SECONDS);check(late.get(5,TimeUnit.SECONDS));invalidation.get(5,TimeUnit.SECONDS);var next=new NativeDraftStore(f.dir.toFile(),"account","https://owned.invalid/v1",f.io,()->true);check(next.read().getJSONObject("record").getString("phase").equals("attempted_unknown"));fails(()->f.read());}finally{pool.shutdownNow();}}});
 }
}
