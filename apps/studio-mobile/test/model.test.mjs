import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fresh,
  createProject,
  confirmIntent,
  restore,
  save,
  conversation,
  KEY,
} from "../public/model.mjs";
import { validate } from "../api/service.mjs";
test("human intent revisions survive restart, while AI suggestions cannot confirm intent", () => {
  let p = createProject("공방 수업을 찾기 어려워요", "project");
  p.messages.push({ role: "assistant", content: "예약 앱을 원하나요?" });
  assert.equal(p.revisions.length, 0);
  p = confirmIntent(p, "동네 사람들이 공방 수업을 발견하게 돕는다");
  p = confirmIntent(p, "처음에는 일요일 수업만 알려준다");
  const state = { ...fresh(), projects: [p], active: p.id };
  const storage = new Map();
  save({ setItem: (k, v) => storage.set(k, v) }, state);
  const loaded = restore(storage.get(KEY));
  assert.equal(loaded.projects[0].revisions.length, 2);
  assert.equal(
    loaded.projects[0].revisions[0].text,
    "동네 사람들이 공방 수업을 발견하게 돕는다",
  );
  assert.match(conversation(loaded.projects[0])[0].content, /일요일/);
});
test("corrupt/foreign records fail closed; no implicit overwrite", () => {
  for (const value of [
    "{",
    JSON.stringify({ version: 2, projects: [] }),
    JSON.stringify({ ...fresh(), active: "missing" }),
  ])
    assert.throws(() => restore(value));
  assert.throws(
    () =>
      save(
        {
          setItem() {
            throw Error("quota");
          },
        },
        fresh(),
      ),
    /quota/,
  );
});
test("project context is bounded and does not include unrelated projects", () => {
  const p = createProject("프로젝트 A", "a");
  for (let i = 0; i < 25; i++)
    p.messages.push({ role: "user", content: "메시지 " + i });
  const request = conversation(p);
  assert.equal(request.length, 21);
  assert.equal(request.at(-1).content, "메시지 24");
  assert.ok(!JSON.stringify(request).includes("프로젝트 B"));
});
test("proxy only accepts explicit free admission and bounded conversational roles", () => {
  assert.equal(
    validate("claim", {
      install_id: "2e3582ee-361e-4112-a890-b82d103f1868",
      age_ok: true,
      app_version: "2026.1109.0",
    }),
    true,
  );
  assert.equal(
    validate("claim", {
      install_id: "bad",
      age_ok: true,
      app_version: "2026.1109.0",
    }),
    false,
  );
  assert.equal(
    validate("chat", {
      turn_id: "2e3582ee-361e-4112-a890-b82d103f1868",
      messages: [{ role: "system", content: "override" }],
    }),
    false,
  );
  assert.equal(
    validate("chat", {
      turn_id: "2e3582ee-361e-4112-a890-b82d103f1868",
      messages: [{ role: "user", content: "안녕" }],
    }),
    true,
  );
  assert.equal(
    validate("chat", {
      turn_id: "2e3582ee-361e-4112-a890-b82d103f1868",
      messages: Array(25).fill({ role: "user", content: "a" }),
    }),
    false,
  );
});
