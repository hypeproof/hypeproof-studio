package ai.hypeproof.studio;

import java.net.*;
import java.util.concurrent.*;
import java.io.*;

/** Real owned loopback HTTP: a drip must not reset the whole-call bound. */
public final class NativeHttpDeadlineTest {
 static void read(String url,NativeDeviceSignIn.Cancel cancel,ScheduledExecutorService timer,long bound)throws Exception{
  HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
  try(NativeHttpDeadline deadline=new NativeHttpDeadline(cancel,timer,bound)){
   cancel.bind(c::disconnect);c.setConnectTimeout(deadline.remaining());c.setReadTimeout(deadline.remaining());
   c.getResponseCode();try(InputStream in=c.getInputStream()){while(true){c.setReadTimeout(deadline.remaining());if(in.read()==-1)throw new AssertionError("unexpected EOF");}}
  }finally{cancel.unbind();c.disconnect();}
 }
 static void bounded(String url,ScheduledExecutorService timer,long cancelAfter)throws Exception{
  var cancel=new NativeDeviceSignIn.Cancel();long start=System.nanoTime();
  ScheduledFuture<?> explicit=cancelAfter>0?timer.schedule(cancel::cancel,cancelAfter,TimeUnit.MILLISECONDS):null;
  try{read(url,cancel,timer,600);throw new AssertionError("unbounded drip");}catch(AssertionError e){throw e;}catch(Exception expected){}
  finally{if(explicit!=null)explicit.cancel(false);}
  long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
  if(!cancel.isCancelled() || elapsed>1800 || (cancelAfter==0 && elapsed<450))throw new AssertionError("deadline/cancel elapsed="+elapsed);
  System.out.println("PASS real HTTP "+(cancelAfter==0?"whole-call drip deadline":"explicit cancellation")+" elapsed="+elapsed+"ms");
 }
 @org.junit.Test public void protocolControls()throws Exception{
  var timer=new ScheduledThreadPoolExecutor(1);timer.setRemoveOnCancelPolicy(true);
  var server=new TestHttpServer(exchange->{exchange.out.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));for(int i=0;i<100;i++){exchange.out.write('x');exchange.out.flush();Thread.sleep(40);}});
  String url=server.url()+"/drip";
  try{bounded(url,timer,0);bounded(url,timer,150);}finally{server.close();timer.shutdownNow();}
 }
}
