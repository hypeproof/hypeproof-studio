package ai.hypeproof.companion;

import android.os.Bundle;

/** Debug-only owned loopback entry; never accepts credentials or enables production transport. */
public final class DeviceSignInFixtureActivity extends MainActivity {
 private NativeDeviceSignIn.Target target;
 @Override public void onCreate(Bundle state) {
  String service=getIntent().getStringExtra("serviceUrl");getIntent().removeExtra("serviceUrl");
  try {if(state==null)target=NativeDeviceSignIn.Target.debugLoopback(BuildConfig.DEBUG,service);}catch(Exception ignored){}
  super.onCreate(state);
 }
 @Override protected NativeDeviceSignIn.Target signInTarget(){return target;}
 @Override protected boolean signInTransportEnabled(){return BuildConfig.DEBUG && target!=null;}
}
