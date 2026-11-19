package ai.hypeproof.studio;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.espresso.Espresso;
import androidx.test.espresso.base.DefaultFailureHandler;
import java.nio.charset.StandardCharsets;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.*;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;

/** Real Activity / Keystore / AtomicFile; controlled Service contract, no live approval. */
@RunWith(AndroidJUnit4.class)
public class TeamEntryJourneyTest {
    private Context context;private ActivityScenario<QuestionActivity> app;private ReflectionStorage store;
    private final AtomicInteger reads=new AtomicInteger(),triggers=new AtomicInteger(),answers=new AtomicInteger(),decisions=new AtomicInteger(),turns=new AtomicInteger(),shown=new AtomicInteger();
    private final AtomicInteger consentWrites=new AtomicInteger();
    private final AtomicBoolean metricsGranted=new AtomicBoolean();
    private final AtomicBoolean capabilityUnavailable=new AtomicBoolean();
    private final JSONArray menuObservations=new JSONArray();
    private final java.util.List<String> metricTypes=new java.util.concurrent.CopyOnWriteArrayList<>();
    private final AtomicBoolean loseTrigger=new AtomicBoolean(),triggerCommitted=new AtomicBoolean();
    private final java.util.List<String> triggerIDs=new java.util.concurrent.CopyOnWriteArrayList<>();
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
        }catch(Throwable problem){Log.e("TeamFailureEvidence","Failure evidence capture failed: "+problem.getClass().getName());}
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


    @Before public void setup()throws Exception {
        Assume.assumeTrue(Build.FINGERPRINT.contains("generic")||Build.MODEL.contains("sdk_gphone"));
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Espresso.setFailureHandler((error,matcher)->{ captureFailure(error); TeamEntryJourneyTest.<RuntimeException>rethrowOriginal(error); });
        File dir=new File(context.getNoBackupFilesDir(),"reflection");if(dir.isDirectory())for(File f:Objects.requireNonNull(dir.listFiles()))Files.delete(f.toPath());
        store=new ReflectionStorage(context);store.saveCredentials(new NativeDeviceSignIn.Credentials("team-account","team-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));
        ReflectionState state=new ReflectionState("team-account");state.draft="아직 보내지 않은 내 생각";store.save(state);
        QuestionActivity.testTransport=(path,body,bearer,cancel)->{
            assertEquals("synthetic-access",bearer);
            if(path.equals("/me/product-events/consent")){
                if(capabilityUnavailable.get())return new NativeDeviceSignIn.Reply(404,Map.of("error","not_found"));
                if(body!=null){consentWrites.incrementAndGet();metricsGranted.set(Boolean.parseBoolean(body.get("granted")));return new NativeDeviceSignIn.Reply(200,Map.of("ok",true));}
                return new NativeDeviceSignIn.Reply(200,Map.of("schema","hps-product-consent/1","notice_version","team-ux/1","title","사용 경험 공유","notice","대화 원문 없이 사용 단계만 기록해요. 거절해도 질문과 승인은 그대로 사용할 수 있어요.","preference",new JSONObject().put("notice_version","team-ux/1").put("granted",metricsGranted.get()?1:0)));
            }
            if(path.equals("/me/product-events")){assertTrue(metricsGranted.get());JSONArray events=new JSONArray(body.get("events")),accepted=new JSONArray();for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);metricTypes.add(e.getString("type"));assertFalse(e.has("text"));assertFalse(e.has("token"));accepted.put(e.getString("id"));}return new NativeDeviceSignIn.Reply(200,Map.of("schema","hps-product-events/1","accepted",accepted,"deferred",new JSONArray(),"evidence_kind","client_observed"));}
            if(path.equals("/me"))return new NativeDeviceSignIn.Reply(200,Map.of("account_id","team-account","account_status","active","session_id","team-session","display_name","지윤"));
            if(path.equals("/me/reflection"))return new NativeDeviceSignIn.Reply(200,Map.of("state",new JSONObject().put("id","personal-reflection").put("revision",0).put("messages",new JSONArray()).put("turn",JSONObject.NULL).put("has_earlier",false),"opening",ReflectionState.OPENING,"hint",ReflectionState.HINT));
            if(path.equals("/me/approval-inbox"))return new NativeDeviceSignIn.Reply(200,Map.of("schema","hps-member-approval-inbox/1","availability","ready","cards",new JSONArray().put(approval())));
            if(path.equals("/me/cards?surface=mobile")){reads.incrementAndGet();return new NativeDeviceSignIn.Reply(200,Map.of("card",!triggerCommitted.get()?JSONObject.NULL:question().put("key","growth:fixture-"+triggers.get())));}
            if(path.equals("/me/question-triggers")){
                assertEquals("method",body.get("choice"));assertEquals(body.get("id"),body.get("source_id"));assertEquals("1",body.get("source_revision"));triggers.incrementAndGet();triggerIDs.add(body.get("id"));if(loseTrigger.get())return new NativeDeviceSignIn.Reply(503,Map.of("error","unavailable"));triggerCommitted.set(true);
                return new NativeDeviceSignIn.Reply(200,Map.of("schema","hps-question-trigger/1","key","growth:fixture","source",new JSONObject().put("kind","choice").put("id",body.get("id")).put("revision",1),"reentry",new JSONObject().put("method","GET").put("path","/v1/me/cards"),"model_calls",0,"policy","team-question/1","created",true));
            }
            if(path.endsWith("/shown")){shown.incrementAndGet();return new NativeDeviceSignIn.Reply(200,Map.of("ok",true));}
            if(path.endsWith("/answer")){assertTrue(triggerCommitted.getAndSet(false));assertEquals("next",body.get("choice"));assertEquals("mobile",body.get("surface"));answers.incrementAndGet();return new NativeDeviceSignIn.Reply(200,Map.of("ok",true,"thanks","다음 생각을 남겼어요"));}
            if(path.endsWith("/decisions"))decisions.incrementAndGet();if(path.equals("/me/reflection/turns"))turns.incrementAndGet();
            throw new IOException("No other Service effects in this fixture");
        };
    }
    @After public void cleanup(){
        try { if(app!=null)app.close(); }
        finally { QuestionActivity.testTransport=null;QuestionActivity.testMenuObservation=null;
            if(context!=null)Espresso.setFailureHandler(new DefaultFailureHandler(context)); }
    }
    private static NativeTeamModel team(QuestionActivity a){try{var f=QuestionActivity.class.getDeclaredField("team");f.setAccessible(true);return(NativeTeamModel)f.get(a);}catch(Exception e){throw new AssertionError(e);}}
    private void settled(java.util.function.Predicate<NativeTeamModel> predicate)throws Exception{
        settled("team model completion",predicate);
    }
    private void settled(String stage,java.util.function.Predicate<NativeTeamModel> predicate)throws Exception{
        AtomicBoolean ready=new AtomicBoolean();
        for(int i=0;i<120&&!ready.get();i++){app.onActivity(a->ready.set(predicate.test(team(a))));if(!ready.get())Thread.sleep(50);}
        if(ready.get())return;
        AtomicReference<String> snapshot=new AtomicReference<>("unavailable");
        try { app.onActivity(a->{
            NativeTeamModel t=team(a);NativeProductExperience e=experience(a);
            String accountState;try{var field=QuestionActivity.class.getDeclaredField("model");field.setAccessible(true);ReflectionModel m=(ReflectionModel)field.get(a);accountState=",accountBusy="+m.busy+",accountReadOnly="+m.readOnly+",hasCredentials="+(m.credentials!=null);}catch(Exception problem){accountState=",accountObservationError="+problem.getClass().getName();}
            snapshot.set("teamBusy="+t.busy+",canStart="+t.canStart+",hasQuestion="+(t.question!=null)
                +",answerConfirmed="+t.answerConfirmed+",hasWords="+!t.words.isEmpty()+",hasPendingChoice="+(t.pendingChoice!=null)
                +",answerMessage="+t.message.equals("다음 생각을 남겼어요")
                +",experienceAvailable="+e.available+",experienceBusy="+e.busy+",experienceGranted="+e.granted
                +",reads="+reads.get()+",triggers="+triggers.get()+",answers="+answers.get()
                +",shown="+shown.get()+",consentWrites="+consentWrites.get()+",metricCount="+metricTypes.size()+accountState);
        }); } catch(Throwable observation) { snapshot.set("observation_error="+observation.getClass().getName()); }
        AssertionError failure=new AssertionError("Actual team model completion: "+stage+"; "+snapshot.get());
        captureFailure(failure);throw failure;
    }
    private void screenshot(String name)throws Exception{Bitmap image=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();assertNotNull(image);File dir=new File(context.getExternalFilesDir(null),"evidence");assertTrue(dir.isDirectory()||dir.mkdirs());try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,out));}image.recycle();}
    @Test public void signedInGreetingOpensRealCardsAndKeepsConversationDraft()throws Exception{
        app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));
        onView(withText("안녕하세요, 지윤님.")).check(matches(isCompletelyDisplayed()));
        onView(withText("확인 요청")).check(matches(isCompletelyDisplayed())).perform(click());settled(t->!t.busy&&t.approvals.size()==1);
        onView(withText("새 질문을 바로 볼 수 있어요")).inRoot(isDialog()).check(matches(isDisplayed()));
        onView(withText("승인")).inRoot(isDialog()).check(matches(isEnabled()));assertEquals(0,decisions.get());screenshot("android-team-direct-approval");
        onView(withText("설명과 근거 aaaaaaa")).inRoot(isDialog()).perform(scrollTo(),click());
        onView(withText("정확한 버전\n"+"a".repeat(40))).inRoot(isDialog()).check(matches(isDisplayed()));
        onView(withText("닫기")).inRoot(isDialog()).perform(click());
        onView(withText("도착한 질문")).perform(click());settled(t->!t.busy&&t.canStart);assertEquals(0,triggers.get());
        onView(withText("방법이 막혔어요")).inRoot(isDialog()).perform(scrollTo(),click());settled(t->!t.busy&&t.question!=null);
        onView(withText("지금 바꿔 볼 작은 방법은 무엇인가요?")).inRoot(isDialog()).check(matches(isDisplayed()));assertEquals(1,triggers.get());assertEquals(0,answers.get());screenshot("android-team-question");
        onView(withText("한 가지 바꿔 볼게요")).inRoot(isDialog()).perform(scrollTo(),click());settled(t->!t.busy&&t.message.equals("다음 생각을 남겼어요"));assertEquals(1,answers.get());
        onView(withText("다음 질문 보기")).inRoot(isDialog()).check(matches(isDisplayed())).check(matches(isEnabled()));
        assertEquals(2,reads.get());assertEquals(1,triggers.get());assertEquals(1,answers.get());screenshot("android-team-answer-next-action");
        onView(withText("다음 질문 보기")).inRoot(isDialog()).perform(scrollTo(),click());settled(t->!t.busy&&t.canStart);
        onView(withText("방법이 막혔어요")).inRoot(isDialog()).check(matches(isDisplayed()));
        assertEquals(3,reads.get());assertEquals(1,triggers.get());assertEquals(1,answers.get());screenshot("android-team-next-question-empty-choices");
        onView(withText("닫기")).inRoot(isDialog()).perform(click());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("아직 보내지 않은 내 생각")));
        assertEquals(0,turns.get());assertEquals(0,decisions.get());assertEquals("아직 보내지 않은 내 생각",store.load("team-account").draft);
        app.close();app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));assertEquals(1,triggers.get());assertEquals(1,answers.get());assertEquals(0,turns.get());
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("아직 보내지 않은 내 생각")));screenshot("android-team-greeting-restored");
    }
    @Test public void lostStartingChoiceRetainsIntentAcrossRelaunchAndDoesNotOverwriteDraft()throws Exception{
        loseTrigger.set(true);app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));
        onView(withText("도착한 질문")).perform(click());settled(t->!t.busy&&t.canStart);
        onView(withText("방법이 막혔어요")).inRoot(isDialog()).perform(scrollTo(),click());settled(t->!t.busy&&t.message.contains("자동으로 다시 요청하지 않아요"));
        String id=store.loadQuestionIntent("team-account").getString("id");assertEquals(1,triggers.get());assertEquals(id,triggerIDs.get(0));
        app.close();app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));
        onView(withText("도착한 질문")).perform(click());settled(t->!t.busy&&t.canStart&&"method".equals(t.pendingChoice));
        onView(withText("목표를 정리하고 싶어요")).inRoot(isDialog()).check(matches(isNotEnabled()));assertEquals(1,triggers.get());screenshot("android-team-pending-choice");
        loseTrigger.set(false);onView(withText("방법이 막혔어요")).inRoot(isDialog()).perform(scrollTo(),click());settled(t->!t.busy&&t.question!=null);
        assertEquals(2,triggers.get());assertEquals(id,triggerIDs.get(1));assertNull(store.loadQuestionIntent("team-account"));assertEquals(0,answers.get());assertEquals(0,turns.get());assertEquals(0,decisions.get());
        assertEquals("아직 보내지 않은 내 생각",store.load("team-account").draft);
    }
    private static NativeProductExperience experience(QuestionActivity a){try{var f=QuestionActivity.class.getDeclaredField("experience");f.setAccessible(true);return(NativeProductExperience)f.get(a);}catch(Exception e){throw new AssertionError(e);}}
    private void experienceSettled(java.util.function.Predicate<NativeProductExperience> predicate)throws Exception{
        long end=System.currentTimeMillis()+5000;AtomicBoolean ready=new AtomicBoolean();while(System.currentTimeMillis()<end){app.onActivity(a->ready.set(predicate.test(experience(a))));if(ready.get())return;Thread.sleep(25);}AtomicReference<String> state=new AtomicReference<>();app.onActivity(a->{NativeProductExperience e=experience(a);state.set("available="+e.available+",busy="+e.busy+",granted="+e.granted+",status="+e.status+",writes="+consentWrites.get());});throw new AssertionError("Experience state did not settle: "+state.get());
    }
    @Test public void explicitExperienceConsentObservesQuestionAndDeclineKeepsItUsable()throws Exception{
        app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));experienceSettled(e->e.available&&!e.busy);assertTrue(metricTypes.isEmpty());
        selectMenu("사용 경험 공유 설정");experienceSettled(e->e.available&&!e.busy);
        onView(withText("동의하고 공유하기")).inRoot(isDialog()).perform(scrollTo(),click());experienceSettled(e->e.granted&&!e.busy);assertEquals(1,consentWrites.get());screenshot("android-team-experience-consent");onView(withText("닫기")).inRoot(isDialog()).perform(click());
        onView(withText("도착한 질문")).perform(click());settled("consent-granted/starting-choice",t->!t.busy&&t.canStart);onView(withText("방법이 막혔어요")).inRoot(isDialog()).perform(scrollTo(),click());settled("consent-granted/question-loaded",t->!t.busy&&t.question!=null);onView(withText("한 가지 바꿔 볼게요")).inRoot(isDialog()).perform(scrollTo(),click());settled("consent-granted/answer-received",t->!t.busy&&t.message.equals("다음 생각을 남겼어요"));onView(withText("닫기")).inRoot(isDialog()).perform(click());
        // Explicitly reopening settings flushes the already-persisted answer, without a product replay.
        selectMenu("사용 경험 공유 설정");experienceSettled(e->!e.busy&&metricTypes.contains("question.answered"));assertTrue(metricTypes.contains("question.presented"));assertEquals(1,answers.get());
        onView(withText("공유하지 않기")).inRoot(isDialog()).perform(scrollTo(),click());experienceSettled(e->!e.busy&&!e.granted);int before=metricTypes.size();onView(withText("닫기")).inRoot(isDialog()).perform(click());
        onView(withText("도착한 질문")).perform(click());settled("consent-declined/starting-choice",t->!t.busy&&t.canStart);onView(withText("방법이 막혔어요")).inRoot(isDialog()).perform(scrollTo(),click());settled("consent-declined/question-loaded",t->!t.busy&&t.question!=null);onView(withText("한 가지 바꿔 볼게요")).inRoot(isDialog()).perform(scrollTo(),click());settled("consent-declined/answer-received",t->!t.busy&&t.message.equals("다음 생각을 남겼어요"));assertEquals(2,answers.get());assertEquals(before,metricTypes.size());assertEquals(0,turns.get());assertEquals(0,decisions.get());assertEquals("아직 보내지 않은 내 생각",store.load("team-account").draft);
    }
    private void selectMenu(String title)throws Exception {
        boolean observe=Boolean.parseBoolean(InstrumentationRegistry.getArguments().getString("observeTeamMenu","false"));
        if(observe){
        QuestionActivity.testMenuObservation=value->{if(menuObservations.length()<40)menuObservations.put(value);};
        onView(withContentDescription("메뉴")).perform(new androidx.test.espresso.ViewAction(){
            public org.hamcrest.Matcher<android.view.View> getConstraints(){return isDisplayed();}
            public String getDescription(){return "observe the one actual menu touch without changing its listener";}
            public void perform(androidx.test.espresso.UiController ui,android.view.View view){
                observeMenu("before",view);view.setOnTouchListener((v,event)->{if(event.getActionMasked()==android.view.MotionEvent.ACTION_DOWN||event.getActionMasked()==android.view.MotionEvent.ACTION_UP)observeMenu(event.getActionMasked()==0?"down":"up",v);return false;});
                click().perform(ui,view);view.setOnTouchListener(null);
            }
        });
        }else onView(withContentDescription("메뉴")).perform(click());
        long deadline=System.currentTimeMillis()+5000;boolean visible=false;
        while(System.currentTimeMillis()<deadline){android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null){visible=!root.findAccessibilityNodeInfosByText(title).isEmpty();root.recycle();}if(visible)break;Thread.sleep(25);}
        if(observe)writeMenuObservations();
        if(!visible){screenshot("android-team-menu-missing");throw new AssertionError("One menu tap did not expose its actual dialog within 5 seconds: "+title);}
        onView(withText(title)).inRoot(isDialog()).perform(click());
    }
    private void observeMenu(String phase,android.view.View view){
        try{android.graphics.Rect bounds=new android.graphics.Rect();view.getGlobalVisibleRect(bounds);if(menuObservations.length()<40)menuObservations.put(new JSONObject().put("phase",phase).put("elapsed_ms",android.os.SystemClock.elapsedRealtime()).put("attached",view.isAttachedToWindow()).put("focused",view.hasWindowFocus()).put("bounds",bounds.toShortString()));}catch(Exception e){throw new AssertionError(e);}
    }
    private void writeMenuObservations()throws Exception{File dir=new File(context.getExternalFilesDir(null),"evidence");assertTrue(dir.isDirectory()||dir.mkdirs());Files.write(new File(dir,"android-team-menu-observations.json").toPath(),menuObservations.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    @Test public void missingTeamCapabilityHidesOnlyStartingChoicesAndPreservesDraft()throws Exception{
        capabilityUnavailable.set(true);app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));experienceSettled(e->!e.busy&&!e.available);
        onView(withText("도착한 질문")).perform(click());settled(t->!t.busy&&t.question==null&&!t.canStart);
        onView(withText("방법이 막혔어요")).check(doesNotExist());onView(withText("지금 도착한 질문이 없어요.")).inRoot(isDialog()).check(matches(isDisplayed()));
        app.onActivity(a->team(a).begin(new NativeDeviceSignIn.Credentials("team-account","team-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000),"method"));
        assertEquals(0,triggers.get());onView(withText("닫기")).inRoot(isDialog()).perform(click());onView(withContentDescription("질문 대화 입력")).check(matches(withText("아직 보내지 않은 내 생각")));assertEquals(0,turns.get());assertEquals(0,consentWrites.get());
    }
    @Test public void unconfiguredNotificationsStayDisabledWithoutBlockingQuestions()throws Exception {
        app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));assertFalse(StudioMessagingService.configured(context));
        selectMenu("질문 알림 설정");
        onView(withText("알림 켜기")).inRoot(isDialog()).check(matches(isDisplayed())).check(matches(isNotEnabled()));
        onView(withText("이 버전은 알림 연결이 아직 준비되지 않았어요. 질문과 확인 요청에서 직접 확인할 수 있어요.")).inRoot(isDialog()).check(matches(isDisplayed()));
        assertFalse(store.loadPush().getBoolean("enabled"));screenshot("android-team-push-unconfigured");onView(withText("닫기")).inRoot(isDialog()).perform(click());
        onView(withText("도착한 질문")).perform(click());settled(t->!t.busy&&t.canStart);onView(withText("방법이 막혔어요")).inRoot(isDialog()).check(matches(isEnabled()));
        assertEquals(0,triggers.get());assertEquals(0,turns.get());assertEquals(0,decisions.get());assertTrue(metricTypes.isEmpty());assertEquals("아직 보내지 않은 내 생각",store.load("team-account").draft);
    }
    private static android.view.View view(QuestionActivity a,String name){try{var f=QuestionActivity.class.getDeclaredField(name);f.setAccessible(true);return(android.view.View)f.get(a);}catch(Exception e){throw new AssertionError(e);}}
    private static android.graphics.Rect rect(android.view.View v){int[] xy=new int[2];v.getLocationOnScreen(xy);return new android.graphics.Rect(xy[0],xy[1],xy[0]+v.getWidth(),xy[1]+v.getHeight());}
    @Test public void emptyGreetingKeepsOpeningNearEntryAndComposerAboveKeyboard()throws Exception{
        app=ActivityScenario.launch(QuestionActivity.class);settled(t->t.displayName.equals("지윤"));
        AtomicReference<JSONObject> geometry=new AtomicReference<>();AtomicReference<String> suffix=new AtomicReference<>();
        app.onActivity(a->{try{
            android.view.View heading=view(a,"heading"),entry=view(a,"teamEntry"),composer=view(a,"composer");android.graphics.Rect title=rect(heading),above=rect(entry),input=rect(composer),visible=new android.graphics.Rect();float density=a.getResources().getDisplayMetrics().density;
            assertEquals(android.view.View.VISIBLE,entry.getVisibility());assertTrue("Opening must follow the greeting, not sit at the bottom of empty history",title.top>=above.bottom&&title.top-above.bottom<=64*density);assertTrue(heading.getGlobalVisibleRect(visible));assertEquals(title,visible);assertTrue(title.bottom<input.top);
            suffix.set(a.getResources().getConfiguration().fontScale>=1.9f?"large-dark":"normal");geometry.set(new JSONObject().put("font_scale",a.getResources().getConfiguration().fontScale).put("night",a.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK).put("opening",title.toShortString()).put("entry",above.toShortString()).put("composer",input.toShortString()));
        }catch(Exception e){throw new AssertionError(e);}});
        screenshot("android-team-empty-"+suffix.get());
        onView(withContentDescription("질문 대화 입력")).perform(click());
        AtomicBoolean ime=new AtomicBoolean();long end=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<end){app.onActivity(a->{android.view.WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();ime.set(insets!=null&&insets.isVisible(android.view.WindowInsets.Type.ime())&&view(a,"composer").hasFocus());});if(ime.get())break;Thread.sleep(25);}assertTrue("Actual IME and editor focus must be present",ime.get());
        onView(withContentDescription("질문 대화 입력")).check(matches(isCompletelyDisplayed())).check(matches(withText("아직 보내지 않은 내 생각")));onView(withText("보내기")).check(matches(isCompletelyDisplayed()));
        app.onActivity(a->{try{
            android.view.View decor=a.getWindow().getDecorView(),composer=view(a,"composer"),send=view(a,"send"),heading=view(a,"heading");android.view.WindowInsets insets=decor.getRootWindowInsets();android.graphics.Rect window=rect(decor),input=rect(composer),button=rect(send),title=rect(heading),visible=new android.graphics.Rect();int imeTop=window.bottom-insets.getInsets(android.view.WindowInsets.Type.ime()).bottom;
            assertTrue(composer.hasFocus());assertTrue(input.bottom<=imeTop);assertTrue(button.bottom<=imeTop);assertTrue(heading.getGlobalVisibleRect(visible));assertEquals(title,visible);assertEquals(android.view.View.GONE,view(a,"teamEntry").getVisibility());
            geometry.get().put("ime_top",imeTop).put("focused",true).put("keyboard_opening",title.toShortString()).put("keyboard_composer",input.toShortString()).put("keyboard_send",button.toShortString());
        }catch(Exception e){throw new AssertionError(e);}});
        screenshot("android-team-empty-keyboard-"+suffix.get());File evidence=new File(context.getExternalFilesDir(null),"evidence");assertTrue(evidence.isDirectory()||evidence.mkdirs());Files.write(new File(evidence,"android-team-empty-"+suffix.get()+".json").toPath(),geometry.get().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(0,turns.get());assertEquals(0,triggers.get());assertEquals("아직 보내지 않은 내 생각",store.load("team-account").draft);
    }
    private static JSONObject question()throws Exception{return new JSONObject().put("schema","hps-card/1").put("key","growth:fixture").put("kind","team:choice").put("attempt",1).put("expires_at",System.currentTimeMillis()+60000).put("prompt","지금 바꿔 볼 작은 방법은 무엇인가요?").put("segments",new JSONArray()).put("choices",new JSONArray().put(new JSONObject().put("id","next").put("label","한 가지 바꿔 볼게요"))).put("select","tap").put("text",JSONObject.NULL).put("actions",new JSONArray()).put("skip","나중에");}
    private static JSONObject approval()throws Exception{long now=System.currentTimeMillis()/1000;return new JSONObject().put("id","review-fixture").put("request_digest","d".repeat(64)).put("source",new JSONObject().put("repo","hypeproof/hypeproof-studio").put("pr",4111).put("head","a".repeat(40)).put("base","b".repeat(40)).put("policy_digest","c".repeat(64)).put("evidence_digest","e".repeat(64)).put("context_digest","f".repeat(64))).put("reviewer","synthetic-reviewer").put("brief",new JSONObject().put("authored",new JSONArray().put("summary: 새 질문을 바로 볼 수 있어요")).put("verified",new JSONArray().put("실제 기기 검증 전"))).put("state","pending").put("created_at",now-10).put("expires_at",now+600).put("lease_expires_at",now+50).put("can_decide",true).put("unavailable_reason",JSONObject.NULL).put("decision",JSONObject.NULL).put("review",JSONObject.NULL);}
}
