package ai.hypeproof.studio;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Build;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.*;
import static androidx.test.espresso.matcher.ViewMatchers.*;

/** Disposable emulator only. Fake network, real Activity / AtomicFile / Android Keystore. */
@RunWith(AndroidJUnit4.class)
public class QuestionJourneyTest {
    private Context context;private ActivityScenario<QuestionActivity> app;
    @Before public void setup() throws Exception {
        Assume.assumeTrue(Build.FINGERPRINT.contains("generic")||Build.MODEL.contains("sdk_gphone"));
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File dir=new File(context.getNoBackupFilesDir(),"reflection");if(dir.isDirectory())for(File f:Objects.requireNonNull(dir.listFiles()))Files.delete(f.toPath());
        QuestionActivity.testTransport=(p,b,t,c)->{if(!p.equals("/me/reflection"))throw new IOException("No live endpoint in fixture");return new NativeDeviceSignIn.Reply(200,Map.of("state",new JSONObject().put("id","personal-reflection").put("revision",2).put("messages",new JSONArray().put(new JSONObject().put("id","fixture-user").put("role","user").put("content","최근에 이웃의 말을 들어줬어요").put("created_at",1000))).put("turn",JSONObject.NULL).put("has_earlier",false),"opening",ReflectionState.OPENING,"hint",ReflectionState.HINT));};
    }
    @After public void teardown(){if(app!=null)app.close();QuestionActivity.testTransport=null;}
    private void ready()throws Exception{for(int i=0;i<100;i++){java.util.concurrent.atomic.AtomicBoolean busy=new java.util.concurrent.atomic.AtomicBoolean();app.onActivity(a->{try{var field=QuestionActivity.class.getDeclaredField("model");field.setAccessible(true);busy.set(((ReflectionModel)field.get(a)).busy);}catch(Exception e){throw new AssertionError(e);}});if(!busy.get())return;Thread.sleep(50);}throw new AssertionError("fixture did not settle");}
    private void screen(String name)throws Exception{Bitmap pixels=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();assertNotNull(pixels);File dir=new File(context.getExternalFilesDir(null),"evidence");assertTrue(dir.isDirectory()||dir.mkdirs());try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){assertTrue(pixels.compress(Bitmap.CompressFormat.PNG,100,out));}pixels.recycle();}
    @Test public void launcherStartsWithQuestionAndConsentCanBeDeclined()throws Exception{
        assertEquals(QuestionActivity.class.getName(),context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()).getComponent().getClassName());
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withText(ReflectionState.OPENING)).check(matches(isDisplayed()));
        onView(withText("내 계정으로 질문 시작하기")).perform(click());
        onView(withText("동의하고 계정 연결")).check(matches(isDisplayed()));screen("android-question-consent");
        onView(withText("나중에")).perform(click());onView(withText("내 계정으로 질문 시작하기")).check(matches(isDisplayed()));assertNull(new ReflectionStorage(context).loadCredentials());screen("android-question-home");
    }
    @Test public void sameAccountDraftAndVoiceStopSurviveRecreationWithoutLiveNetwork()throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);store.saveCredentials(new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));ReflectionState state=new ReflectionState("test-account");state.draft="내가 더 듣고 싶은 이야기";store.save(state);
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("내가 더 듣고 싶은 이야기")));
        ready();VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));
        onView(withText("말로 적기")).perform(click());onView(withText("음성 멈추기")).perform(click());
        onView(withContentDescription("질문 대화 입력")).perform(replaceText("한 번 더 생각한 말"),closeSoftKeyboard());app.recreate();
        app.onActivity(a->{try{var root=QuestionActivity.class.getDeclaredField("root");root.setAccessible(true);assertTrue(((android.view.View)root.get(a)).getPaddingLeft()>0);}catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("한 번 더 생각한 말")));assertEquals("한 번 더 생각한 말",store.load("test-account").draft);screen("android-account-questions");
    }
    @Test public void realKeystoreEncryptsRotatesAndRefusesTamperedCredentials()throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);var credentials=new NativeDeviceSignIn.Credentials("test-account","test-session","private-synthetic-access","private-synthetic-refresh",System.currentTimeMillis()+3600000);
        store.saveCredentials(credentials);assertEquals(credentials,store.loadCredentials());File file=new File(new File(context.getNoBackupFilesDir(),"reflection"),"account.bin");byte[] bytes=Files.readAllBytes(file.toPath());assertFalse(new String(bytes,StandardCharsets.ISO_8859_1).contains("private-synthetic"));
        store.markRefreshSpent();assertNull(store.loadCredentials());store.saveCredentials(credentials);bytes=Files.readAllBytes(file.toPath());bytes[bytes.length-1]^=1;Files.write(file.toPath(),bytes);assertThrows(Exception.class,store::loadCredentials);byte[] corrupt=Files.readAllBytes(file.toPath());assertArrayEquals(bytes,corrupt);store.preserveBrokenCredentials();assertNull(store.loadCredentials());
    }
    @Test public void malformedUTF8CacheStaysUntouchedAndExportsOriginalBytes()throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);ReflectionState state=new ReflectionState("corrupt-account");state.draft="kept";store.save(state);
        File file=new File(new File(context.getNoBackupFilesDir(),"reflection"),"conversation-corrupt-account.json");byte[] bytes=Files.readAllBytes(file.toPath());for(int i=0;i<bytes.length-4;i++)if(bytes[i]=='k'&&bytes[i+1]=='e'&&bytes[i+2]=='p'&&bytes[i+3]=='t'){bytes[i]=(byte)0xc3;bytes[i+1]=0x28;break;}Files.write(file.toPath(),bytes);
        assertThrows(Exception.class,()->store.load("corrupt-account"));assertArrayEquals(bytes,Files.readAllBytes(file.toPath()));File exported=new File(context.getCacheDir(),"malformed-questions-export.json");store.exportOriginal("corrupt-account",exported);assertArrayEquals(bytes,Files.readAllBytes(exported.toPath()));Files.delete(exported.toPath());
    }

    private VoiceFixture conversation(java.util.List<String> submitted)throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);
        store.saveCredentials(new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));
        store.save(new ReflectionState("test-account"));
        JSONArray messages=new JSONArray();JSONObject[] turn={null};long[] revision={0};
        QuestionActivity.testTransport=(path,body,bearer,cancel)->{
            assertEquals("synthetic-access",bearer);
            synchronized(submitted){
                if(path.equals("/me/reflection/turns")){
                    assertNotNull(body);String id=body.get("id"),text=body.get("text");
                    ReflectionState durable=store.load("test-account");assertEquals(id,durable.request.getString("id"));assertEquals(text,durable.request.getString("text"));
                    assertFalse(submitted.contains(id));submitted.add(id);
                    messages.put(new JSONObject().put("id",id).put("role","user").put("content",text).put("created_at",1000+revision[0]));
                    messages.put(new JSONObject().put("id","answer-"+id).put("role","assistant").put("content","내 생각의 답변 "+submitted.size()).put("created_at",1001+revision[0]));
                    turn[0]=new JSONObject().put("id",id).put("text",text).put("status","completed").put("created_at",1000).put("updated_at",1001);revision[0]++;
                }else assertEquals("/me/reflection",path);
                return new NativeDeviceSignIn.Reply(200,Map.of("state",new JSONObject().put("id","personal-reflection").put("revision",revision[0]).put("messages",new JSONArray(messages.toString())).put("turn",turn[0]==null?JSONObject.NULL:new JSONObject(turn[0].toString())).put("has_earlier",false),"opening",ReflectionState.OPENING,"hint",ReflectionState.HINT));
            }
        };
        app=ActivityScenario.launch(QuestionActivity.class);ready();VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));return voice;
    }
    private void drain(){InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
    @Test public void oneTapFiveAutomaticTurnsUseDurableOwnRepliesWithoutRmsOrNextTap()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withText("음성 대화")).perform(click());onView(withText("말하기 끝")).check(doesNotExist());
        onView(withText("다시 말하기")).check(doesNotExist());
        for(int i=0;i<5;i++){
            final int n=i;app.onActivity(a->{assertEquals(n+1,voice.starts);voice.partial("생각 "+n);voice.endpoint();voice.endpoint();assertEquals(n,submitted.size());voice.result("생각 "+n+" 최종");voice.result("중복 결과");});
            ready();drain();assertEquals(i+1,submitted.size());assertEquals(i+1,voice.spoken.size());assertEquals("내 생각의 답변 "+(i+1),voice.spoken.get(i));
            var listener=voice.output;String utterance=voice.utterance;
            app.onActivity(a->{listener.onDone(utterance+"-intermediate");listener.onError("foreign");listener.onError(utterance+"-foreign");});drain();assertEquals(i+1,voice.starts);
            app.onActivity(a->{listener.onDone(utterance);listener.onDone(utterance);});drain();assertEquals(i+2,voice.starts);
            app.onActivity(a->listener.onError(utterance));drain();assertTrue(voice.controller.session.active());
        }
        onView(withText("음성 멈추기")).perform(click());int starts=voice.starts;
        app.onActivity(a->{voice.partial("중단 뒤 인식");voice.result("중단 뒤 최종");voice.output.onDone(voice.utterance);});drain();
        assertEquals(starts,voice.starts);assertEquals(5,submitted.size());assertEquals(10,new ReflectionStorage(context).load("test-account").messages.length());
        screen("android-continuous-voice-fixture");
    }
    @Test public void dictationEndpointTimeoutKeepsPartialAndNeverSubmits()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withText("말로 적기")).perform(click());
        app.onActivity(a->{voice.partial("인식이 끝나지 않아도 남길 말");voice.endpoint();voice.expire();voice.result("늦게 온 최종");});drain();
        assertFalse(voice.controller.session.active());assertTrue(submitted.isEmpty());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("인식이 끝나지 않아도 남길 말")));
        app.recreate();onView(withContentDescription("질문 대화 입력")).check(matches(withText("인식이 끝나지 않아도 남길 말")));
    }
    @Test public void editingDuringReplyOrBackgroundInvalidatesAutomaticReopen()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withText("음성 대화")).perform(click());app.onActivity(a->voice.result("내가 보낸 말"));ready();drain();
        onView(withContentDescription("질문 대화 입력")).perform(replaceText("답변을 들으며 직접 적은 글"),closeSoftKeyboard());
        app.onActivity(a->voice.output.onDone(voice.utterance));drain();assertEquals(1,voice.starts);assertEquals(1,submitted.size());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("답변을 들으며 직접 적은 글")));
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(""),closeSoftKeyboard());
        onView(withText("음성 대화")).perform(click());app.onActivity(a->voice.partial("화면을 떠나도 남길 말"));
        var old=voice.capture;app.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);app.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
        app.onActivity(a->old.onResults(VoiceFixture.words("뒤늦은 말")));drain();assertFalse(voice.controller.session.active());assertEquals(2,voice.starts);assertEquals(1,submitted.size());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("화면을 떠나도 남길 말")));
    }

    @Test public void expiredOrReplacedCredentialCannotSendOrReopenTheOldVoiceTurn()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withText("음성 대화")).perform(click());
        app.onActivity(a->{voice.partial("연결이 끝나기 전에 적은 말");try{
            var f=QuestionActivity.class.getDeclaredField("model");f.setAccessible(true);ReflectionModel m=(ReflectionModel)f.get(a);
            m.credentials=new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",0);
            voice.result("만료된 연결의 최종 말");voice.checkScope();
            assertFalse(voice.controller.session.active());assertTrue(submitted.isEmpty());assertEquals("연결이 끝나기 전에 적은 말",m.draft);
            m.credentials=new NativeDeviceSignIn.Credentials("test-account","new-session","synthetic-access","new-refresh",System.currentTimeMillis()+3600000);
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(""),closeSoftKeyboard());
        onView(withText("음성 대화")).perform(click());app.onActivity(a->voice.result("새 연결의 말"));ready();drain();
        app.onActivity(a->{try{
            var f=QuestionActivity.class.getDeclaredField("model");f.setAccessible(true);ReflectionModel m=(ReflectionModel)f.get(a);
            m.credentials=new NativeDeviceSignIn.Credentials("test-account","replacement-session","synthetic-access","replacement-refresh",System.currentTimeMillis()+3600000);
            voice.output.onDone(voice.utterance);voice.checkScope();
        }catch(Exception e){throw new AssertionError(e);}});drain();assertEquals(2,voice.starts);assertEquals(1,submitted.size());assertFalse(voice.controller.session.active());
    }

}

