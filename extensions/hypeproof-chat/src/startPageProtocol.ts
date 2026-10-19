/** Start-page messages contain presentation state, never saved credentials. */
export interface ActivitySummary {
  ref: string;
  id: string;
  name: string;
  kind?: 'trial' | 'personal' | 'classroom';
  /** REQ-L12 — the activity was entered with a bought pass. */
  pass?: boolean;
  workspace: string;
}
export interface StartState {
  account?: import("./accountSession").AccountView;
  activities?: ActivitySummary[];
  legacyConnection?: boolean;
  legacyHistory?: boolean;
  checking: boolean;
  started?: boolean;
  candidate?: boolean;
  previousConnected?: boolean;
  error?: string;
  profile?: { kind?: "trial" | "personal" | "classroom"; pass?: import("./protocol").PassStatus; trial?: import("./protocol").TrialStatus; id: string; name: string; coach: string; series: string; workspace: string };
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
export type StartRequest =
  | { type: "startReady" }
  | { type: "accountSignIn" | "accountCancel" | "accountReopen" | "accountRefresh" | "accountSignOut" | "accountManage" }
  | { type: "accountActivate"; passId: string }
  | { type: "exportLegacyHistory" }
  | { type: "selectActivity"; ref: string }
  | { type: "chooseActivityFolder" }
  | { type: "openLocalReview" }
  | { type: "openStudioFiles" }
  | { type: "openStudioSettings" }
  | { type: "connectCourse"; token: string }
  | { type: "beginCourse" }
  | { type: "disconnectCourse" }
  | { type: "cancelCandidate" }
  | { type: "purchaseHide" }
  | { type: "openLocalFolder" }
  | { type: "purchaseOpen" }
  | { type: "purchaseStart"; productId: string }
  | { type: "purchaseReopen" }
  | { type: "purchaseRetry" }
  | { type: "purchaseCancel" }
  | { type: "githubSignIn" }
  | { type: "continueFromGithub"; repo: string }
  | { type: "startNew" }
  | { type: "inboxOpen"; objectId: string; generation: number }
  | { type: "inboxLink"; objectId: string; url: string; generation: number; action: "open" | "copy" };
export type StartResponse = { type: "startState"; state: StartState };
