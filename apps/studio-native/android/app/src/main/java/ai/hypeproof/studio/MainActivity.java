package ai.hypeproof.studio;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import android.text.*;
import android.util.AtomicFile;
import android.speech.RecognizerIntent;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final int SPEECH_REQUEST = 104;
    private StudioState state;
    private final java.util.Map<String,String> editing = new java.util.HashMap<>();
    private String activeID, installID, token, error;
    private String speechProjectID;
    private long expiresAt;
    private boolean busy, readOnly;
    private int generation;
    private AtomicFile records;
    private final StudioService service = new StudioService();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Future<?> pending;
    private LinearLayout root, content;
    private int ink = Color.rgb(28,65,54);
    private int dp(int n) { return (int)(n * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        android.content.SharedPreferences preferences = getSharedPreferences("installation", MODE_PRIVATE);
        installID = preferences.getString("id", null);
        if (installID == null) { installID = UUID.randomUUID().toString(); preferences.edit().putString("id", installID).commit(); }
        records = new AtomicFile(new File(getFilesDir(), "studio-notebook-v1.json"));
        try {
            if (records.getBaseFile().exists()) state = new StudioState(new String(records.readFully(), StandardCharsets.UTF_8)); else state = new StudioState();
            if (state.projects().length() > 0) activeID = state.projects().getJSONObject(0).getString("id");
            if (saved != null && state.find(saved.getString("active")) != null) activeID = saved.getString("active");
            if (saved != null) speechProjectID = saved.getString("speechProject");
        } catch (Exception e) { readOnly = true; error = "기록을 읽지 못했어요. 원본을 보존하기 위해 저장을 멈췄어요."; try { state = new StudioState(); } catch (Exception ignored) {} }
        render();
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putString("active", activeID); out.putString("speechProject", speechProjectID); }
    @Override protected void onDestroy() { cancel(); executor.shutdownNow(); super.onDestroy(); }
    private void cancel() { generation++; if (pending != null) pending.cancel(true); service.cancel(); busy = false; }
    interface Change { void run() throws Exception; }
    private boolean change(Change edit) {
        if (readOnly) return false;
        String previous = state.data.toString(); String previousID = activeID;
        FileOutputStream output = null;
        try {
            edit.run(); output = records.startWrite(); output.write(state.data.toString().getBytes(StandardCharsets.UTF_8)); records.finishWrite(output); return true;
        } catch (Exception e) {
            if (output != null) records.failWrite(output);
            try { state = new StudioState(previous); activeID = previousID; } catch (Exception ignored) { readOnly = true; }
            error = e instanceof IllegalArgumentException ? e.getMessage() : "기록을 저장하지 못했어요. 저장 공간을 확인해 주세요.";
            Toast.makeText(this, error, Toast.LENGTH_LONG).show(); return false;
        }
    }
    private JSONObject project() { try { return state.find(activeID); } catch (Exception e) { return null; } }
    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(ink); view.setPadding(0,dp(6),0,dp(8));
        if (bold) view.setTypeface(null, Typeface.BOLD); return view;
    }
    private Button button(String title, Runnable action) { Button b = new Button(this); b.setText(title); b.setAllCaps(false); b.setOnClickListener(v -> action.run()); return b; }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private EditText editor(String hint, String value, String description) {
        EditText field = new EditText(this); field.setHint(hint); field.setText(value); field.setTextSize(17); field.setContentDescription(description);
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); field.setMaxLines(5); return field;
    }
    private void watch(EditText field, String key, String id) {
        field.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s,int start,int count,int after) {}
            public void onTextChanged(CharSequence s,int start,int before,int count) { editing.put(id+":"+key,s.toString()); change(() -> state.find(id).put(key,s.toString())); }
            public void afterTextChanged(Editable e) {}
        });
    }
    private void newProject() { cancel(); if (change(() -> activeID = state.create())) render(); }
    private void render() {
        root = column(); root.setBackgroundColor(Color.rgb(245,244,239)); root.setPadding(dp(20),dp(8),dp(20),dp(8));
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            int bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 30) bottom = Math.max(insets.getInsets(WindowInsets.Type.systemBars()).bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
            view.setPadding(dp(20),insets.getSystemWindowInsetTop()+dp(8),dp(20),bottom+dp(8)); return insets;
        });
        LinearLayout header = new LinearLayout(this);
        header.addView(text("HP Studio",22,true), new LinearLayout.LayoutParams(0,-2,1));
        header.addView(button("기록",this::history)); header.addView(button("메뉴",this::menu)); root.addView(header);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); content = column(); content.setPadding(0,dp(18),0,dp(16)); scroll.addView(content); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        JSONObject p = project();
        content.addView(text("생각을 실천으로  ·  NATIVE PREVIEW",12,false));
        try {
            if (p == null) {
                content.addView(text("질문에서 시작하는\n나의 다음 한 걸음",30,true)); introduction();
                Button start = button("첫 생각 기록하기", this::newProject); start.setEnabled(!readOnly); content.addView(start);
            } else {
                JSONArray messages = p.getJSONArray("messages"), revisions = p.getJSONArray("revisions");
                content.addView(text(messages.length()==0 ? "마음에 남은 장면이\n있나요?" : p.getString("title"),28,true));
                if (revisions.length()>0) { JSONObject r = revisions.getJSONObject(revisions.length()-1); content.addView(text("내가 확인한 의도 · "+r.getInt("revision"),13,true)); content.addView(text(r.getString("text"),19,true)); }
                if (messages.length()==0) introduction();
                for (int i=0;i<messages.length();i++) {
                    JSONObject m=messages.getJSONObject(i); LinearLayout card=column(); card.setPadding(dp(16),dp(12),dp(16),dp(12));
                    GradientDrawable bg=new GradientDrawable(); bg.setColor(m.getString("role").equals("user")?Color.WHITE:Color.rgb(230,239,230)); bg.setCornerRadius(dp(18)); card.setBackground(bg);
                    card.addView(text(m.getString("role").equals("user")?"나의 생각":"함께 생각하기",12,true)); TextView body=text(m.getString("content"),17,false); body.setTextIsSelectable(true); card.addView(body);
                    LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2); params.bottomMargin=dp(12); content.addView(card,params);
                }
                if (messages.length()>0) content.addView(button("지금의 의도 정리하기",this::intent));
                if (!busy && token!=null && messages.length()>0 && messages.getJSONObject(messages.length()-1).getString("role").equals("user")) content.addView(button("이 생각에 질문 받기",this::ask));
                if (token==null) root.addView(button("무료 AI 연결하고 질문 받기",this::consent));
                Button speak=button("말로 적기",this::voice); speak.setEnabled(!busy&&!readOnly); root.addView(speak);
                LinearLayout composer=new LinearLayout(this); composer.setGravity(Gravity.BOTTOM);
                EditText draft=editor("정리되지 않은 말도 괜찮아요",editing.getOrDefault(activeID+":draft",p.optString("draft")),"생각 입력"); watch(draft,"draft",activeID);
                composer.addView(draft,new LinearLayout.LayoutParams(0,-2,1)); Button send=button(token==null?"기록":"보내기",this::send); send.setContentDescription("생각 기록 또는 보내기"); send.setEnabled(!busy&&!readOnly); composer.addView(send); root.addView(composer);
                root.addView(text(token==null?"AI 연결 전에는 이 기기에만 기록해요.":"최근 대화와 확인한 의도를 AI에 보내요.",11,false));
            }
            if (busy) content.addView(button("답변을 준비하고 있어요 · 취소",()->{cancel();render();}));
            if (readOnly) content.addView(button("원본 보존 후 새로 시작",this::recover));
            if (error!=null) { TextView status=text(error,14,false); status.setTextColor(Color.rgb(160,45,35)); content.addView(status); }
        } catch(Exception e) { content.addView(text("기록을 표시하지 못했어요.",16,false)); }
        setContentView(root); root.requestApplyInsets();
    }
    private void introduction() {
        content.addView(text("주변 사람의 작은 불편, 바꾸고 싶은 일, 아직 이름 붙이지 못한 생각부터 시작해요.",18,false));
        content.addView(text("관찰 → 다른 관점 → 작은 실천 → 성찰",15,true));
        content.addView(text("동양철학의 성찰과 배움에서 출발합니다. 답을 정하는 사람은 나예요.",14,false));
    }
    private void voice() {
        if (project()==null||busy||readOnly) return;
        String id=activeID;
        new AlertDialog.Builder(this).setTitle("말로 생각 적기")
            .setMessage("기기의 음성 인식 앱을 열어요. 해당 앱과 설정에 따라 음성이 음성 인식 제공자에게 전송될 수 있어요. 변환된 글은 입력창에만 담기며, 직접 기록하거나 보내기 전에는 대화에 추가되지 않아요.")
            .setNegativeButton("취소",null)
            .setPositiveButton("음성 입력 시작",(dialog,which)->{
                if (!id.equals(activeID)||busy||readOnly) return;
                Intent capture=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                capture.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                capture.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"ko-KR");
                capture.putExtra(RecognizerIntent.EXTRA_PROMPT,"정리되지 않은 말도 괜찮아요");
                capture.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
                capture.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true);
                speechProjectID=id;
                try { startActivityForResult(capture,SPEECH_REQUEST); }
                catch (ActivityNotFoundException|SecurityException e) {
                    speechProjectID=null;
                    error="음성 입력을 열 수 없어요. 키보드로 계속 적거나 기기의 음성 인식 앱을 확인해 주세요.";
                    render();
                }
            }).show();
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if (requestCode!=SPEECH_REQUEST) return;
        String id=speechProjectID; speechProjectID=null;
        if (id==null||resultCode!=RESULT_OK) return;
        if (!id.equals(activeID)||project()==null||readOnly) {
            error="기록이 바뀌어 음성 입력을 추가하지 않았어요. 원하는 기록에서 다시 말해 주세요."; render(); return;
        }
        java.util.ArrayList<String> results=data==null?null:data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results==null||results.isEmpty()||results.get(0)==null||results.get(0).trim().isEmpty()) {
            error="말한 내용을 받지 못했어요. 다시 말하거나 글로 적어 주세요."; render(); return;
        }
        String before=editing.getOrDefault(id+":draft",project().optString("draft"));
        String draft=before+(before.isEmpty()?"":"\n")+results.get(0).trim();
        editing.put(id+":draft",draft);
        if (change(()->state.find(id).put("draft",draft))) error=null;
        render();
    }
    private void send() {
        JSONObject p=project(); if(p==null||busy)return;
        if(change(()->state.append(activeID,editing.getOrDefault(activeID+":draft",p.optString("draft"))))) {
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(),0);
            editing.remove(activeID+":draft"); render(); if(token!=null)ask();
        }
    }
    private void consent() {
        LinearLayout box=column(); box.setPadding(dp(24),dp(12),dp(24),dp(12));
        box.addView(text("현재 생각의 최근 대화 20개와 확인한 의도를 HypeProof Service 및 AI 제공자에게 보내요. 무료 사용량에는 비용 한도가 있어요. 연결 없이 기록할 수도 있어요.",16,false));
        CheckBox age=new CheckBox(this);age.setText("만 14세 이상이에요");box.addView(age);
        CheckBox transfer=new CheckBox(this);transfer.setText("위 내용의 AI 전송에 동의해요");box.addView(transfer);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("무료 AI 연결").setView(box).setNegativeButton("닫기",null).setPositiveButton("동의하고 연결",null).create();
        dialog.setOnShowListener(v->{Button yes=dialog.getButton(-1);yes.setEnabled(false);android.widget.CompoundButton.OnCheckedChangeListener listener=(b,on)->yes.setEnabled(age.isChecked()&&transfer.isChecked());age.setOnCheckedChangeListener(listener);transfer.setOnCheckedChangeListener(listener);yes.setOnClickListener(b->{dialog.dismiss();connect();});});dialog.show();
    }
    interface Work { Object run() throws Exception; }
    interface Done { void run(Object result) throws Exception; }
    private void run(Work work,Done done) {
        if(busy)return; busy=true;error=null;int attempt=generation;render();
        pending=executor.submit(()->{
            Object result=null;Exception failure=null;try{result=work.run();}catch(Exception e){failure=e;}
            Object output=result;Exception problem=failure;
            runOnUiThread(()->{if(isDestroyed()||generation!=attempt)return;busy=false;
                if(problem!=null){error=problem instanceof StudioService.Failure?problem.getMessage():"AI에 연결하지 못했어요. 작성한 내용은 유지돼요. 다시 시도해 주세요.";if(problem instanceof StudioService.Failure && (((StudioService.Failure)problem).status==401||((StudioService.Failure)problem).status==403))token=null;}
                else try{done.run(output);}catch(Exception e){error="응답을 저장하지 못했어요.";}render();
            });
        });
    }
    private void connect(){run(()->service.claim(installID),result->{JSONObject grant=(JSONObject)result;String code=grant.getString("code");long expiry=grant.getLong("expires_at");if(code.isEmpty()||expiry<=System.currentTimeMillis())throw new IOException();token=code;expiresAt=expiry;});}
    private void ask(){
        if(token==null||expiresAt<=System.currentTimeMillis()+5000){token=null;error="무료 AI를 다시 연결해 주세요. 기록은 그대로 남아 있어요.";render();return;}
        try{StudioState snapshot=new StudioState(state.data.toString());String id=activeID;String bearer=token;run(()->service.reply(snapshot,id,bearer),result->change(()->state.find(id).getJSONArray("messages").put(StudioState.message("assistant",(String)result))));}catch(Exception e){error="먼저 생각을 적어 주세요.";render();}
    }
    private void intent(){
        JSONObject p=project();if(p==null)return;String id=activeID;
        LinearLayout box=column();box.setPadding(dp(24),dp(12),dp(24),dp(12));box.addView(text("누구를 위해, 무엇을 바꾸고, 어떤 작은 행동으로 확인할지 내 말로 적어 보세요.",16,false));
        EditText field=editor("지금 내가 원하는 변화",editing.getOrDefault(id+":intentDraft",p.optString("intentDraft")),"의도 입력");field.setMinLines(4);watch(field,"intentDraft",id);box.addView(field);
        try {JSONArray revisions=p.getJSONArray("revisions");if(revisions.length()>0){box.addView(text("생각이 바뀐 기록",14,true));for(int i=0;i<revisions.length();i++)box.addView(text((i+1)+". "+revisions.getJSONObject(i).getString("text"),14,false));}}catch(Exception ignored){}
        ScrollView scroller=new ScrollView(this);scroller.addView(box);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("나의 의도").setView(scroller).setNegativeButton("닫기",null).setPositiveButton("내 의도로 확인",null).create();
        dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(b->{if(change(()->state.confirm(id,field.getText().toString()))){editing.remove(id+":intentDraft");dialog.dismiss();render();}}));dialog.show();
    }
    private void history(){try{JSONArray all=state.projects();String[] labels=new String[all.length()+1];labels[0]="새 생각 기록하기";for(int i=0;i<all.length();i++)labels[i+1]=all.getJSONObject(i).getString("title");new AlertDialog.Builder(this).setTitle("나의 기록").setItems(labels,(d,index)->{if(index==0)newProject();else try{cancel();activeID=all.getJSONObject(index-1).getString("id");render();}catch(Exception ignored){}}).show();}catch(Exception ignored){}}
    private void menu(){new AlertDialog.Builder(this).setTitle("기록 메뉴").setItems(new String[]{"새 생각",token==null?"무료 AI 연결":"AI 연결 해제",readOnly?"읽지 못한 원본 내보내기":"전체 기록 내보내기","현재 기록 삭제"},(d,i)->{if(i==0)newProject();if(i==1){if(token==null)consent();else{cancel();token=null;render();}}if(i==2)export();if(i==3&&project()!=null)new AlertDialog.Builder(this).setTitle("이 기록을 삭제할까요?").setMessage("대화와 의도 변경 기록을 이 기기에서 삭제해요. AI에 이미 전송된 내용은 이 작업으로 삭제되지 않아요.").setNegativeButton("취소",null).setPositiveButton("삭제",(dialog,which)->{cancel();if(change(()->{state.delete(activeID);activeID=state.projects().length()>0?state.projects().getJSONObject(0).getString("id"):null;}))render();}).show();}).show();}
    private void recover(){new AlertDialog.Builder(this).setTitle("원본을 보존하고 새로 시작할까요?").setMessage("읽지 못한 원본은 기기에 별도 보관해요. 먼저 원본 내보내기로 외부에 복사해 두세요.").setNegativeButton("취소",null).setPositiveButton("원본 보존 후 새로 시작",(d,w)->{try{File backup=new File(getFilesDir(),"recovery-"+UUID.randomUUID()+".json");try(FileOutputStream out=new FileOutputStream(backup)){out.write(records.readFully());}readOnly=false;if(change(()->{state=new StudioState();activeID=null;})){error=null;render();}else readOnly=true;}catch(Exception e){error="원본을 보존하지 못해 초기화하지 않았어요.";render();}}).show();}
    private byte[] exportBytes() throws Exception {
        if(readOnly)return records.readFully();
        StudioState snapshot=state.includingEdits(editing);
        return snapshot.data.toString(2).getBytes(StandardCharsets.UTF_8);
    }
    private void export(){try{File dir=new File(getCacheDir(),"exports");if(!dir.exists()&&!dir.mkdirs())throw new IOException();File file=new File(dir,readOnly?"HP-Studio-recovery-original.json":"HP-Studio-records.json");try(FileOutputStream out=new FileOutputStream(file)){out.write(exportBytes());}Intent share=new Intent(Intent.ACTION_SEND);share.setType("application/json");share.putExtra(Intent.EXTRA_STREAM,FileProvider.getUriForFile(this,getPackageName()+".files",file));share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(share,"나의 기록 내보내기"));}catch(Exception e){error="기록을 내보내지 못했어요.";render();}}
}
