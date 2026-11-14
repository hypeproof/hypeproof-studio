package ai.hypeproof.studio;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import android.view.*;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.Espresso;
import androidx.test.espresso.base.DefaultFailureHandler;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.*;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;

/** Real Activity, gestures, layout and persisted cache; no live requests. */
@RunWith(AndroidJUnit4.class)
public class ConversationHistoryTest {
    private Context context;private ActivityScenario<QuestionActivity> app;private ReflectionStorage store;
    @Rule public final org.junit.rules.TestName testName=new org.junit.rules.TestName();
    private File failureDirectory;
    private Throwable firstFailure;
    private final JSONArray imeObservations=new JSONArray();

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
                        .put("decor_visible",activity.getWindow().getDecorView().getVisibility())
                        .put("ime",imeState(activity)).put("ime_observations",imeObservations);
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
            captureCommand("input-method.txt","timeout 3 dumpsys input_method",state);
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


    private final AtomicReference<JSONObject> reply=new AtomicReference<>();
    private final AtomicInteger posts=new AtomicInteger();
    private final AtomicBoolean delay=new AtomicBoolean();
    private final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
    private static String words(int i){return "대화 "+i+" · 그때 들었던 이야기를 다시 읽고 내가 할 수 있는 일을 생각했어요.";}
    private JSONObject snapshot(int first,int last,long revision)throws Exception{
        JSONArray messages=new JSONArray();for(int i=first;i<=last;i++)messages.put(new JSONObject().put("id","history-"+i).put("role",i%2==0?"user":"assistant").put("content",words(i)).put("created_at",1000+i));
        return new JSONObject().put("state",new JSONObject().put("id","personal-reflection").put("revision",revision).put("messages",messages).put("turn",JSONObject.NULL).put("has_earlier",first>0)).put("opening",ReflectionState.OPENING).put("hint",ReflectionState.HINT);
    }
    @Before public void setup()throws Exception{
        Assume.assumeTrue(Build.FINGERPRINT.contains("generic")||Build.MODEL.contains("sdk_gphone"));
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Espresso.setFailureHandler((error,matcher)->{
            captureFailure(error);
            ConversationHistoryTest.<RuntimeException>rethrowOriginal(error);
        });
        File dir=new File(context.getNoBackupFilesDir(),"reflection");if(dir.isDirectory())for(File f:Objects.requireNonNull(dir.listFiles()))Files.delete(f.toPath());
        store=new ReflectionStorage(context);store.saveCredentials(new NativeDeviceSignIn.Credentials("history-account","history-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));
        reply.set(snapshot(0,79,1));ReflectionState state=new ReflectionState("history-account");state.apply(reply.get());state.draft="지켜야 하는 초안";store.save(state);
        QuestionActivity.testTransport=(path,body,bearer,cancel)->{
            if(body!=null)posts.incrementAndGet();assertEquals("/me/reflection",path);
            if(delay.compareAndSet(true,false)){entered.countDown();assertTrue("controlled response released",release.await(10,TimeUnit.SECONDS));}
            JSONObject next=reply.get();return new NativeDeviceSignIn.Reply(200,Map.of("state",next.getJSONObject("state"),"opening",next.getString("opening"),"hint",next.getString("hint")));
        };
    }
    @After public void cleanup(){
        release.countDown();
        try {
            if(app!=null)app.close();
            if(failureDirectory!=null)try {
                writeFailureJson("after-teardown.json",new JSONObject().put("phase","after_teardown")
                    .put("elapsed_ms",SystemClock.elapsedRealtime()).put("scenario_state",app==null?"absent":app.getState().name()));
            }catch(Exception problem){Log.e("StudioFailureEvidence","Teardown evidence write failed: "+problem.getClass().getName());}
        } finally {
            QuestionActivity.testTransport=null;
            if(context!=null)Espresso.setFailureHandler(new DefaultFailureHandler(context));
        }
    }
    private void launch()throws Exception{app=ActivityScenario.launch(QuestionActivity.class);ready();}
    private void ready()throws Exception{
        for(int i=0;i<100;i++){AtomicBoolean busy=new AtomicBoolean();app.onActivity(a->{try{var field=QuestionActivity.class.getDeclaredField("model");field.setAccessible(true);busy.set(((ReflectionModel)field.get(a)).busy);}catch(Exception e){throw new AssertionError(e);}});if(!busy.get()){InstrumentationRegistry.getInstrumentation().waitForIdleSync();return;}Thread.sleep(50);}throw new AssertionError("response did not settle");
    }
    private JSONObject imeState(QuestionActivity activity)throws Exception{
        View decor=activity.getWindow().getDecorView();WindowInsets insets=decor.getRootWindowInsets();
        List<TextView> texts=new ArrayList<>();collect(decor,texts);
        TextView input=texts.stream().filter(v->"질문 대화 입력".contentEquals(v.getContentDescription()==null?"":v.getContentDescription())).findFirst().orElse(null);
        JSONObject state=new JSONObject().put("elapsed_ms",SystemClock.elapsedRealtime()).put("window_focus",activity.hasWindowFocus())
            .put("decor_layout_requested",decor.isLayoutRequested()).put("insets_present",insets!=null)
            .put("ime_visible",insets!=null&&insets.isVisible(WindowInsets.Type.ime()))
            .put("ime_bottom",insets==null?-1:insets.getInsets(WindowInsets.Type.ime()).bottom);
        View focus=activity.getCurrentFocus();state.put("focused_view",focus==null?JSONObject.NULL:focus.getClass().getName());
        if(input!=null){
            int[] xy=new int[2];input.getLocationOnScreen(xy);Rect visible=new Rect();boolean shown=input.getGlobalVisibleRect(visible);
            state.put("editor",new JSONObject().put("enabled",input.isEnabled()).put("focused",input.hasFocus())
                .put("window_focus",input.hasWindowFocus()).put("attached",input.isAttachedToWindow()).put("layout_requested",input.isLayoutRequested())
                .put("x",xy[0]).put("y",xy[1]).put("width",input.getWidth()).put("height",input.getHeight())
                .put("visible",shown).put("visible_bounds",visible.toShortString()).put("text_length",input.length()));
        }
        return state;
    }
    private void observeIme(String phase){
        app.onActivity(a->{try{imeObservations.put(imeState(a).put("phase",phase));}catch(Exception e){throw new AssertionError(e);}});
    }
    private void awaitIme()throws Exception{
        for(int i=0;i<100;i++){AtomicBoolean shown=new AtomicBoolean();app.onActivity(a->{WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();shown.set(insets!=null&&insets.isVisible(WindowInsets.Type.ime()));});if(shown.get()){InstrumentationRegistry.getInstrumentation().waitForIdleSync();observeIme("visible");return;}Thread.sleep(50);}
        AssertionError failure=new AssertionError("actual IME did not appear");captureFailure(failure);throw failure;
    }
    private void refresh(){onView(withContentDescription("메뉴")).perform(click());onView(withText("대화 다시 확인")).inRoot(isDialog()).perform(click());}
    private record Reading(String text,int y){}
    private void collect(View view,List<TextView> out){if(view instanceof TextView)out.add((TextView)view);if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)collect(((ViewGroup)view).getChildAt(i),out);}
    private Reading readingIn(View root){
        List<TextView> views=new ArrayList<>();collect(root,views);for(TextView v:views){Rect r=new Rect();if(v.getText().toString().startsWith("대화 ")&&v.getGlobalVisibleRect(r)&&r.height()==v.getHeight())return new Reading(v.getText().toString(),r.top);}throw new AssertionError("a full earlier message is visible");
    }
    private Reading reading(){AtomicReference<Reading> found=new AtomicReference<>();app.onActivity(a->found.set(readingIn(a.getWindow().getDecorView())));return found.get();}
    private android.widget.ScrollView scrollIn(View view){if(view instanceof android.widget.ScrollView)return (android.widget.ScrollView)view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){var found=scrollIn(((ViewGroup)view).getChildAt(i));if(found!=null)return found;}return null;}

