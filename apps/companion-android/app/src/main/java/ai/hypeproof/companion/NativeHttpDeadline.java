package ai.hypeproof.companion;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Absolute native HTTP bound, including a peer which keeps delivering small chunks. */
final class NativeHttpDeadline implements AutoCloseable {
 private final NativeDeviceSignIn.Cancel cancel;
 private final long end;
 private final ScheduledFuture<?> watchdog;
 NativeHttpDeadline(NativeDeviceSignIn.Cancel cancel,ScheduledExecutorService scheduler,long timeoutMillis){
  this.cancel=cancel;end=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
  watchdog=scheduler.schedule(cancel::cancel,timeoutMillis,TimeUnit.MILLISECONDS);
 }
 int remaining() throws Exception {
  long nanos=end-System.nanoTime();if(cancel.isCancelled() || nanos<=0){cancel.cancel();throw new Exception("native_deadline");}
  return (int)Math.max(1,Math.min(Integer.MAX_VALUE,TimeUnit.NANOSECONDS.toMillis(nanos)));
 }
 @Override public void close(){watchdog.cancel(false);}
}
