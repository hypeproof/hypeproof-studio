package ai.hypeproof.studio;

import org.junit.Test;
import static org.junit.Assert.*;

public class VoiceSessionTest {
    @Test public void stoppedOrDifferentProjectCannotAcceptPermissionPartialOrFinal(){
        VoiceSession s=new VoiceSession();long old=s.start("one",true);
        assertFalse(s.beginListening(old,"two"));
        s.stop();assertFalse(s.beginListening(old,"one"));assertFalse(s.finish(old,"one"));
        long fresh=s.start("two",false);assertTrue(s.beginListening(fresh,"two"));
        assertFalse(s.listening(old,"one"));assertFalse(s.finish(old,"one"));
        assertTrue(s.finish(fresh,"two"));assertFalse(s.finish(fresh,"two"));
        assertFalse(s.conversation());
    }
    @Test public void fiveTurnsRequireExplicitNextAndNeverAcceptDuplicateOrLateResults(){
        VoiceSession s=new VoiceSession();long ticket=s.start("one",true);
        for(int turn=0;turn<5;turn++){
            assertTrue(s.beginListening(ticket,"one"));assertTrue(s.finish(ticket,"one"));
            assertFalse(s.finish(ticket,"one"));assertFalse(s.beginListening(ticket,"one"));
            assertTrue(s.speak(ticket,"one"));assertTrue(s.ready(ticket,"one"));
            assertFalse(s.listening(ticket,"one"));assertFalse(s.finish(ticket,"one"));
            assertEquals(VoiceSession.Phase.READY,s.phase());
            long previous=ticket;ticket=s.next("one");assertTrue(ticket>previous);
            assertFalse(s.ready(previous,"one"));assertFalse(s.finish(previous,"one"));
        }
    }
    @Test public void everyInFlightPhaseInvalidatesOnStopAndNewSession(){
        for(int phase=0;phase<5;phase++){
            VoiceSession s=new VoiceSession();long old=s.start("p",true);
            if(phase>=1)s.beginListening(old,"p");if(phase>=2)s.finish(old,"p");
            if(phase>=3)s.speak(old,"p");if(phase>=4)s.ready(old,"p");
            s.stop();assertFalse(s.active());assertFalse(s.conversation());
            long fresh=s.start("p",true);assertTrue(fresh>old);
            assertFalse(s.matches(old,"p"));assertFalse(s.finish(old,"p"));assertFalse(s.ready(old,"p"));
        }
    }
}
