package ai.hypeproof.studio;

import java.util.Map;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Account reads performed by the real Activity alongside each scenario's transport.
 * No writes, cards, reflection responses, or unknown routes are accepted here. */
final class SignedInReadFixture {
    private SignedInReadFixture() {}

    static NativeDeviceSignIn.Reply read(String path, Map<String,String> body,
            String bearer, String account, String session) throws Exception {
        if (!path.equals("/me") && !path.equals("/me/product-events/consent")) return null;
        assertNull("account fixture only accepts reads", body);
        assertEquals("synthetic-access", bearer);
        if (path.equals("/me")) {
            return new NativeDeviceSignIn.Reply(200, Map.of(
                    "account_id", account, "session_id", session, "account_status", "active"));
        }
        // A current metadata read is distinct from opting in. These journeys must
        // never emit metrics; an unexpected write still reaches their refusal.
        return new NativeDeviceSignIn.Reply(200, Map.of(
                "schema", "hps-product-consent/1", "notice_version", "team-ux/1",
                "title", "사용 경험 공유", "notice", "대화 원문 없이 사용 단계만 기록해요. 거절해도 질문과 승인은 그대로 사용할 수 있어요.",
                "preference", new JSONObject().put("notice_version", "team-ux/1").put("granted", 0)));
    }
}
