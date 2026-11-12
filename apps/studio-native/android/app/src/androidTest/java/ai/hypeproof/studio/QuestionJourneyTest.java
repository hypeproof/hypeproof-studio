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
    @Test public void sameAccountDraftAndVoiceConsentSurviveRecreationWithoutLiveNetwork()throws Exception{
        ReflectionStorage store=new ReflectionStorage(context);store.saveCredentials(new NativeDeviceSignIn.Credentials("test-account","test-session","synthetic-access","synthetic-refresh",System.currentTimeMillis()+3600000));ReflectionState state=new ReflectionState("test-account");state.draft="내가 더 듣고 싶은 이야기";store.save(state);
        app=ActivityScenario.launch(QuestionActivity.class);
        onView(withContentDescription("질문 대화 입력")).check(matches(withText("내가 더 듣고 싶은 이야기")));
        ready();onView(withText("말로 적기")).perform(click());onView(withText("취소")).perform(click());
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

}
