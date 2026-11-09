package ai.hypeproof.studio;

import org.json.*;
import java.util.UUID;

/** Versioned local records. AI text never creates a confirmed revision. */
public final class StudioState {
    public JSONObject data;
    public StudioState() throws JSONException { data = new JSONObject().put("version", 1).put("projects", new JSONArray()); }
    public StudioState(String raw) throws JSONException {
        data = new JSONObject(raw);
        if (data.getInt("version") != 1 || data.getJSONArray("projects").length() > 100) throw new JSONException("Unsupported records");
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < projects().length(); i++) {
            JSONObject p = projects().getJSONObject(i);
            if (!ids.add(p.getString("id"))) throw new JSONException("Duplicate project");
            p.getString("draft"); p.getString("intentDraft"); p.getString("title");
            JSONArray messages = p.getJSONArray("messages");
            for (int j = 0; j < messages.length(); j++) {
                JSONObject m = messages.getJSONObject(j);
                if (!m.getString("role").equals("user") && !m.getString("role").equals("assistant")) throw new JSONException("Invalid role");
                m.getString("id"); m.getString("content");
            }
            JSONArray revisions = p.getJSONArray("revisions");
            for (int j = 0; j < revisions.length(); j++) {
                JSONObject r = revisions.getJSONObject(j);
                if (!r.getString("author").equals("user") || r.getInt("revision") != j + 1) throw new JSONException("Invalid revision");
                r.getString("text");
            }
        }
    }
    public JSONArray projects() throws JSONException { return data.getJSONArray("projects"); }
    public JSONObject find(String id) throws JSONException {
        for (int i = 0; i < projects().length(); i++) if (projects().getJSONObject(i).getString("id").equals(id)) return projects().getJSONObject(i);
        return null;
    }
    public String create() throws JSONException {
        if (projects().length() >= 100) throw new JSONException("기록이 100개예요. 내보낸 뒤 기록을 정리해 주세요.");
        String id = UUID.randomUUID().toString();
        JSONObject p = new JSONObject().put("id", id).put("title", "새로운 생각").put("draft", "").put("intentDraft", "").put("messages", new JSONArray()).put("revisions", new JSONArray());
        JSONArray next = new JSONArray().put(p); for (int i = 0; i < projects().length(); i++) next.put(projects().get(i));
        data.put("projects", next); return id;
    }
    public static String checked(String raw) {
        String text = raw.trim(); if (text.isEmpty() || text.codePointCount(0, text.length()) > 4000) throw new IllegalArgumentException("1~4,000자로 적어 주세요."); return text;
    }
    public static JSONObject message(String role, String text) throws JSONException { return new JSONObject().put("id", UUID.randomUUID().toString()).put("role", role).put("content", text); }
    public void append(String id, String text) throws JSONException {
        JSONObject p = find(id); text = checked(text);
        if (p.getJSONArray("messages").length() == 0) p.put("title", text.substring(0, Math.min(text.length(), 32)));
        p.getJSONArray("messages").put(message("user", text)); p.put("draft", "");
    }
    public void confirm(String id, String text) throws JSONException {
        JSONObject p = find(id); JSONArray revisions = p.getJSONArray("revisions");
        revisions.put(new JSONObject().put("revision", revisions.length() + 1).put("text", checked(text)).put("author", "user").put("confirmedAt", System.currentTimeMillis())); p.put("intentDraft", "");
    }
    public JSONArray conversation(String id) throws JSONException {
        JSONObject p = find(id);
        String guide = "HP Studio 모바일에서 내 생각을 구체화하고 싶습니다. 관찰한 사실과 추측을 구분하고 다른 사람의 관점을 살핀 뒤 작은 실천으로 생각을 수정하도록 도와주세요. 한 번에 짧은 질문 하나 또는 작은 다음 행동을 제안해 주세요. 목적이 충분히 분명하면 질문을 반복하지 말고 예시나 실행 가능한 다음 행동을 제시해 주세요. 사람의 가치나 성장을 점수화하지 마세요. 도구 실행이나 배포를 했다고 주장하지 마세요.";
        JSONArray revisions = p.getJSONArray("revisions");
        if (revisions.length() > 0) guide += "\n내가 현재 확인한 의도: " + revisions.getJSONObject(revisions.length() - 1).getString("text");
        JSONArray result = new JSONArray().put(new JSONObject().put("role", "user").put("content", guide));
        JSONArray messages = p.getJSONArray("messages");
        for (int i = Math.max(0, messages.length() - 20); i < messages.length(); i++) {
            JSONObject m = messages.getJSONObject(i); result.put(new JSONObject().put("role", m.getString("role")).put("content", m.getString("content")));
        }
        return result;
    }
    public void delete(String id) throws JSONException { for (int i = projects().length() - 1; i >= 0; i--) if (projects().getJSONObject(i).getString("id").equals(id)) projects().remove(i); }
}
