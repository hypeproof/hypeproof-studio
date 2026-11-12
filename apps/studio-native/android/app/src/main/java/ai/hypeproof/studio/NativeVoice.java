package ai.hypeproof.studio;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import android.speech.*;
import android.speech.tts.*;
import java.util.*;

/** No cloud recognizer or network voice fallback. All callbacks are fenced on the UI thread. */
final class NativeVoice {
    static final int PERMISSION_REQUEST=104;
    interface Host {
        String projectID();
        void changed();
        void transcript(String id,String text,boolean complete,boolean automatic);
        void failed(String message);
    }
    final VoiceSession session=new VoiceSession();
    private final Activity activity;
    private final Host host;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private final java.util.function.BooleanSupplier recognitionAvailable;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private AudioFocusRequest focus;
    private boolean ttsReady;
    private long permissionTicket=-1;
    private String permissionProject;
    private Runnable timeout;
    private Set<Integer> routes;
    private final AudioDeviceCallback routeListener=new AudioDeviceCallback(){
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices){routeChanged();}
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices){routeChanged();}
    };
    NativeVoice(Activity activity,Host host) {this(activity,host,()->available(activity));}
    NativeVoice(Activity activity,Host host,java.util.function.BooleanSupplier recognitionAvailable) {
        this.recognitionAvailable=recognitionAvailable;this.activity=activity;this.host=host;audio=(AudioManager)activity.getSystemService(Activity.AUDIO_SERVICE);
        routes=routeIDs();audio.registerAudioDeviceCallback(routeListener,handler);
    }
    static boolean available(Activity activity) {
        return Build.VERSION.SDK_INT>=31&&SpeechRecognizer.isOnDeviceRecognitionAvailable(activity);
    }
    private Set<Integer> routeIDs(){Set<Integer> result=new HashSet<>();for(AudioDeviceInfo d:audio.getDevices(AudioManager.GET_DEVICES_INPUTS | AudioManager.GET_DEVICES_OUTPUTS))result.add(d.getId());return result;}
    private void routeChanged(){Set<Integer> next=routeIDs();boolean changed=!next.equals(routes);routes=next;if(changed&&session.active())fail("오디오 연결이 바뀌어 음성을 멈췄어요. 작성한 글은 남아 있어요.");}
    void start(boolean conversation) {
        stop();String id=host.projectID();if(id==null)return;
        if(permissionTicket>=0){host.failed("마이크 권한 확인을 마친 뒤 다시 시작해 주세요.");return;}
        if(!recognitionAvailable.getAsBoolean()){host.failed("이 기기는 한국어 기기 내 음성 인식을 사용할 수 없어요. 글로 계속 적을 수 있어요.");return;}
        session.start(id,conversation);host.changed();
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            permissionTicket=session.ticket();permissionProject=id;
            activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},PERMISSION_REQUEST);return;
        }
        listen();
    }
    void permission(int[] grants) {
        long ticket=permissionTicket;String id=permissionProject;permissionTicket=-1;permissionProject=null;
        if(!current(ticket,id)||session.phase()!=VoiceSession.Phase.PERMISSION)return;
        if(grants.length==0||grants[0]!=PackageManager.PERMISSION_GRANTED){fail("마이크 권한이 없어 음성을 시작하지 않았어요. 글로 계속 적을 수 있어요.");return;}
        if(!current(session.ticket(),session.project())){stop();return;}listen();
    }
    private boolean current(long ticket,String id){return session.matches(ticket,id)&&id!=null&&id.equals(host.projectID())&&!activity.isDestroyed();}
    private boolean audioFocus(){
        final long ticket=session.ticket();final String id=session.project();
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener(change->{if(change<0&&current(ticket,id))fail("다른 오디오가 시작되어 음성을 멈췄어요. 작성한 글은 남아 있어요.");},handler).build();
        return audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }
    void finishListening(){if(recognizer!=null&&session.phase()==VoiceSession.Phase.LISTENING){recognizer.stopListening();final long ticket=session.ticket();final String id=session.project();armTimeout(8000,()->{if(current(ticket,id)&&session.listening(ticket,id))fail("인식이 끝나지 않아 멈췄어요. 작성한 글을 확인해 주세요.");});}}
    void next(){if(session.next(host.projectID())<0)return;listen();}
    private void listen(){
        final long ticket=session.ticket();final String id=session.project();
        if(!current(ticket,id)||!session.beginListening(ticket,id))return;
        if(!audioFocus()){fail("마이크 오디오를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");return;}
        try {
            if(Build.VERSION.SDK_INT<31||!recognitionAvailable.getAsBoolean())throw new UnsupportedOperationException();
            recognizer=SpeechRecognizer.createOnDeviceSpeechRecognizer(activity);
            recognizer.setRecognitionListener(new RecognitionListener(){
                public void onReadyForSpeech(Bundle params){}
                public void onBeginningOfSpeech(){}
                public void onRmsChanged(float rms){}
                public void onBufferReceived(byte[] bytes){}
                public void onEndOfSpeech(){}
                public void onEvent(int type,Bundle params){}
                public void onPartialResults(Bundle results){deliver(results,false);}
                public void onResults(Bundle results){deliver(results,true);}
                private void deliver(Bundle results,boolean complete){
                    if(!current(ticket,id)||!session.listening(ticket,id))return;
                    ArrayList<String> values=results==null?null:results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String value=values==null||values.isEmpty()?"":values.get(0);
                    if(value==null||value.trim().isEmpty()){if(complete)fail("말한 내용을 받지 못했어요. 작성한 글은 남아 있어요.");return;}
                    if(complete){session.finish(ticket,id);releaseRecognizer();releaseFocus();}
                    boolean automatic=session.conversation();
                    host.transcript(id,value,complete,automatic);
                    if(complete&&!automatic){stop();host.changed();}
                }
                public void onError(int code){if(current(ticket,id)&&session.listening(ticket,id))fail(code==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS?"마이크 권한이 없어 음성을 멈췄어요. 글로 계속 적을 수 있어요.":"기기 내 한국어 음성 인식을 마치지 못했어요. 기기의 한국어 음성 지원을 확인하거나 글로 계속 적어 주세요.");}
            });
            Intent request=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            request.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            request.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"ko-KR");request.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true);
            recognizer.startListening(request);
            armTimeout(60000,()->{if(current(ticket,id)&&session.listening(ticket,id))fail("음성 입력 시간이 끝났어요. 작성한 글을 확인하고 다시 시작해 주세요.");});
            host.changed();
        }catch(RuntimeException e){fail("기기 내 음성 인식을 시작하지 못했어요. 글로 계속 적을 수 있어요.");}
    }
    void read(String id,String reply){
        long ticket=session.ticket();
        if(!current(ticket,id)||!session.conversation()||!session.speak(ticket,id))return;
        host.changed();
        if(tts!=null&&ttsReady){speak(ticket,id,reply);return;}
        armTimeout(10000,()->{if(current(ticket,id))fail("읽어주기를 시작하지 못했어요. 화면의 답변을 읽어 주세요.");});
        tts=new TextToSpeech(activity.getApplicationContext(),status->handler.post(()->{
            if(!current(ticket,id))return;
            if(status!=TextToSpeech.SUCCESS){fail("기기 내 읽어주기를 사용할 수 없어요. 화면의 답변을 읽어 주세요.");return;}
            ttsReady=true;speak(ticket,id,reply);
        }));
    }
    private void speak(long ticket,String id,String reply){
        try {
            if(!current(ticket,id)||tts==null)return;
            Voice selected=null;Set<Voice> voices=tts.getVoices();
            if(voices!=null)for(Voice voice:voices){
                Set<String> features=voice.getFeatures();
                if("ko".equals(voice.getLocale().getLanguage())&&!voice.isNetworkConnectionRequired()&&(features==null||!features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))){selected=voice;break;}
            }
            if(selected==null||tts.setVoice(selected)!=TextToSpeech.SUCCESS){fail("기기에 설치된 한국어 읽기 음성이 없어요. 화면의 답변을 읽어 주세요.");return;}
            if(!audioFocus()){fail("읽기 오디오를 사용할 수 없어요. 화면의 답변을 읽어 주세요.");return;}
            clearTimeout();
            String utterance="voice-"+ticket;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                public void onStart(String value){}
                public void onDone(String value){handler.post(()->{if(current(ticket,id)&&utterance.equals(value)&&session.ready(ticket,id)){clearTimeout();releaseFocus();host.changed();}});}
                public void onError(String value){handler.post(()->{if(current(ticket,id))fail("읽어주기를 마치지 못했어요. 화면의 답변을 읽어 주세요.");});}
            });
            int limit=TextToSpeech.getMaxSpeechInputLength()-1;
            for(int offset=0;offset<reply.length();){
                int end=Math.min(reply.length(),offset+limit);if(end<reply.length()&&Character.isHighSurrogate(reply.charAt(end-1)))end--;
                String chunkID=end==reply.length()?utterance:utterance+"-"+offset;
                if(tts.speak(reply.substring(offset,end),offset==0?TextToSpeech.QUEUE_FLUSH:TextToSpeech.QUEUE_ADD,null,chunkID)!=TextToSpeech.SUCCESS){fail("읽어주기를 시작하지 못했어요. 화면의 답변을 읽어 주세요.");return;}offset=end;
            }
            armTimeout(180000,()->{if(current(ticket,id))fail("읽어주기를 멈췄어요. 화면에서 계속 읽을 수 있어요.");});
        }catch(RuntimeException e){fail("기기 내 읽어주기를 사용할 수 없어요. 화면의 답변을 읽어 주세요.");}
    }
    private void armTimeout(long delay,Runnable task){clearTimeout();timeout=task;handler.postDelayed(task,delay);}
    private void clearTimeout(){if(timeout!=null)handler.removeCallbacks(timeout);timeout=null;}
    private void releaseRecognizer(){clearTimeout();if(recognizer!=null){SpeechRecognizer old=recognizer;recognizer=null;old.cancel();old.destroy();}}
    private void releaseFocus(){if(focus!=null){audio.abandonAudioFocusRequest(focus);focus=null;}}
    private void fail(String message){stop();host.failed(message);}
    void stop(){session.stop();releaseRecognizer();releaseFocus();if(tts!=null){tts.stop();tts.shutdown();tts=null;}ttsReady=false;}
    void close(){stop();audio.unregisterAudioDeviceCallback(routeListener);}
}
