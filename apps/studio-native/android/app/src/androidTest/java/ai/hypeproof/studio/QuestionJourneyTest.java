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
    @Test public void launcherStartsWithEditableGuestDraftAndConsentCanBeDeclined()throws Exception{
        assertEquals(QuestionActivity.class.getName(),context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()).getComponent().getClassName());
        java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();
        QuestionActivity.testTransport=(p,b,t,c)->{calls.incrementAndGet();throw new IOException("No guest network");};
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withText(ReflectionState.OPENING)).check(matches(isDisplayed()));
        onView(withContentDescription("질문 대화 입력")).check(matches(isDisplayed())).perform(replaceText("  로그인 전 내 생각\n다음 줄  "),closeSoftKeyboard());
        onView(withText("로그인")).perform(click());onView(withText("동의하고 로그인")).check(matches(isDisplayed()));screen("android-question-consent");
        onView(withText("나중에")).perform(click());assertNull(new ReflectionStorage(context).loadCredentials());
        app.close();app=ActivityScenario.launch(QuestionActivity.class);
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("  로그인 전 내 생각\n다음 줄  ")));assertEquals("  로그인 전 내 생각\n다음 줄  ",new ReflectionStorage(context).loadGuestDraft());assertEquals(0,calls.get());screen("android-question-home");
    }
    @Test public void emptyGuestCanOpenLoginAndCancelWithoutDraftOrNetwork()throws Exception{
        java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();
        QuestionActivity.testTransport=(p,b,t,c)->{calls.incrementAndGet();throw new IOException("No request before login consent");};
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("")));
        onView(withText("로그인")).check(matches(isEnabled())).perform(click());
        onView(withText("동의하고 로그인")).check(matches(isDisplayed()));screen("android-design-empty-login");onView(withText("나중에")).perform(click());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("")));
        ReflectionStorage store=new ReflectionStorage(context);assertEquals("",store.loadGuestDraft());assertNull(store.loadCredentials());assertEquals(0,calls.get());
    }
    @Test public void guestDictationAndBackgroundPreserveWordsWithoutAnAccountOrSend()throws Exception{
        java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();QuestionActivity.testTransport=(p,b,t,c)->{calls.incrementAndGet();throw new IOException("No guest network");};
        app=ActivityScenario.launch(QuestionActivity.class);VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));
        onView(withContentDescription("질문 대화 입력")).perform(replaceText("이미 적은 글"),click(),closeSoftKeyboard());
        // A focus update may arrive between physical DOWN/UP; it must not eat the tap.
        java.util.concurrent.atomic.AtomicReference<float[]> point=new java.util.concurrent.atomic.AtomicReference<>();
        onView(withContentDescription("말로 적기")).check((v,e)->{if(e!=null)throw e;int[] xy=new int[2];v.getLocationOnScreen(xy);point.set(new float[]{xy[0]+v.getWidth()/2f,xy[1]+v.getHeight()/2f});});
        var instrumentation=InstrumentationRegistry.getInstrumentation();float[] xy=point.get();long downTime=android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down=android.view.MotionEvent.obtain(downTime,downTime,android.view.MotionEvent.ACTION_DOWN,xy[0],xy[1],0);down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(down);down.recycle();
        onView(withContentDescription("질문 대화 입력")).check((v,e)->{if(e!=null)throw e;v.clearFocus();});
        android.view.MotionEvent up=android.view.MotionEvent.obtain(downTime,android.os.SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_UP,xy[0],xy[1],0);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(up);up.recycle();drain();
        app.onActivity(a->{try{var f=QuestionActivity.class.getDeclaredField("model");f.setAccessible(true);ReflectionModel model=(ReflectionModel)f.get(a);assertNotNull("dictation tap must start capture; phase="+voice.controller.session.phase()+" error="+model.error,voice.capture);}catch(ReflectiveOperationException e){throw new AssertionError(e);}});
        app.onActivity(a->voice.partial("말로 이어 적은 글"));app.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);app.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
        app.onActivity(a->voice.result("늦게 온 말"));drain();assertFalse(voice.controller.session.active());
        app.close();app=ActivityScenario.launch(QuestionActivity.class);onView(withContentDescription("질문 대화 입력")).check(matches(withText("이미 적은 글\n말로 이어 적은 글")));assertEquals(0,calls.get());
    }
    private java.util.concurrent.atomic.AtomicInteger loginTransport(boolean denied){
        java.util.concurrent.atomic.AtomicInteger sends=new java.util.concurrent.atomic.AtomicInteger();
        QuestionActivity.testTransport=(path,body,bearer,cancel)->{
            if(path.equals("/auth/device/start"))return new NativeDeviceSignIn.Reply(200,Map.of("device_code","a".repeat(64),"user_code","ABCD-EFGH","verification_uri","https://hypeproof-ai.xyz/studio/connect","verification_uri_complete","https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH","expires_in",30,"interval",3));
            if(path.equals("/auth/device/poll"))return denied?new NativeDeviceSignIn.Reply(403,Map.of("error","access_denied")):new NativeDeviceSignIn.Reply(200,Map.of("access_token","synthetic-access","refresh_token","synthetic-refresh","account_id","test-account","session_id","test-session","expires_in",3600));
            if(path.equals("/me"))return new NativeDeviceSignIn.Reply(200,Map.of("account_id","test-account","session_id","test-session","account_status","active"));
            if(path.equals("/me/reflection/turns"))sends.incrementAndGet();
            if(path.equals("/auth/logout"))return new NativeDeviceSignIn.Reply(200,Map.of());
            return new NativeDeviceSignIn.Reply(200,Map.of("state",new JSONObject().put("id","personal-reflection").put("revision",0).put("messages",new JSONArray()).put("turn",JSONObject.NULL).put("has_earlier",false),"opening",ReflectionState.OPENING,"hint",ReflectionState.HINT));
        };return sends;
    }
    private void approveLogin()throws Exception{
        androidx.test.espresso.intent.Intents.init();
        try{
            androidx.test.espresso.intent.Intents.intending(androidx.test.espresso.intent.matcher.IntentMatchers.hasAction(android.content.Intent.ACTION_VIEW)).respondWith(new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null));
            onView(withText("로그인")).perform(click());onView(withText("동의하고 로그인")).perform(click());ready();drain();
        }finally{androidx.test.espresso.intent.Intents.release();}
    }
    @Test public void realLoginAdoptsGuestOnlyIntoEmptyAccountAndNeverSends()throws Exception{
        var sends=loginTransport(false);ReflectionStorage store=new ReflectionStorage(context);store.saveGuestDraft("로그인 뒤에도 내가 보낼 글");app=ActivityScenario.launch(QuestionActivity.class);approveLogin();
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("로그인 뒤에도 내가 보낼 글")));assertEquals("",store.loadGuestDraft());assertEquals("로그인 뒤에도 내가 보낼 글",store.load("test-account").draft);assertNull(store.load("test-account").request);assertEquals(0,sends.get());
    }
    @Test public void realLoginCollisionAndExplicitRestorePreserveBothFilesWithoutSending()throws Exception{
        var sends=loginTransport(false);ReflectionStorage store=new ReflectionStorage(context);store.saveGuestDraft("로그인 전에 적은 글");ReflectionState previous=new ReflectionState("test-account");previous.draft="계정에 남긴 글";store.save(previous);
        app=ActivityScenario.launch(QuestionActivity.class);approveLogin();onView(withContentDescription("질문 대화 입력")).check(matches(withText("계정에 남긴 글")));assertEquals("로그인 전에 적은 글",store.loadGuestDraft());onView(withText("로그인 전 글 가져오기")).check(matches(org.hamcrest.Matchers.not(isEnabled())));
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(""),closeSoftKeyboard());onView(withText("로그인 전 글 가져오기")).perform(click());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("로그인 전에 적은 글")));assertEquals("",store.loadGuestDraft());assertEquals("로그인 전에 적은 글",store.load("test-account").draft);assertNull(store.load("test-account").request);assertEquals(0,sends.get());screen("android-guest-restored");
    }
    @Test public void deniedLoginAndCorruptGuestFileRemainLocalAndIntact()throws Exception{
        var sends=loginTransport(true);ReflectionStorage store=new ReflectionStorage(context);store.saveGuestDraft("취소해도 지킬 글");app=ActivityScenario.launch(QuestionActivity.class);approveLogin();assertNull(store.loadCredentials());assertEquals("취소해도 지킬 글",store.loadGuestDraft());app.close();app=null;
        File file=new File(new File(context.getNoBackupFilesDir(),"reflection"),"guest-draft-v1.json");byte[] corrupt={(byte)0xc3,0x28};Files.write(file.toPath(),corrupt);
        app=ActivityScenario.launch(QuestionActivity.class);onView(withContentDescription("질문 대화 입력")).check(matches(org.hamcrest.Matchers.not(isEnabled())));assertArrayEquals(corrupt,Files.readAllBytes(file.toPath()));assertEquals(0,sends.get());
    }
    @Test public void composerRemainsReachableWithKeyboardAndSystemTheme()throws Exception{
        app=ActivityScenario.launch(QuestionActivity.class);
        String text="첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄";
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(text),click());
        java.util.concurrent.atomic.AtomicBoolean keyboard=new java.util.concurrent.atomic.AtomicBoolean();
        for(int i=0;i<80&&!keyboard.get();i++){app.onActivity(a->{android.view.WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();keyboard.set(insets!=null&&insets.isVisible(android.view.WindowInsets.Type.ime()));});if(!keyboard.get())Thread.sleep(50);}
        assertTrue("actual software keyboard must be visible",keyboard.get());
        screen("android-first-use-keyboard");
        app.onActivity(a->{try{
            var field=QuestionActivity.class.getDeclaredField("composer");field.setAccessible(true);android.widget.EditText edit=(android.widget.EditText)field.get(a);int[] xy=new int[2];edit.getLocationOnScreen(xy);
            android.view.WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();int keyboardTop=a.getWindowManager().getCurrentWindowMetrics().getBounds().bottom-insets.getInsets(android.view.WindowInsets.Type.ime()).bottom;
            var sendField=QuestionActivity.class.getDeclaredField("send");sendField.setAccessible(true);android.widget.Button send=(android.widget.Button)sendField.get(a);int[] sendXY=new int[2];send.getLocationOnScreen(sendXY);
            JSONObject proof=new JSONObject().put("font_scale",a.getResources().getConfiguration().fontScale).put("ui_mode",a.getResources().getConfiguration().uiMode).put("keyboard_top",keyboardTop).put("composer_y",xy[1]).put("composer_height",edit.getHeight()).put("full_text_retained",edit.getText().toString().equals(text)).put("send_y",sendXY[1]).put("send_height",send.getHeight()).put("send_parent_y",send.getY()).put("compose_height",((android.view.View)send.getParent()).getHeight());
            File dir=new File(context.getExternalFilesDir(null),"evidence");assertTrue(dir.isDirectory()||dir.mkdirs());try(FileOutputStream out=new FileOutputStream(new File(dir,"android-first-use-layout.json"))){out.write(proof.toString().getBytes(StandardCharsets.UTF_8));}
            assertTrue("composer must stay above keyboard",xy[1]+edit.getHeight()<=keyboardTop);assertTrue("composer remains below top controls",xy[1]>insets.getInsets(android.view.WindowInsets.Type.statusBars()).top+48*a.getResources().getDisplayMetrics().density);
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("질문 대화 입력")).check(matches(isCompletelyDisplayed())).check(matches(withText(text)));
        onView(withText("로그인")).check(matches(isCompletelyDisplayed()));
        onView(withContentDescription("질문 대화 입력")).perform(closeSoftKeyboard());
    }
    private void compactControl(String label){
        onView(org.hamcrest.Matchers.anyOf(withContentDescription(label),withText(label))).check((view,error)->{
            if(error!=null)throw error;
            float density=view.getResources().getDisplayMetrics().density;
            android.graphics.Rect visible=new android.graphics.Rect();assertTrue(label+" is visible",view.getGlobalVisibleRect(visible));
            assertEquals(label+" full width",view.getWidth(),visible.width());assertEquals(label+" full height",view.getHeight(),visible.height());
            assertTrue(label+" has a 48dp touch target",view.getWidth()>=48*density&&view.getHeight()>=48*density);
            assertTrue(label+" stays a compact tool, not a full-width bar",view.getWidth()<=64*density);
            android.view.accessibility.AccessibilityNodeInfo node=view.createAccessibilityNodeInfo();
            assertTrue(label+" exposes an accessible action",node.isClickable());assertTrue(label+" remains enabled",node.isEnabled());
            assertTrue(label+" has a readable name",label.contentEquals(node.getContentDescription()==null?node.getText():node.getContentDescription()));
        });
    }
    @Test public void compactConversationToolsKeepHumanWordsAndVoiceStopVisible()throws Exception{
        app=ActivityScenario.launch(QuestionActivity.class);onView(withContentDescription("질문 대화 입력")).check(matches(isCompletelyDisplayed()));
        screen("android-design-guest");compactControl("메뉴");compactControl("말로 적기");app.close();app=null;
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        compactControl("말로 적기");compactControl("음성 대화");
        onView(withContentDescription("음성 대화")).perform(click());compactControl("음성 멈추기");
        onView(withContentDescription("질문 대화 입력")).check(matches(org.hamcrest.Matchers.not(isEnabled())));screen("android-design-listening");
        app.onActivity(a->voice.result("이웃의 이야기를 듣고 내가 할 수 있는 일을 생각했어요."));ready();drain();
        onView(withText("이웃의 이야기를 듣고 내가 할 수 있는 일을 생각했어요.")).check(matches(isDisplayed()));
        onView(withText("내 생각의 답변 1")).check(matches(isDisplayed()));compactControl("음성 멈추기");screen("android-design-messages");
        onView(withContentDescription("음성 멈추기")).perform(click());drain();assertFalse(voice.controller.session.active());assertEquals(1,submitted.size());
        compactControl("말로 적기");compactControl("음성 대화");
    }
    @Test public void sameAccountDraftAndVoiceStopSurviveRecreationWithoutLiveNetwork()throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);store.saveCredentials(new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));ReflectionState state=new ReflectionState("test-account");state.draft="내가 더 듣고 싶은 이야기";store.save(state);
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("내가 더 듣고 싶은 이야기")));
        ready();VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));
        onView(withContentDescription("말로 적기")).perform(click());onView(withContentDescription("음성 멈추기")).perform(click());
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
        return conversation(submitted,null);
    }
    private VoiceFixture conversation(java.util.List<String> submitted,String denial)throws Exception{
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
                    if(denial!=null){
                        // Service persists the failed user turn before admission rejects execution.
                        turn[0]=new JSONObject().put("id",id).put("text",text).put("status","failed").put("created_at",1000).put("updated_at",1001);revision[0]++;
                        return new NativeDeviceSignIn.Reply(403,Map.of("error",denial));
                    }
                    messages.put(new JSONObject().put("id","answer-"+id).put("role","assistant").put("content","내 생각의 답변 "+submitted.size()).put("created_at",1001+revision[0]));
                    turn[0]=new JSONObject().put("id",id).put("text",text).put("status","completed").put("created_at",1000).put("updated_at",1001);revision[0]++;
                }else assertEquals("/me/reflection",path);
                return new NativeDeviceSignIn.Reply(200,Map.of("state",new JSONObject().put("id","personal-reflection").put("revision",revision[0]).put("messages",new JSONArray(messages.toString())).put("turn",turn[0]==null?JSONObject.NULL:new JSONObject(turn[0].toString())).put("has_earlier",false),"opening",ReflectionState.OPENING,"hint",ReflectionState.HINT));
            }
        };
        app=ActivityScenario.launch(QuestionActivity.class);ready();VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));return voice;
    }
    private void drain(){InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
    @Test public void voiceAdmissionDenialKeepsServiceReasonAndStopsWithoutReplay()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted,"reflection_monthly_limit");
        String words="이번 주에 시도해 보고 싶은 일이 있어요";
        onView(withContentDescription("음성 대화")).perform(click());
        app.onActivity(a->{voice.partial("이번 주에 시도해 보고 싶은 일");voice.endpoint();voice.result(words);});ready();drain();
        onView(withText("이번 달 이용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다.")).check(matches(isDisplayed()));
        assertFalse(voice.controller.session.active());assertTrue(voice.spoken.isEmpty());assertEquals(1,voice.starts);assertEquals(1,submitted.size());
        ReflectionStorage store=new ReflectionStorage(context);ReflectionState saved=store.load("test-account");
        assertEquals(words,saved.request.getString("text"));assertEquals(submitted.get(0),saved.request.getString("id"));assertNotNull(store.loadCredentials());
        app.onActivity(a->{voice.result("오래된 최종 결과");voice.endpoint();});drain();
        assertFalse(voice.controller.session.active());assertEquals(1,voice.starts);assertEquals(1,submitted.size());assertTrue(voice.spoken.isEmpty());
        screen("android-voice-admission-denial");
    }
    @Test public void oneTapFiveAutomaticTurnsUseDurableOwnRepliesWithoutRmsOrNextTap()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withContentDescription("음성 대화")).perform(click());onView(withText("말하기 끝")).check(doesNotExist());
        onView(withText("다시 말하기")).check(doesNotExist());
        for(int i=0;i<5;i++){
            final int n=i;app.onActivity(a->{assertEquals(n+1,voice.starts);voice.partial("생각 "+n);voice.endpoint();voice.endpoint();assertEquals(n,submitted.size());voice.result("생각 "+n+" 최종");voice.result("중복 결과");});
            ready();drain();assertEquals(i+1,submitted.size());assertEquals(i+1,voice.spoken.size());assertEquals("내 생각의 답변 "+(i+1),voice.spoken.get(i));
            var listener=voice.output;String utterance=voice.utterance;
            app.onActivity(a->{listener.onDone(utterance+"-intermediate");listener.onError("foreign");listener.onError(utterance+"-foreign");});drain();assertEquals(i+1,voice.starts);
            app.onActivity(a->{listener.onDone(utterance);listener.onDone(utterance);});drain();assertEquals(i+2,voice.starts);
            app.onActivity(a->listener.onError(utterance));drain();assertTrue(voice.controller.session.active());
        }
        onView(withContentDescription("음성 멈추기")).perform(click());int starts=voice.starts;
        app.onActivity(a->{voice.partial("중단 뒤 인식");voice.result("중단 뒤 최종");voice.output.onDone(voice.utterance);});drain();
        assertEquals(starts,voice.starts);assertEquals(5,submitted.size());assertEquals(10,new ReflectionStorage(context).load("test-account").messages.length());
        screen("android-continuous-voice-fixture");
    }
    @Test public void dictationEndpointTimeoutKeepsPartialAndNeverSubmits()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withContentDescription("말로 적기")).perform(click());
        app.onActivity(a->{voice.partial("인식이 끝나지 않아도 남길 말");voice.endpoint();voice.expire();voice.result("늦게 온 최종");});drain();
        assertFalse(voice.controller.session.active());assertTrue(submitted.isEmpty());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("인식이 끝나지 않아도 남길 말")));
        app.recreate();onView(withContentDescription("질문 대화 입력")).check(matches(withText("인식이 끝나지 않아도 남길 말")));
    }
    @Test public void editingDuringReplyOrBackgroundInvalidatesAutomaticReopen()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withContentDescription("음성 대화")).perform(click());app.onActivity(a->voice.result("내가 보낸 말"));ready();drain();
        onView(withContentDescription("질문 대화 입력")).perform(replaceText("답변을 들으며 직접 적은 글"),closeSoftKeyboard());
        app.onActivity(a->voice.output.onDone(voice.utterance));drain();assertEquals(1,voice.starts);assertEquals(1,submitted.size());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("답변을 들으며 직접 적은 글")));
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(""),closeSoftKeyboard());
        onView(withContentDescription("음성 대화")).perform(click());app.onActivity(a->voice.partial("화면을 떠나도 남길 말"));
        var old=voice.capture;app.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);app.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
        app.onActivity(a->old.onResults(VoiceFixture.words("뒤늦은 말")));drain();assertFalse(voice.controller.session.active());assertEquals(2,voice.starts);assertEquals(1,submitted.size());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("화면을 떠나도 남길 말")));
    }

    @Test public void expiredOrReplacedCredentialCannotSendOrReopenTheOldVoiceTurn()throws Exception{
        java.util.List<String> submitted=Collections.synchronizedList(new ArrayList<>());VoiceFixture voice=conversation(submitted);
        onView(withContentDescription("음성 대화")).perform(click());
        app.onActivity(a->{voice.partial("연결이 끝나기 전에 적은 말");try{
            var f=QuestionActivity.class.getDeclaredField("model");f.setAccessible(true);ReflectionModel m=(ReflectionModel)f.get(a);
            m.credentials=new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",0);
            voice.result("만료된 연결의 최종 말");voice.checkScope();
            assertFalse(voice.controller.session.active());assertTrue(submitted.isEmpty());assertEquals("연결이 끝나기 전에 적은 말",m.draft);
            m.credentials=new NativeDeviceSignIn.Credentials("test-account","new-session","synthetic-access","new-refresh",System.currentTimeMillis()+3600000);
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("질문 대화 입력")).perform(replaceText(""),closeSoftKeyboard());
        onView(withContentDescription("음성 대화")).perform(click());app.onActivity(a->voice.result("새 연결의 말"));ready();drain();
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
