package ai.hypeproof.studio;

import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** App-private, no-backup files; only Keystore-encrypted credentials survive process death. */
final class ReflectionStorage implements ReflectionModel.Store {
    private final File directory;
    private final String alias;
    ReflectionStorage(Context context){directory=new File(context.getNoBackupFilesDir(),"reflection");alias=context.getPackageName()+".reflection-account-v1";}
    private AtomicFile file(String name) throws Exception {if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("storage_unavailable");return new AtomicFile(new File(directory,name));}
    private byte[] read(String name,int maximum) throws Exception {
        AtomicFile f=file(name);if(!f.getBaseFile().exists()&&!new File(f.getBaseFile()+".bak").exists()){if(new File(f.getBaseFile()+".new").exists())throw new IOException("incomplete_storage");return null;}
        try(InputStream in=f.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] chunk=new byte[4096];for(int n;(n=in.read(chunk))!=-1;){if(out.size()+n>maximum)throw new IOException("invalid_storage");out.write(chunk,0,n);}return out.toByteArray();}
    }
    private void write(String name,byte[] value) throws Exception {
        AtomicFile f=file(name);FileOutputStream out=null;
        try{out=f.startWrite();out.write(value);f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}
    }
    private String name(String account) throws Exception {if(!account.matches("[A-Za-z0-9_-]{1,128}"))throw new IOException("invalid_account");return "conversation-"+account+".json";}
    public ReflectionState load(String account) throws Exception {byte[] b=read(name(account),4194304);return b==null?new ReflectionState(account):new ReflectionState(account,new String(b,StandardCharsets.UTF_8));}
    public void save(ReflectionState state) throws Exception {byte[] bytes=state.json().toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>4194304)throw new IOException("storage_limit");write(name(state.account),bytes);}
    void exportOriginal(String account,File destination) throws Exception {try(InputStream in=file(name(account)).openRead();OutputStream out=new FileOutputStream(destination)){byte[] chunk=new byte[8192];for(int n;(n=in.read(chunk))!=-1;)out.write(chunk,0,n);}}
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(alias))return (javax.crypto.SecretKey)store.getKey(alias,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();
    }
    private void credentials(JSONObject value) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] encrypted=cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(1);out.write(cipher.getIV());out.write(encrypted);write("account.bin",out.toByteArray());
    }
    public void saveCredentials(NativeDeviceSignIn.Credentials c) throws Exception {credentials(new JSONObject().put("account",c.account()).put("session",c.session()).put("access_token",c.bearer()).put("refresh_token",c.refresh()).put("expires_at",c.expiresAt()));}
    public void markRefreshSpent() throws Exception {credentials(new JSONObject().put("refresh_spent",true));}
    public NativeDeviceSignIn.Credentials loadCredentials() throws Exception {
        byte[] bytes=read("account.bin",65536);if(bytes==null)return null;
        if(bytes.length<30||bytes[0]!=1)throw new IOException("invalid_credentials");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,bytes,1,12));
        JSONObject v=new JSONObject(new String(cipher.doFinal(bytes,13,bytes.length-13),StandardCharsets.UTF_8));if(v.optBoolean("refresh_spent"))return null;
        java.util.Map<String,Object> fields=new java.util.HashMap<>();for(String k:java.util.List.of("account","session","access_token","refresh_token"))fields.put(k,v.get(k));
        return new NativeDeviceSignIn.Credentials(NativeDeviceSignIn.identifier(fields,"account"),NativeDeviceSignIn.identifier(fields,"session"),NativeDeviceSignIn.token(fields,"access_token"),NativeDeviceSignIn.token(fields,"refresh_token"),ReflectionState.integer(v,"expires_at"));
    }
    public void forgetCredentials() throws Exception {file("account.bin").delete();if(file("account.bin").getBaseFile().exists())throw new IOException("storage_unavailable");}
    void preserveBrokenCredentials() throws Exception {
        AtomicFile f=file("account.bin");String recovery="account-recovery-"+System.nanoTime()+".bin";
        for(String suffix:new String[]{"",".bak",".new"}){File source=new File(f.getBaseFile()+suffix);if(source.exists()&&!source.renameTo(new File(directory,recovery+suffix)))throw new IOException("storage_unavailable");}
    }
}
