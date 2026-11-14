package ai.hypeproof.studio;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
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
    // One response and one bounded cancellation may overlap; ordinary requests stay serialized by the model.
    private final ExecutorService worker=Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
    private ReflectionStorage storage;
    private ReflectionModel model;
    private NativeTeamModel team;
    private NativeDeviceSignIn.Credentials teamIdentity;
    private LinearLayout teamEntry,teamContent;
    private TextView greeting;
    private Button questionsEntry,approvalsEntry;
    private AlertDialog teamDialog;
    private boolean approvalDialog;
    private NativeVoice voice;
    private LinearLayout root,messages,actions,voiceActions,body;
    private EditText composer;
    private TextView heading,hint,status,voiceStatus,voiceHint;
    private Button send,latest;
    private ConversationScroll timeline;
    private ImageButton dictate,talk,voiceStop;
    private String shownAccount,transcriptKey="",voicePrefix="",voiceTurn;
    private long voiceWait,voiceTicket;
    private NativeDeviceSignIn.Credentials voiceCredentials;
    private boolean foreground;
    private boolean visible,editing;
    private int ink,paper,muted,card,accent,onAccent;
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
        team=new NativeTeamModel(()->model.credentials,http,worker,r->handler.post(r),storage,()->{update();renderTeamDialog();});
        if(saved!=null&&saved.getBundle("unsavedDrafts")!=null){Bundle drafts=saved.getBundle("unsavedDrafts");for(String account:drafts.keySet())model.unsavedDrafts.put(account,drafts.getString(account,""));}
        model.restore();
        if(saved!=null&&Objects.equals(model.account(),saved.getString("draftAccount"))){model.edit(saved.getString("draft",model.draft));}
        update();
    }
    @Override protected void onStart(){super.onStart();visible=true;handler.removeCallbacks(poll);handler.post(poll);}
    @Override protected void onResume(){super.onResume();foreground=true;if(voice!=null)voice.resumePermission();}
    @Override protected void onPause(){foreground=false;if(voice!=null&&voice.session.phase()!=VoiceSession.Phase.PERMISSION)stopVoice();super.onPause();}
    @Override protected void onStop(){visible=false;handler.removeCallbacks(poll);stopVoice();if(teamDialog!=null)teamDialog.dismiss();super.onStop();}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);if(model!=null){out.putString("draftAccount",model.account());out.putString("draft",model.draft);Bundle drafts=new Bundle();for(var entry:model.unsavedDrafts.entrySet())drafts.putString(entry.getKey(),entry.getValue());out.putBundle("unsavedDrafts",drafts);}}
    @Override protected void onDestroy(){if(team!=null)team.invalidate();if(model!=null)model.close();if(voice!=null)voice.close();handler.removeCallbacks(poll);worker.shutdown();deadlines.shutdown();super.onDestroy();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==NativeVoice.PERMISSION_REQUEST)voice.permission(grants);}
    private LinearLayout column(){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);return c;}
    private TextView text(String value,int size,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(ink);t.setPadding(0,dp(6),0,dp(8));if(bold)t.setTypeface(null,Typeface.BOLD);return t;}
    private GradientDrawable rounded(int color,int radius){GradientDrawable shape=new GradientDrawable();shape.setColor(color);shape.setCornerRadius(dp(radius));return shape;}
    private ColorStateList tones(int enabled,int disabled){return new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},new int[]{disabled,enabled});}
    private RippleDrawable touchSurface(int color,int radius){return new RippleDrawable(ColorStateList.valueOf((ink&0x00ffffff)|0x18000000),rounded(color,radius),rounded(Color.WHITE,radius));}
    private Button button(String title,Runnable action){
        Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setTextSize(14);b.setTypeface(null,Typeface.NORMAL);
        b.setMinHeight(dp(48));b.setMinimumHeight(dp(48));b.setMinWidth(dp(48));b.setMinimumWidth(dp(48));b.setPadding(dp(12),dp(8),dp(12),dp(8));
        b.setTextColor(tones(ink,muted));b.setBackground(touchSurface(Color.TRANSPARENT,24));b.setStateListAnimator(null);b.setOnClickListener(v->action.run());return b;
    }
    private ImageButton iconButton(String label,int icon,Runnable action){
        ImageButton b=new ImageButton(this);b.setImageResource(icon);b.setImageTintList(tones(ink,muted));b.setScaleType(ImageView.ScaleType.CENTER);
        b.setContentDescription(label);b.setTooltipText(label);b.setPadding(dp(12),dp(12),dp(12),dp(12));b.setMinimumWidth(dp(48));b.setMinimumHeight(dp(48));
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48)));b.setBackground(touchSurface(Color.TRANSPARENT,24));b.setOnClickListener(v->action.run());return b;
    }
    private void build(){
        boolean dark=(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        ink=getColor(R.color.conversation_ink);paper=getColor(R.color.conversation_canvas);muted=getColor(R.color.conversation_muted);card=getColor(R.color.conversation_surface);accent=getColor(R.color.conversation_accent);onAccent=getColor(R.color.conversation_on_accent);
        shownAccount=model.account();transcriptKey="";root=column();root.setBackgroundColor(paper);root.setPadding(dp(16),dp(4),dp(16),dp(8));
        androidx.core.view.WindowInsetsControllerCompat bars=androidx.core.view.WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView());bars.setAppearanceLightStatusBars(!dark);bars.setAppearanceLightNavigationBars(!dark);
        root.setOnApplyWindowInsetsListener((v,insets)->{int bottom=insets.getSystemWindowInsetBottom();if(Build.VERSION.SDK_INT>=30)bottom=Math.max(insets.getInsets(WindowInsets.Type.systemBars()).bottom,insets.getInsets(WindowInsets.Type.ime()).bottom);v.setPadding(dp(16),insets.getSystemWindowInsetTop()+dp(4),dp(16),bottom+dp(8));return insets;});
        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setBaselineAligned(false);
        TextView title=text("HP Studio",18,true);title.setPadding(dp(4),0,0,0);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));header.addView(iconButton("메뉴",R.drawable.ic_conversation_menu,this::menu));root.addView(header);
        teamEntry=column();greeting=text("안녕하세요.",14,false);greeting.setContentDescription("계정 인사");teamEntry.addView(greeting);
        LinearLayout entries=new LinearLayout(this);questionsEntry=button("도착한 질문",()->openTeam(false));approvalsEntry=button("확인 요청",()->openTeam(true));
        entries.addView(questionsEntry,new LinearLayout.LayoutParams(0,-2,1));entries.addView(approvalsEntry,new LinearLayout.LayoutParams(0,-2,1));teamEntry.addView(entries);root.addView(teamEntry);
        messages=column();timeline=new ConversationScroll(this,messages);body=column();body.setPadding(dp(4),dp(24),dp(4),dp(20));
        heading=text(ReflectionState.OPENING,24,true);heading.setLineSpacing(dp(3),1);if(Build.VERSION.SDK_INT>=29)heading.setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_BALANCED);
        hint=text(ReflectionState.HINT,14,false);hint.setTextColor(muted);body.addView(heading);body.addView(hint);body.addView(messages);timeline.addView(body);
        FrameLayout history=new FrameLayout(this);history.addView(timeline,new FrameLayout.LayoutParams(-1,-1));
        latest=button("최신 메시지",timeline::showLatest);latest.setBackground(touchSurface(card,24));latest.setElevation(dp(2));latest.setVisibility(View.GONE);
        FrameLayout.LayoutParams catchUp=new FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM|Gravity.END);catchUp.setMargins(dp(8),dp(8),dp(8),dp(8));history.addView(latest,catchUp);
        timeline.onPositionChanged(()->latest.setVisibility(timeline.atLatest()?View.GONE:View.VISIBLE));root.addView(history,new LinearLayout.LayoutParams(-1,0,1));
        status=text("",13,false);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
        actions=column();root.addView(actions);
        LinearLayout compose=column();compose.setPadding(dp(12),dp(4),dp(12),dp(8));compose.setBackground(rounded(card,24));
        composer=new EditText(this);composer.setTextColor(ink);composer.setHintTextColor(muted);composer.setHint("정리되지 않은 말도 괜찮아요");composer.setContentDescription("질문 대화 입력");composer.setTextSize(17);composer.setMinHeight(dp(56));composer.setMaxLines(getResources().getConfiguration().fontScale>=1.3f?2:4);composer.setGravity(Gravity.TOP|Gravity.START);composer.setPadding(dp(4),dp(12),dp(4),dp(12));composer.setBackground(null);composer.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);composer.setFilters(new InputFilter[]{new InputFilter.LengthFilter(4000)});
        composer.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!editing){stopVoice();model.edit(s.toString());status.setText(model.error.isEmpty()?model.notice:model.error);send.setEnabled(canActivatePrimary());handler.post(QuestionActivity.this::update);}}});
        composer.setOnFocusChangeListener((v,focused)->update());compose.addView(composer,new LinearLayout.LayoutParams(-1,-2));
        voiceStatus=text("",13,false);voiceStatus.setTextColor(muted);voiceStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);compose.addView(voiceStatus);
        LinearLayout tools=new LinearLayout(this);tools.setGravity(Gravity.CENTER_VERTICAL);tools.setBaselineAligned(false);
        voiceActions=new LinearLayout(this);voiceActions.setGravity(Gravity.CENTER_VERTICAL);
        dictate=iconButton("말로 적기",R.drawable.ic_conversation_mic,()->startVoice(false));talk=iconButton("음성 대화",R.drawable.ic_conversation_wave,()->startVoice(true));
        voiceStop=iconButton("음성 멈추기",R.drawable.ic_conversation_stop,()->{stopVoice();update();});voiceStop.setImageTintList(ColorStateList.valueOf(onAccent));voiceStop.setBackground(touchSurface(accent,24));
        voiceActions.addView(dictate);voiceActions.addView(talk);voiceActions.addView(voiceStop);tools.addView(voiceActions,new LinearLayout.LayoutParams(0,-2,1));
        send=button("보내기",()->{stopVoice();if(model.account()==null)signIn();else if(model.send())timeline.showLatest();});send.setTypeface(null,Typeface.BOLD);send.setTextColor(tones(onAccent,muted));
        StateListDrawable sendStates=new StateListDrawable();sendStates.addState(new int[]{-android.R.attr.state_enabled},rounded(paper,24));sendStates.addState(new int[]{},rounded(accent,24));send.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33000000),sendStates,rounded(Color.WHITE,24)));
        tools.addView(send);compose.addView(tools);root.addView(compose);
        voiceHint=text("음성 대화는 말이 끝나면 보내고 계속 들어요.",12,false);voiceHint.setTextColor(muted);voiceHint.setPadding(dp(4),dp(8),dp(4),0);root.addView(voiceHint);
        setContentView(root);root.requestApplyInsets();
    }
    private String voiceScope(){return model.account()==null?"guest-local-draft":model.account();}
    private boolean canSend(){return !model.readOnly&&!model.busy&&!model.brokenCredentials&&(model.account()!=null||!model.guestReadOnly)&&(model.state==null||!model.state.outstanding())&&!model.draft.trim().isEmpty()&&voice.session.phase()!=VoiceSession.Phase.LISTENING&&voice.session.phase()!=VoiceSession.Phase.PERMISSION;}
    private boolean canActivatePrimary(){
        if(model.account()!=null)return canSend();
        return !model.readOnly&&!model.guestReadOnly&&!model.busy&&!model.signing&&!model.brokenCredentials
            &&voice.session.phase()!=VoiceSession.Phase.LISTENING&&voice.session.phase()!=VoiceSession.Phase.PERMISSION;
    }
    private void update(){
        if(isDestroyed()||model==null)return;
        if(team!=null&&!NativeTeamModel.same(teamIdentity,model.credentials)){
            team.invalidate();if(teamDialog!=null)teamDialog.dismiss();teamIdentity=model.credentials;
            if(teamIdentity!=null)team.profile(teamIdentity);
        }
        if(root==null||!Objects.equals(shownAccount,model.account())){if(voice!=null)voice.stop();voiceTurn=null;build();}
        teamEntry.setVisibility(model.account()!=null&&!composer.hasFocus()&&!voice.session.active()?View.VISIBLE:View.GONE);
        greeting.setText(team==null||team.displayName.isEmpty()?"안녕하세요.":"안녕하세요, "+team.displayName+"님.");
        questionsEntry.setEnabled(!model.busy&&!model.readOnly);approvalsEntry.setEnabled(!model.busy&&!model.readOnly);
        timeline.beforeContentChange();
        ReflectionState s=model.state;heading.setText(s==null?ReflectionState.OPENING:s.opening);hint.setText(s==null?"로그인 전에는 이 기기에만 저장돼요.":s.hint);
        body.setGravity(s!=null&&s.messages.length()>0?Gravity.TOP:Gravity.BOTTOM);heading.setVisibility(s!=null&&s.messages.length()>0?View.GONE:View.VISIBLE);hint.setVisibility(composer.hasFocus()||(s!=null&&s.messages.length()>0)?View.GONE:View.VISIBLE);
        String key=s==null?"signed-out":s.messages.toString()+String.valueOf(s.request)+s.earlier;
        if(!key.equals(transcriptKey)){
            transcriptKey=key;messages.removeAllViews();
            try{
                if(s!=null){
                    if(s.earlier)messages.addView(text("최근 대화를 보여주고 있어요.",12,false));
                    boolean requestShown=false;
                    for(int i=0;i<s.messages.length();i++){JSONObject m=s.messages.getJSONObject(i);boolean user=m.getString("role").equals("user");addMessage(user?"나의 생각":"함께 생각하기",m.getString("content"),m.getString("id"));if(user&&s.request!=null&&m.getString("id").equals(s.request.optString("id"))&&m.getString("content").equals(s.request.optString("text")))requestShown=true;}
                    if(!requestShown&&(s.status().equals("local")||s.status().equals("failed")))addMessage(s.status().equals("local")?"전송 확인이 필요한 내 생각":"나의 생각",s.request.getString("text"),s.request.getString("id"));
                    if(s.request!=null&&!s.outstanding()&&!s.status().equals("completed"))messages.addView(text("이 답변은 완료되지 않았어요. 이전 글은 남아 있어요.",13,false));
                }
            }catch(Exception e){model.error="대화를 표시하지 못했어요. 원본은 보존돼요.";}
        }
        if(!composer.getText().toString().equals(model.draft)){editing=true;composer.setText(model.draft);composer.setSelection(composer.length());editing=false;}
        boolean capturing=voice!=null&&(voice.session.phase()==VoiceSession.Phase.LISTENING||voice.session.phase()==VoiceSession.Phase.PERMISSION);
        composer.setEnabled(!model.readOnly&&(s!=null||!model.guestReadOnly)&&!capturing);send.setText(s==null?"로그인":"보내기");send.setEnabled(canActivatePrimary());
        status.setText(!model.error.isEmpty()?model.error:model.signing?"브라우저에서 로그인을 완료해 주세요.":model.stoppingResponse?"답변 중지를 확인하고 있어요. 보낸 글은 남아 있어요.":model.busy?"대화를 확인하고 있어요.":model.notice);status.setTextColor(muted);status.setVisibility(status.length()==0||(composer.hasFocus()&&model.error.isEmpty()&&!model.busy)?View.GONE:View.VISIBLE);
        actions.removeAllViews();
        if(s==null){
            if(model.brokenCredentials)actions.addView(button("로그인 복구",()->new AlertDialog.Builder(this).setTitle("로그인 복구").setMessage("읽지 못한 로그인 정보는 이 기기에 보존하고 다시 로그인해요. 대화 파일은 그대로 남아요.").setNegativeButton("취소",null).setPositiveButton("보존 후 다시 로그인",(d,w)->{try{storage.preserveBrokenCredentials();model.brokenCredentials=false;model.error="";update();}catch(Exception e){model.error="연결 정보를 보존하지 못했어요.";update();}}).show()));
            else if(model.signing)actions.addView(button("로그인 취소",model::cancelLogin));

        }else if(model.canStopResponse()){actions.addView(button("응답 수신 멈추기",()->{stopVoice();new AlertDialog.Builder(this).setTitle("응답 수신 멈추기").setMessage("이 답변을 더 받지 않도록 요청해요. 이미 시작된 AI 처리에는 비용이 발생할 수 있어요. 보낸 글은 남아요.").setNegativeButton("계속 기다리기",null).setPositiveButton("멈추기",(d,w)->model.stopResponse()).show();}));
        }else if(s.status().equals("local")&&!model.busy){
            LinearLayout row=new LinearLayout(this);row.addView(button("먼저 대화 확인",model::refresh),new LinearLayout.LayoutParams(0,-2,1));row.addView(button("같은 요청 다시 확인",model::retry),new LinearLayout.LayoutParams(0,-2,1));actions.addView(row);
        }
        if(s!=null&&s.status().equals("failed")){
            Button restore=button("입력란에 가져오기",()->{stopVoice();if(model.restoreFailedDraft())composer.requestFocus();});
            restore.setEnabled(model.canRestoreFailedDraft());actions.addView(restore);
            if(!model.draft.isEmpty())actions.addView(text("작성 중인 글을 먼저 확인해 주세요. 보낸 이야기는 그대로 남아 있어요.",13,false));
        }
        if(s!=null&&!model.guestDraft.isEmpty()){
            TextView kept=text("로그인 전 글도 남아 있어요. 입력창을 비운 뒤 가져올 수 있어요.",13,false);actions.addView(kept);
            Button restore=button("로그인 전 글 가져오기",()->{stopVoice();model.restoreGuest();update();});restore.setEnabled(model.canRestoreGuest());actions.addView(restore);
        }
        // Keep the actual touch targets stable while focus/model updates arrive.
        voiceActions.setVisibility(model.readOnly?View.INVISIBLE:View.VISIBLE);voiceStatus.setVisibility(View.GONE);voiceHint.setVisibility(View.GONE);
        boolean active=voice.session.active();dictate.setVisibility(active?View.GONE:View.VISIBLE);talk.setVisibility(!active&&s!=null?View.VISIBLE:View.GONE);voiceStop.setVisibility(active?View.VISIBLE:View.GONE);
        if(!model.readOnly){
            if(voice.session.active()){
                VoiceSession.Phase phase=voice.session.phase();voiceStatus.setText(phase==VoiceSession.Phase.LISTENING?"듣고 있어요 · 기기 내 한국어 인식":phase==VoiceSession.Phase.SPEAKING?"답변을 읽고 있어요":phase==VoiceSession.Phase.READY?"다음 말을 기다려요 · 마이크 꺼짐":phase==VoiceSession.Phase.PERMISSION?"마이크 권한 확인 중":"답변을 기다려요 · 마이크 꺼짐");voiceStatus.setVisibility(View.VISIBLE);

            }else{
                voiceHint.setVisibility(s!=null&&!composer.hasFocus()?View.VISIBLE:View.GONE);
                dictate.setEnabled((model.account()!=null||!model.guestReadOnly)&&!model.busy);
                talk.setEnabled(s!=null&&!model.busy&&!s.outstanding());
            }
        }
        updateVoiceReply();
    }
    private void openTeam(boolean approvals){
        if(team==null||model.credentials==null||model.busy)return;
        stopVoice();composer.clearFocus();approvalDialog=approvals;
        ScrollView scroll=new ScrollView(this);teamContent=column();teamContent.setPadding(dp(20),dp(8),dp(20),dp(12));scroll.addView(teamContent);
        teamDialog=new AlertDialog.Builder(this).setTitle(approvals?"확인 요청":"도착한 질문").setView(scroll).setNegativeButton("닫기",null).create();
        teamDialog.setOnDismissListener(d->{team.dismiss();teamDialog=null;teamContent=null;});teamDialog.show();
        model.withCurrentAccount(c->{if(teamDialog==null)return;if(approvals)team.approvals(c);else team.questions(c);});
        renderTeamDialog();
    }
    private void renderTeamDialog(){
        if(teamDialog==null||teamContent==null||!teamDialog.isShowing())return;
        teamContent.removeAllViews();if(!team.message.isEmpty())teamContent.addView(text(team.message,15,false));
        if(approvalDialog){
            for(NativeApprovalCard item:team.approvals){try{
                JSONObject source=item.json.getJSONObject("source"),brief=item.json.getJSONObject("brief");
                teamContent.addView(text(source.getString("repo")+" #"+source.getLong("pr"),14,true));
                String summary=brief.getJSONArray("authored").getString(0);if(summary.startsWith("summary: "))summary=summary.substring(9);
                TextView change=text(summary,16,false);change.setMaxLines(3);change.setEllipsize(android.text.TextUtils.TruncateAt.END);teamContent.addView(change);
                teamContent.addView(text("검토 담당자로 지정됐어요. "+item.status(),13,false));
                LinearLayout choices=new LinearLayout(this);
                String[] labels={"승인","보류","설명 요청"},values={"approve","reject","question"};
                for(int i=0;i<labels.length;i++){String choice=values[i];Button b=button(labels[i],()->model.withCurrentAccount(c->team.decide(c,item,choice)));b.setEnabled(!model.busy&&!team.busy&&team.availability.equals("ready")&&!team.pending.contains(item.id)&&item.canDecide());choices.addView(b,new LinearLayout.LayoutParams(0,-2,1));}teamContent.addView(choices);
                LinearLayout evidence=column();evidence.setVisibility(View.GONE);String head=source.getString("head");
                teamContent.addView(button("설명과 근거 "+head.substring(0,7),()->evidence.setVisibility(evidence.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE)));
                evidence.addView(text("정확한 버전\n"+head,13,false));
                for(String family:new String[]{"authored","verified"}){evidence.addView(text(family.equals("authored")?"작성자가 설명한 변경":"검증된 근거",14,true));JSONArray facts=brief.getJSONArray(family);for(int i=0;i<facts.length();i++)evidence.addView(text(facts.getString(i),14,false));}
                teamContent.addView(evidence);
                JSONObject review=item.json.optJSONObject("review");if(review!=null)teamContent.addView(button("GitHub에 반영된 승인 보기",()->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(review.optString("html_url"))));}catch(ActivityNotFoundException ignored){}}));
            }catch(JSONException e){teamContent.addView(text("요청 정보를 표시하지 못했어요. 새로고침해 주세요.",14,false));}}
        }else if(team.question!=null){
            NativeAccountCard card=team.question;JSONObject j=card.json;
            try{
                for(String key:new String[]{"title","preface","prompt"})if(!j.isNull(key))teamContent.addView(text(j.getString(key),key.equals("prompt")?20:15,key.equals("prompt")));
                JSONArray segments=j.getJSONArray("segments");for(int i=0;i<segments.length();i++){JSONObject segment=segments.getJSONObject(i);if(!segment.isNull("label"))teamContent.addView(text(segment.getString("label"),13,true));teamContent.addView(text(segment.getString("text"),16,false));}
                JSONArray choices=j.getJSONArray("choices");for(int i=0;i<choices.length();i++){JSONObject choice=choices.getJSONObject(i);String id=choice.getString("id");Button b=button(choice.getString("label")+(id.equals(team.choice)?" ✓":""),()->{if(j.optString("select").equals("tap"))model.withCurrentAccount(c->team.answer(c,null,id,false));else{team.choice=id;renderTeamDialog();}});b.setEnabled(!team.busy&&card.available());teamContent.addView(b);}
                JSONObject input=j.optJSONObject("text");if(input!=null){teamContent.addView(text(input.getString("label"),14,true));EditText answer=new EditText(this);answer.setTextColor(ink);answer.setHintTextColor(muted);answer.setTextSize(17);answer.setMinHeight(dp(56));answer.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);answer.setHint(input.getString("placeholder"));answer.setFilters(new InputFilter[]{new InputFilter.LengthFilter(input.getInt("max"))});answer.setText(team.words);answer.setEnabled(!team.busy);answer.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){team.words=s.toString();}public void afterTextChanged(Editable e){}});teamContent.addView(answer);}
                JSONArray actions=j.getJSONArray("actions");for(int i=0;i<actions.length();i++){JSONObject action=actions.getJSONObject(i);String id=action.getString("id");Button b=button(action.getString("label"),()->model.withCurrentAccount(c->team.answer(c,id,null,false)));b.setEnabled(!team.busy&&card.available());teamContent.addView(b);}
                if(!j.isNull("skip")){Button skip=button(j.getString("skip"),()->model.withCurrentAccount(c->team.answer(c,null,null,true)));skip.setEnabled(!team.busy);teamContent.addView(skip);}
                if(!j.isNull("note"))teamContent.addView(text(j.getString("note"),13,false));
                team.presented();
            }catch(JSONException e){teamContent.addView(text("질문을 표시하지 못했어요. 새로고침해 주세요.",14,false));}
        }
        if(!approvalDialog&&team.canStart){
            String[] labels={"목표를 정리하고 싶어요","방법이 막혔어요","결정을 앞두고 있어요"},values={"goal","method","decision"};
            for(int i=0;i<values.length;i++){String choice=values[i];Button b=button(labels[i],()->model.withCurrentAccount(c->team.begin(c,choice)));b.setEnabled(!team.busy&&!model.busy);teamContent.addView(b);}
        }
        Button refresh=button("새로고침",()->model.withCurrentAccount(c->{if(approvalDialog)team.approvals(c);else team.questions(c);}));refresh.setEnabled(!team.busy&&!model.busy);teamContent.addView(refresh);
    }
    private void addMessage(String label,String value,String id){
        boolean user=label.equals("나의 생각")||label.equals("전송 확인이 필요한 내 생각");
        LinearLayout box=column();box.setTag(java.util.Arrays.asList(user?"user":"assistant",id,user?value:""));box.setPadding(user?dp(16):0,dp(4),user?dp(16):0,dp(4));
        if(user){GradientDrawable bg=new GradientDrawable();bg.setColor(card);bg.setCornerRadius(dp(16));box.setBackground(bg);}
        TextView t=text(value,17,false);t.setLineSpacing(dp(4),1);t.setTextIsSelectable(true);t.setContentDescription(label+": "+value);box.addView(t);
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(user?-2:-1,-2);params.gravity=user?Gravity.END:Gravity.START;params.bottomMargin=dp(20);if(user)params.leftMargin=dp(24);messages.addView(box,params);
    }
    private void signIn(){stopVoice();composer.clearFocus();new AlertDialog.Builder(this).setTitle("로그인하고 대화하기").setMessage("대화는 HP Studio 서버에 저장되고 같은 계정의 iPhone·Android·기존 데스크톱에서 읽을 수 있어요. 전송 시 AI가 최근 대화를 처리하며 계정의 AI 이용 권한과 비용 한도가 적용돼요. 전송 구간은 암호화되지만 종단 간 암호화는 아니에요. 기기 기록은 이 기기에 남으며 계정 대화에 자동으로 복사하거나 보내지 않아요.").setNegativeButton("나중에",null).setPositiveButton("동의하고 로그인",(d,w)->model.login(url->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(ActivityNotFoundException e){model.cancelLogin();model.error="로그인할 브라우저를 열지 못했어요.";update();}})).show();}
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
            if((!waiting&&!model.busy)||SystemClock.elapsedRealtime()-voiceWait>120000){stopVoice();if(model.error.isEmpty())model.error="음성 대기를 멈췄어요. 보낸 글과 답변 상태는 화면에서 확인해 주세요.";handler.post(this::update);}
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
