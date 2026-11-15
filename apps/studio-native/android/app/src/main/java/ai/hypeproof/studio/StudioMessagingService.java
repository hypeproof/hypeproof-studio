package ai.hypeproof.studio;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.content.pm.PackageManager;
import com.google.firebase.messaging.*;
import com.google.firebase.FirebaseApp;
import org.json.JSONObject;

/** Standard FCM callbacks. Tokens and provider messages never enter diagnostics/analytics. */
public final class StudioMessagingService extends FirebaseMessagingService {
    // The SDK task survives Activity recreation; a new opt-in must wait for deletion.
    static com.google.android.gms.tasks.Task<Void> tokenDeletion;
    static final String EXTRA="hps_push_reference",CHANNEL="account-questions";
    interface Listener { void token(String token); }
    private static java.lang.ref.WeakReference<Listener> listener=new java.lang.ref.WeakReference<>(null);
    static void attach(Listener value){listener=new java.lang.ref.WeakReference<>(value);}
    static void detach(Listener value){if(listener.get()==value)listener.clear();}
    static boolean configured(Context c){
        try{FirebaseApp app=FirebaseApp.initializeApp(c);return app!=null&&!app.getOptions().getApplicationId().isEmpty()&&app.getOptions().getGcmSenderId()!=null&&app.getOptions().getProjectId()!=null;}catch(Exception e){return false;}
    }
    static boolean permission(Context c){return (Build.VERSION.SDK_INT<33||c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)&&c.getSystemService(NotificationManager.class).areNotificationsEnabled();}
    @Override public void onNewToken(String token){Listener value=listener.get();if(value!=null)new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(listener.get()==value)value.token(token);});}
    @Override public void onMessageReceived(RemoteMessage message){
        try{
            ReflectionStorage store=new ReflectionStorage(this);if(!NativePush.owns(store.loadPush(),store.loadCredentials())||!permission(this))return;
            NativePush.Open reference=NativePush.Open.parse(new JSONObject(message.getData()));
            Intent intent=new Intent(this,QuestionActivity.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(EXTRA,reference.json().toString());
            PendingIntent open=PendingIntent.getActivity(this,reference.delivery().hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel(CHANNEL,"질문과 확인 요청",NotificationManager.IMPORTANCE_DEFAULT));
            manager.notify(reference.delivery().hashCode(),new Notification.Builder(this,CHANNEL).setSmallIcon(ai.hypeproof.studio.R.drawable.studio_icon).setContentTitle("HP Studio").setContentText("확인할 질문이나 요청이 있어요.").setContentIntent(open).setAutoCancel(true).build());
        }catch(Exception ignored){/* Invalid, expired or signed-out references are not displayed. */}
    }
}