/** Only OS audio is synthetic; listener, Host, model, storage and lifecycle are production code. */
final class VoiceFixture {
    NativeVoice controller;android.speech.RecognitionListener capture;
    android.speech.tts.UtteranceProgressListener output;String utterance;
    int starts;final java.util.List<String> spoken=new java.util.ArrayList<>();
    static android.os.Bundle words(String text){android.os.Bundle b=new android.os.Bundle();b.putStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION,new java.util.ArrayList<>(java.util.List.of(text)));return b;}
    void install(android.app.Activity activity){try{
        var field=activity.getClass().getDeclaredField("voice");field.setAccessible(true);NativeVoice previous=(NativeVoice)field.get(activity);
        var host=NativeVoice.class.getDeclaredField("host");host.setAccessible(true);NativeVoice.Host existing=(NativeVoice.Host)host.get(previous);previous.close();
        controller=new NativeVoice(activity,existing,()->true,listener->new NativeVoice.Capture(){
            public void start(){capture=listener;starts++;}public void close(){}
        },new NativeVoice.Playback(){
            public void speak(String text,String id,android.speech.tts.UtteranceProgressListener listener){spoken.add(text);utterance=id;output=listener;listener.onStart(id);}public void stop(){}
        },()->true);field.set(activity,controller);
    }catch(Exception e){throw new AssertionError(e);}}
    void partial(String text){capture.onPartialResults(words(text));}void endpoint(){capture.onEndOfSpeech();}void result(String text){capture.onResults(words(text));}
    void checkScope(){try{var f=NativeVoice.class.getDeclaredField("guard");f.setAccessible(true);((Runnable)f.get(controller)).run();}catch(Exception e){throw new AssertionError(e);}}
    void expire(){try{var f=NativeVoice.class.getDeclaredField("timeout");f.setAccessible(true);((Runnable)f.get(controller)).run();}catch(Exception e){throw new AssertionError(e);}}
}
