package ai.hypeproof.companion;

import android.app.Activity;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.file.Files;
import static org.junit.Assert.*;

/** Synthetic seed through the real authenticated broker; subsequent read/cancel/erase uses UI clicks. */
@RunWith(AndroidJUnit4.class)
public final class AuthenticatedDraftUiTest {
 private static final String PKG="ai.hypeproof.companion.debug",TEXT="한글 초안 · authenticated cold reopen",URL="https://appassets.androidplatform.net/assets/ui/index.html";
 private final android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
 private final UiDevice device=UiDevice.getInstance(instrumentation);
 private Context context(){Context c=instrumentation.getTargetContext();assertEquals(PKG,c.getPackageName());assertEquals(c.getApplicationInfo().uid,Process.myUid());assertTrue((c.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);assertFalse((c.getApplicationInfo().flags&ApplicationInfo.FLAG_ALLOW_BACKUP)!=0);return c;}
 private String argument(String key){String value=InstrumentationRegistry.getArguments().getString(key);assertNotNull(value);return value;}
 private File directory()throws Exception{File base=context().getNoBackupFilesDir(),dir=new File(base,"companion-draft");assertEquals(base.getCanonicalFile(),dir.getCanonicalFile().getParentFile());assertFalse(Files.isSymbolicLink(dir.toPath()));return dir;}
 private File record()throws Exception{return new File(directory(),"draft-"+NativeDraftRecord.hash(argument("hps_service")+"\n"+argument("hps_account"))+".json");}
 private UiObject2 text(String label){UiObject2 object=device.wait(Until.findObject(By.pkg(PKG).text(label)),10000);assertNotNull("actual owned UI text required",object);java.util.List<UiObject2> matches=device.findObjects(By.pkg(PKG).text(label));assertEquals("unique owned UI text required",1,matches.size());return matches.get(0);}
 private void click(String label){UiObject2 object=text(label);assertTrue(object.isEnabled());assertTrue(object.isClickable());object.click();}
 private WebView web(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView found=web(group.getChildAt(i));if(found!=null)return found;}}return null;}
 private NativeDraftBroker broker(Activity activity)throws Exception{
  // Read only the existing broker reference, never credentials, verified/session fields or a replacement guard.
  Field field=MainActivity.class.getDeclaredField("draftBroker");field.setAccessible(true);Object[] value={null};instrumentation.runOnMainSync(()->{try{synchronized(activity){value[0]=field.get(activity);}}catch(IllegalAccessException e){throw new AssertionError(e);}});return (NativeDraftBroker)value[0];
 }
 private Activity login()throws Exception{
  assertTrue(argument("hps_run").matches("[a-f0-9]{32}"));assertTrue(argument("hps_account").matches("[A-Za-z0-9_-]{1,128}"));
  assertNotNull(NativeDeviceSignIn.Target.debugLoopback(true,argument("hps_service")));
  Activity activity=instrumentation.startActivitySync(new Intent(context(),DeviceSignInFixtureActivity.class).putExtra("serviceUrl",argument("hps_service")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  click("개인계정 로그인");
  long deadline=SystemClock.elapsedRealtime()+60000;boolean[] ready={false};
  while(SystemClock.elapsedRealtime()<deadline){instrumentation.runOnMainSync(()->{WebView view=web(activity.getWindow().getDecorView());ready[0]=!activity.isDestroyed()&&view!=null&&URL.equals(view.getUrl());});if(ready[0])break;Thread.sleep(100);}
  assertTrue("real native start/poll/me must load trusted assets",ready[0]);
  // Native auth may have opened a browser. Reorder this exact existing Activity once; never re-provision it.
  instrumentation.runOnMainSync(()->activity.startActivity(new Intent(activity,DeviceSignInFixtureActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
  click("기기 연결 확인");
  deadline=SystemClock.elapsedRealtime()+10000;
  while(SystemClock.elapsedRealtime()<deadline&&broker(activity)==null)Thread.sleep(100);
  assertNotNull("actual identity UI must create guarded broker",broker(activity));
  return activity;
 }
 private JSONObject selection()throws Exception{return new JSONObject().put("schema","hps-companion-host-request/1").put("requestId","synthetic-preview").put("actorId",argument("hps_account")).put("deviceId","synthetic-device").put("hostId","synthetic-host").put("workspaceId","workspace").put("projectId","project").put("taskId","task").put("version",1).put("epoch",0).put("consentRevision",1).put("artifactId","html").put("artifactVersion","a".repeat(64)).put("operation","preview.read");}
 private void screenshot(String name)throws Exception{assertTrue(name.equals("readback")||name.equals("cancel"));File base=new File(context().getFilesDir(),"hosted-ui-"+argument("hps_run"));assertFalse(Files.isSymbolicLink(base.toPath()));assertTrue(base.isDirectory()||base.mkdir());File output=new File(base,name+".png");assertFalse(output.exists());assertTrue(device.takeScreenshot(output));}
 private void hold(String phase)throws Exception{
  Bundle b=new Bundle();b.putString("hps_phase",phase);b.putString("hps_run",argument("hps_run"));b.putInt("hps_pid",Process.myPid());b.putInt("hps_uid",Process.myUid());b.putString("hps_process",android.app.Application.getProcessName());b.putString("hps_data_dir",context().getDataDir().getCanonicalPath());b.putString("hps_namespace",directory().getCanonicalPath());b.putString("hps_package",PKG);b.putString("hps_scope","authenticated_synthetic_draft_ui_only");instrumentation.sendStatus(0,b);Thread.sleep(30000);fail("owned external force-stop required");
 }
 @Test public void seed()throws Exception{
  assertFalse("fresh slot only",directory().exists());Activity activity=login();NativeDraftBroker broker=broker(activity);
  JSONObject empty=broker.request(new JSONObject().put("id","synthetic-seed-read").put("kind","draft.read"));assertEquals("empty",empty.getString("state"));
  JSONObject saved=broker.request(new JSONObject().put("id","synthetic-seed-write").put("kind","draft.replace").put("generation",empty.get("generation")).put("expectedVersion",empty.get("version")).put("value",new JSONObject().put("phase","editing").put("selection",selection()).put("text",TEXT)));
  assertEquals(TEXT,saved.getJSONObject("record").getString("text"));assertEquals(argument("hps_account"),saved.getJSONObject("record").getString("accountId"));assertEquals(argument("hps_service"),saved.getJSONObject("record").getString("service"));assertTrue(record().isFile());hold("ui_seed_ready");
 }
 @Test public void erase()throws Exception{
  assertTrue(record().isFile());byte[] before=Files.readAllBytes(record().toPath());Activity activity=login();
  text("이 기기에 남은 요청");text(TEXT);text("아직 현재 작업에 적용하지 않았어요.");text("원래 작업: synthetic-host / workspace / project / task / html (작업 버전 1, 파일 "+"a".repeat(64)+", 연결 세대 0, 동의 버전 1)");assertFalse(text("현재 선택으로 초안 옮기기").isEnabled());
  assertArrayEquals(before,Files.readAllBytes(record().toPath()));screenshot("readback");click("이 기기의 초안 기록 지우기");text("기기 기록만 지우기");click("그대로 두기");text(TEXT);assertArrayEquals(before,Files.readAllBytes(record().toPath()));screenshot("cancel");
  click("이 기기의 초안 기록 지우기");click("기기 기록만 지우기");assertTrue(device.wait(Until.gone(By.pkg(PKG).text("이 기기에 남은 요청")),10000));
  assertNotNull(broker(activity));assertFalse(record().exists());assertEquals(0,directory().list().length);hold("ui_erased_ready");
 }
 @Test public void absence()throws Exception{
  assertTrue(directory().isDirectory());assertEquals(0,directory().list().length);Activity activity=login();
  text("DEV 테스트 계정 연결을 확인했어요. 컴퓨터의 초대 정보를 직접 붙여 넣어 주세요.");
  assertNull(device.findObject(By.pkg(PKG).text("이 기기에 남은 요청")));assertNull(device.findObject(By.pkg(PKG).text(TEXT)));assertNull(device.findObject(By.pkg(PKG).text("이 기기의 초안 기록 지우기")));
  assertEquals(0,directory().list().length);assertNotNull(broker(activity));hold("ui_cold_absence");
 }
}
