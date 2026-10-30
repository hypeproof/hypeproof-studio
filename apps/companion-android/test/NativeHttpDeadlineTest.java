package ai.hypeproof.companion;

import com.sun.net.httpserver.HttpServer;
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
 public static void main(String[] args)throws Exception{
  var timer=new ScheduledThreadPoolExecutor(1);timer.setRemoveOnCancelPolicy(true);
  var io=Executors.newCachedThreadPool();HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setExecutor(io);
  server.createContext("/drip",exchange->{try{exchange.sendResponseHeaders(200,0);try(var out=exchange.getResponseBody()){for(int i=0;i<100;i++){out.write('x');out.flush();Thread.sleep(40);}}}catch(Exception ignored){}finally{exchange.close();}});
  server.start();String url="http://127.0.0.1:"+server.getAddress().getPort()+"/drip";
  try{bounded(url,timer,0);bounded(url,timer,150);}finally{server.stop(0);timer.shutdownNow();io.shutdownNow();}
 }
}
