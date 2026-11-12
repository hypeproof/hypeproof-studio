package ai.hypeproof.studio;

import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class StudioService {
    private volatile HttpURLConnection active;
    public void cancel() { HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    public JSONObject claim(String installID) throws Exception {
        return request("/v1/free/claim", new JSONObject().put("install_id", installID.toLowerCase(Locale.ROOT)).put("age_ok", true).put("app_version", "2026.1110.0"), Collections.emptyMap());
    }
    public String reply(StudioState state, String id, String token) throws Exception {
        JSONArray messages = state.find(id).getJSONArray("messages");
        JSONObject last = messages.getJSONObject(messages.length() - 1);
        if (!last.getString("role").equals("user")) throw new IOException("먼저 생각을 적어 주세요.");
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer " + token); headers.put("anthropic-version", "2023-06-01"); headers.put("x-hps-effort", "low"); headers.put("x-hps-turn-id", last.getString("id")); headers.put("x-hps-trial-request-id", UUID.randomUUID().toString());
        JSONObject response = request("/v1/messages", new JSONObject().put("model", "hypeproof-fast").put("messages", state.conversation(id)).put("max_tokens", 2048).put("stream", false), headers);
        JSONArray content = response.getJSONArray("content"); StringBuilder text = new StringBuilder();
        for (int i = 0; i < content.length(); i++) if (content.getJSONObject(i).optString("type").equals("text")) text.append(content.getJSONObject(i).getString("text")).append('\n');
        if (text.toString().trim().isEmpty()) throw new IOException("AI 답변이 비어 있어요. 잠시 뒤 다시 시도해 주세요.");
        if (response.optString("stop_reason").equals("max_tokens")) text.append("\n응답 길이 제한으로 여기까지 받았어요.");
        return text.toString().trim();
    }
    private JSONObject request(String path, JSONObject body, Map<String, String> headers) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("https://api.hypeproof-ai.xyz" + path).openConnection();
        active = connection;
        try {
            connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST"); connection.setConnectTimeout(15000); connection.setReadTimeout(90000); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
            for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
            try (OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int status = connection.getResponseCode(); InputStream source = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String text;
            if (source == null) text = "{}";
            else try (InputStream input = source; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) { if (out.size() + count > 1048576) throw new IOException("응답 크기 제한을 넘었어요."); out.write(buffer, 0, count); }
                text = out.toString(StandardCharsets.UTF_8.name());
            }
            JSONObject result; try { result = new JSONObject(text); } catch (JSONException e) { throw new IOException("AI 응답 형식을 확인하지 못했어요."); }
            if (status < 200 || status >= 300) {
                JSONObject error = result.optJSONObject("error"); String code = error == null ? "" : error.optString("code", error.optString("type"));
                throw new Failure(status, code);
            }
            return result;
        } finally { connection.disconnect(); if (active == connection) active = null; }
    }
    public static final class Failure extends IOException {
        public final int status;
        public Failure(int status, String code) { super(friendly(status, code)); this.status = status; }
    }
    public static String friendly(int status, String code) {
        if (code.equals("network_limit") || code.equals("rate_limited")) return "무료 연결 요청이 잠시 많아요. 잠시 뒤 다시 시도해 주세요.";
        if (code.equals("claim_busy") || code.equals("trial_busy")) return "앞선 요청을 마무리하고 있어요. 잠시 뒤 다시 시도해 주세요.";
        if (code.equals("under_14")) return "현재 무료 AI는 만 14세 이상에게 제공돼요.";
        if (code.equals("app_too_old")) return "앱을 최신 버전으로 업데이트해 주세요.";
        if (code.equals("allowance_revoked")) return "무료 AI 이용이 중지되어 있어요. HypeProof 지원팀에 문의해 주세요.";
        if (code.equals("trial_input_limit")) return "대화가 길어졌어요. 의도를 기록하고 새 생각으로 이어가 주세요.";
        if (status == 429) return "무료 AI 사용 한도에 도달했어요. 기록은 그대로 남아요. 나중에 다시 시도해 주세요.";
        if (status == 401 || status == 403) return "AI 연결 권한을 확인해야 해요. 다시 연결해 주세요.";
        return "AI에 연결하지 못했어요. 작성한 내용은 유지돼요. 잠시 뒤 다시 시도해 주세요.";
    }
}
