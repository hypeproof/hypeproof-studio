package ai.hypeproof.companion;
import org.json.JSONObject;
import java.util.Set;
import java.util.function.BooleanSupplier;
/** Existing main-frame broker's fixed draft subprotocol. Identity/store are native-owned. */
final class NativeDraftBroker {
 interface StoreFactory {NativeDraftStore create()throws Exception;}
 private final StoreFactory factory;private final BooleanSupplier eligible;private NativeDraftStore store;
 NativeDraftBroker(StoreFactory factory,BooleanSupplier eligible){this.factory=factory;this.eligible=eligible;}
 static boolean trustedFrame(boolean mainFrame,String origin){return mainFrame&&"https://appassets.androidplatform.net".equals(origin);}
 synchronized JSONObject request(JSONObject r)throws Exception{
  NativeDraftRecord.require(eligible.getAsBoolean());String kind=NativeDraftRecord.string(r,"kind");
  NativeDraftRecord.require(Set.of("draft.read","draft.replace","draft.erase").contains(kind));
  if(kind.equals("draft.read"))NativeDraftRecord.require(NativeDraftRecord.keys(r).equals(Set.of("id","kind")));
  if(store==null)store=factory.create();JSONObject result=kind.equals("draft.read")?store.read():store.operate(r);
  NativeDraftRecord.require(eligible.getAsBoolean());return result;
 }
}
