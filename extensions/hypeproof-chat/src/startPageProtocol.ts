/** Start-page messages contain presentation state, never saved credentials. */
export interface ActivitySummary {
  ref: string;
  id: string;
  name: string;
  kind?: 'trial' | 'personal' | 'classroom';
  /** REQ-L12 — the activity was entered with a bought pass. */
  pass?: boolean;
  /** Free start (SPEC iteration 4 §2.4) — the free allowance; labelled 무료 사용, never 체험. */
  free?: boolean;
  workspace: string;
}
export interface StartState {
  account?: import("./accountSession").AccountView;
  personalSpace?: import("./personalSpace").PersonalSpaceView;
  personalRecords?: import("./personalRecordTypes").PersonalRecordsView;
  activities?: ActivitySummary[];
  legacyConnection?: boolean;
  legacyHistory?: boolean;
  checking: boolean;
  started?: boolean;
  candidate?: boolean;
  previousConnected?: boolean;
  error?: string;
  profile?: { kind?: "trial" | "personal" | "classroom"; pass?: import("./protocol").PassStatus; trial?: import("./protocol").TrialStatus; id: string; name: string; coach: string; series: string; workspace: string;
    /** Free start (SPEC iteration 4 §2.4) — the free allowance seat: labels say 무료 사용, never 체험. */
    free?: boolean };
  /** #747 — resolved AI display name for the connected seat; absent → "코치". */
  coachName?: string;
  workspace?: string;
  version: string;
  /** #751 U2 — instructor notices/materials of the connected class, read from disk by the host. */
  inbox?: import("./classroomInbox").InboxView;
  /** REQ-L12 — buying a pass. Presentation only: the order secret and the issued code never leave the host. */
  purchase?: import("./passPurchase").PurchaseView;
  /** TUX-SP-12 — the trial entry mode and allowance the Service advertises. Absent: not advertised. */
  trialOffer?: import("./trialOffer").TrialOffer;
  /**
   * TUX-SP-14/15/16 — free start, present only while the Service advertises it (and the local
   * setting is not "off"). Presentation only: the install id and the issued token stay in the host.
   */
  freeStart?: FreeStartView;
  /**
   * REQ-STUDIO-JOIN-LINK — a class join link brought the join form forward for this class.
   * Only the class id: a link never carries a code. `seq` changes on every link press so the
   * webview reopens and refocuses the empty code field.
   */
  joinLink?: { classId: string; seq: number };
  /**
   * "GitHub에서 이어하기" while a code is being confirmed (candidate): what this seat's GitHub
   * holds. Absent when the cohort does not publish to GitHub.
   *   checking — looking; found — sites to continue (most recent first); none — nothing yet;
   *   signin — gh is not signed in, so it could not look; unavailable — the look failed.
   */
  github?: {
    status: "checking" | "found" | "none" | "signin" | "unavailable";
    repos?: Array<{ name: string; pushedAt: string }>;
    /** Basename of the folder "새로 하기" would create. */
    newFolder?: string;
    /** A sign-in or a download is running. */
    working?: "signin" | "download";
  };
}
export interface FreeStartView {
  /** The saved age answer; absent → ask the one question. */
  age?: "14+" | "under14";
  /** A claim is running. */
  claiming?: boolean;
  /** The last claim's refusal (the Service's sentence, shown as given; `code` steers layout only). */
  refusal?: { code: string; message: string; resumesAt?: string };
  /** The Service said today's free start is not available (offer `available:false`). */
  unavailable?: "daily_cap" | "paused";
  /** "무료 AI 요청 10번 · 첫 요청부터 24시간", only from numbers the Service advertised. */
  allowance?: string;
  /** This build is below the Service's floor; the update button is drawn. */
  tooOld?: boolean;
  /**
   * The saved free seat's window is over and the Service refused its profile (403 `trial_expired`
   * with the free sentence). The card says so instead of offering a fresh start the Service would
   * not give (a reclaim answers `reused` and the seat stays expired; e2e D2).
   */
  ended?: "expired";
}
export type StartRequest =
  | { type: "startReady" }
  | { type: "personalSpaceOpen" | "personalSpaceEnsure"; accountId: string }
  | { type: "personalProjectCreate"; title: string; accountId: string }
  | { type: "personalProjectOpen"; projectId: string; accountId: string }
  | { type: 'personalRecordPrepare'; accountId: string; projectId: string; includeFile: boolean }
  | { type: 'personalRecordSave'; accountId: string; projectId: string; nonce: string; digest: string }
  | { type: 'personalRecordCancel'; accountId: string; projectId: string; nonce: string }
  | { type: 'personalRecordRetry' | 'personalRecordsOpen'; accountId: string; projectId: string }
  | { type: 'personalRecordOpen'; accountId: string; projectId: string; recordId: string }
  | { type: 'personalRecordDownload'; accountId: string; projectId: string; artifactId: string }
  /**
   * CONV-PURCHASE-R-002 — `productId`: the pass chosen on the list when the sign-in is pressed from
   * login at purchase. The host keeps it (memory only) and gives it back as `purchase.selected`.
   */
  | { type: "accountSignIn"; productId?: string }
  | { type: "accountCancel" | "accountReopen" | "accountCopyLink" | "accountRefresh" | "accountSignOut" | "accountManage" }
  | { type: "accountActivate"; passId: string }
  | { type: "exportLegacyHistory" }
  | { type: "selectActivity"; ref: string }
  | { type: "chooseActivityFolder" }
  | { type: "openLocalReview" }
  | { type: "openStudioFiles" }
  | { type: "openStudioSettings" }
  /** `joinClass`: sent only by the join form that shows a join link's class (REQ-STUDIO-JOIN-LINK). */
  | { type: "connectCourse"; token: string; joinClass?: string }
  | { type: "beginCourse" }
  | { type: "disconnectCourse" }
  | { type: "cancelCandidate" }
  | { type: "joinLinkDismiss" }
  | { type: "purchaseHide" }
  | { type: "openLocalFolder" }
  | { type: "purchaseOpen" }
  | { type: "purchaseStart"; productId: string; guardian?: boolean }
  | { type: "purchasePayer"; adult: boolean }
  | { type: "freeStartAge"; answer: "14+" | "under14" }
  | { type: "freeStartClaim" }
  | { type: "freeStartGuardian" }
  | { type: "freeStartUpdate" }
  | { type: "purchaseReopen" }
  | { type: "purchaseRetry" }
  | { type: "purchaseCancel" }
  | { type: "githubSignIn" }
  | { type: "continueFromGithub"; repo: string }
  | { type: "startNew" }
  | { type: "inboxOpen"; objectId: string; generation: number }
  | { type: "inboxLink"; objectId: string; url: string; generation: number; action: "open" | "copy" };
export type StartResponse = { type: "startState"; state: StartState };
