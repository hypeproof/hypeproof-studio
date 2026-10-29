package ai.hypeproof.companion;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.util.function.BooleanSupplier;
/** Platform commit/rollback; no cold read recovery that could silently remove pending bytes. */
final class AndroidDraftFile implements NativeDraftStore.AtomicIO {
 public void replace(File base,byte[] bytes,BooleanSupplier current)throws Exception{
  AtomicFile file=new AtomicFile(base);FileOutputStream out=null;
  try{out=file.startWrite();out.write(bytes);out.flush();out.getFD().sync();
   if(!current.getAsBoolean())throw new Exception("draft_owner_changed");
   file.finishWrite(out);out=null;
  }finally{if(out!=null)file.failWrite(out);}
 }
 public void erase(File base){new AtomicFile(base).delete();}
}
