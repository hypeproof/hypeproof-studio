package ai.hypeproof.studio;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import android.text.*;
import android.util.AtomicFile;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class MainActivity extends Activity {
    private StudioState state;
    private final java.util.Map<String,String> editing = new java.util.HashMap<>();
    private String activeID, error;
    private NativeVoice voice;
    private String voicePrefix="";
    private boolean readOnly, foreground;
    private AtomicFile records;
    private LinearLayout root, content;
    private int ink = Color.rgb(28,65,54), paper = Color.rgb(245,244,239), notePaper = Color.WHITE, aiPaper = Color.rgb(230,239,230), muted = Color.rgb(82,101,91), failureInk = Color.rgb(160,45,35);
    private int dp(int n) { return (int)(n * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        records = new AtomicFile(new File(getFilesDir(), "studio-notebook-v1.json"));
        try {
            if (records.getBaseFile().exists()) state = new StudioState(new String(records.readFully(), StandardCharsets.UTF_8)); else state = new StudioState();
            if (state.projects().length() > 0) activeID = state.projects().getJSONObject(0).getString("id");
            if (saved != null && state.find(saved.getString("active")) != null) activeID = saved.getString("active");
            if (saved != null && saved.getBundle("pendingEdits") != null) {
                Bundle edits=saved.getBundle("pendingEdits");
                for(String key:edits.keySet()) { String value=edits.getString(key);if(value!=null)editing.put(key,value); }
            }
        } catch (Exception e) { readOnly = true; error = "기록을 읽지 못했어요. 원본을 보존하기 위해 저장을 멈췄어요."; try { state = new StudioState(); } catch (Exception ignored) {} }
        voice=new NativeVoice(this,new NativeVoice.Host(){
            public String projectID(){return activeID;}
            public boolean foreground(){return foreground;}
            public boolean allowed(boolean automatic){return !automatic&&!readOnly&&project()!=null;}
            public boolean nextTurn(){return false;}
            public void changed(){render();}
            public void transcript(String id,String value,boolean complete,boolean automatic){voiceTranscript(id,value,complete,automatic);}
            public void failed(String message){cancel();error=message;render();}
        });
        render();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out); out.putString("active", activeID);
        Bundle edits=new Bundle();for(java.util.Map.Entry<String,String> entry:editing.entrySet())edits.putString(entry.getKey(),entry.getValue());out.putBundle("pendingEdits",edits);
    }
    @Override protected void onResume(){super.onResume();foreground=true;if(voice!=null)voice.resumePermission();}
    @Override protected void onPause(){
        foreground=false;
        if(voice!=null&&voice.session.active()&&voice.session.phase()!=VoiceSession.Phase.PERMISSION){cancel();render();}
        super.onPause();
    }
    @Override protected void onStop(){if(voice!=null&&voice.session.active()){cancel();render();}super.onStop();}
    @Override protected void onDestroy() { cancel();if(voice!=null)voice.close(); super.onDestroy(); }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(request,permissions,grants);
        if(request==NativeVoice.PERMISSION_REQUEST&&voice!=null)voice.permission(grants);
    }
    private void cancel() { if(voice!=null)voice.stop(); }
    interface Change { void run() throws Exception; }
    private boolean change(Change edit) {
        if (readOnly) return false;
        String previous = state.data.toString(); String previousID = activeID;
        FileOutputStream output = null;
        try {
            // A later successful write must also retain any visible fields whose earlier save failed.
            state=state.includingEdits(editing);
            edit.run(); output = records.startWrite(); output.write(state.data.toString().getBytes(StandardCharsets.UTF_8)); records.finishWrite(output); editing.clear(); return true;
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
        field.setTextColor(ink); field.setHintTextColor(muted); field.setMinHeight(dp(48));
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); field.setMaxLines(5); return field;
    }
    private void watch(EditText field, String key, String id) {
        watch(field, key, id, null);
    }
    private void watch(EditText field, String key, String id, TextView saved) {
        field.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s,int start,int count,int after) {}
            public void onTextChanged(CharSequence s,int start,int before,int count) {
                String value=s.toString(); if(voice!=null&&voice.session.active()){cancel();field.post(()->render());} editing.put(id+":"+key,value);
                boolean stored=change(() -> state.edit(id,key,value));
                if (stored) editing.remove(id+":"+key);
                if (saved!=null) {
                    String status=stored?"이 기기에 저장했어요.":"저장하지 못했어요. 작성한 글은 화면에 남아 있어요. 다시 저장하거나 내보내 주세요.";
                    if(!saved.getText().toString().equals(status))saved.setText(status);
                    saved.setTextColor(stored?muted:failureInk);
                }
            }
            public void afterTextChanged(Editable e) {}
        });
    }
    private void newProject() { cancel(); if (change(() -> activeID = state.create())) render(); }
    private void render() {
        boolean dark=(getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        ink=dark?Color.rgb(224,239,231):Color.rgb(28,65,54); paper=dark?Color.rgb(22,32,28):Color.rgb(245,244,239);
        notePaper=dark?Color.rgb(33,46,39):Color.WHITE; aiPaper=dark?Color.rgb(41,59,46):Color.rgb(230,239,230);
        muted=dark?Color.rgb(180,201,188):Color.rgb(82,101,91); failureInk=dark?Color.rgb(255,180,169):Color.rgb(160,45,35);
        root = column(); root.setBackgroundColor(paper); root.setPadding(dp(20),dp(8),dp(20),dp(8));
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            int bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 30) bottom = Math.max(insets.getInsets(WindowInsets.Type.systemBars()).bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
            view.setPadding(dp(20),insets.getSystemWindowInsetTop()+dp(8),dp(20),bottom+dp(8)); return insets;
        });
        LinearLayout header = new LinearLayout(this);
        header.addView(text("기기 기록",22,true), new LinearLayout.LayoutParams(0,-2,1));
        header.addView(button("기록",this::history)); header.addView(button("메뉴",this::menu)); root.addView(header);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); content = column(); content.setPadding(0,dp(18),0,dp(16)); scroll.addView(content); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        JSONObject p = project();
        content.addView(text("이 기기에 남겨 둔 기록이에요. 대화에 자동으로 보내지 않아요.",12,false));
        try {
            if (p == null) {
                content.addView(text("이 기기에 생각을 남겨요",30,true)); introduction();
                Button start = button("첫 생각 기록하기", this::newProject); start.setEnabled(!readOnly); content.addView(start);
            } else {
                JSONArray messages = p.getJSONArray("messages"), revisions = p.getJSONArray("revisions");
                content.addView(text(messages.length()==0 ? "마음에 남은 장면이\n있나요?" : p.getString("title"),28,true));
                Button reflect=button("생각 정리",this::reflection); reflect.setEnabled(!readOnly); content.addView(reflect);
                if (revisions.length()>0) { JSONObject r = revisions.getJSONObject(revisions.length()-1); content.addView(text("내가 확인한 의도 · "+r.getInt("revision"),13,true)); content.addView(text(r.getString("text"),19,true)); }
                if (messages.length()==0) introduction();
                for (int i=0;i<messages.length();i++) {
                    JSONObject m=messages.getJSONObject(i); LinearLayout card=column(); card.setPadding(dp(16),dp(12),dp(16),dp(12));
                    GradientDrawable bg=new GradientDrawable(); bg.setColor(m.getString("role").equals("user")?notePaper:aiPaper); bg.setCornerRadius(dp(18)); card.setBackground(bg);
                    card.addView(text(m.getString("role").equals("user")?"나의 생각":"함께 생각하기",12,true)); TextView body=text(m.getString("content"),17,false); body.setTextIsSelectable(true); card.addView(body);
                    LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2); params.bottomMargin=dp(12); content.addView(card,params);
                }
                if (messages.length()>0) content.addView(button("지금의 의도 정리하기",this::intent));
                if(voice!=null&&voice.session.active()) {
                    String status=voice.session.phase()==VoiceSession.Phase.LISTENING?"듣고 있어요 · 기기 내 한국어 인식":"마이크 권한 확인 중";
                    TextView voiceStatus=text(status,13,true);voiceStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(voiceStatus);
                    root.addView(button("음성 멈추기",()->{cancel();render();}));
                } else {
                    root.addView(text("말로 적기는 이 기기에서만 인식해 입력창에 적어요. 자동으로 보내지 않아요.",12,false));
                    Button speak=button("말로 적기",this::dictate);speak.setEnabled(!readOnly);root.addView(speak);
                }
                LinearLayout composer=new LinearLayout(this); composer.setGravity(Gravity.BOTTOM);
                boolean capturing=voice!=null&&(voice.session.phase()==VoiceSession.Phase.PERMISSION||voice.session.phase()==VoiceSession.Phase.LISTENING);
                EditText draft=editor("정리되지 않은 말도 괜찮아요",editing.getOrDefault(activeID+":draft",p.optString("draft")),"생각 입력");draft.setEnabled(!capturing); watch(draft,"draft",activeID);
                composer.addView(draft,new LinearLayout.LayoutParams(0,-2,1)); Button send=button("기록",this::send); send.setContentDescription("생각 기록"); send.setEnabled(!readOnly&&!capturing); composer.addView(send); root.addView(composer);
                root.addView(text("기록과 작성 중인 글은 이 기기에만 저장해요.",11,false));
            }
            if (readOnly) content.addView(button("원본 보존 후 새로 시작",this::recover));
            if (error!=null) { TextView status=text(error,14,false); status.setTextColor(failureInk); content.addView(status); }
        } catch(Exception e) { content.addView(text("기록을 표시하지 못했어요.",16,false)); }
        setContentView(root); root.requestApplyInsets();
    }
    private void introduction() {
        content.addView(text("주변 사람의 작은 불편, 바꾸고 싶은 일, 아직 이름 붙이지 못한 생각부터 시작해요.",18,false));
        content.addView(text("관찰 → 다른 관점 → 작은 실천 → 성찰",15,true));
        content.addView(text("동양철학의 성찰과 배움에서 출발합니다. 답을 정하는 사람은 나예요.",14,false));
    }
    private void dictate() {
        if(project()==null||readOnly)return;
        voicePrefix=editing.getOrDefault(activeID+":draft",project().optString("draft"));
        error=null;voice.start(false);
    }
    private void voiceTranscript(String id,String value,boolean complete,boolean automatic){
        if(!id.equals(activeID)||project()==null||readOnly)return;
        String draft=voicePrefix+(voicePrefix.isEmpty()?"":"\n")+value;
        editing.put(id+":draft",draft);
        if(!change(()->state.find(id).put("draft",draft))){cancel();render();return;}
        error=null;
        render();
    }
    private void send() {
        if(voice!=null&&voice.session.phase()==VoiceSession.Phase.LISTENING)cancel();
        JSONObject p=project(); if(p==null)return;
        if(change(()->state.append(activeID,editing.getOrDefault(activeID+":draft",p.optString("draft"))))) {
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(),0);
            editing.remove(activeID+":draft"); render();
        }else{voice.stop();render();}
    }
    private void intent(){
        cancel();render();
        JSONObject p=project();if(p==null)return;String id=activeID;
        LinearLayout box=column();box.setPadding(dp(24),dp(12),dp(24),dp(12));box.addView(text("누구를 위해, 무엇을 바꾸고, 어떤 작은 행동으로 확인할지 내 말로 적어 보세요.",16,false));
        EditText field=editor("지금 내가 원하는 변화",editing.getOrDefault(id+":intentDraft",p.optString("intentDraft")),"의도 입력");field.setMinLines(4);watch(field,"intentDraft",id);box.addView(field);
        try {JSONArray revisions=p.getJSONArray("revisions");if(revisions.length()>0){box.addView(text("생각이 바뀐 기록",14,true));for(int i=0;i<revisions.length();i++)box.addView(text((i+1)+". "+revisions.getJSONObject(i).getString("text"),14,false));}}catch(Exception ignored){}
        ScrollView scroller=new ScrollView(this);scroller.addView(box);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("나의 의도").setView(scroller).setNegativeButton("닫기",null).setPositiveButton("내 의도로 확인",null).create();
        dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(b->{if(change(()->state.confirm(id,field.getText().toString()))){editing.remove(id+":intentDraft");dialog.dismiss();render();}}));dialog.show();
    }
    private void reflection() {
        cancel();render();
        JSONObject p=project(); if(p==null||readOnly)return; String id=activeID;
        LinearLayout box=column();box.setPadding(dp(24),dp(12),dp(24),dp(12));
        box.addView(text("떠오르는 것부터 편하게 적어요. 순서는 자유롭고, 빈칸으로 남겨도 괜찮아요.",16,false));
        box.addView(text("이 메모는 이 기기에만 저장돼요. AI에 자동 전송하거나 내 의도로 확정하지 않아요.",14,false));
        String[] questions={"직접 본 것은 무엇인가요?","누구의 어떤 불편인가요?","무엇이 달라지면 좋을까요?","가장 작게 확인할 행동은 무엇인가요?","해보니 무엇이 달랐나요?"};
        try {
            JSONObject notes=p.getJSONObject("reflection");
            for(int i=0;i<StudioState.REFLECTION_FIELDS.length;i++) {
                String key="reflection:"+StudioState.REFLECTION_FIELDS[i];
                TextView label=text(questions[i],18,true);androidx.core.view.ViewCompat.setAccessibilityHeading(label,true);box.addView(label);
                EditText field=editor("지금 떠오르는 생각을 적어 주세요",editing.getOrDefault(id+":"+key,notes.getString(StudioState.REFLECTION_FIELDS[i])),questions[i]);
                field.setId(View.generateViewId());label.setLabelFor(field.getId());field.setMinLines(2);box.addView(field);
                boolean unsaved=editing.containsKey(id+":"+key);
                TextView saved=text(unsaved?"아직 저장하지 못한 글이 있어요.":"이 기기에 자동 저장해요.",12,false);saved.setTextColor(unsaved?failureInk:muted);
                saved.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);box.addView(saved);watch(field,key,id,saved);
            }
        } catch(JSONException e) { error="생각 정리 기록을 읽지 못했어요. 원본을 보존했어요.";render();return; }
        ScrollView scroller=new ScrollView(this);scroller.addView(box);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("생각 정리").setView(scroller).setNegativeButton("대화로 돌아가기",null).setNeutralButton("다시 저장",null).setPositiveButton("내보내기",null).create();
        dialog.setOnShowListener(v->{
            dialog.getButton(-3).setOnClickListener(b->{
                if(change(()->state=state.includingEdits(editing))) {
                    editing.clear();error=null;dialog.dismiss();render();reflection();
                }
            });
            dialog.getButton(-1).setOnClickListener(b->export());
        });dialog.show();
    }
    private void history() {
        cancel();render();
        LinearLayout box=column();box.setPadding(dp(24),dp(8),dp(24),dp(8));
        EditText query=editor("제목이나 의도로 찾기","","기록 검색");query.setSingleLine(true);box.addView(query);
        Button create=button("새 생각 기록하기",()->{});create.setEnabled(!readOnly);box.addView(create);
        LinearLayout list=column();ScrollView scroll=new ScrollView(this);scroll.addView(list);box.addView(scroll,new LinearLayout.LayoutParams(-1,dp(320)));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("나의 기록").setView(box).setNegativeButton("닫기",null).create();
        create.setOnClickListener(v->{dialog.dismiss();newProject();});
        Runnable filter=()->{
            list.removeAllViews();
            try {
                StudioState visible=state.includingEdits(editing);JSONArray all=visible.projects();
                for(int i=0;i<all.length();i++) {
                    JSONObject item=all.getJSONObject(i);String id=item.getString("id");if(!visible.matches(id,query.getText().toString()))continue;
                    String title=visible.displayTitle(id),subtitle=visible.subtitle(id);
                    LinearLayout row=column();row.setPadding(dp(4),dp(8),dp(4),dp(8));row.setMinimumHeight(dp(64));
                    TextView heading=text(title,17,true),detail=text(subtitle,14,false);detail.setMaxLines(2);detail.setEllipsize(android.text.TextUtils.TruncateAt.END);detail.setTextColor(muted);
                    heading.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);detail.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                    row.addView(heading);row.addView(detail);row.setContentDescription(title+". "+subtitle);row.setFocusable(true);
                    android.util.TypedValue background=new android.util.TypedValue();getTheme().resolveAttribute(android.R.attr.selectableItemBackground,background,true);row.setBackgroundResource(background.resourceId);
                    row.setAccessibilityDelegate(new View.AccessibilityDelegate(){@Override public void onInitializeAccessibilityNodeInfo(View host,android.view.accessibility.AccessibilityNodeInfo info){super.onInitializeAccessibilityNodeInfo(host,info);info.setClassName(Button.class.getName());}});
                    row.setOnClickListener(v->{cancel();activeID=id;dialog.dismiss();render();});list.addView(row);
                }
                if(list.getChildCount()==0)list.addView(text("찾는 기록이 없어요. 다른 말로 찾아보세요.",16,false));
            }catch(JSONException e){list.addView(text("기록을 읽지 못했어요. 작성한 내용은 그대로 있어요.",16,false));}
        };
        query.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){filter.run();}public void afterTextChanged(Editable e){}});
        filter.run();dialog.show();
    }
    private void returnToQuestions() {
        cancel();
        if(isTaskRoot())startActivity(new Intent(this,QuestionActivity.class));
        finish();
    }
    private void menu(){cancel();render();new AlertDialog.Builder(this).setTitle("기기 기록 메뉴").setItems(new String[]{"새 생각",readOnly?"읽지 못한 원본 내보내기":"전체 기록 내보내기","현재 기록 삭제","나의 질문으로"},(d,i)->{if(i==3)returnToQuestions();if(i==0)newProject();if(i==1)export();if(i==2&&project()!=null)new AlertDialog.Builder(this).setTitle("이 기록을 삭제할까요?").setMessage("대화, 생각 정리 메모와 의도 변경 기록을 이 기기에서 삭제해요. AI에 이미 전송된 내용은 이 작업으로 삭제되지 않아요.").setNegativeButton("취소",null).setPositiveButton("삭제",(dialog,which)->{cancel();if(change(()->{state.delete(activeID);activeID=state.projects().length()>0?state.projects().getJSONObject(0).getString("id"):null;}))render();}).show();}).show();}
    private void recover(){new AlertDialog.Builder(this).setTitle("원본을 보존하고 새로 시작할까요?").setMessage("읽지 못한 원본은 기기에 별도 보관해요. 먼저 원본 내보내기로 외부에 복사해 두세요.").setNegativeButton("취소",null).setPositiveButton("원본 보존 후 새로 시작",(d,w)->{try{File backup=new File(getFilesDir(),"recovery-"+UUID.randomUUID()+".json");try(FileOutputStream out=new FileOutputStream(backup)){out.write(records.readFully());}readOnly=false;if(change(()->{state=new StudioState();activeID=null;})){error=null;render();}else readOnly=true;}catch(Exception e){error="원본을 보존하지 못해 초기화하지 않았어요.";render();}}).show();}
    private byte[] exportBytes() throws Exception {
        if(readOnly)return records.readFully();
        StudioState snapshot=state.includingEdits(editing);
        return snapshot.data.toString(2).getBytes(StandardCharsets.UTF_8);
    }
    private void export(){try{File dir=new File(getCacheDir(),"exports");if(!dir.exists()&&!dir.mkdirs())throw new IOException();File file=new File(dir,readOnly?"HP-Studio-recovery-original.json":"HP-Studio-records.json");try(FileOutputStream out=new FileOutputStream(file)){out.write(exportBytes());}Intent share=new Intent(Intent.ACTION_SEND);share.setType("application/json");share.putExtra(Intent.EXTRA_STREAM,FileProvider.getUriForFile(this,getPackageName()+".files",file));share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(share,"나의 기록 내보내기"));}catch(Exception e){error="기록을 내보내지 못했어요.";render();}}
}
