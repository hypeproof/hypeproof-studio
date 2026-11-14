package ai.hypeproof.studio;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Owned loopback sockets, including actual headers/body; no Android networking mocks. */
final class TestHttpServer implements AutoCloseable {
    interface Handler {void handle(Request r)throws Exception;}
    static final class Request {
        final String path;final Map<String,String> headers=new HashMap<>();final byte[] body;final OutputStream out;
        Request(Socket socket)throws Exception{InputStream in=socket.getInputStream();out=socket.getOutputStream();path=line(in).split(" ")[1];for(String l;!(l=line(in)).isEmpty();){int split=l.indexOf(':');headers.put(l.substring(0,split).toLowerCase(Locale.ROOT),l.substring(split+1).trim());}body=in.readNBytes(Integer.parseInt(headers.getOrDefault("content-length","0")));}
        void respond(int code,String type,byte[] bytes,String extra)throws Exception{out.write(("HTTP/1.1 "+code+" Test\r\nContent-Type: "+type+"\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n"+extra+"\r\n").getBytes(StandardCharsets.US_ASCII));out.write(bytes);out.flush();}
        private static String line(InputStream in)throws IOException{ByteArrayOutputStream b=new ByteArrayOutputStream();for(int n;(n=in.read())!=-1;){if(n=='\n')break;if(n!='\r')b.write(n);if(b.size()>8192)throw new IOException("long_header");}return b.toString(StandardCharsets.US_ASCII);}
    }
    final ServerSocket server=new ServerSocket(0,10,InetAddress.getByName("127.0.0.1"));
    final ExecutorService workers=Executors.newCachedThreadPool();volatile Throwable failure;
    TestHttpServer(Handler handler)throws Exception{workers.execute(()->{while(!server.isClosed()){try{Socket socket=server.accept();socket.setSoTimeout(2000);workers.execute(()->{try(socket){handler.handle(new Request(socket));}catch(IOException ignored){}catch(InterruptedException e){Thread.currentThread().interrupt();if(!server.isClosed())failure=e;}catch(Throwable e){failure=e;}});}catch(IOException e){if(!server.isClosed())failure=e;}}});}
    String url(){return "http://127.0.0.1:"+server.getLocalPort();}
    void check(){if(failure!=null)throw new AssertionError(failure);}
    public void close()throws Exception{server.close();workers.shutdownNow();workers.awaitTermination(3,TimeUnit.SECONDS);check();}
}
