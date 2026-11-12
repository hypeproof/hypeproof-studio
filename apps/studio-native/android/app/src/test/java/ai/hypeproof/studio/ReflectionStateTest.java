package ai.hypeproof.studio;
import org.junit.Test;
import org.json.*;
import java.util.Map;
import static org.junit.Assert.*;

public class ReflectionStateTest {
    static JSONObject reply(long revision,JSONArray messages,JSONObject turn) throws Exception {return new JSONObject().put("state",new JSONObject().put("id","personal-reflection").put("revision",revision).put("messages",messages).put("turn",turn==null?JSONObject.NULL:turn).put("has_earlier",false)).put("opening",ReflectionState.OPENING).put("hint",ReflectionState.HINT);}
    static JSONObject message(String id,String role,String text) throws Exception {return new JSONObject().put("id",id).put("role",role).put("content",text).put("created_at",1000);}
    @Test public void pendingWordsSurviveProcessDeathAndUnacknowledgedPoll() throws Exception {
        ReflectionState original=new ReflectionState("account-A");original.revision=9;original.draft="내가 본 장면";original.enqueue();Map<String,String> turn=original.submission();
        ReflectionState restored=new ReflectionState("account-A",original.json().toString());restored.apply(reply(10,new JSONArray(),null));
        assertEquals(turn,restored.submission());assertEquals("9",restored.submission().get("revision"));assertEquals("",restored.draft);
        assertThrows(Exception.class,()->new ReflectionState("account-B",original.json().toString()));
    }
    @Test public void acknowledgementReconcilesExactWordsAndVoiceNeverReadsAnotherTurn() throws Exception {
        ReflectionState state=new ReflectionState("A");state.draft="나의 선택";state.enqueue();String id=state.request.getString("id");
        JSONObject completed=new JSONObject(state.request.toString()).put("status","completed");JSONArray messages=new JSONArray().put(message(id,"user","나의 선택")).put(message(id+"-answer","assistant","무엇이 중요했나요?"));
        state.apply(reply(2,messages,completed));assertFalse(state.outstanding());assertEquals("무엇이 중요했나요?",state.voiceAnswer(id));assertNull(state.voiceAnswer("other"));
        completed.put("id","other");state.apply(reply(3,messages,completed));assertNull(state.voiceAnswer(id));
    }
    @Test public void staleMalformedOrDuplicateSnapshotCannotChangeTheRecord() throws Exception {
        ReflectionState state=new ReflectionState("A");state.revision=4;state.draft="남겨 둘 초안";String before=state.json().toString();
        assertThrows(Exception.class,()->state.apply(reply(3,new JSONArray(),null)));
        JSONArray duplicates=new JSONArray().put(message("x","user","one")).put(message("x","assistant","two"));assertThrows(Exception.class,()->state.apply(reply(5,duplicates,null)));
        JSONObject bad=reply(5,new JSONArray(),null);bad.getJSONObject("state").put("revision",5.5);assertThrows(Exception.class,()->state.apply(bad));assertEquals(before,state.json().toString());
    }
    @Test public void draftsAndOutboxRejectOversizeAndCorruptionInsteadOfStartingFresh() throws Exception {
        ReflectionState state=new ReflectionState("A");state.draft="x".repeat(4001);assertThrows(Exception.class,state::enqueue);
        state.draft="valid";state.enqueue();assertThrows(Exception.class,state::enqueue);
        JSONObject encoded=state.json();encoded.getJSONObject("request").remove("expected_revision");assertThrows(Exception.class,()->new ReflectionState("A",encoded.toString()));assertThrows(Exception.class,()->new ReflectionState("A","{broken"));
    }
    @Test public void malformedUTF8AndUnpairedDraftSurrogatesNeverBecomeReplacementText() throws Exception {
        ReflectionState state=new ReflectionState("A");state.draft="kept";byte[] encoded=ReflectionState.encode(state.json().toString());
        for(int i=0;i<encoded.length-4;i++)if(encoded[i]=='k'&&encoded[i+1]=='e'&&encoded[i+2]=='p'&&encoded[i+3]=='t'){encoded[i]=(byte)0xc3;encoded[i+1]=0x28;break;}
        assertThrows(Exception.class,()->ReflectionState.decode(encoded));
        state.draft="\uD800";assertThrows(Exception.class,()->ReflectionState.encode(state.json().toString()));
        state.draft="한글과 🙂";assertEquals(state.draft,new ReflectionState("A",ReflectionState.decode(ReflectionState.encode(state.json().toString()))).draft);
    }

}