    private void assertReading(Reading kept){onView(withText(kept.text())).check(matches(isDisplayed())).check((v,e)->{if(e!=null)throw e;int[] xy=new int[2];v.getLocationOnScreen(xy);assertTrue("same message stays at reading offset",Math.abs(xy[1]-kept.y())<=3*v.getResources().getDisplayMetrics().density);});}
    private void screenshot(String name)throws Exception{Bitmap b=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();assertNotNull(b);File dir=new File(context.getExternalFilesDir(null),"evidence");assertTrue(dir.isDirectory()||dir.mkdirs());try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){assertTrue(b.compress(Bitmap.CompressFormat.PNG,100,out));}b.recycle();}
    @Test public void opensAndReopensAtLatestWithoutLosingDraft()throws Exception{
        launch();onView(withText(words(79))).check(matches(isDisplayed()));onView(withContentDescription("질문 대화 입력")).check(matches(isCompletelyDisplayed())).check(matches(withText("지켜야 하는 초안")));
        onView(withContentDescription("대화 기록")).perform(swipeDown(),swipeDown());onView(withText("최신 메시지")).check(matches(isCompletelyDisplayed()));
        app.close();app=null;launch();onView(withText(words(79))).check(matches(isDisplayed()));assertEquals("지켜야 하는 초안",store.load("history-account").draft);assertEquals(0,posts.get());screenshot("android-history-reopened-latest");
    }
    @Test public void delayedRolloverKeepsEarlierReadingUntilExplicitLatest()throws Exception{
        launch();onView(withText(words(79))).check(matches(isDisplayed()));delay.set(true);refresh();assertTrue(entered.await(5,TimeUnit.SECONDS));
        onView(withContentDescription("대화 기록")).perform(swipeDown(),swipeDown(),swipeDown());Reading kept=reading();assertNotEquals(words(79),kept.text());
        reply.set(snapshot(2,81,2));release.countDown();ready();assertEquals(2,store.load("history-account").revision);assertEquals(80,store.load("history-account").messages.length());assertReading(kept);
        onView(withText("최신 메시지")).check(matches(isCompletelyDisplayed())).perform(click());onView(withText(words(81))).check(matches(isDisplayed()));
        reply.set(snapshot(4,83,3));refresh();ready();onView(withText(words(83))).check(matches(isDisplayed()));assertEquals("지켜야 하는 초안",store.load("history-account").draft);assertEquals(0,posts.get());screenshot("android-history-latest-follow");
    }
    @Test public void acknowledgedLongLocalWordsKeepTheirReadingAnchor()throws Exception{
        String words="길게 남겨 둔 미확인 생각을 다시 읽고 있어요.\n".repeat(60).trim();
        ReflectionState state=new ReflectionState("history-account");reply.set(snapshot(0,77,1));state.apply(reply.get());state.draft=words;state.enqueue();store.save(state);String id=state.request.getString("id");
        // Place this oversized row using actual viewport geometry; gestures are covered separately.
        launch();app.onActivity(a->{var scroll=scrollIn(a.getWindow().getDecorView());List<TextView> texts=new ArrayList<>();collect(scroll,texts);TextView original=texts.stream().filter(v->words.contentEquals(v.getText())).findFirst().orElseThrow();int[] xy=new int[2];original.getLocationOnScreen(xy);Rect viewport=new Rect();assertTrue(scroll.getGlobalVisibleRect(viewport));scroll.scrollTo(0,scroll.getScrollY()+xy[1]-viewport.top+original.getHeight()/2-viewport.height()/2);});InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        AtomicInteger y=new AtomicInteger();onView(withText(words)).check(matches(isDisplayed())).check((v,e)->{if(e!=null)throw e;int[] xy=new int[2];v.getLocationOnScreen(xy);y.set(xy[1]);android.widget.ScrollView scroll=scrollIn(v.getRootView());Rect viewport=new Rect();assertTrue(scroll.getGlobalVisibleRect(viewport));String geometry="textY="+xy[1]+" height="+v.getHeight()+" viewport="+viewport;assertTrue("long bubble exceeds viewport: "+geometry,v.getHeight()>2*viewport.height());assertTrue("reading inside long local bubble: "+geometry,xy[1]<viewport.top&&xy[1]+v.getHeight()>viewport.bottom);});
        onView(withText("최신 메시지")).check(matches(isCompletelyDisplayed()));
        JSONObject acknowledged=snapshot(0,77,2);acknowledged.getJSONObject("state").getJSONArray("messages").put(new JSONObject().put("id",id).put("role","user").put("content",words).put("created_at",2000));acknowledged.getJSONObject("state").put("turn",new JSONObject().put("id",id).put("text",words).put("status","pending").put("created_at",2000).put("updated_at",2001));reply.set(acknowledged);
        refresh();ready();assertEquals("pending",store.load("history-account").status());assertEquals(id,store.load("history-account").request.getString("id"));
        onView(withText(words)).check((v,e)->{if(e!=null)throw e;assertTrue("acknowledged words remain visible",v.getGlobalVisibleRect(new Rect()));int[] xy=new int[2];v.getLocationOnScreen(xy);assertTrue("acknowledged words keep the same reading offset",Math.abs(xy[1]-y.get())<=3*v.getResources().getDisplayMetrics().density);});
        assertEquals(0,posts.get());screenshot("android-history-acknowledged-anchor");
    }
    @Test public void queuedLayoutKeepsActualKeyboardScrollBeforeTraversal()throws Exception{
        launch();onView(withText(words(79))).check(matches(isDisplayed()));AtomicReference<Reading> moved=new AtomicReference<>();
        app.onActivity(a->{try{
            android.widget.ScrollView scroll=scrollIn(a.getWindow().getDecorView());assertNotNull(scroll);scroll.setSmoothScrollingEnabled(false);
            var field=QuestionActivity.class.getDeclaredField("model");field.setAccessible(true);
            // The real model save queues the Activity update/layout, then a platform key
            // moves the viewport in the same UI event before that traversal runs.
            ((ReflectionModel)field.get(a)).retrySave();int before=scroll.getScrollY();
            assertTrue(scroll.executeKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_PAGE_UP)));
            assertTrue("key moves earlier immediately",scroll.getScrollY()<before);moved.set(readingIn(a.getWindow().getDecorView()));
        }catch(Exception e){throw new AssertionError(e);}});
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertReading(moved.get());onView(withText("최신 메시지")).check(matches(isCompletelyDisplayed()));assertEquals(0,posts.get());screenshot("android-history-keyboard-scroll");
    }
    @Test public void latestActionAndDraftStayUsableAboveKeyboard()throws Exception{
        if(InstrumentationRegistry.getArguments().getString("largeDark", "false").equals("true")){assertTrue(context.getResources().getConfiguration().fontScale>=1.9f);assertEquals(android.content.res.Configuration.UI_MODE_NIGHT_YES,context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK);}
        launch();onView(withContentDescription("대화 기록")).perform(swipeDown(),swipeDown());
        String draft="키보드에서 쓰던 글\n둘째 줄";observeIme("before_replace_and_click");onView(withContentDescription("질문 대화 입력")).perform(replaceText(draft),click());observeIme("after_replace_and_click");awaitIme();
        onView(withText("최신 메시지")).check(matches(isCompletelyDisplayed())).check((v,e)->{if(e!=null)throw e;float d=v.getResources().getDisplayMetrics().density;assertTrue(v.getHeight()>=48*d);assertTrue(v.getWidth()>=48*d);assertTrue(v.createAccessibilityNodeInfo().isClickable());assertEquals("최신 메시지",v.createAccessibilityNodeInfo().getText().toString());});
        app.onActivity(a->{View decor=a.getWindow().getDecorView();WindowInsets insets=decor.getRootWindowInsets();assertNotNull(insets);assertTrue("actual IME is visible",insets.isVisible(WindowInsets.Type.ime()));});
        onView(withContentDescription("질문 대화 입력")).check(matches(isCompletelyDisplayed())).check(matches(withText(draft)));screenshot("android-history-keyboard");
        File diagnostic=new File(context.getExternalFilesDir(null),"evidence/ime-observations.json");
        Files.write(diagnostic.toPath(),imeObservations.toString(2).getBytes(StandardCharsets.UTF_8));
        onView(withText("최신 메시지")).perform(click());onView(withText(words(79))).check(matches(isDisplayed()));onView(withContentDescription("질문 대화 입력")).check(matches(withText(draft))).check(matches(hasFocus()));
        app.onActivity(a->{WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();assertTrue("Latest keeps actual IME visible",insets!=null&&insets.isVisible(WindowInsets.Type.ime()));});assertEquals(draft,store.load("history-account").draft);assertEquals(0,posts.get());
    }
}
