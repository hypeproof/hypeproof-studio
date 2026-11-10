package ai.hypeproof.studio;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
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

    @Before public void start() throws Exception {
        Assume.assumeTrue("Use a disposable emulator, not a person's phone",
            Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("sdk_gphone"));
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String name:new String[]{"studio-notebook-v1.json","studio-notebook-v1.json.bak","studio-notebook-v1.json.new"})
            Files.deleteIfExists(new File(context.getFilesDir(),name).toPath());
        Intents.init();
        app=ActivityScenario.launch(MainActivity.class);
    }
    @After public void stop() {
        if (app!=null) app.close();
        if (context!=null) Intents.release();
    }
    private StudioState notebook() throws Exception {
        return new StudioState(new String(Files.readAllBytes(new File(context.getFilesDir(),"studio-notebook-v1.json").toPath()),StandardCharsets.UTF_8));
    }
    private void begin() { onView(withText("첫 생각 기록하기")).perform(click()); }
    private void draft(String value) { onView(withContentDescription("생각 입력")).perform(replaceText(value),closeSoftKeyboard()); }
    private void record() { onView(withContentDescription("생각 기록 또는 보내기")).perform(click()); }
    private void screenshot(String name) throws Exception {
        Bitmap pixels=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(pixels);
        File directory=new File(context.getExternalFilesDir(null),"evidence");
        assertTrue(directory.isDirectory()||directory.mkdirs());
        try (FileOutputStream out=new FileOutputStream(new File(directory,name+".png"))) { assertTrue(pixels.compress(Bitmap.CompressFormat.PNG,100,out)); }
        pixels.recycle();
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
        onView(allOf(withText("기록"),not(withContentDescription("생각 기록 또는 보내기")))).perform(click());
        onView(withText("새 생각 기록하기")).perform(click());
        draft("버스 시간을 확인하기 어렵다"); record();
        String second=notebook().projects().getJSONObject(0).getString("id");
        assertFalse(notebook().conversation(second).toString().contains("가게"));
        assertEquals(1,notebook().find(first).getJSONArray("revisions").length());
        onView(allOf(withText("기록"),not(withContentDescription("생각 기록 또는 보내기")))).perform(click());
        onView(withText("동네 가게에서 기다리는 사람이 많다")).perform(click());
        onView(withContentDescription("생각 입력")).check(matches(withText("아직 전송하지 않은 질문")));
        screenshot("android-records");
    }
    @Test public void speechRequiresDisclosureAndLeavesEditableUnsentDraft() throws Exception {
        begin(); draft("먼저 적은 생각");
        Intent result=new Intent().putStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS,new ArrayList<>(List.of("말로 덧붙인 관찰")));
        intending(hasAction(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_OK,result));
        onView(withText("말로 적기")).perform(click());
        onView(withText("취소")).perform(click());
        assertFalse(Intents.getIntents().stream().anyMatch(i -> RecognizerIntent.ACTION_RECOGNIZE_SPEECH.equals(i.getAction())));
        onView(withText("말로 적기")).perform(click());
        screenshot("android-voice-disclosure");
        onView(withText("음성 입력 시작")).perform(click());
        intended(allOf(hasAction(RecognizerIntent.ACTION_RECOGNIZE_SPEECH),hasExtra(RecognizerIntent.EXTRA_LANGUAGE,"ko-KR")));
        onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각\n말로 덧붙인 관찰")));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("revisions").length());
        app.recreate();
        onView(withContentDescription("생각 입력")).check(matches(withText("먼저 적은 생각\n말로 덧붙인 관찰")));
        screenshot("android-voice-draft");
        record();
        assertEquals(1,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
    }
    @Test public void cancelledSpeechAndUnconfirmedAIConsentPreserveLocalWork() throws Exception {
        begin(); draft("지켜야 할 작성 중인 생각");
        intending(hasAction(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null));
        onView(withText("말로 적기")).perform(click()); onView(withText("음성 입력 시작")).perform(click());
        onView(withContentDescription("생각 입력")).check(matches(withText("지켜야 할 작성 중인 생각")));
        onView(withText("무료 AI 연결하고 질문 받기")).perform(click());
        onView(withText("동의하고 연결")).check(matches(not(isEnabled())));
        onView(withText("만 14세 이상이에요")).perform(click());
        onView(withText("동의하고 연결")).check(matches(not(isEnabled())));
        onView(withText("위 내용의 AI 전송에 동의해요")).perform(click());
        onView(withText("동의하고 연결")).check(matches(isEnabled()));
        onView(withText("닫기")).perform(click());
        app.recreate();
        onView(withContentDescription("생각 입력")).check(matches(withText("지켜야 할 작성 중인 생각")));
        assertEquals(0,notebook().projects().getJSONObject(0).getJSONArray("messages").length());
    }
}
