package ai.hypeproof.studio;
import org.junit.Test;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public class ReflectionModelTest {
    static final class Queue extends AbstractExecutorService {
        final Deque<Runnable> tasks=new ArrayDeque<>();boolean stopped;
        public void execute(Runnable r){tasks.add(r);}void one(){tasks.remove().run();}
        public void shutdown(){stopped=true;}public List<Runnable> shutdownNow(){stopped=true;return List.of();}public boolean isShutdown(){return stopped;}public boolean isTerminated(){return stopped;}public boolean awaitTermination(long t,TimeUnit u){return stopped;}
    }
    static final class Store implements ReflectionModel.Store {
        final Map<String,String> records=new HashMap<>();NativeDeviceSignIn.Credentials token=new NativeDeviceSignIn.Credentials("A","session","bearer","refresh",System.currentTimeMillis()+3600000);
        boolean fail,spent;String guest="";
        public String loadGuestDraft(){return guest;}
        public void saveGuestDraft(String text)throws Exception{if(fail)throw new Exception("disk_full");guest=text;}
        public ReflectionState load(String a)throws Exception{return records.containsKey(a)?new ReflectionState(a,records.get(a)):new ReflectionState(a);}
        public void save(ReflectionState s)throws Exception{if(fail)throw new Exception("disk_full");records.put(s.account,s.json().toString());}
        public NativeDeviceSignIn.Credentials loadCredentials(){return token;}
        public void saveCredentials(NativeDeviceSignIn.Credentials c){token=c;spent=false;}
        public void markRefreshSpent(){spent=true;token=null;}
        public void forgetCredentials(){token=null;}
    }
    static final class Harness {
        final Store store=new Store();final Queue worker=new Queue();final Deque<Runnable> ui=new ArrayDeque<>();final List<Map<String,String>> submitted=new ArrayList<>();
        NativeDeviceSignIn.Reply answer;boolean networkFailure;ReflectionModel model;
        Harness(){NativeDeviceSignIn.Transport transport=(p,b,t,c)->{if(p.equals("/auth/refresh"))assertTrue(store.spent);if(b!=null&&p.equals("/me/reflection/turns"))submitted.add(new HashMap<>(b));if(networkFailure)throw new Exception("offline");return answer;};model=new ReflectionModel(store,new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),transport,NativeDeviceSignIn.MONOTONIC),transport,worker,ui::add,()->{});model.restore();}
        void finish(){worker.one();ui.remove().run();}
        void snapshot(JSONObject value){Map<String,Object> map=new HashMap<>();for(Iterator<String> it=value.keys();it.hasNext();){String k=it.next();map.put(k,value.opt(k));}answer=new NativeDeviceSignIn.Reply(200,map);}
    }
    @Test public void failedDurableWriteCannotDispatchAndUncertainRetryKeepsItsID() throws Exception {
        Harness h=new Harness();h.store.fail=true;h.model.edit("지킬 초안");assertFalse(h.model.send());assertTrue(h.worker.tasks.isEmpty());assertEquals("지킬 초안",h.model.draft);
        h.store.fail=false;h.model.edit("지킬 글");h.networkFailure=true;assertTrue(h.model.send());h.finish();assertEquals("local",h.model.state.status());
        Map<String,String> first=h.submitted.get(0);h.model.retry();h.finish();assertEquals(first,h.submitted.get(1));assertEquals(first,h.store.load("A").submission());
    }
    @Test public void logoutAndAccountSwitchFenceTheAlreadyReturnedSnapshot() throws Exception {
        Harness h=new Harness();h.snapshot(ReflectionStateTest.reply(2,new JSONArray().put(ReflectionStateTest.message("A-message","user","A private")),null));h.model.refresh();h.worker.one();
        h.model.logout();h.model.credentials=new NativeDeviceSignIn.Credentials("B","B-session","B-bearer","B-refresh",System.currentTimeMillis()+3600000);h.model.state=new ReflectionState("B");
        h.ui.remove().run();assertEquals("B",h.model.state.account);assertEquals(0,h.model.state.messages.length());assertFalse(h.store.records.containsKey("B"));
    }
    @Test public void failedRotationIsSpentAndRequiresFreshLoginWithoutLosingStoredWords() throws Exception {
        Harness h=new Harness();h.model.edit("refresh 중에도 지킬 글");h.model.credentials=new NativeDeviceSignIn.Credentials("A","session","bearer","refresh",0);h.networkFailure=true;
        h.model.refresh();assertTrue(h.store.spent);h.finish();assertNull(h.model.credentials);assertNull(h.store.loadCredentials());assertEquals("refresh 중에도 지킬 글",h.store.load("A").draft);
        h.model.refresh();assertTrue(h.worker.tasks.isEmpty());
    }
    @Test public void rejectedSnapshotAndDiskFailurePreserveDraftAndCommittedState() throws Exception {
        Harness h=new Harness();h.model.edit("초안");h.snapshot(ReflectionStateTest.reply(2,new JSONArray(),null));h.store.fail=true;h.model.refresh();h.finish();assertEquals(0,h.model.state.revision);assertEquals("초안",h.model.draft);
        h.store.fail=false;h.snapshot(ReflectionStateTest.reply(3,new JSONArray(),null));h.model.refresh();h.model.edit("확인 중 편집한 초안");h.finish();assertEquals("확인 중 편집한 초안",h.store.load("A").draft);assertEquals(3,h.model.state.revision);
        h.snapshot(ReflectionStateTest.reply(2,new JSONArray(),null));h.model.refresh();h.finish();assertEquals(3,h.model.state.revision);
    }
    @Test public void staleConflictRestoresSubmittedWordsButDoesNotOverwriteNewDraft() throws Exception {
        Harness h=new Harness();h.model.edit("first");h.model.send();h.model.edit("second");h.answer=new NativeDeviceSignIn.Reply(409,Map.of("error","reflection_changed"));h.finish();assertEquals("second",h.model.draft);assertEquals("first",h.model.state.request.getString("text"));
    }
    @Test public void corruptAccountFileIsReadOnlyAndNeverReplacedByPolling() throws Exception {
        Harness h=new Harness();h.store.records.put("A","{broken");h.model.restore();assertTrue(h.model.readOnly);h.model.refresh();assertFalse(h.model.send());assertTrue(h.worker.tasks.isEmpty());assertEquals("{broken",h.store.records.get("A"));
    }
}
