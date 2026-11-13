package ai.hypeproof.studio;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.concurrent.*;

/** Same native app, questions first. The existing local notebook stays available. */
public final class QuestionActivity extends Activity {
    // Instrumentation may install a fixture only inside a debug app process; no Intent override.
    static NativeDeviceSignIn.Transport testTransport;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
    private ReflectionStorage storage;
    private ReflectionModel model;
    private NativeVoice voice;
    private LinearLayout root,messages,actions,voiceActions;
    private EditText composer;
    private TextView heading,hint,status;
    private Button send;
    private String shownAccount,transcriptKey="",voicePrefix="",voiceTurn;
    private long voiceWait,voiceTicket;
    private NativeDeviceSignIn.Credentials voiceCredentials;
    private boolean foreground;
    private boolean visible,editing;
    private int ink,paper,muted,card;
    private final Runnable poll=new Runnable(){public void run(){if(visible&&model!=null){if(!voice.session.active()||voice.session.phase()==VoiceSession.Phase.WAITING)model.refresh();updateVoiceReply();handler.postDelayed(this,4000);}}};
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);storage=new ReflectionStorage(this);
        NativeDeviceSignIn.Target target=NativeDeviceSignIn.Target.production();
        NativeDeviceSignIn.Transport http=BuildConfig.DEBUG&&testTransport!=null?testTransport:new DeviceSignInHttp(target,deadlines);
        model=new ReflectionModel(storage,new NativeDeviceSignIn(target,http,NativeDeviceSignIn.MONOTONIC),http,worker,r->handler.post(r),this::update);
        voice=new NativeVoice(this,new NativeVoice.Host(){
            public String projectID(){return voiceScope();}
            public boolean foreground(){return foreground;}
            public boolean allowed(boolean automatic){
                return !model.readOnly&&(model.account()!=null||!model.guestReadOnly)&&Objects.equals(voiceCredentials,model.credentials)
                    &&(!automatic||(model.state!=null&&voiceCredentials!=null&&voiceCredentials.expiresAt()>System.currentTimeMillis()+90000));
            }
            public boolean nextTurn(){
                if(model.busy||model.state==null||model.state.outstanding()||!model.draft.trim().isEmpty())return false;
                voicePrefix="";voiceTurn=null;return true;
            }
            public void changed(){update();}
            public void failed(String value){voiceTurn=null;model.error=value;update();}
            public void transcript(String id,String value,boolean complete,boolean automatic){
                if(!Objects.equals(id,voiceScope()))return;
                model.edit(voicePrefix.isEmpty()?value:voicePrefix+"\n"+value);
                if(complete&&automatic){if(model.send()){voiceTurn=model.state.request.optString("id");voiceTicket=voice.session.ticket();voiceWait=SystemClock.elapsedRealtime();}else{voice.stop();model.error="인식한 글을 확인한 뒤 직접 보내 주세요.";}}
                update();
            }
        });
        if(saved!=null&&saved.getBundle("unsavedDrafts")!=null){Bundle drafts=saved.getBundle("unsavedDrafts");for(String account:drafts.keySet())model.unsavedDrafts.put(account,drafts.getString(account,""));}
        model.restore();
        if(saved!=null&&Objects.equals(model.account(),saved.getString("draftAccount"))){model.edit(saved.getString("draft",model.draft));}
        update();
    }
    @Override protected void onStart(){super.onStart();visible=true;handler.removeCallbacks(poll);handler.post(poll);}
    @Override protected void onResume(){super.onResume();foreground=true;if(voice!=null)voice.resumePermission();}
    @Override protected void onPause(){foreground=false;if(voice!=null&&voice.session.phase()!=VoiceSession.Phase.PERMISSION)stopVoice();super.onPause();}
    @Override protected void onStop(){visible=false;handler.removeCallbacks(poll);stopVoice();super.onStop();}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);if(model!=null){out.putString("draftAccount",model.account());out.putString("draft",model.draft);Bundle drafts=new Bundle();for(var entry:model.unsavedDrafts.entrySet())drafts.putString(entry.getKey(),entry.getValue());out.putBundle("unsavedDrafts",drafts);}}
    @Override protected void onDestroy(){if(model!=null)model.close();if(voice!=null)voice.close();handler.removeCallbacks(poll);worker.shutdown();deadlines.shutdown();super.onDestroy();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==NativeVoice.PERMISSION_REQUEST)voice.permission(grants);}
    private LinearLayout column(){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);return c;}
    private TextView text(String value,int size,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(ink);t.setPadding(0,dp(6),0,dp(8));if(bold)t.setTypeface(null,Typeface.BOLD);return t;}
    private Button button(String title,Runnable action){Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setMinHeight(dp(48));b.setOnClickListener(v->action.run());return b;}
    private void build(){
        boolean dark=(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        ink=dark?Color.rgb(230,230,230):Color.rgb(40,40,40);paper=dark?Color.rgb(31,31,31):Color.WHITE;muted=dark?Color.rgb(170,170,170):Color.rgb(100,100,100);card=dark?Color.rgb(54,54,62):Color.rgb(231,231,239);
        shownAccount=model.account();transcriptKey="";root=column();root.setBackgroundColor(paper);root.setPadding(dp(20),dp(8),dp(20),dp(8));
        androidx.core.view.WindowInsetsControllerCompat bars=androidx.core.view.WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView());bars.setAppearanceLightStatusBars(!dark);bars.setAppearanceLightNavigationBars(!dark);
        root.setOnApplyWindowInsetsListener((v,insets)->{int bottom=insets.getSystemWindowInsetBottom();if(Build.VERSION.SDK_INT>=30)bottom=Math.max(insets.getInsets(WindowInsets.Type.systemBars()).bottom,insets.getInsets(WindowInsets.Type.ime()).bottom);v.setPadding(dp(20),insets.getSystemWindowInsetTop()+dp(8),dp(20),bottom+dp(8));return insets;});
        LinearLayout header=new LinearLayout(this);header.addView(text("HP Studio",22,true),new LinearLayout.LayoutParams(0,-2,1));header.addView(button("메뉴",this::menu));root.addView(header);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);LinearLayout body=column();heading=text(ReflectionState.OPENING,22,false);if(Build.VERSION.SDK_INT>=29)heading.setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_BALANCED);hint=text(ReflectionState.HINT,16,false);hint.setTextColor(muted);body.addView(heading);body.addView(hint);messages=column();body.addView(messages);scroll.addView(body);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        status=text("",13,false);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
        actions=column();root.addView(actions);voiceActions=column();root.addView(voiceActions);
        LinearLayout compose=new LinearLayout(this);compose.setBaselineAligned(false);compose.setGravity(Gravity.BOTTOM);composer=new EditText(this);composer.setTextColor(ink);composer.setHintTextColor(muted);composer.setHint("정리되지 않은 말도 괜찮아요");composer.setContentDescription("질문 대화 입력");composer.setTextSize(17);composer.setMinHeight(dp(48));composer.setMaxLines(getResources().getConfiguration().fontScale>=1.3f?2:4);composer.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);composer.setFilters(new InputFilter[]{new InputFilter.LengthFilter(4000)});
        composer.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!editing){stopVoice();model.edit(s.toString());status.setText(model.error.isEmpty()?model.notice:model.error);send.setEnabled(canSend());handler.post(QuestionActivity.this::update);}}});
        composer.setOnFocusChangeListener((v,focused)->update());
        compose.addView(composer,new LinearLayout.LayoutParams(0,-2,1));send=button("보내기",()->{stopVoice();if(model.account()==null)signIn();else model.send();});compose.addView(send);root.addView(compose);setContentView(root);root.requestApplyInsets();
    }
    private String voiceScope(){return model.account()==null?"guest-local-draft":model.account();}
    private boolean canSend(){return !model.readOnly&&!model.busy&&!model.brokenCredentials&&(model.account()!=null||!model.guestReadOnly)&&(model.state==null||!model.state.outstanding())&&!model.draft.trim().isEmpty()&&voice.session.phase()!=VoiceSession.Phase.LISTENING&&voice.session.phase()!=VoiceSession.Phase.PERMISSION;}
    private void update(){
        if(isDestroyed()||model==null)return;
        if(root==null||!Objects.equals(shownAccount,model.account())){if(voice!=null)voice.stop();voiceTurn=null;build();}
        ReflectionState s=model.state;heading.setText(s==null?ReflectionState.OPENING:s.opening);hint.setText(s==null?"로그인 전에는 이 기기에만 저장돼요.":s.hint);
        heading.setVisibility(s!=null&&s.messages.length()>0?View.GONE:View.VISIBLE);hint.setVisibility(composer.hasFocus()||(s!=null&&s.messages.length()>0)?View.GONE:View.VISIBLE);
        String key=s==null?"signed-out":s.messages.toString()+String.valueOf(s.request)+s.earlier;
        if(!key.equals(transcriptKey)){
            transcriptKey=key;messages.removeAllViews();
            try{
                if(s!=null){
                    if(s.earlier)messages.addView(text("최근 대화를 보여주고 있어요.",12,false));
                    for(int i=0;i<s.messages.length();i++){JSONObject m=s.messages.getJSONObject(i);addMessage(m.getString("role").equals("user")?"나의 생각":"함께 생각하기",m.getString("content"));}
                    if(s.status().equals("local"))addMessage("전송 확인이 필요한 내 생각",s.request.getString("text"));
                    if(s.request!=null&&!s.outstanding()&&!s.status().equals("completed"))messages.addView(text("이 답변은 완료되지 않았어요. 이전 글은 남아 있어요.",13,false));
                }
            }catch(Exception e){model.error="대화를 표시하지 못했어요. 원본은 보존돼요.";}
        }
        if(!composer.getText().toString().equals(model.draft)){editing=true;composer.setText(model.draft);composer.setSelection(composer.length());editing=false;}
        boolean capturing=voice!=null&&(voice.session.phase()==VoiceSession.Phase.LISTENING||voice.session.phase()==VoiceSession.Phase.PERMISSION);
        composer.setEnabled(!model.readOnly&&(s!=null||!model.guestReadOnly)&&!capturing);send.setText(s==null?"로그인":"보내기");send.setEnabled(canSend());
        status.setText(!model.error.isEmpty()?model.error:model.signing?"브라우저에서 로그인을 완료해 주세요.":model.busy?"대화를 확인하고 있어요.":model.notice);status.setTextColor(muted);status.setVisibility(status.length()==0||(composer.hasFocus()&&model.error.isEmpty()&&!model.busy)?View.GONE:View.VISIBLE);
        actions.removeAllViews();
        if(s==null){
            if(model.brokenCredentials)actions.addView(button("로그인 복구",()->new AlertDialog.Builder(this).setTitle("로그인 복구").setMessage("읽지 못한 로그인 정보는 이 기기에 보존하고 다시 로그인해요. 대화 파일은 그대로 남아요.").setNegativeButton("취소",null).setPositiveButton("보존 후 다시 로그인",(d,w)->{try{storage.preserveBrokenCredentials();model.brokenCredentials=false;model.error="";update();}catch(Exception e){model.error="연결 정보를 보존하지 못했어요.";update();}}).show()));
            else if(model.signing)actions.addView(button("로그인 취소",model::cancelLogin));

        }else if(s.status().equals("local")&&!model.busy){
            LinearLayout row=new LinearLayout(this);row.addView(button("먼저 대화 확인",model::refresh),new LinearLayout.LayoutParams(0,-2,1));row.addView(button("같은 요청 다시 확인",model::retry),new LinearLayout.LayoutParams(0,-2,1));actions.addView(row);
        }else if(s.outstanding()&&!model.busy){actions.addView(button("응답 수신 멈추기",()->{stopVoice();new AlertDialog.Builder(this).setTitle("응답 수신 멈추기").setMessage("이 답변을 더 받지 않도록 요청해요. 이미 시작된 AI 처리에는 비용이 발생할 수 있어요. 보낸 글은 남아요.").setNegativeButton("계속 기다리기",null).setPositiveButton("멈추기",(d,w)->model.stopResponse()).show();}));}
        if(s!=null&&!model.guestDraft.isEmpty()){
            TextView kept=text("로그인 전 글도 남아 있어요. 입력창을 비운 뒤 가져올 수 있어요.",13,false);actions.addView(kept);
            Button restore=button("로그인 전 글 가져오기",()->{stopVoice();model.restoreGuest();update();});restore.setEnabled(model.canRestoreGuest());actions.addView(restore);
        }
        voiceActions.removeAllViews();
        if(!model.readOnly){
            if(voice.session.active()){
                VoiceSession.Phase phase=voice.session.phase();voiceActions.addView(text(phase==VoiceSession.Phase.LISTENING?"듣고 있어요 · 기기 내 한국어 인식":phase==VoiceSession.Phase.SPEAKING?"답변을 읽고 있어요":phase==VoiceSession.Phase.READY?"다음 말을 기다려요 · 마이크 꺼짐":phase==VoiceSession.Phase.PERMISSION?"마이크 권한 확인 중":"답변을 기다려요 · 마이크 꺼짐",13,true));
                LinearLayout row=new LinearLayout(this);row.addView(button("음성 멈추기",()->{stopVoice();update();}));voiceActions.addView(row);
            }else{if(s!=null&&!composer.hasFocus())voiceActions.addView(text("음성 대화는 말이 끝나면 보내고 계속 들어요.",12,false));LinearLayout row=new LinearLayout(this);Button dictate=button("말로 적기",()->startVoice(false));dictate.setEnabled((model.account()!=null||!model.guestReadOnly)&&!model.busy);row.addView(dictate,new LinearLayout.LayoutParams(0,-2,1));if(s!=null){Button talk=button("음성 대화",()->startVoice(true));talk.setEnabled(!model.busy&&!s.outstanding());row.addView(talk,new LinearLayout.LayoutParams(0,-2,1));}voiceActions.addView(row);}
        }
        updateVoiceReply();
    }
    private void addMessage(String label,String value){
        boolean user=label.equals("나의 생각")||label.equals("전송 확인이 필요한 내 생각");
        LinearLayout box=column();box.setPadding(dp(14),dp(8),dp(14),dp(8));
        if(user){GradientDrawable bg=new GradientDrawable();bg.setColor(card);bg.setCornerRadius(dp(16));box.setBackground(bg);}
        TextView t=text(value,17,false);t.setTextIsSelectable(true);t.setContentDescription(label+": "+value);box.addView(t);
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(user?-2:-1,-2);params.gravity=user?Gravity.END:Gravity.START;params.bottomMargin=dp(12);if(user)params.leftMargin=dp(24);messages.addView(box,params);
    }
    private void signIn(){stopVoice();composer.clearFocus();new AlertDialog.Builder(this).setTitle("로그인하고 대화하기").setMessage("대화는 HP Studio 서버에 저장되고 같은 계정의 iPhone·Android·기존 데스크톱에서 읽을 수 있어요. 전송 시 AI가 최근 대화를 처리하며 계정의 AI 이용 권한과 비용 한도가 적용돼요. 전송 구간은 암호화되지만 종단 간 암호화는 아니에요. 기기 기록의 원본은 이 기기에 남고, 그 화면의 AI 연결은 별도 동의를 받아요.").setNegativeButton("나중에",null).setPositiveButton("동의하고 로그인",(d,w)->model.login(url->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(ActivityNotFoundException e){model.cancelLogin();model.error="로그인할 브라우저를 열지 못했어요.";update();}})).show();}
    private void stopVoice(){voiceTurn=null;if(voice!=null)voice.stop();}
    private void startVoice(boolean automatic){
        if(model.busy||model.readOnly||(model.account()==null&&model.guestReadOnly))return;
        if(automatic&&!model.draft.trim().isEmpty()){model.error="작성 중인 글을 먼저 보내거나 정리해 주세요. 말로 적기는 내용을 덧붙일 수 있어요.";update();return;}
        if(automatic&&(model.state==null||model.state.outstanding()||model.credentials==null||model.credentials.expiresAt()<=System.currentTimeMillis()+90000)){
            model.error="계정 연결을 다시 확인한 뒤 음성 대화를 시작해 주세요. 작성한 글은 남아 있어요.";update();return;
        }
        voicePrefix=model.draft;voiceTurn=null;voiceCredentials=model.credentials;voice.start(automatic);
    }
    private void updateVoiceReply(){
        if(!visible||voiceTurn==null||voice.session.phase()!=VoiceSession.Phase.WAITING||model.state==null)return;
        try{String answer=model.state.voiceAnswer(voiceTurn);if(answer!=null){voiceTurn=null;voice.read(voiceTicket,model.account(),answer);return;}
            JSONObject request=model.state.request;
            boolean waiting=request!=null&&voiceTurn.equals(request.optString("id"))&&java.util.Set.of("running","pending","completed").contains(request.optString("status"));
            if((!waiting&&!model.busy)||SystemClock.elapsedRealtime()-voiceWait>120000){stopVoice();model.error="음성 대기를 멈췄어요. 보낸 글과 답변 상태는 화면에서 확인해 주세요.";handler.post(this::update);}
        }catch(Exception e){stopVoice();}
    }
    private void menu(){stopVoice();update();new AlertDialog.Builder(this).setTitle("나의 질문").setItems(new String[]{"대화 다시 확인","다시 저장","기록 내보내기","만들기로 이어가기","응답 확인 복구","계정 연결 해제","기기 기록","로그인"},(d,w)->{
        switch(w){case 7:if(model.account()==null)signIn();break;case 6:startActivity(new Intent(this,MainActivity.class));break;case 0:model.refresh();break;case 1:model.retrySave();break;case 2:export();break;case 3:new AlertDialog.Builder(this).setTitle("생각을 만들어 보고 싶다면").setMessage("기존 HP Studio 데스크톱에 같은 계정으로 로그인하고 ‘나의 질문’을 열어 주세요. ‘만들기로 이어가기’에서 구현할 의도를 직접 확인한 뒤 MVP 작업을 시작할 수 있어요.").setPositiveButton("확인",null).show();break;case 4:new AlertDialog.Builder(this).setTitle("응답 확인 복구").setMessage("오래 끝나지 않는 요청을 확인해요. 서버에서 2분 이상 멈춘 요청만 복구하며 이미 발생한 AI 비용은 취소되지 않아요. 같은 요청으로 AI를 다시 실행하지 않아요.").setNegativeButton("취소",null).setPositiveButton("확인",(a,b)->model.abandon()).show();break;case 5:stopVoice();new AlertDialog.Builder(this).setTitle("기기에서 계정 연결 해제").setMessage("이 기기의 로그인 정보를 지우고 서버 세션 해제를 시도해요. 대화와 초안은 기기에 남으며 같은 계정으로 돌아오면 읽을 수 있어요. 서버 대화를 삭제하는 동작은 아니에요.").setNegativeButton("취소",null).setPositiveButton("연결 해제",(a,b)->model.logout()).show();break;}
    }).show();}
    private void export(){
        if(model.state==null)return;
        try{File directory=new File(getCacheDir(),"exports");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException();File out=new File(directory,"studio-questions.json");byte[] bytes;if(model.readOnly){storage.exportOriginal(model.account(),out);bytes=null;}else{ReflectionState copy=model.state.copy();copy.draft=model.draft;bytes=copy.json().toString(2).getBytes(StandardCharsets.UTF_8);}if(bytes!=null)try(FileOutputStream stream=new FileOutputStream(out)){stream.write(bytes);}Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",out);Intent intent=new Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("HP Studio questions",uri));startActivity(Intent.createChooser(intent,"기록 내보내기"));}
        catch(Exception e){model.error="기록을 내보내지 못했어요. 원본은 그대로 남아 있어요.";update();}
    }
}
