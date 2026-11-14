package ai.hypeproof.studio;

import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** Actual model and sign-in protocol; deterministic local storage/clock/network ports. */
public class GuestDraftTest {
    static final class Store implements ReflectionModel.Store {
        String guest="";boolean failAccount,failGuest,brokenGuest;
        NativeDeviceSignIn.Credentials credentials;
        final Map<String,String> records=new HashMap<>();
        public String loadGuestDraft()throws Exception{if(brokenGuest)throw new Exception("corrupt");return guest;}
        public void saveGuestDraft(String text)throws Exception{if(failGuest)throw new Exception("disk_full");guest=text;}
        public ReflectionState load(String account)throws Exception{return records.containsKey(account)?new ReflectionState(account,records.get(account)):new ReflectionState(account);}
        public void save(ReflectionState state)throws Exception{if(failAccount)throw new Exception("disk_full");records.put(state.account,state.json().toString());}
        public NativeDeviceSignIn.Credentials loadCredentials(){return credentials;}
        public void saveCredentials(NativeDeviceSignIn.Credentials c){credentials=c;}
        public void markRefreshSpent(){credentials=null;}
        public void forgetCredentials(){credentials=null;}
    }
    static final class Fixture {
        final Store store;final ReflectionModelTest.Queue worker=new ReflectionModelTest.Queue();
        final Deque<Runnable> ui=new ArrayDeque<>();final NativeDeviceSignInTest.Wire wire=new NativeDeviceSignInTest.Wire();
        final List<String> calls=new ArrayList<>();final ReflectionModel model;
        Fixture(Store store){this.store=store;NativeDeviceSignIn.Transport transport=(p,b,t,c)->{calls.add(p);if(p.equals("/me/reflection"))return new NativeDeviceSignIn.Reply(200,Map.of("error","offline_fixture"));if(p.equals("/me/reflection/turns"))throw new AssertionError("No implicit send permitted");return wire.call(p,b,t,c);};
            model=new ReflectionModel(store,new NativeDeviceSignIn(NativeDeviceSignIn.Target.production(),transport,wire.time),transport,worker,ui::add,()->{});model.restore();}
        void drain(){while(!ui.isEmpty())ui.remove().run();}
        void login(){model.login(url->{});worker.one();drain();if(!worker.tasks.isEmpty()){worker.one();drain();}}
    }
    @Test public void guestDraftPersistsExactlyBeforeAnyAccountOrNetwork()throws Exception{
        Store store=new Store();Fixture f=new Fixture(store);String words="  정리되지 않은 생각\n다음 줄 🙂  ";f.model.edit(words);
        assertFalse(f.model.send());assertEquals(words,store.guest);assertTrue(f.calls.isEmpty());assertTrue(store.records.isEmpty());
        f.model.close();assertEquals(words,new Fixture(store).model.draft);
    }
    @Test public void failedAndCancelledLoginKeepGuestAndFenceLateAdoption()throws Exception{
        for(boolean cancel:List.of(false,true)){Store store=new Store();Fixture f=new Fixture(store);f.model.edit("로그인 전에 쓴 말");
            if(!cancel)f.wire.deny=true;f.model.login(url->{});f.worker.one();if(cancel)f.model.cancelLogin();f.drain();
            assertNull(f.model.account());assertNull(store.credentials);assertEquals("로그인 전에 쓴 말",store.guest);assertEquals(store.guest,f.model.draft);assertTrue(store.records.isEmpty());}
    }
    @Test public void explicitLoginCopiesToEmptyAccountBeforeClearingGuestWithoutSending()throws Exception{
        Store store=new Store();Fixture f=new Fixture(store);f.model.edit("계속 적을 내 생각");f.login();
        assertEquals("acct_1",f.model.account());assertEquals("계속 적을 내 생각",f.model.draft);assertEquals(f.model.draft,store.load("acct_1").draft);assertEquals("",store.guest);assertNull(f.model.state.request);assertFalse(f.calls.contains("/me/reflection/turns"));
    }
    @Test public void collisionPreservesBothUntilAnExplicitRestoreIntoEmptyDraft()throws Exception{
        Store store=new Store();ReflectionState prior=new ReflectionState("acct_1");prior.draft="계정에 남겨 둔 말";store.save(prior);Fixture f=new Fixture(store);f.model.edit("로그인 전에 적은 말");f.login();
        assertEquals(prior.draft,f.model.draft);assertEquals("로그인 전에 적은 말",store.guest);assertFalse(f.model.restoreGuest());
        f.model.edit(" ");assertFalse(f.model.restoreGuest());assertEquals(" ",store.load("acct_1").draft);
        f.model.edit("");assertTrue(f.model.restoreGuest());assertEquals("로그인 전에 적은 말",store.load("acct_1").draft);assertEquals("",store.guest);assertNull(f.model.state.request);
    }
    @Test public void handoffWriteFailuresNeverLoseTheOnlyCopy()throws Exception{
        for(boolean accountFailure:List.of(true,false)){Store store=new Store();store.guest="파일 오류에도 남을 말";Fixture f=new Fixture(store);store.failAccount=accountFailure;store.failGuest=!accountFailure;f.login();
            assertEquals("파일 오류에도 남을 말",store.guest);assertEquals(accountFailure?"":"파일 오류에도 남을 말",store.load("acct_1").draft);assertNull(f.model.state.request);
            store.failGuest=false;store.failAccount=false;assertEquals(accountFailure?"":"파일 오류에도 남을 말",new Fixture(store).model.draft);}
    }
    @Test public void restoredCredentialsDoNotImplicitlyAdoptAndOutstandingTurnBlocksRestore()throws Exception{
        Store store=new Store();Fixture first=new Fixture(store);first.login();store.guest="기기에 남은 별도 글";Fixture reopened=new Fixture(store);assertEquals("",reopened.model.draft);assertEquals("기기에 남은 별도 글",store.guest);
        ReflectionState pending=new ReflectionState("acct_1");pending.draft="앞선 요청";pending.enqueue();store.save(pending);Fixture held=new Fixture(store);assertFalse(held.model.restoreGuest());assertEquals("기기에 남은 별도 글",store.guest);assertEquals("앞선 요청",held.model.state.request.getString("text"));
    }
    @Test public void unreadableGuestRefusesOverwriteAndFailedSaveRetainsVisibleWords()throws Exception{
        Store store=new Store();store.guest="original";store.brokenGuest=true;Fixture f=new Fixture(store);f.model.edit("replacement");assertTrue(f.model.guestReadOnly);assertEquals("original",store.guest);
        store.brokenGuest=false;store.failGuest=true;f=new Fixture(store);f.model.edit("화면에 남을 말");assertEquals("화면에 남을 말",f.model.draft);assertEquals("original",store.guest);store.failGuest=false;f.model.retrySave();assertEquals("화면에 남을 말",store.guest);
    }
}
