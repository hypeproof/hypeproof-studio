package ai.hypeproof.studio;

/** Owns callback identity; neither permission nor an old result can resume a stopped session. */
final class VoiceSession {
    enum Phase { IDLE, PERMISSION, LISTENING, WAITING, SPEAKING, READY }
    private long epoch;
    private String project;
    private boolean conversation;
    private Phase phase = Phase.IDLE;
    long start(String id, boolean automatic) {
        stop(); project=id; conversation=automatic; phase=Phase.PERMISSION; return epoch;
    }
    boolean matches(long ticket, String id) { return phase!=Phase.IDLE && epoch==ticket && project!=null && project.equals(id); }
    boolean listening(long ticket, String id) { return matches(ticket,id)&&phase==Phase.LISTENING; }
    boolean beginListening(long ticket, String id) {
        if(!matches(ticket,id)||(phase!=Phase.PERMISSION&&phase!=Phase.READY))return false;
        phase=Phase.LISTENING;return true;
    }
    boolean finish(long ticket, String id) {
        if(!listening(ticket,id))return false;
        phase=Phase.WAITING;return true;
    }
    boolean speak(long ticket, String id) {
        if(!matches(ticket,id)||phase!=Phase.WAITING)return false;
        phase=Phase.SPEAKING;return true;
    }
    boolean ready(long ticket, String id) {
        if(!matches(ticket,id)||phase!=Phase.SPEAKING)return false;
        phase=Phase.READY;return true;
    }
    long next(String id) {
        if(phase!=Phase.READY||!project.equals(id))return -1;
        epoch++; return epoch;
    }
    void stop() { epoch++;phase=Phase.IDLE;project=null;conversation=false; }
    long ticket(){return epoch;} String project(){return project;}
    boolean conversation(){return conversation;} Phase phase(){return phase;}
    boolean active(){return phase!=Phase.IDLE;}
}
