import { postToHost } from "./vscode";
import { Brand } from "./Brand";

// #3563 — the instructor's Studio chat points to the Chalk tab. The Chalk tab opens only on click.
export function ChalkInstructorNotice() {
  return (
    <main className="studio-disconnected">
      <Brand/>
      <h1>강사 화면은 Chalk 탭에서 열립니다.</h1>
      <button className="studio-primary" onClick={() => postToHost({ type: "openChalkInstructorPanel" })}>Chalk 탭 열기</button>
    </main>
  );
}
