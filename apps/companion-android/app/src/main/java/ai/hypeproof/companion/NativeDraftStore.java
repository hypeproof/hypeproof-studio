package ai.hypeproof.companion;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.*;
import java.util.function.BooleanSupplier;
/** Single process-wide slot. Android supplies AtomicFile IO; no path/identity comes from WebView. */
final class NativeDraftStore {
 interface AtomicIO {void replace(File base,byte[] bytes,BooleanSupplier current)throws Exception;void erase(File base)throws Exception;}
 private static final Object LOCK=new Object();private static final Map<String,String> OWNERS=new HashMap<>();
 static void lifecycle(Runnable change){synchronized(LOCK){change.run();}}
 private final File directory;private final String account,service,name,namespace;private final AtomicIO io;private final BooleanSupplier live;
 private String generation;private String erasedGeneration;private Object erasedVersion;
 NativeDraftStore(File directory,String account,String service,AtomicIO io,BooleanSupplier live)throws Exception{
  this.directory=directory;this.account=account;this.service=service;this.io=io;this.live=live;
  namespace=directory.getCanonicalPath();name="draft-"+NativeDraftRecord.hash(service+"\n"+account)+".json";
 }
 private void current()throws Exception{NativeDraftRecord.require(live.getAsBoolean()&&generation!=null&&generation.equals(OWNERS.get(namespace)));}
 private List<File> files()throws Exception{
  if(!directory.exists())NativeDraftRecord.require(directory.mkdirs());NativeDraftRecord.require(directory.isDirectory()&&!Files.isSymbolicLink(directory.toPath()));
  File[] entries=directory.listFiles();NativeDraftRecord.require(entries!=null);return Arrays.stream(entries).sorted(Comparator.comparing(File::getName)).toList();
 }
 private boolean ours(File f){return Set.of(name,name+".bak",name+".new").contains(f.getName())&&f.isFile()&&!Files.isSymbolicLink(f.toPath());}
 private byte[] boundedRead(File file)throws Exception{
  try(var in=new FileInputStream(file)){byte[] bytes=in.readNBytes(NativeDraftRecord.LIMIT+1);NativeDraftRecord.require(bytes.length<=NativeDraftRecord.LIMIT);return bytes;}
 }
 private JSONObject snapshot()throws Exception{
  current();List<File> entries=files();JSONObject reply=new JSONObject().put("generation",generation).put("version",JSONObject.NULL);
  if(entries.isEmpty())return reply.put("state","empty");
  if(entries.stream().anyMatch(f->!ours(f)))return reply.put("state","foreign");
  // Keep interrupted transaction bytes. Never let AtomicFile.openRead delete .new or replace .bak implicitly.
  var digest=java.security.MessageDigest.getInstance("SHA-256");
  for(File f:entries){digest.update((f.getName()+":"+f.length()+":"+f.lastModified()).getBytes(StandardCharsets.UTF_8));try(var in=new FileInputStream(f)){digest.update(in.readNBytes(NativeDraftRecord.LIMIT+1));}}
  StringBuilder version=new StringBuilder();for(byte b:digest.digest())version.append(String.format("%02x",b&255));reply.put("version",version.toString());
  if(entries.size()!=1||!entries.get(0).getName().equals(name)||entries.get(0).length()>NativeDraftRecord.LIMIT)return reply.put("state","corrupt");
  try{String raw=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(boundedRead(entries.get(0)))).toString();return reply.put("state","record").put("record",NativeDraftRecord.parse(raw,account,service));}
  catch(Exception invalid){return reply.put("state","corrupt");}
 }
 JSONObject read()throws Exception{synchronized(LOCK){NativeDraftRecord.require(live.getAsBoolean());generation=UUID.randomUUID().toString();OWNERS.put(namespace,generation);erasedGeneration=null;erasedVersion=null;return snapshot();}}
 JSONObject operate(JSONObject request)throws Exception{synchronized(LOCK){
  current();String kind=NativeDraftRecord.string(request,"kind");Set<String> keys=new HashSet<>(Set.of("id","kind","generation","expectedVersion"));if(kind.equals("draft.replace"))keys.add("value");else NativeDraftRecord.require(kind.equals("draft.erase"));
  NativeDraftRecord.require(NativeDraftRecord.keys(request).equals(keys));
  JSONObject old=snapshot();
  if(kind.equals("draft.erase")&&old.getString("state").equals("empty")&&Objects.equals(erasedGeneration,request.get("generation"))&&Objects.equals(erasedVersion,request.get("expectedVersion")))return old;
  NativeDraftRecord.require(generation.equals(NativeDraftRecord.string(request,"generation")));NativeDraftRecord.require(!old.getString("state").equals("foreign")&&Objects.equals(old.get("version"),request.get("expectedVersion")));
  File base=new File(directory,name);
  if(kind.equals("draft.erase")){
   current();io.erase(base);current();NativeDraftRecord.require(files().isEmpty());erasedGeneration=generation;erasedVersion=old.get("version");generation=UUID.randomUUID().toString();OWNERS.put(namespace,generation);return snapshot();
  }
  NativeDraftRecord.require(!old.getString("state").equals("corrupt"));JSONObject value=NativeDraftRecord.value(request.getJSONObject("value"),account);
  JSONObject previous=old.optJSONObject("record");if(previous!=null){
   NativeDraftRecord.require(!previous.getString("phase").equals("attempted_unknown"));
   // Changing selected scope is an explicit UI recovery operation; native still preserves exact request schema and account.
  }
  long now=Math.max(0,System.currentTimeMillis()),revision=previous==null?1:NativeDraftRecord.number(previous,"revision")+1;
  JSONObject record=new JSONObject(value.toString()).put("schema",NativeDraftRecord.SCHEMA).put("accountId",account).put("service",service).put("revision",revision)
   .put("createdAt",previous==null?now:previous.get("createdAt")).put("updatedAt",now);
  byte[] bytes=record.toString().getBytes(StandardCharsets.UTF_8);NativeDraftRecord.parse(record.toString(),account,service);current();
  io.replace(base,bytes,()->live.getAsBoolean()&&generation.equals(OWNERS.get(namespace)));current();
  JSONObject committed=snapshot();NativeDraftRecord.require(committed.getString("state").equals("record")&&Arrays.equals(bytes,boundedRead(base)));return committed;
 }}
}
