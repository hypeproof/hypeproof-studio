package ai.hypeproof.studio;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.espresso.Espresso;
import androidx.test.espresso.base.DefaultFailureHandler;
import org.json.JSONObject;
import android.speech.RecognizerIntent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.espresso.intent.Intents;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.*;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static androidx.test.espresso.intent.Intents.*;
import static androidx.test.espresso.intent.matcher.IntentMatchers.*;
import static org.hamcrest.Matchers.*;
import static org.junit.Assert.*;

/** Runs only in a disposable emulator; speech output is a fixture, never an ASR claim. */
@RunWith(AndroidJUnit4.class)
public class StudioJourneyTest {
    private ActivityScenario<MainActivity> app;
    private Context context;
    @Rule public final org.junit.rules.TestName testName=new org.junit.rules.TestName();
    private File failureDirectory;
    private Throwable firstFailure;

    // Espresso calls this before the exception unwinds into JUnit's @After.
    // TestWatcher.failed would run too late to observe the original activity.
    private void captureFailure(Throwable error) {
        if(firstFailure!=null)return;
        firstFailure=error;
        try {
            failureDirectory=new File(context.getExternalFilesDir(null),"evidence/failures/"+testName.getMethodName()+"-"+SystemClock.elapsedRealtime());
            if(!failureDirectory.mkdirs())throw new java.io.IOException("Cannot create failure evidence directory");
            String message=String.valueOf(error.getMessage());
            JSONObject state=new JSONObject().put("phase","before_teardown").put("test",testName.getMethodName())
                .put("elapsed_ms",SystemClock.elapsedRealtime()).put("error_class",error.getClass().getName())
                .put("error_message",message.substring(0,Math.min(message.length(),4096))).put("scenario_state",app==null?"absent":app.getState().name());
            if(app!=null)try {
                app.onActivity(activity->{try {
                    state.put("activity",activity.getClass().getName()).put("activity_destroyed",activity.isDestroyed())
                        .put("activity_finishing",activity.isFinishing()).put("window_focus",activity.hasWindowFocus())
                        .put("decor_visible",activity.getWindow().getDecorView().getVisibility());
                }catch(Exception problem){throw new RuntimeException(problem);}});
            }catch(Throwable problem){state.put("activity_observation_error",problem.getClass().getName());}
            writeFailureJson("failure.json",state);
            try {
                Bitmap pixels=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                if(pixels==null)throw new java.io.IOException("Screenshot unavailable");
                try(FileOutputStream out=new FileOutputStream(new File(failureDirectory,"screen.png"))){
                    if(!pixels.compress(Bitmap.CompressFormat.PNG,100,out))throw new java.io.IOException("Screenshot write failed");
                }finally{pixels.recycle();}
            }catch(Throwable problem){state.put("screenshot_error",problem.getClass().getName());}
            captureCommand("window.txt","timeout 3 dumpsys window",state);
            captureCommand("power.txt","timeout 3 dumpsys power",state);
            captureCommand("recent-logcat.txt","timeout 3 logcat -d -b main -b system -b crash -t 150",state);
            state.put("capture_finished_ms",SystemClock.elapsedRealtime());writeFailureJson("failure.json",state);
        }catch(Throwable problem){Log.e("StudioFailureEvidence","Failure evidence capture failed: "+problem.getClass().getName());}
    }
    private void captureCommand(String name,String command,JSONObject state) {
        try(java.io.InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command));
            FileOutputStream output=new FileOutputStream(new File(failureDirectory,name))) {
            byte[] buffer=new byte[8192];int count,total=0;
            while(total<512*1024&&(count=input.read(buffer,0,Math.min(buffer.length,512*1024-total)))!=-1){output.write(buffer,0,count);total+=count;}
            state.put(name+"_bytes",total).put(name+"_at_byte_limit",total==512*1024);
        }catch(Throwable problem){try{state.put(name+"_error",problem.getClass().getName());}catch(Exception ignored){/* Keep the original Espresso failure. */}}
    }
    private void writeFailureJson(String name,JSONObject value) throws Exception {
        Files.write(new File(failureDirectory,name).toPath(),value.toString(2).getBytes(StandardCharsets.UTF_8));
    }
    @SuppressWarnings("unchecked")
    private static <T extends Throwable> void rethrowOriginal(Throwable error) throws T { throw (T)error; }


    @Before public void start() throws Exception {
        Assume.assumeTrue("Use a disposable emulator, not a person's phone",
            Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("sdk_gphone"));
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String name:new String[]{"studio-notebook-v1.json","studio-notebook-v1.json.bak","studio-notebook-v1.json.new"})
            Files.deleteIfExists(new File(context.getFilesDir(),name).toPath());
        Intents.init();
        Espresso.setFailureHandler((error,matcher)->{
            captureFailure(error);
            StudioJourneyTest.<RuntimeException>rethrowOriginal(error);
        });
        app=ActivityScenario.launch(MainActivity.class);
    }
    @After public void stop() {
        try {
            if(app!=null)app.close();
            if(failureDirectory!=null)try {
                writeFailureJson("after-teardown.json",new JSONObject().put("phase","after_teardown")
                    .put("elapsed_ms",SystemClock.elapsedRealtime()).put("scenario_state",app==null?"absent":app.getState().name()));
            }catch(Exception problem){Log.e("StudioFailureEvidence","Teardown evidence write failed: "+problem.getClass().getName());}
        } finally {
            try {if(context!=null)Intents.release();}
            finally {if(context!=null)Espresso.setFailureHandler(new DefaultFailureHandler(context));}
        }
    }
    private StudioState notebook() throws Exception {
        return new StudioState(new String(Files.readAllBytes(new File(context.getFilesDir(),"studio-notebook-v1.json").toPath()),StandardCharsets.UTF_8));
    }
    private void begin() { onView(withText("첫 생각 기록하기")).perform(click()); }
    private void draft(String value) { onView(withContentDescription("생각 입력")).perform(replaceText(value),closeSoftKeyboard()); }
    private void record() { onView(withContentDescription("생각 기록")).perform(click()); }
    private void screenshot(String name) throws Exception {
        Bitmap pixels=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(pixels);
        File directory=new File(context.getExternalFilesDir(null),"evidence");
        assertTrue(directory.isDirectory()||directory.mkdirs());
        try (FileOutputStream out=new FileOutputStream(new File(directory,name+".png"))) { assertTrue(pixels.compress(Bitmap.CompressFormat.PNG,100,out)); }
        pixels.recycle();
    }
    @Test public void reflectionIsOptionalPersistentAndExcludedFromAIContext() throws Exception {
        begin();
        // Explicit diagnostic control only; ordinary instrumentation never sets it.
        if("before-teardown".equals(InstrumentationRegistry.getArguments().getString("hpsFailureProbe"))) {
            onView(withContentDescription("생각 입력")).check((view,error)->{
                if(error!=null)throw error;
                throw new AssertionError("HPS_INTENTIONAL_BEFORE_TEARDOWN_FAILURE");
            });
        }
        onView(withText("생각 정리")).perform(scrollTo(),click());
        onView(withContentDescription("해보니 무엇이 달랐나요?")).perform(scrollTo(),replaceText("먼저 적은 배움"),closeSoftKeyboard());
        onView(withContentDescription("직접 본 것은 무엇인가요?")).perform(scrollTo(),replaceText("손님이 문 앞에서 기다렸다"),closeSoftKeyboard());
        String first=notebook().projects().getJSONObject(0).getString("id");
        assertEquals("",notebook().find(first).getJSONObject("reflection").getString("audience"));
        assertEquals(0,notebook().find(first).getJSONArray("messages").length());
        assertEquals(0,notebook().find(first).getJSONArray("revisions").length());
        assertFalse(notebook().conversation(first).toString().contains("문 앞"));
        screenshot("android-reflection");
        onView(withText("대화로 돌아가기")).perform(click());app.recreate();
        onView(withText("생각 정리")).perform(scrollTo(),click());
        onView(withContentDescription("직접 본 것은 무엇인가요?")).check(matches(withText("손님이 문 앞에서 기다렸다")));
        onView(withContentDescription("해보니 무엇이 달랐나요?")).perform(scrollTo()).check(matches(withText("먼저 적은 배움")));
        onView(withText("대화로 돌아가기")).perform(click());
        draft("동네 가게 관찰");record();
        onView(withText("지금의 의도 정리하기")).perform(scrollTo(),click());
        onView(withContentDescription("의도 입력")).perform(replaceText("대기 시간을 줄인다"),closeSoftKeyboard());
        onView(withText("내 의도로 확인")).perform(click());
        onView(allOf(withText("기록"),not(withContentDescription("생각 기록")))).perform(click());
        onView(withContentDescription("기록 검색")).perform(replaceText("대기 시간"),closeSoftKeyboard());
        onView(withText("확인한 의도 · 대기 시간을 줄인다")).check(matches(isDisplayed()));
        screenshot("android-project-search");
        onView(withText("새 생각 기록하기")).perform(click());
        String second=notebook().projects().getJSONObject(0).getString("id");
        onView(withText("생각 정리")).perform(scrollTo(),click());
        onView(withContentDescription("직접 본 것은 무엇인가요?")).check(matches(withText("")));
        onView(withContentDescription("누구의 어떤 불편인가요?")).perform(scrollTo(),replaceText("버스를 기다리는 사람"),closeSoftKeyboard());
        assertEquals("손님이 문 앞에서 기다렸다",notebook().find(first).getJSONObject("reflection").getString("observation"));
        assertEquals("버스를 기다리는 사람",notebook().find(second).getJSONObject("reflection").getString("audience"));
        assertFalse(notebook().conversation(second).toString().contains("버스를"));
    }
    @Test public void failedReflectionSaveKeepsVisibleAndExportableTextUntilNextSave() throws Exception {
        begin();onView(withText("생각 정리")).perform(scrollTo(),click());
        onView(withContentDescription("직접 본 것은 무엇인가요?")).perform(scrollTo(),replaceText("저장된 관찰"),closeSoftKeyboard());
        File blocker=new File(context.getCacheDir(),"reflection-save-blocker");
        try(FileOutputStream output=new FileOutputStream(blocker)){output.write(1);}
        java.util.concurrent.atomic.AtomicReference<android.util.AtomicFile> original=new java.util.concurrent.atomic.AtomicReference<>();
        app.onActivity(activity->{try{
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("records");field.setAccessible(true);
            original.set((android.util.AtomicFile)field.get(activity));field.set(activity,new android.util.AtomicFile(new File(blocker,"notebook.json")));
        }catch(Exception e){throw new AssertionError(e);}});
        try {
            onView(withContentDescription("직접 본 것은 무엇인가요?")).perform(replaceText("저장 실패 후에도 지킬 관찰"),closeSoftKeyboard());
            onView(withContentDescription("직접 본 것은 무엇인가요?")).check(matches(withText("저장 실패 후에도 지킬 관찰")));
            assertEquals("저장된 관찰",notebook().projects().getJSONObject(0).getJSONObject("reflection").getString("observation"));
            app.onActivity(activity->{try{
                java.lang.reflect.Method method=MainActivity.class.getDeclaredMethod("exportBytes");method.setAccessible(true);
                StudioState exported=new StudioState(new String((byte[])method.invoke(activity),StandardCharsets.UTF_8));
                assertEquals("저장 실패 후에도 지킬 관찰",exported.projects().getJSONObject(0).getJSONObject("reflection").getString("observation"));
            }catch(Exception e){throw new AssertionError(e);}});
            onView(withText("대화로 돌아가기")).perform(click());
            onView(withText("생각 정리")).perform(scrollTo(),click());
            onView(withContentDescription("직접 본 것은 무엇인가요?")).check(matches(withText("저장 실패 후에도 지킬 관찰")));
        } finally {
            app.onActivity(activity->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("records");field.setAccessible(true);field.set(activity,original.get());}catch(Exception e){throw new AssertionError(e);}});
            Files.deleteIfExists(blocker.toPath());
        }
        onView(withContentDescription("누구의 어떤 불편인가요?")).perform(scrollTo(),replaceText("나중에 저장한 다른 항목"),closeSoftKeyboard());
        assertEquals("저장 실패 후에도 지킬 관찰",notebook().projects().getJSONObject(0).getJSONObject("reflection").getString("observation"));
        assertEquals("나중에 저장한 다른 항목",notebook().projects().getJSONObject(0).getJSONObject("reflection").getString("audience"));
    }
    @Test public void observationIntentDraftAndProjectsSurviveNativeRelaunch() throws Exception {
        begin(); draft("동네 가게에서 기다리는 사람이 많다"); record();
        onView(withText("지금의 의도 정리하기")).perform(scrollTo(),click());
        onView(withContentDescription("의도 입력")).perform(replaceText("가게 손님의 대기 시간을 줄이는 작은 실험을 한다"),closeSoftKeyboard());
        onView(withText("내 의도로 확인")).perform(click());
        draft("아직 전송하지 않은 질문");
        String first=notebook().projects().getJSONObject(0).getString("id");
        app.recreate();
        onView(withContentDescription("생각 입력")).check(matches(withText("아직 전송하지 않은 질문")));
        app.close(); app=ActivityScenario.launch(MainActivity.class);
        onView(withText("가게 손님의 대기 시간을 줄이는 작은 실험을 한다")).check(matches(isDisplayed()));
        onView(withContentDescription("생각 입력")).check(matches(withText("아직 전송하지 않은 질문")));
        screenshot("android-intent");
        onView(allOf(withText("기록"),not(withContentDescription("생각 기록")))).perform(click());
        onView(withText("새 생각 기록하기")).perform(click());
        draft("버스 시간을 확인하기 어렵다"); record();
        String second=notebook().projects().getJSONObject(0).getString("id");
        assertFalse(notebook().conversation(second).toString().contains("가게"));
        assertEquals(1,notebook().find(first).getJSONArray("revisions").length());
        onView(allOf(withText("기록"),not(withContentDescription("생각 기록")))).perform(click());
        onView(withText("동네 가게에서 기다리는 사람이 많다")).perform(click());
        onView(withContentDescription("생각 입력")).check(matches(withText("아직 전송하지 않은 질문")));
        screenshot("android-records");
    }
    @Test public void unavailableCapabilityFixtureStaysLocalAndNeverLaunchesExternalRecognizer() throws Exception {
        begin(); draft("먼저 적은 생각");
        screenshot("android-voice-disclosure");
        assertFalse(Intents.getIntents().stream().anyMatch(i -> RecognizerIntent.ACTION_RECOGNIZE_SPEECH.equals(i.getAction())));
        // The emulator advertises an engine but does not prove usable Korean ASR. Inject only the
        // capability boundary to exercise unavailable UI deterministically; never fake microphone input.
        app.onActivity(activity->{try{
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("voice");field.setAccessible(true);
            NativeVoice old=(NativeVoice)field.get(activity);
            java.lang.reflect.Field hostField=NativeVoice.class.getDeclaredField("host");hostField.setAccessible(true);
            NativeVoice.Host host=(NativeVoice.Host)hostField.get(old);old.close();
            field.set(activity,new NativeVoice(activity,host,()->false));
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withText("말로 적기")).perform(click());
        onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각")));
        onView(withText("이 기기는 한국어 기기 내 음성 인식을 사용할 수 없어요. 글로 계속 적을 수 있어요.")).perform(scrollTo()).check(matches(isDisplayed()));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        screenshot("android-voice-unavailable");
        app.recreate();onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각")));
        record();assertEquals(1,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
    }
    @Test public void nativePermissionDenialKeepsKeyboardUsable() throws Exception {
        begin();draft("마이크 없이도 남길 글");
        onView(withText("말로 적기")).perform(click());
        android.app.UiAutomation automation=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        android.accessibilityservice.AccessibilityServiceInfo info=automation.getServiceInfo();
        info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;automation.setServiceInfo(info);
        android.view.accessibility.AccessibilityNodeInfo deny=null;
        for(int attempt=0;attempt<30&&deny==null;attempt++){
            android.view.accessibility.AccessibilityNodeInfo root=automation.getRootInActiveWindow();
            if(root!=null){
                java.util.List<android.view.accessibility.AccessibilityNodeInfo> nodes=root.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/permission_deny_button");
                if(!nodes.isEmpty())deny=nodes.get(0);
            }
            if(deny==null)Thread.sleep(100);
        }
        assertNotNull("Expected the actual Android microphone permission dialog",deny);
        assertTrue(deny.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        onView(withContentDescription("생각 입력")).check(matches(withText("마이크 없이도 남길 글")));
        draft("거부 후에도 글로 계속한다");record();
        assertEquals(1,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
        screenshot("android-voice-native-permission-denied");
    }
    @Test public void deniedPermissionAndLateGrantDoNotResumeOrChangeDraft() throws Exception {
        begin();draft("권한과 무관하게 남을 글");
        app.onActivity(activity->{try{
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("voice");field.setAccessible(true);
            NativeVoice voice=(NativeVoice)field.get(activity);String id=notebook().projects().getJSONObject(0).getString("id");
            long ticket=voice.session.start(id,false);
            java.lang.reflect.Field ticketField=NativeVoice.class.getDeclaredField("permissionTicket");ticketField.setAccessible(true);ticketField.setLong(voice,ticket);
            java.lang.reflect.Field projectField=NativeVoice.class.getDeclaredField("permissionProject");projectField.setAccessible(true);projectField.set(voice,id);
            // Exercise the native callback path with denial; no real microphone or OS permission dialog claim.
            activity.onRequestPermissionsResult(NativeVoice.PERMISSION_REQUEST,new String[]{android.Manifest.permission.RECORD_AUDIO},new int[]{android.content.pm.PackageManager.PERMISSION_DENIED});
            assertFalse(voice.session.active());
            ticket=voice.session.start(id,true);ticketField.setLong(voice,ticket);projectField.set(voice,id);
            voice.stop();
            activity.onRequestPermissionsResult(NativeVoice.PERMISSION_REQUEST,new String[]{android.Manifest.permission.RECORD_AUDIO},new int[]{android.content.pm.PackageManager.PERMISSION_GRANTED});
            assertFalse(voice.session.active());
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("생각 입력")).check(matches(withText("권한과 무관하게 남을 글")));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        screenshot("android-voice-denied");
    }
    @Test public void transcribedDraftSurvivesBackgroundWithoutSending() throws Exception {
        begin();draft("먼저 적은 생각");
        final java.util.concurrent.atomic.AtomicReference<NativeVoice> controller=new java.util.concurrent.atomic.AtomicReference<>();
        final long[] oldTicket=new long[1];final String[] id=new String[1];
        app.onActivity(activity->{try{
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("voice");field.setAccessible(true);NativeVoice voice=(NativeVoice)field.get(activity);controller.set(voice);
            id[0]=notebook().projects().getJSONObject(0).getString("id");oldTicket[0]=voice.session.start(id[0],false);voice.session.beginListening(oldTicket[0],id[0]);
            java.lang.reflect.Field prefix=MainActivity.class.getDeclaredField("voicePrefix");prefix.setAccessible(true);prefix.set(activity,"먼저 적은 생각");
            java.lang.reflect.Method transcript=MainActivity.class.getDeclaredMethod("voiceTranscript",String.class,String.class,boolean.class,boolean.class);transcript.setAccessible(true);
            // Inject text only: this checks native persistence and lifecycle, not microphone recognition.
            transcript.invoke(activity,id[0],"아직 인식 중인 말",false,false);
        }catch(Exception e){throw new AssertionError(e);}});
        app.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
        assertFalse(controller.get().session.matches(oldTicket[0],id[0]));
        app.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
        onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각\n아직 인식 중인 말")));
        app.recreate();onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각\n아직 인식 중인 말")));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
    }

    @Test public void captureDisablesEditingAndReadyDraftCannotBeOverwritten() throws Exception {
        begin();draft("소중한 작성 중인 글");
        java.util.concurrent.atomic.AtomicReference<NativeVoice> voiceRef=new java.util.concurrent.atomic.AtomicReference<>();
        app.onActivity(activity->{try{
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("voice");field.setAccessible(true);NativeVoice voice=(NativeVoice)field.get(activity);voiceRef.set(voice);
            String id=notebook().projects().getJSONObject(0).getString("id");long ticket=voice.session.start(id,true);voice.session.beginListening(ticket,id);
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("render");render.setAccessible(true);render.invoke(activity);
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withContentDescription("생각 입력")).check(matches(not(isEnabled())));
        onView(withContentDescription("생각 기록")).check(matches(not(isEnabled())));
        app.onActivity(activity->{try{
            NativeVoice voice=voiceRef.get();long ticket=voice.session.ticket();String id=voice.session.project();
            voice.session.finish(ticket,id);voice.session.speak(ticket,id);voice.session.ready(ticket,id);
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("render");render.setAccessible(true);render.invoke(activity);
        }catch(Exception e){throw new AssertionError(e);}});
        onView(withText("다시 말하기")).check(doesNotExist());
        onView(withContentDescription("생각 입력")).check(matches(withText("소중한 작성 중인 글")));
        draft("소중한 작성 중인 글을 직접 고침");assertFalse(voiceRef.get().session.active());assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        // Editing a completed/read-aloud session also invalidates its callback identity before saving.
        app.onActivity(activity->{try{
            NativeVoice voice=voiceRef.get();String id=notebook().projects().getJSONObject(0).getString("id");long ticket=voice.session.start(id,true);
            voice.session.beginListening(ticket,id);voice.session.finish(ticket,id);voice.session.speak(ticket,id);voice.session.ready(ticket,id);
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("render");render.setAccessible(true);render.invoke(activity);
        }catch(Exception e){throw new AssertionError(e);}});
        draft("직접 고친 내 글");assertFalse(voiceRef.get().session.active());
        assertEquals("직접 고친 내 글",notebook().projects().getJSONObject(0).getString("draft"));
    }
    @Test public void cancelledSpeechPreservesLocalWorkWithoutAIControls() throws Exception {
        begin(); draft("지켜야 할 작성 중인 생각");
        VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));
        onView(withText("말로 적기")).perform(click());onView(withText("음성 멈추기")).perform(click());
        onView(withContentDescription("생각 입력")).check(matches(withText("지켜야 할 작성 중인 생각")));
        onView(withText("무료 AI 연결하고 질문 받기")).check(doesNotExist());
        onView(withText("음성 대화")).check(doesNotExist());
        app.recreate();
        onView(withContentDescription("생각 입력")).check(matches(withText("지켜야 할 작성 중인 생각")));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
    }
    @Test public void nativeDictationFinalStaysEditableAndAutomaticCaptureIsRefused() throws Exception {
        begin();VoiceFixture voice=new VoiceFixture();app.onActivity(a->voice.install(a));
        onView(withText("말로 적기")).perform(click());app.onActivity(a->{voice.partial("직접 고칠 말");voice.endpoint();voice.result("직접 고칠 최종 말");});
        onView(withContentDescription("생각 입력")).check(matches(withText("직접 고칠 최종 말")));
        assertFalse(voice.controller.session.active());assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        app.onActivity(a->voice.controller.start(true));
        assertFalse(voice.controller.session.active());
        draft("직접 고친 최종 말");record();
        assertEquals(1,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        assertEquals("직접 고친 최종 말",notebook().projects().getJSONObject(0).getJSONArray("messages").getJSONObject(0).getString("content"));
    }

    @Test public void priorNotebookEditsExportAndReturnsToSameQuestionWithoutCopyOrNetwork() throws Exception {
        app.close();app=null;
        File reflection=new File(context.getNoBackupFilesDir(),"reflection");
        if(reflection.isDirectory())for(File file:reflection.listFiles())Files.delete(file.toPath());
        ReflectionStorage storage=new ReflectionStorage(context);storage.saveGuestDraft("질문 화면에 남겨 둔 초안");
        String old="{\"version\":1,\"projects\":[{\"id\":\"old-project\",\"title\":\"예전 가게 관찰\",\"draft\":\"기기에 남긴 초안\",\"intentDraft\":\"아직 확인하지 않은 의도\",\"messages\":[{\"id\":\"old-user\",\"role\":\"user\",\"content\":\"손님이 문 앞에서 기다렸다\"},{\"id\":\"old-answer\",\"role\":\"assistant\",\"content\":\"예전에 받은 질문\"}],\"revisions\":[{\"revision\":1,\"author\":\"user\",\"text\":\"대기 시간을 줄인다\"}]},{\"id\":\"other-project\",\"title\":\"버스 기록\",\"draft\":\"버스 초안\",\"intentDraft\":\"\",\"messages\":[],\"revisions\":[],\"reflection\":{\"observation\":\"사람들이 정류장에 서 있었다\",\"audience\":\"승객\",\"change\":\"\",\"experiment\":\"\",\"learning\":\"\"}}]}";
        File file=new File(context.getFilesDir(),"studio-notebook-v1.json");Files.write(file.toPath(),old.getBytes(StandardCharsets.UTF_8));
        context.getSharedPreferences("installation",Context.MODE_PRIVATE).edit().putString("id","preserved-old-installation").commit();
        java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();
        QuestionActivity.testTransport=(path,body,bearer,cancel)->{calls.incrementAndGet();throw new java.io.IOException("No network in local notebook journey");};
        intending(hasAction(Intent.ACTION_CHOOSER)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null));
        try(ActivityScenario<QuestionActivity> question=ActivityScenario.launch(QuestionActivity.class)) {
            java.util.concurrent.atomic.AtomicReference<QuestionActivity> original=new java.util.concurrent.atomic.AtomicReference<>();question.onActivity(original::set);
            onView(withContentDescription("메뉴")).perform(click());onView(withText("기기 기록")).perform(click());
            onView(withText("기기 기록")).check(matches(isDisplayed()));
            onView(withContentDescription("생각 입력")).check(matches(withText("기기에 남긴 초안")));
            onView(withText("무료 AI 연결하고 질문 받기")).check(doesNotExist());onView(withText("음성 대화")).check(doesNotExist());
            assertArrayEquals(old.getBytes(StandardCharsets.UTF_8),Files.readAllBytes(file.toPath()));
            draft("편집한 기기 초안");
            onView(withText("생각 정리")).perform(scrollTo(),click());
            onView(withContentDescription("직접 본 것은 무엇인가요?")).perform(scrollTo(),replaceText("오래된 기록에 덧붙인 관찰"),closeSoftKeyboard());
            onView(withText("대화로 돌아가기")).perform(click());
            onView(allOf(withText("기록"),not(withContentDescription("생각 기록")))).perform(click());
            onView(withContentDescription("기록 검색")).perform(replaceText("대기 시간"),closeSoftKeyboard());
            onView(withText("확인한 의도 · 대기 시간을 줄인다")).check(matches(isDisplayed()));
            onView(withText("닫기")).perform(click());
            screenshot("android-local-records");
            onView(withText("메뉴")).perform(click());onView(withText("전체 기록 내보내기")).perform(click());
            Intent chooser=Intents.getIntents().stream().filter(i->Intent.ACTION_CHOOSER.equals(i.getAction())).reduce((a,b)->b).orElseThrow();
            Intent share=chooser.getParcelableExtra(Intent.EXTRA_INTENT);assertEquals(Intent.ACTION_SEND,share.getAction());assertEquals("application/json",share.getType());
            android.net.Uri uri=share.getParcelableExtra(Intent.EXTRA_STREAM);
            StudioState exported;try(java.io.InputStream input=context.getContentResolver().openInputStream(uri)){exported=new StudioState(new String(input.readAllBytes(),StandardCharsets.UTF_8));}
            assertEquals("편집한 기기 초안",exported.find("old-project").getString("draft"));
            assertEquals("아직 확인하지 않은 의도",exported.find("old-project").getString("intentDraft"));
            assertEquals("오래된 기록에 덧붙인 관찰",exported.find("old-project").getJSONObject("reflection").getString("observation"));
            assertEquals(2,exported.find("old-project").getJSONArray("messages").length());assertEquals(1,exported.find("old-project").getJSONArray("revisions").length());
            assertEquals("버스 초안",exported.find("other-project").getString("draft"));
            assertEquals("승객",exported.find("other-project").getJSONObject("reflection").getString("audience"));
            onView(withText("메뉴")).perform(click());onView(withText("나의 질문으로")).perform(click());
            onView(withContentDescription("질문 대화 입력")).check(matches(withText("질문 화면에 남겨 둔 초안")));
            question.onActivity(a->assertSame(original.get(),a));assertEquals(0,calls.get());assertNull(storage.loadCredentials());
            assertEquals("preserved-old-installation",context.getSharedPreferences("installation",Context.MODE_PRIVATE).getString("id",null));
            onView(withContentDescription("메뉴")).perform(click());onView(withText("기기 기록")).perform(click());
            onView(withContentDescription("생각 입력")).check(matches(withText("편집한 기기 초안")));
            androidx.test.espresso.Espresso.pressBack();
            onView(withContentDescription("질문 대화 입력")).check(matches(withText("질문 화면에 남겨 둔 초안")));assertEquals(0,calls.get());
        } finally {QuestionActivity.testTransport=null;}
    }

    @Test public void corruptNotebookExportsOriginalAndRecoveryPreservesBackup() throws Exception {
        app.close();app=null;byte[] original="{broken prior notebook".getBytes(StandardCharsets.UTF_8);
        File file=new File(context.getFilesDir(),"studio-notebook-v1.json");Files.write(file.toPath(),original);
        app=ActivityScenario.launch(MainActivity.class);
        onView(withText("첫 생각 기록하기")).check(matches(not(isEnabled())));
        intending(hasAction(Intent.ACTION_CHOOSER)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null));
        onView(withText("메뉴")).perform(click());onView(withText("읽지 못한 원본 내보내기")).perform(click());
        assertArrayEquals(original,Files.readAllBytes(new File(context.getCacheDir(),"exports/HP-Studio-recovery-original.json").toPath()));
        onView(withText("원본 보존 후 새로 시작")).perform(scrollTo(),click());
        onView(withId(android.R.id.button1)).perform(click());
        assertEquals(0,notebook().projects().length());
        assertTrue(java.util.Arrays.stream(context.getFilesDir().listFiles()).filter(f->f.getName().startsWith("recovery-")).anyMatch(f->{try{return java.util.Arrays.equals(original,Files.readAllBytes(f.toPath()));}catch(Exception e){return false;}}));
    }
}
