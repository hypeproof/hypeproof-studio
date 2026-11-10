package ai.hypeproof.studio;
import org.junit.Test;
import static org.junit.Assert.*;
public class StudioStateTest {
    @Test public void exportRetainsVisibleEditsWhenPersistedDraftIsOlder() throws Exception {
        StudioState saved = new StudioState(); String id = saved.create(); saved.find(id).put("draft", "old draft A");
        StudioState exported = saved.includingEdits(java.util.Map.of(id+":draft", "visible draft B", id+":intentDraft", "unconfirmed intention B"));
        assertEquals("visible draft B", exported.find(id).getString("draft"));
        assertEquals("unconfirmed intention B", exported.find(id).getString("intentDraft"));
        assertEquals(0, exported.find(id).getJSONArray("revisions").length());
        assertEquals("old draft A", saved.find(id).getString("draft"));
    }
    @Test public void humanRevisionContextAndRestore() throws Exception {
        StudioState state=new StudioState();String first=state.create();state.append(first,"Observe a local shop");
        state.find(first).getJSONArray("messages").put(StudioState.message("assistant","Who needs this?"));
        assertEquals(0,state.find(first).getJSONArray("revisions").length());
        state.confirm(first,"Ask the owner");state.confirm(first,"Ask a customer");
        assertEquals(2,state.find(first).getJSONArray("revisions").length());
        assertTrue(state.conversation(first).getJSONObject(0).getString("content").contains("Ask a customer"));
        assertFalse(state.conversation(first).getJSONObject(0).getString("content").contains("Ask the owner"));
        String second=state.create();state.find(second).put("draft","Unfinished observation");
        StudioState restored=new StudioState(state.data.toString());
        assertEquals("Unfinished observation",restored.find(second).getString("draft"));
        assertFalse(restored.conversation(second).toString().contains("local shop"));
        restored.delete(first);assertNull(restored.find(first));assertNotNull(restored.find(second));
    }
    @Test public void rejectsUnknownAndForgedRecords() throws Exception {
        StudioState state=new StudioState();String id=state.create();state.confirm(id,"My intention");
        state.find(id).getJSONArray("revisions").getJSONObject(0).put("author","assistant");
        assertThrows(org.json.JSONException.class,()->new StudioState(state.data.toString()));
        assertThrows(IllegalArgumentException.class,()->StudioState.checked("   "));
        assertThrows(IllegalArgumentException.class,()->StudioState.checked("a".repeat(4001)));
    }
    @Test public void boundedContextAndAdmissionError() throws Exception {
        StudioState state=new StudioState();String id=state.create();for(int i=0;i<30;i++)state.append(id,"Observation "+i);
        assertEquals(21,state.conversation(id).length());
        assertNotEquals(StudioService.friendly(429,"network_limit"),StudioService.friendly(429,"trial_allowance_exhausted"));
    }
}
