package ai.hypeproof.studio;

import org.json.*;
import java.util.UUID;

/** Versioned local records. AI text never creates a confirmed revision. */
public final class StudioState {
    public static final String[] REFLECTION_FIELDS = {"observation", "audience", "change", "experiment", "learning"};
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
            // v1 notebooks predate reflection. Missing fields migrate without touching existing text.
            if (!p.has("reflection")) p.put("reflection", emptyReflection());
            JSONObject reflection = p.getJSONObject("reflection");
            for (String field : REFLECTION_FIELDS) {
                if (!reflection.has(field)) reflection.put(field, "");
                if (!(reflection.get(field) instanceof String)) throw new JSONException("Invalid reflection field");
            }
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
    public StudioState includingEdits(java.util.Map<String,String> edits) throws JSONException {
        StudioState snapshot = new StudioState(data.toString());
        for (int i = 0; i < snapshot.projects().length(); i++) {
            JSONObject p = snapshot.projects().getJSONObject(i); String id = p.getString("id");
            for (String key : new String[]{"draft", "intentDraft"}) if (edits.containsKey(id + ":" + key)) p.put(key, edits.get(id + ":" + key));
            for (String key : REFLECTION_FIELDS) if (edits.containsKey(id + ":reflection:" + key)) p.getJSONObject("reflection").put(key, edits.get(id + ":reflection:" + key));
        }
        return snapshot;
    }
    public JSONArray projects() throws JSONException { return data.getJSONArray("projects"); }
    public JSONObject find(String id) throws JSONException {
        for (int i = 0; i < projects().length(); i++) if (projects().getJSONObject(i).getString("id").equals(id)) return projects().getJSONObject(i);
        return null;
    }
    public String create() throws JSONException {
        if (projects().length() >= 100) throw new JSONException("기록이 100개예요. 내보낸 뒤 기록을 정리해 주세요.");
        String id = UUID.randomUUID().toString();
        JSONObject p = new JSONObject().put("id", id).put("updatedAt", System.currentTimeMillis()).put("title", "새로운 생각").put("draft", "").put("intentDraft", "").put("reflection", emptyReflection()).put("messages", new JSONArray()).put("revisions", new JSONArray());
        JSONArray next = new JSONArray().put(p); for (int i = 0; i < projects().length(); i++) next.put(projects().get(i));
        data.put("projects", next); return id;
    }
    private static JSONObject emptyReflection() throws JSONException {
        JSONObject notes = new JSONObject(); for (String field : REFLECTION_FIELDS) notes.put(field, ""); return notes;
    }
    public void edit(String id, String key, String value) throws JSONException {
        JSONObject p = find(id); if (p == null) throw new JSONException("Missing project");
        if (key.equals("draft") || key.equals("intentDraft")) p.put(key, value);
        else {
            boolean allowed = false;
            for (String field : REFLECTION_FIELDS) if (key.equals("reflection:" + field)) { p.getJSONObject("reflection").put(field, value); allowed = true; break; }
            if (!allowed) throw new JSONException("Invalid editable field");
        }
        p.put("updatedAt", System.currentTimeMillis());
    }
    public String subtitle(String id) throws JSONException {
        JSONObject p = find(id); JSONArray revisions = p.getJSONArray("revisions");
        if (revisions.length() > 0) return "확인한 의도 · " + revisions.getJSONObject(revisions.length() - 1).getString("text");
        if (!p.getString("intentDraft").trim().isEmpty()) return "의도 작성 중 · " + p.getString("intentDraft");
        if (!p.getString("draft").trim().isEmpty()) return "작성 중 · " + p.getString("draft");
        for(String field:REFLECTION_FIELDS)if(!p.getJSONObject("reflection").getString(field).trim().isEmpty())return "생각 정리 · "+p.getJSONObject("reflection").getString(field);
        return "아직 확인한 의도가 없어요";
    }
    public String displayTitle(String id) throws JSONException {
        JSONObject p=find(id);
        if(p.getJSONArray("messages").length()>0 || !p.getString("title").equals("새로운 생각"))return p.getString("title");
        for(String field:REFLECTION_FIELDS) {
            String note=p.getJSONObject("reflection").getString(field).trim();
            if(!note.isEmpty())return note.substring(0,note.offsetByCodePoints(0,Math.min(32,note.codePointCount(0,note.length()))));
        }
        return p.getString("title");
    }
    public boolean matches(String id, String query) throws JSONException {
        String needle = query.trim().toLowerCase(java.util.Locale.ROOT);
        JSONObject p = find(id);
        for(String field:REFLECTION_FIELDS)if(p.getJSONObject("reflection").getString(field).toLowerCase(java.util.Locale.ROOT).contains(needle))return true;
        return p.getString("title").toLowerCase(java.util.Locale.ROOT).contains(needle)
            || subtitle(id).toLowerCase(java.util.Locale.ROOT).contains(needle)
            || p.getString("draft").toLowerCase(java.util.Locale.ROOT).contains(needle)
            || p.getString("intentDraft").toLowerCase(java.util.Locale.ROOT).contains(needle);
    }
    public static String checked(String raw) {
        String text = raw.trim(); if (text.isEmpty() || text.codePointCount(0, text.length()) > 4000) throw new IllegalArgumentException("1~4,000자로 적어 주세요."); return text;
    }
    public static JSONObject message(String role, String text) throws JSONException { return new JSONObject().put("id", UUID.randomUUID().toString()).put("role", role).put("content", text); }
    public void append(String id, String text) throws JSONException {
        JSONObject p = find(id); text = checked(text);
        if (p.getJSONArray("messages").length() == 0) p.put("title", text.substring(0, Math.min(text.length(), 32)));
        p.getJSONArray("messages").put(message("user", text)); p.put("draft", ""); p.put("updatedAt", System.currentTimeMillis());
    }
    public void confirm(String id, String text) throws JSONException {
        JSONObject p = find(id); JSONArray revisions = p.getJSONArray("revisions");
        revisions.put(new JSONObject().put("revision", revisions.length() + 1).put("text", checked(text)).put("author", "user").put("confirmedAt", System.currentTimeMillis())); p.put("intentDraft", ""); p.put("updatedAt", System.currentTimeMillis());
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
