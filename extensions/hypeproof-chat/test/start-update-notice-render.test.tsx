// REQ-STUDIO-START-UPDATE-NOTICE — the start page's update row as rendered. Bundled with esbuild (JSX +
// CSS stripped) and run with plain Node, like seat-vocabulary-render. Positive: a newer version shows the
// version, 업데이트 and 나중에. Negatives: no offer renders nothing; a class seat renders no button.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartUpdateNotice } from "../webview-ui/src/StartPage";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (name: string, fn: () => void) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { fail++; console.error(`  FAIL ${name}: ${(e as Error).message}`); } };
const html = (update: Parameters<typeof StartUpdateNotice>[0]["update"]) => renderToStaticMarkup(<StartUpdateNotice update={update} />);

t("newer version: version, install and later", () => {
  const out = html({ version: "2026.1029.0" });
  for (const want of ["새 버전이 나왔습니다", "v2026.1029.0", ">업데이트<", ">나중에<", 'role="status"', "업데이트하면 Studio가 다시 시작됩니다."]) if (!out.includes(want)) throw new Error(`missing ${want}: ${out}`);
});
t("no offer (current or dismissed): nothing", () => {
  if (html(undefined) !== "") throw new Error("rendered without an offer");
});
t("class seat: a status line with no button", () => {
  const out = html({ version: "2026.1029.0", heldForClass: true });
  if (!out.includes("수업이 끝나면 설치할 수 있습니다.")) throw new Error(`no hold line: ${out}`);
  if (/<button/.test(out)) throw new Error(`a button during class: ${out}`);
});

if (fail) { console.error(`start-update-notice-render: ${fail} failed`); process.exit(1); }
console.log("start-update-notice-render.test.tsx — all assertions passed");
