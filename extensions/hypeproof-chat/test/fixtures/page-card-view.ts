const p = (versionId: string, title: string, status: string) => ({ versionId, title, status, thumbnail: { state: "failed" } });
export const VIEW = { turnId: "t1", anchorId: "a1", pages: [
  { path: "site/index.html", kind: "added", presentation: p("sha256:690acc65aabbccdd", "첫 화면", "unchecked") },
  { path: "site/about.html", kind: "changed", presentation: p("sha256:11223344eeff0011", "소개", "verified") },
  { path: "site/x.html", kind: "added" },
  { path: "site/old.html", kind: "changed", presentation: p("sha256:99887766aabb0011", "예전 판", "previous") },
] };
