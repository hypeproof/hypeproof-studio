// Team members of a curriculum project, edited from /manage.
//
// The Service route PUT /v1/curriculum/projects/:id/members REPLACES the whole list and carries no revision, so the page
// must never send a list it did not start from the current team. The rules that protect an existing member live here:
// a member leaves only when the instructor removed them and confirmed it, and a team changed elsewhere stops the save and
// is merged with the instructor's edits instead of being overwritten.
//
// Like roster-csv.ts, the kit is ONE self-contained factory that index.ts inlines into /manage with
// Function.prototype.toString(), so the page and the tests run the same code. Nothing inside may reference module scope.

export type TeamProject = { id: string; title: string; cohort_id: string; profile_id: string; members: string[] };
export type TeamRefusal = { error?: { type?: string; code?: string; message?: string; members?: unknown } } | null;

export function teamMembersKit() {
  // The Service's bounds on one team (worker/src/routes/curriculum.ts); it re-checks them and the roster.
  const MAX_MEMBERS = 12;
  const MAX_ID = 100;

  const unique = (list: readonly string[]) => [...new Set(list)];
  const isProject = (p: unknown): p is TeamProject => {
    const v = p as TeamProject | null;
    return !!v && typeof v.id === "string" && typeof v.title === "string" && typeof v.cohort_id === "string" && Array.isArray(v.members) && v.members.every((m) => typeof m === "string");
  };

  /** The projects of this class. A malformed row is left out rather than shown with a guessed team. */
  function ofCohort(projects: unknown, cohort: string): TeamProject[] {
    return (Array.isArray(projects) ? projects : []).filter(isProject).filter((p) => p.cohort_id === cohort);
  }

  function plan(baseline: readonly string[], draft: readonly string[]) {
    return {
      added: draft.filter((m) => !baseline.includes(m)),
      removed: baseline.filter((m) => !draft.includes(m)),
      kept: baseline.filter((m) => draft.includes(m)),
    };
  }

  const sameTeam = (a: readonly string[], b: readonly string[]) => {
    const p = plan(a, b);
    return p.added.length === 0 && p.removed.length === 0;
  };

  function addSeat(draft: readonly string[], raw: unknown): { draft: string[]; problem: string | null } {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) return { draft: [...draft], problem: "추가할 학생 ID를 입력하세요." };
    if (id.length > MAX_ID) return { draft: [...draft], problem: `학생 ID는 ${MAX_ID}자까지 입력할 수 있습니다.` };
    if (draft.includes(id)) return { draft: [...draft], problem: `${id} 학생은 이미 팀에 있습니다.` };
    if (draft.length >= MAX_MEMBERS) return { draft: [...draft], problem: `한 팀은 최대 ${MAX_MEMBERS}명입니다.` };
    return { draft: [...draft, id], problem: null };
  }

  /** The instructor's edits carried onto the team as it is now: nobody added elsewhere is lost. */
  function rebase(baseline: readonly string[], draft: readonly string[], live: readonly string[]): string[] {
    const mine = plan(baseline, draft);
    return unique([...live.filter((m) => !mine.removed.includes(m)), ...mine.added]);
  }

  /** Why this list may not be sent yet, or null. */
  function blocked(baseline: readonly string[], draft: readonly string[], confirmed: boolean): string | null {
    const p = plan(baseline, draft);
    if (!p.added.length && !p.removed.length) return "바뀐 내용이 없습니다.";
    if (!draft.length) return "팀에는 최소 1명이 있어야 합니다.";
    if (draft.length > MAX_MEMBERS) return `한 팀은 최대 ${MAX_MEMBERS}명입니다.`;
    if (p.removed.length && !confirmed) return `${p.removed.join(", ")} 학생을 팀에서 빼는 것을 확인해 주세요.`;
    return null;
  }

  /** A write the Service may have applied: the page must read the team again before another save. */
  const outcomeUnknown = (status: number) => status >= 500;

  /** The Service's refusal in the instructor's words. Nothing was saved in any of these cases except an unknown outcome. */
  function refusal(status: number, body: TeamRefusal, baseline: readonly string[]): string {
    const e = body?.error;
    if (e?.code === "members_not_in_roster") {
      const missing = Array.isArray(e.members) ? e.members.filter((m): m is string => typeof m === "string") : [];
      const current = missing.filter((m) => baseline.includes(m));
      const added = missing.filter((m) => !baseline.includes(m));
      const parts: string[] = [];
      if (added.length) parts.push(`수업 명단에 없는 학생입니다: ${added.join(", ")}. 명단에 먼저 추가하거나 목록에서 빼세요.`);
      if (current.length) parts.push(`현재 팀원이지만 수업 명단에서 빠져 있습니다: ${current.join(", ")}. 명단에 다시 추가하거나, 팀에서 빼는 것을 확인한 뒤 저장하세요.`);
      return `저장하지 않았습니다. ${parts.join(" ") || "수업 명단에 없는 학생이 있습니다."}`;
    }
    if (e?.code === "invalid_members") return `저장하지 않았습니다. 팀원은 1명 이상 ${MAX_MEMBERS}명 이하로 입력하세요.`;
    if (status === 401) return "저장하지 않았습니다. 인증이 거부됐습니다. 강사 연결을 확인하세요.";
    if (status === 403) return "저장하지 않았습니다. 이 프로젝트를 바꿀 권한이 없습니다.";
    if (status === 404) return "저장하지 않았습니다. 프로젝트를 찾을 수 없거나 이 강사 권한 밖입니다.";
    if (outcomeUnknown(status)) return "저장됐는지 확인하지 못했습니다. 다시 불러오기로 현재 팀을 확인한 뒤 진행하세요.";
    return `저장하지 않았습니다. 요청이 거절됐습니다 (${status}).`;
  }

  return { MAX_MEMBERS, MAX_ID, ofCohort, plan, sameTeam, addSeat, rebase, blocked, outcomeUnknown, refusal };
}

export const TEAM_MEMBERS_SCRIPT =
  "const teamMembersKit=((__name)=>(" + teamMembersKit.toString() + ")())((f)=>f);";
