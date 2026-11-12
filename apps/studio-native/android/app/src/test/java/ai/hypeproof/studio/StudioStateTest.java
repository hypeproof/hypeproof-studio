package ai.hypeproof.studio;
import org.junit.Test;
import static org.junit.Assert.*;
public class StudioStateTest {
    @Test public void oldNotebookAndPartialReflectionKeepHumanRecords() throws Exception {
        StudioState original=new StudioState();String id=original.create();original.append(id,"직접 본 장면");original.confirm(id,"내가 선택한 의도");
        original.find(id).remove("reflection");String old=original.data.toString();
        StudioState migrated=new StudioState(old);
        assertEquals(1,migrated.data.getInt("version"));
        for(String field:StudioState.REFLECTION_FIELDS)assertEquals("",migrated.find(id).getJSONObject("reflection").getString(field));
        assertEquals(original.find(id).getJSONArray("messages").toString(),migrated.find(id).getJSONArray("messages").toString());
        assertEquals(original.find(id).getJSONArray("revisions").toString(),migrated.find(id).getJSONArray("revisions").toString());
        assertFalse(old.contains("reflection"));
        migrated.find(id).put("reflection",new org.json.JSONObject().put("learning","예상과 달랐다").put("futureNote","보존할 확장"));
        StudioState partial=new StudioState(migrated.data.toString());
        assertEquals("예상과 달랐다",partial.find(id).getJSONObject("reflection").getString("learning"));
        assertEquals("",partial.find(id).getJSONObject("reflection").getString("observation"));
        assertEquals("보존할 확장",partial.find(id).getJSONObject("reflection").getString("futureNote"));
        partial.find(id).getJSONObject("reflection").put("audience",42);
        assertThrows(org.json.JSONException.class,()->new StudioState(partial.data.toString()));
    }
    @Test public void reflectionSurvivesAndNeverBecomesConversationOrConfirmation() throws Exception {
        StudioState state=new StudioState();String first=state.create();state.append(first,"보내기로 선택한 말");
        String second=state.create();state.confirm(second,"두 번째 기록에서 확인한 의도");
        for(String field:StudioState.REFLECTION_FIELDS)state.edit(first,"reflection:"+field,"비공개 메모 "+field+"\n  여백 유지  ");
        state.edit(first,"intentDraft","확인하지 않은 의도");
        StudioState restored=new StudioState(state.data.toString());
        for(String field:StudioState.REFLECTION_FIELDS) {
            assertEquals("비공개 메모 "+field+"\n  여백 유지  ",restored.find(first).getJSONObject("reflection").getString(field));
            assertEquals("",restored.find(second).getJSONObject("reflection").getString(field));
        }
        assertEquals(0,restored.find(first).getJSONArray("revisions").length());
        assertFalse(restored.conversation(first).toString().contains("비공개 메모"));
        assertFalse(restored.conversation(first).toString().contains("확인하지 않은 의도"));
        assertFalse(restored.conversation(second).toString().contains("보내기로 선택한 말"));
        restored.edit(first,"reflection:learning","");
        assertEquals("",new StudioState(restored.data.toString()).find(first).getJSONObject("reflection").getString("learning"));
        assertThrows(org.json.JSONException.class,()->restored.edit(first,"reflection:confirmed","not allowed"));
    }
    @Test public void failedSaveEditsExportWithoutChangingStoredNotesOrOtherProjects() throws Exception {
        StudioState stored=new StudioState();String first=stored.create(),second=stored.create();stored.edit(first,"reflection:observation","저장된 관찰");
        String deleted=stored.create();stored.delete(deleted);
        StudioState exported=stored.includingEdits(java.util.Map.of(first+":reflection:observation","아직 저장하지 못한 관찰",first+":reflection:learning","배운 것",deleted+":reflection:change","삭제한 프로젝트"));
        assertEquals("아직 저장하지 못한 관찰",exported.find(first).getJSONObject("reflection").getString("observation"));
        assertEquals("배운 것",exported.find(first).getJSONObject("reflection").getString("learning"));
        assertEquals("저장된 관찰",stored.find(first).getJSONObject("reflection").getString("observation"));
        assertEquals("",exported.find(second).getJSONObject("reflection").getString("observation"));
        assertNull(exported.find(deleted));
        assertFalse(exported.conversation(first).toString().contains("아직 저장하지 못한"));
    }
    @Test public void historySearchUsesVisibleDraftAndLatestIntentWithoutMutatingRecords() throws Exception {
        StudioState state=new StudioState();String first=state.create();state.append(first,"동네 가게");state.confirm(first,"이전 의도");state.confirm(first,"새 의도");
        String second=state.create();state.edit(second,"draft","버스 시간표");
        StudioState visible=state.includingEdits(java.util.Map.of(second+":draft","아직 저장하지 못한 도서관 관찰"));
        assertEquals("확인한 의도 · 새 의도",visible.subtitle(first));
        assertTrue(visible.matches(first,"새 의도"));assertFalse(visible.matches(first,"이전 의도"));
        assertTrue(visible.matches(second," 도서관 "));assertFalse(visible.matches(first,"도서관"));
        assertEquals("버스 시간표",state.find(second).getString("draft"));
        assertFalse(visible.conversation(second).toString().contains("도서관"));
        String reflectionOnly=state.create();state.edit(reflectionOnly,"reflection:learning","도서관 이용자를 관찰했다");state.edit(reflectionOnly,"reflection:audience","이용자 반응");
        assertEquals("이용자 반응",state.displayTitle(reflectionOnly));
        assertTrue(state.matches(reflectionOnly,"도서관"));
        assertEquals("새로운 생각",state.find(reflectionOnly).getString("title"));
        assertEquals(0,state.find(reflectionOnly).getJSONArray("revisions").length());
    }
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
