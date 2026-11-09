// Run through the shared remote_ai resource queue. Never print the credential.
import { createProject, conversation } from "../public/model.mjs";
const origin =
  process.env.HP_MOBILE_ORIGIN ?? "https://hp-studio-mobile-mvp.vercel.app";
const installId = process.env.HP_MOBILE_TEST_INSTALL_ID;
if (!installId)
  throw Error(
    "Set a persistent HP_MOBILE_TEST_INSTALL_ID; do not create a new allowance per run.",
  );
const admission = await fetch(origin + "/api/service?action=claim", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    install_id: installId,
    app_version: "2026.1109.0",
    age_ok: true,
  }),
});
const grant = await admission.json();
if (!admission.ok || typeof grant.code !== "string") {
  console.log(
    JSON.stringify({
      step: "admission",
      status: admission.status,
      error: grant.error,
    }),
  );
  process.exit(1);
}
const project = createProject(
  "동네 공방의 좋은 수업이 알려지지 않는 문제가 있어요. 의도를 구체화하도록 짧은 질문 하나만 해주세요. 실제 제작은 하지 마세요.",
);
const reply = await fetch(origin + "/api/service?action=chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: origin,
    Authorization: "Bearer " + grant.code,
  },
  body: JSON.stringify({
    turn_id: project.messages[0].id,
    messages: conversation(project),
  }),
  signal: AbortSignal.timeout(55000),
});
const data = await reply.json();
console.log(
  JSON.stringify({
    observedAt: new Date().toISOString(),
    origin,
    admissionStatus: admission.status,
    status: reply.status,
    reply: data.content,
    truncated: data.truncated,
    error: data.error,
    scope: "Actual deployed Service request; not iPhone hardware acceptance.",
  }),
);
if (!reply.ok || typeof data.content !== "string" || !data.content.trim())
  process.exitCode = 1;
