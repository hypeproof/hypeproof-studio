package ai.hypeproof.companion;

import android.content.Context;
import android.content.Intent;
import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Process;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import static org.junit.Assert.*;

/** Installed target-UID file lifecycle, not login, WebView recovery or relay acceptance. */
@RunWith(AndroidJUnit4.class)
public final class NativeDraftLifecycleTest {
 private static final String ACCOUNT="hosted-synthetic-account", SERVICE="https://owned.invalid/v1";
 private static final String TEXT="한글 초안 · cold restart", SENTINEL="owned synthetic original";
 private static final byte[] CORRUPT="{owned-corrupt".getBytes(StandardCharsets.UTF_8);
 private Context context() {Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("ai.hypeproof.companion.debug",c.getPackageName());assertEquals(c.getApplicationInfo().uid,Process.myUid());assertTrue((c.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);assertFalse((c.getApplicationInfo().flags&ApplicationInfo.FLAG_ALLOW_BACKUP)!=0);return c;}
 private File root()throws Exception {String run=InstrumentationRegistry.getArguments().getString("hps_run");assertNotNull(run);assertTrue(run.matches("[a-f0-9]{32}"));File base=context().getNoBackupFilesDir(),r=new File(base,"hosted-draft-"+run);assertEquals(base.getCanonicalFile(),r.getCanonicalFile().getParentFile());return r;}
 private NativeDraftStore store(String slot,String account)throws Exception{return new NativeDraftStore(new File(root(),slot),account,SERVICE,new AndroidDraftFile(),()->true);}
 private File record(String slot)throws Exception{return new File(new File(root(),slot),"draft-"+NativeDraftRecord.hash(SERVICE+"\n"+ACCOUNT)+".json");}
 private JSONObject selection()throws Exception{return new JSONObject().put("schema","hps-companion-host-request/1").put("requestId","preview").put("actorId",ACCOUNT).put("deviceId","synthetic-device").put("hostId","synthetic-host").put("workspaceId","workspace").put("projectId","project").put("taskId","task").put("version",1).put("epoch",0).put("consentRevision",1).put("artifactId","html").put("artifactVersion","a".repeat(64)).put("operation","preview.read");}
 private JSONObject editing()throws Exception{return new JSONObject().put("phase","editing").put("selection",selection()).put("text",TEXT);}
 private JSONObject attempted()throws Exception{String packet=new JSONObject().put("schema","hps-companion-authoring-intent/1").put("requestId","synthetic-intent").put("pairingId","synthetic-pair").put("selection",selection()).put("text",TEXT).toString();return editing().put("phase","attempted_unknown").put("packet",packet).put("requestId","synthetic-intent").put("requestHash",NativeDraftRecord.hash(packet));}
 private JSONObject request(String kind,JSONObject state,JSONObject value)throws Exception{JSONObject q=new JSONObject().put("id","instrumented").put("kind",kind).put("generation",state.get("generation")).put("expectedVersion",state.get("version"));if(value!=null)q.put("value",value);return q;}
 private interface Action {void run()throws Exception;}
 private void refuses(Action action)throws Exception{try{action.run();fail("mutation must refuse");}catch(AssertionError failure){throw failure;}catch(Exception expected){}}
 private void bytes(File file,byte[] wanted)throws Exception{assertTrue(Arrays.equals(wanted,Files.readAllBytes(file.toPath())));}
 private void original()throws Exception{bytes(new File(root(),"original.txt"),SENTINEL.getBytes(StandardCharsets.UTF_8));}
 private void foreignPreserved()throws Exception{byte[] old=Files.readAllBytes(record("editing").toPath());NativeDraftStore foreign=store("editing","foreign-synthetic-account");JSONObject state=foreign.read();assertEquals("foreign",state.getString("state"));assertFalse(state.has("record"));refuses(()->foreign.operate(request("draft.erase",state,null)));refuses(()->foreign.operate(request("draft.replace",state,editing())));bytes(record("editing"),old);}
 private void ack(String phase,boolean hold)throws Exception{Bundle b=new Bundle();b.putString("hps_phase",phase);b.putString("hps_run",InstrumentationRegistry.getArguments().getString("hps_run"));b.putInt("hps_pid",Process.myPid());b.putInt("hps_uid",Process.myUid());b.putString("hps_process",android.app.Application.getProcessName());b.putString("hps_data_dir",context().getDataDir().getCanonicalPath());b.putString("hps_namespace",root().getCanonicalPath());b.putString("hps_package",context().getPackageName());b.putString("hps_scope","target_uid_private_native_store_only");InstrumentationRegistry.getInstrumentation().sendStatus(0,b);if(hold){Thread.sleep(30000);fail("external owned force-stop required after store ACK");}}
 private int disabledLogin(View view){int count=0;if(view instanceof Button && "개인계정 로그인".contentEquals(((Button)view).getText())){assertFalse(view.isEnabled());count++;}if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)count+=disabledLogin(group.getChildAt(i));}return count;}
 private void unconfiguredEntry(){android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Intent intent=new Intent(context(),DeviceSignInFixtureActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);Activity activity=instrumentation.startActivitySync(intent);instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->{assertEquals(1,disabledLogin(activity.getWindow().getDecorView()));assertNull(((DeviceSignInFixtureActivity)activity).signInTarget());assertFalse(((DeviceSignInFixtureActivity)activity).signInTransportEnabled());});}
 @Test public void seed()throws Exception{
  unconfiguredEntry();
  File root=root();assertFalse(root.exists());assertTrue(root.mkdir());
  try(FileOutputStream out=new FileOutputStream(new File(root,"original.txt"))){out.write(SENTINEL.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
  NativeDraftStore editing=store("editing",ACCOUNT);JSONObject empty=editing.read();assertEquals("empty",empty.getString("state"));JSONObject saved=editing.operate(request("draft.replace",empty,editing()));assertEquals(TEXT,saved.getJSONObject("record").getString("text"));
  foreignPreserved();
  NativeDraftStore unknown=store("unknown",ACCOUNT);JSONObject held=unknown.operate(request("draft.replace",unknown.read(),attempted()));assertEquals("attempted_unknown",held.getJSONObject("record").getString("phase"));
  NativeDraftStore corrupt=store("corrupt",ACCOUNT);JSONObject good=corrupt.operate(request("draft.replace",corrupt.read(),editing()));assertEquals("record",good.getString("state"));try(FileOutputStream out=new FileOutputStream(record("corrupt"))){out.write(CORRUPT);out.getFD().sync();}
  original();ack("seed_ready",true);
 }
 @Test public void recoverErase()throws Exception{
  assertTrue(root().isDirectory());original();foreignPreserved();
  NativeDraftStore editing=store("editing",ACCOUNT);JSONObject state=editing.read();assertEquals("record",state.getString("state"));JSONObject value=state.getJSONObject("record");assertEquals("editing",value.getString("phase"));assertEquals(TEXT,value.getString("text"));JSONObject selected=value.getJSONObject("selection");assertEquals(NativeDraftRecord.keys(selection()),NativeDraftRecord.keys(selected));for(String key:NativeDraftRecord.keys(selection()))assertEquals(selection().get(key),selected.get(key));
  JSONObject erased=editing.operate(request("draft.erase",state,null));assertEquals("empty",erased.getString("state"));
  pendingPreserved();original();ack("erased_ready",true);
 }
 private void pendingPreserved()throws Exception{
  NativeDraftStore unknown=store("unknown",ACCOUNT);JSONObject held=unknown.read(),value=held.getJSONObject("record");assertEquals("attempted_unknown",value.getString("phase"));assertEquals("synthetic-intent",value.getString("requestId"));assertEquals(attempted().getString("packet"),value.getString("packet"));assertEquals(NativeDraftRecord.hash(value.getString("packet")),value.getString("requestHash"));byte[] old=Files.readAllBytes(record("unknown").toPath());refuses(()->unknown.operate(request("draft.replace",held,editing())));bytes(record("unknown"),old);
  NativeDraftStore corrupt=store("corrupt",ACCOUNT);JSONObject bad=corrupt.read();assertEquals("corrupt",bad.getString("state"));refuses(()->corrupt.operate(request("draft.replace",bad,editing())));bytes(record("corrupt"),CORRUPT);
 }
 @Test public void coldAbsence()throws Exception{
  original();assertEquals("empty",store("editing",ACCOUNT).read().getString("state"));assertFalse(record("editing").exists());pendingPreserved();
  for(String slot:new String[]{"unknown","corrupt"}){NativeDraftStore store=store(slot,ACCOUNT);assertEquals("empty",store.operate(request("draft.erase",store.read(),null)).getString("state"));}
  original();ack("cold_absence",true);
 }
}
