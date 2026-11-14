package ai.hypeproof.studio;

import org.json.*;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;

/** Real loopback HTTP, production transport/model, and a held turn response. */
public class ReflectionStopTest {
    static final class Fixture implements AutoCloseable {
        final ReflectionModelTest.Store store=new ReflectionModelTest.Store();
        final ExecutorService worker=Executors.newFixedThreadPool(2);
        final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
        final Queue<Runnable> ui=new ConcurrentLinkedQueue<>();
        final CountDownLatch posted=new CountDownLatch(1),release=new CountDownLatch(1);
        final AtomicInteger posts=new AtomicInteger(),reads=new AtomicInteger(),cancels=new AtomicInteger();
        final TestHttpServer server;final DeviceSignInHttp http;final ReflectionModel model;
        volatile JSONObject submitted;volatile boolean registered;volatile String readStatus="running",cancelStatus="cancelled",errorCode;
        volatile int errorStatus=429;volatile boolean wrongCancel;
        Fixture()throws Exception{
            server=new TestHttpServer(this::handle);
            var target=NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1");http=new DeviceSignInHttp(target,deadlines);
            model=new ReflectionModel(store,new NativeDeviceSignIn(target,http,NativeDeviceSignIn.MONOTONIC),http,worker,ui::add,()->{});model.restore();
        }
        JSONObject snapshot(String status)throws Exception{
            JSONObject turn=new JSONObject().put("id",submitted.getString("id")).put("text",submitted.getString("text")).put("status",status).put("created_at",1000).put("updated_at",2000);
            return ReflectionStateTest.reply(3,new JSONArray().put(ReflectionStateTest.message(turn.getString("id"),"user",turn.getString("text"))),turn);
        }
        void respond(TestHttpServer.Request r,int status,JSONObject value)throws Exception{r.respond(status,"application/json",value.toString().getBytes(StandardCharsets.UTF_8),"");}
        void handle(TestHttpServer.Request r)throws Exception{
            assertEquals("Bearer bearer",r.headers.get("authorization"));
            if(r.path.equals("/v1/me/reflection/turns")){
                posts.incrementAndGet();submitted=new JSONObject(new String(r.body,StandardCharsets.UTF_8));assertTrue(submitted.get("revision") instanceof Number);posted.countDown();
                assertTrue("owned response released",release.await(8,TimeUnit.SECONDS));
                respond(r,errorCode==null?200:errorStatus,errorCode==null?snapshot("completed"):new JSONObject().put("error",errorCode));return;
            }
            if(r.path.equals("/v1/me/reflection")){
                reads.incrementAndGet();respond(r,200,registered?snapshot(readStatus):ReflectionStateTest.reply(0,new JSONArray(),null));return;
            }
            assertEquals("/v1/me/reflection/turns/"+submitted.getString("id")+"/cancel",r.path);
            assertTrue("cancel must follow registration",registered);assertEquals("{}",new String(r.body,StandardCharsets.UTF_8));cancels.incrementAndGet();
            JSONObject reply=snapshot(cancelStatus);if(wrongCancel)reply.getJSONObject("state").getJSONObject("turn").put("id","another-request");respond(r,200,reply);
        }
        void drain(){for(Runnable r;(r=ui.poll())!=null;)r.run();}
        void until(BooleanSupplier condition)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);do{drain();server.check();if(condition.getAsBoolean())return;Thread.sleep(5);}while(System.nanoTime()<end);fail("condition timed out; status="+model.state.status()+" error="+model.error);}
        String send()throws Exception{model.edit("보낸 한국어 생각");assertTrue(model.send());assertTrue("Stop immediately available",model.canStopResponse());assertTrue(posted.await(3,TimeUnit.SECONDS));return model.state.request.getString("id");}
        public void close()throws Exception{release.countDown();model.close();worker.shutdownNow();deadlines.shutdownNow();assertTrue(worker.awaitTermination(3,TimeUnit.SECONDS));assertTrue(deadlines.awaitTermination(3,TimeUnit.SECONDS));server.close();}
    }
    @Test public void stopBeforeWorkerStartsPreventsEveryHTTPCallAndKeepsLocalIdentity()throws Exception{
        ReflectionModelTest.Store store=new ReflectionModelTest.Store();ReflectionModelTest.Queue worker=new ReflectionModelTest.Queue();Queue<Runnable> ui=new ArrayDeque<>();AtomicInteger calls=new AtomicInteger();
        NativeDeviceSignIn.Transport http=(p,b,t,c)->{calls.incrementAndGet();return new NativeDeviceSignIn.Reply(503,Map.of("error","reflection_unavailable"));};
        ReflectionModel model=new ReflectionModel(store,new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),http,NativeDeviceSignIn.MONOTONIC),http,worker,ui::add,()->{});model.restore();model.edit("실행 전에 멈출 글");assertTrue(model.send());String disk=store.records.get("A"),id=model.state.request.getString("id");
        model.stopResponse();while(!worker.tasks.isEmpty())worker.one();while(!ui.isEmpty())ui.remove().run();
        assertEquals(0,calls.get());assertEquals(disk,store.records.get("A"));assertEquals(id,model.state.request.getString("id"));assertEquals("local",model.state.status());assertFalse(model.busy);assertFalse(model.stoppingResponse);assertFalse(model.notice.contains("중지했어요"));model.close();
    }
    @Test public void heldPostRegistersBeforeCancelAndLateAnswerCannotReplaceDurableStop()throws Exception{
        try(Fixture f=new Fixture()){
            String id=f.send();f.model.edit("별도로 적는 다음 글");f.model.stopResponse();f.model.stopResponse();
            f.until(()->f.reads.get()>0);assertEquals(0,f.cancels.get());assertEquals("local",f.model.state.status());assertTrue(f.model.stoppingResponse);
            f.registered=true;f.until(()->!f.model.stoppingResponse);assertEquals("cancelled",f.model.state.status());assertEquals(1,f.cancels.get());
            f.release.countDown();f.until(()->!f.model.busy);f.drain();
            ReflectionState restored=f.store.load("A");assertEquals("cancelled",restored.status());assertEquals(id,restored.request.getString("id"));assertEquals("보낸 한국어 생각",restored.request.getString("text"));assertEquals("별도로 적는 다음 글",restored.draft);assertEquals(1,f.posts.get());assertFalse(f.model.canStopResponse());
        }
    }
    @Test public void wrongOrNonterminalAcknowledgementAndWriteFailureNeverClaimCancelled()throws Exception{
        for(String mode:List.of("wrong-id","still-running","write-failure"))try(Fixture f=new Fixture()){
            String id=f.send();String disk=f.store.records.get("A");f.registered=true;
            f.wrongCancel=mode.equals("wrong-id");if(mode.equals("still-running"))f.cancelStatus="running";f.store.fail=mode.equals("write-failure");
            f.model.stopResponse();f.until(()->!f.model.stoppingResponse);
            assertEquals(mode,"local",f.model.state.status());assertEquals(id,f.model.state.request.getString("id"));assertEquals(disk,f.store.records.get("A"));assertFalse(f.model.error.isEmpty());assertFalse(f.model.notice.contains("중지했어요"));assertEquals(1,f.posts.get());assertEquals(1,f.cancels.get());
        }
    }
    @Test public void terminalAdmissionFailureRetainsTypedReasonWhenBodyArrivesAfterStopRead()throws Exception{
        for(String code:List.of("reflection_monthly_limit","reflection_admission_unavailable"))try(Fixture f=new Fixture()){
            String id=f.send();f.registered=true;f.readStatus="failed";f.errorCode=code;f.errorStatus=code.equals("reflection_monthly_limit")?429:503;
            f.model.stopResponse();f.until(()->!f.model.stoppingResponse);assertEquals("failed",f.model.state.status());assertTrue(f.model.busy);assertEquals(0,f.cancels.get());
            f.release.countDown();f.until(()->!f.model.busy);
            assertTrue(f.model.error,code.equals("reflection_monthly_limit")?f.model.error.startsWith("이번 달"):f.model.error.startsWith("AI 이용 상태"));assertEquals(id,f.store.load("A").request.getString("id"));assertEquals(1,f.posts.get());assertNotNull(f.model.credentials);
        }
    }
    @Test public void closeAndChangedSessionFenceQueuedStopAcknowledgement()throws Exception{
        for(boolean close:List.of(false,true))try(Fixture f=new Fixture()){
            f.send();f.registered=true;f.model.stopResponse();
            long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(f.ui.isEmpty()&&System.nanoTime()<end)Thread.sleep(5);assertFalse(f.ui.isEmpty());
            String before=f.store.records.get("A");if(close)f.model.close();else f.model.credentials=new NativeDeviceSignIn.Credentials("A","other-session","other-bearer","other-refresh",Long.MAX_VALUE);
            f.drain();assertEquals(before,f.store.records.get("A"));assertEquals("local",f.model.state.status());assertEquals(1,f.posts.get());
        }
    }
    @Test public void cancellationReadUsesActualShorterTransportDeadline()throws Exception{
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
        try(TestHttpServer server=new TestHttpServer(r->{entered.countDown();release.await(3,TimeUnit.SECONDS);})){
            DeviceSignInHttp http=new DeviceSignInHttp(NativeDeviceSignIn.Target.debugLoopback(true,server.url()+"/v1"),deadlines);long start=System.nanoTime();
            assertThrows(Exception.class,()->http.call("/me/reflection",null,"bearer",new NativeDeviceSignIn.Cancel(),150));
            assertTrue(entered.await(1,TimeUnit.SECONDS));assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)<2000);
        }finally{release.countDown();deadlines.shutdownNow();assertTrue(deadlines.awaitTermination(2,TimeUnit.SECONDS));}
    }
}
