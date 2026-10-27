# ChatGPT desktop parity: SHELL (settings, account, onboarding, usage/billing, desktop shell)

Domain slug `settings-account-shell`, ID prefix `CGP-SHELL-NN`. Target: ChatGPT macOS app v26.1013.40934
(`com.openai.codex`, Electron, Sparkle 2.9.1). Written 2026-10-19.

## 0. Method and scope

- Message evidence: `findings/messages-en.json`, filtered to this domain's namespaces (10,370 messages,
  extraction in `shellwork/domain.tsv`). Biggest groups: `settings` 4,822, `restricted` 1,241,
  `businessProfiles` 760, `electron` 530, `space` 392, `sidebarElectron` 323, `merchantSettings` 258,
  `pricing` 226, `onboarding` 190, `settingsModal` 154, `teams` 152, `checkout` 126.
- Main process: `app.asar:.vite/build/main-CLu1A25j.js` (4.0 MB), `preload.js` (exposes only
  `electronBridge`, `codexWindowType`, `__SENTRY_IPC__`), `native-menu-locales/*.json` (63 locales,
  220 keys each, incl. `ko-KR.json`).
- Bundle: `/Applications/ChatGPT.app/Contents/Info.plist`, `Resources/scripting.sdef`,
  `Frameworks/Sparkle.framework` (2.9.1, build 2054).
- Studio state: snapshot `studio@origin/main:` (CLAUDE.md, PRODUCT-INTENT.md, studio-requirements.md,
  requirements/*.md, design/*.md, chalk/README.md, chalk/src/ui/*.html, extensions/hypeproof-chat/src).
  `extensions/hypeproof-chat/package.json` is not in the snapshot, so contributed settings/commands were
  not checked.
- Labels: **observed** means the string or code is in the shipped bundle. Shipping does not prove it is
  enabled for every user. **inferred** is my reading of behavior.
- Product Intent principles (docs/PRODUCT-INTENT.md): #1 Useful work first, #2 Human judgment stays
  visible, #3 Learning is embedded, #4 Minimum necessary intervention, #5 Evidence over claims,
  #6 Adapt, do not script, #7 Capability models are hypotheses. Access intent: INT-ACCESS-01 (understand
  what is included and who pays before running), INT-ACCESS-05 (results survive limits; no upgrade
  pressure), via AB-01..18.

### Desktop-shell facts read from the bundle (observed)

| Area | Finding | Source |
|---|---|---|
| Auto-update | Sparkle 2.9.1 with EdDSA key `SUPublicEDKey`; backend appcast toggle, `disableSparkleAutodownload`, `disableInAppUpdates` latch, release channel `codexReleaseChannel`, `supportsAutoInstallWhenIdle`, relaunch notice with countdown | main `setSparkleQueryParams`, `getRelaunchNotice`; `appUpdate.relaunchNotice.titleDays/Hours/Minutes/Now` |
| Quit guard | Quit confirmation that names what will be interrupted (active local chats, scheduled tasks, worktrees starting) | `native-menu-locales/ko-KR.json` `desktop.quitConfirmation.*` |
| Tray / menu bar | `new D.Tray(...)`; menu: Open app, New Chat, Pinned, Running, Recent, Unread, Usage, More | main `trayMenu.*` constants |
| Deep links | `deepLinks.registerProtocolClient()`; scheme `codex` (+ http/https as default-browser candidate); routes: `settings`, `newThread`, `joinTeam`, `team`, `pluginInstall`, `pluginDetail`, `skills`, `automation(s)`, `sharedChatGptConversation`, `sharedCodexSnapshot`, `connectorOAuthCallback`, `cloudEnvironmentCreate`, `browserHandoff`, `spacePage`, `petInstall`, `launch`, `wakeQueuedThread` and others | main `codex-deep-link-navigation` switch; Info.plist `CFBundleURLSchemes` |
| Global hotkeys | `globalShortcut.register/unregister` for Popout Window, dictation, voice | main; `settings.general.experimentalFeatures.hotkeyWindowHotkey.*` |
| Power | `powerSaveBlocker` with `prevent-app-suspension` while tasks run (stricter on AC power for remote control) | main |
| Badge | `app.setBadgeCount` per primary window | main `refreshAppBadgeCount` |
| Notifications | Electron `Notification(` (~50 sites); OS banner style; custom sounds `codex-notification.wav`, `codex-classic.wav` | main; Info.plist `NSUserNotificationAlertStyle=banner`; Resources |
| AppleScript | `scripting.sdef` is Chromium's default Standard + Chromium suites (windows, tabs, bookmarks); `NSAppleScriptEnabled = 0` | sdef, Info.plist |
| Single instance | `second-instance` handler opens/focuses window; `CODEX_ELECTRON_START_IN_BACKGROUND` | main |
| Native menu | App/Edit/View/Window/Help; Help includes System status, Task manager, Troubleshooting, performance trace start/stop/upload | `electron.appMenu.*` |
| Offline | Renderer uses online/offline listeners (react-query `networkMode`); `net.isOnline`; browser panel offline/DNS/proxy error page | main; `browserSidebar.loadError.offlineSummary` (native-menu-locales) |
| Permissions | Usage strings for Apple Events, mic, camera, audio capture, calendar, reminders, location, Desktop folder | Info.plist `NS*UsageDescription` |
| Documents | Opens folders and csv/docx/pptx/tsv/xls(x) as Viewer (`LSHandlerRank=Alternate`) | Info.plist `CFBundleDocumentTypes` |
| Minimum OS | macOS 13.0 | Info.plist `LSMinimumSystemVersion` |

## 1. Feature inventory

Columns: ID, Feature, What it does, Evidence, Studio/Chalk today, Verdict, Surface.

### A. Desktop shell and OS integration

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-01 | Background auto-update with restart notice | Downloads silently, shows install progress, then a restart countdown (`Restart required in # days/hours/minutes/now`). Can install when idle. Warns that installing stops active local sessions (observed) | `appUpdate.relaunchNotice.titleDays`, `appUpdate.installProgress.subtitle` ("{appName} will restart when installation finishes."), `appHeader.installUpdate.confirmSubtitle` (native-menu-locales); main `supportsAutoInstallWhenIdle`; chunk `app-initial-90eb42395b7d.js` | REQ-I1..I13: 24 h check, banner, 7-day dismiss, verified download, user-approved restart, existing app kept. PRA-01..08 private release access. No idle install, no "not during class" rule found (searched studio-requirements.md §I, classroom-admin.md for update/업데이트) | ADAPT: keep user approval; add idle-only install and no prompts or installs inside a class session window. No forced deadline | Studio |
| CGP-SHELL-02 | Organization-managed updates | Admin can turn in-app updates off; settings row shows "Managed" (observed) | `settings.general.inAppUpdates.description.managed` ("Your organization has turned off in-app updates"), `settings.general.inAppUpdates.status.managed`; main `latchInAppUpdatesEnabledForLaunch`; `general-settings-679bf39c78a4.js` | ADM-11 says a running class is not changed silently, but nothing pins the app version for a class. Chalk manage.html shows per-action "이 앱 버전은 지원하지 않음" | ADAPT: a cohort-level update freeze for the class period, set in Chalk | Both |
| CGP-SHELL-03 | Startup recovery dialogs | Update recovery screen ("Update ChatGPT" / checking / downloading / installing); session-expired dialog ("Sign in again"); org-policy load failure pauses the app with Retry/Sign out/Quit and names the broken config file (observed) | `appUpdate.recovery.*`; `desktop.requirementsAuthRecovery.*`, `desktop.workspacePolicyRecovery.*` (native-menu-locales) | REQ-A5 (saved connection error by cause, secret kept), REQ-B5 (auth errors as friendly toasts, no raw JSON), REQ-I11 (failed check is not "up to date") | ALREADY | Studio |
| CGP-SHELL-04 | Quit / close confirmation | Before quitting, lists what will be lost: active local chats, scheduled tasks, starting worktrees. Separate "Confirm before closing a window" (Always / Close shortcut only / Never) (observed) | `desktop.quitConfirmation.title`, `.activeLocalTasksDetail` (native-menu-locales); `settings.general.confirmBeforeClose.label`, `.keyboardOnly`; `general-settings-679bf39c78a4.js` | No coverage found (searched studio-requirements.md, extension src for quit/onWillQuit/종료할까요). REQ-C16 records 5–10 min agent turns (9 min in a real class) | ADOPT | Studio |
| CGP-SHELL-05 | Menu bar (tray) presence | Keeps app in macOS menu bar when window closed; tray lists Pinned/Running/Recent/Unread chats and Usage (observed) | `settings.general.macMenuBar.label`, main `trayMenu.usage`, `trayMenu.runningThreads`; `notifications-settings-3f11a446e75a.js` | No coverage (VS Code shell has no tray) | DEFER: no class need; an always-present app on a family computer needs a guardian decision first | Studio |
| CGP-SHELL-06 | Launch at login | Starts app at OS login; Windows variant links to Startup Apps (observed) | `settings.general.launchAtLogin`, `settings.classicWindows.launchAtLogin`; `general-settings-679bf39c78a4.js` | No coverage | REJECT: a child's tool should not start by itself on a shared or family computer | Studio |
| CGP-SHELL-07 | Global hotkey Popout Window | System-wide shortcut opens a small always-available chat window (projectless, local, worktree or cloud) (observed, experimental flag) | `hotkeyWindow.*` (19), `settings.general.experimentalFeatures.hotkeyWindowHotkey.description`; `hotkey-window-detail-layout-b6729bcbd67e.js` | No coverage | DEFER: system-wide hotkeys conflict with other apps and take chat out of lesson context | Studio |
| CGP-SHELL-08 | Detached windows, keep-on-top, drag panes | Drag a tab out to a new window, pin window on top, move panes left/right/bottom (observed) | `appShell.detachedWindow.pin`, `appShell.tabs.dragNewWindowCue`, `appShell.tabs.dragMoveBottomCue`; `app-initial-90eb42395b7d.js` | VS Code workbench already has editor groups and new-window (inferred). HP shell defaults (#725) keep standard controls | ALREADY (inferred) | Studio |
| CGP-SHELL-09 | Deep links | `codex://` routes open settings, new chat, join team, plugin install, shared conversation, OAuth callback etc. Debug menu "Open deeplink from clipboard" (observed) | main route switch (list in §0); Info.plist `CFBundleURLSchemes` | One URI handler: `/account-return` for Google sign-in (extension.ts:230). No join-class or open-lesson link | ADAPT: Chalk/issuer links that open Studio on the join screen for a named class, without the participation code in the URL | Both |
| CGP-SHELL-10 | Localized native menus and dialogs | 63 locales incl. `ko-KR.json` for app menu, quit dialogs, About, command titles (observed) | `native-menu-locales/ko-KR.json` (220 keys, e.g. `electron.appMenu.app.checkForUpdates` = "업데이트 확인…") | No Korean language pack or display-language config found (searched config/, INSTALL-ARCHITECTURE.ko.md, METAPLAN.md for locale/language pack). Webview copy is Korean | ADAPT: menus, native dialogs and settings labels a learner can reach must be Korean | Studio |
| CGP-SHELL-11 | Command menu and rebindable shortcuts | Command menu, search by keystroke, number shortcuts, reset all, conflict warning (observed) | `settings.keyboardShortcuts.*` (47), `settings.keyboardShortcuts.numberTarget.conflict`; `codex.commandMenuTitle.*` (native-menu-locales) | VS Code command palette and keybindings editor; #725 keeps menus and shortcuts | ALREADY | Studio |
| CGP-SHELL-12 | Dock badge for unread | Dock icon shows unread count per main window (observed) | main `D.app.setBadgeCount`, `refreshAppBadgeCount` | classroomInboxStore.ts and classroomOpsHost.ts refresh the inbox on focus (classroomOpsHost.ts:113); no badge | ADAPT: badge only for teacher notices and help-request replies | Studio |
| CGP-SHELL-13 | Desktop notifications | "Turn completion notifications" Always / Only when unfocused / Never; question and permission alerts; 8 built-in sounds + custom sound (MP3/WAV/FLAC/Ogg < 30 s, 10 MB); "Notifications are off" with Open System Settings (observed) | `notifications.turnMode.*`, `notifications.sound.*`, `notifications.systemSettings.*`; `notifications-settings-3f11a446e75a.js` | Studio avoids toasts in class on purpose: a visible toast paused the integrated browser (extension.ts:694); a quest-result notification was "noise to the child" (chatPanelProvider.ts:2023) | ADAPT: only when unfocused, only for teacher-originated events and long turns finishing, silent by default for minors | Studio |
| CGP-SHELL-14 | Prevent sleep while running | Keeps computer awake while a task runs (observed) | `settings.general.power.preventSleepWhileRunning.label`; main `powerSaveBlocker` `prevent-app-suspension` | No coverage found (searched src for powerSaveBlocker, sleep) | ADOPT | Studio |
| CGP-SHELL-15 | Single instance and background start | Second launch focuses the existing window; can start hidden (observed) | main `second-instance`, `CODEX_ELECTRON_START_IN_BACKGROUND` | VS Code single-instance behavior (inferred) | ALREADY (inferred) | Studio |
| CGP-SHELL-16 | Wrong-architecture launch warning | Warns when the Intel build runs under Rosetta on Apple Silicon; Quit / Continue (observed) | `desktop.intelLaunchWarning.*` (native-menu-locales) | PRA-05 bootstrap scripts keep platform restrictions; only macOS arm64 and Windows x64 ship (CLAUDE.md) | ALREADY | Studio |
| CGP-SHELL-17 | OS permission purpose strings | Purpose text for Apple Events, mic, camera, calendar, reminders, location, Desktop folder; onboarding step "Give ChatGPT access to your computer" (observed) | Info.plist `NSMicrophoneUsageDescription` etc.; `electron.onboarding.capabilitiesSetup.title`; `onboarding-page-b0057625e2d6.js` | Voice uses mic (REQ-R, voice-conversation.md); purpose strings come from VSCodium defaults (not verified in snapshot) | ADAPT: Korean, child-readable purpose before the OS prompt, asked only when a lesson step needs it | Studio |
| CGP-SHELL-18 | AppleScript | Chromium default dictionary; scripting disabled (`NSAppleScriptEnabled=0`) (observed) | `Resources/scripting.sdef`, Info.plist | None | REJECT: not usable in ChatGPT either; an extra automation surface for no learner value | Studio |
| CGP-SHELL-19 | Document types and file viewers | Registers as viewer for folders and csv/docx/pptx/xls; "File viewers" settings choose plugin handlers (observed) | Info.plist `CFBundleDocumentTypes`; `settings.fileTypeHandlers.*`; `file-type-handlers-414a1e4fe2cc.js` | VS Code opens folders (REQ-A1 workspace) | DEFER: Office viewers are not in the lesson loop | Studio |
| CGP-SHELL-20 | Help menu diagnostics | System status, Task manager, Troubleshooting, performance trace record and upload (observed) | `electron.appMenu.help.*`, `electron.appMenu.trace.*`, `electron.traceRecording.*` | REQ-H1..H9 report problem with metadata, last request_id, rate limit, PII minimization | ALREADY (trace upload DEFER) | Studio |
| CGP-SHELL-21 | About and open-source licenses | About dialog with version and release date; licenses page (observed) | `codex.aboutDialog.versionLineWithDate` (native-menu-locales); `settings.openSourceLicenses.*`; `open-source-licenses-page-fe169c847c13.js` | VS Code About; REQ-J4 keeps license/attribution text | ALREADY | Studio |
| CGP-SHELL-22 | Offline and network error states | Renderer tracks online/offline; browser panel explains offline/DNS/proxy/firewall causes with fixes (observed) | `browserSidebar.loadError.offlineSummary`, `.proxyHeader` (native-menu-locales); main `net.isOnline` | Offline handling exists in heartbeat.ts, accountSession.ts, classroomInboxStore.ts; classroom-admin.md "오프라인·재연결" for notice delivery. No learner-visible offline state in chat found | ADAPT: one offline banner in the chat panel stating what still works | Studio |
| CGP-SHELL-23 | Dock icon variants | Choose ChatGPT or Space Dock icon (observed) | `settings.general.appearance.dockIcon.*`; `general-settings-679bf39c78a4.js` | Branding fixed (REQ-J1..J4) | REJECT: cosmetic, conflicts with fixed branding | Studio |
| CGP-SHELL-24 | Shell accessibility | "Skip to content" link; keyboard-resizable panes (observed) | `appShell.skipToContent`, `appShell.resizeContentPanes`; `app-initial-90eb42395b7d.js` | No coverage in chat webview (searched src for skip/본문으로). aria-live exists in protocol.ts, imageEditAssets.ts | ADOPT | Studio |
| CGP-SHELL-25 | Panel render error boundary | "Tab content couldn't render" + Try again, without losing the rest of the window (observed) | `appShell.tabPanelRenderError.title`, `.retry` | previewRecovery.ts covers the preview only; no webview-wide boundary found | ADOPT | Studio |

### B. Settings framework

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-26 | Settings page structure | Full-page settings: nav groups (Personal / Coding / Integrations), search with "No results found", host filter (Local/remote), unsaved-changes guard (observed) | `settings.nav.*` (71), `settings.search.label`, `settings.hostDropdown.filter`, `settings.unsavedChanges.discardTitle`; `settings-page-cd654a99d29b.js` | Start page "설정" opens the VS Code settings editor (#725); REQ-K1..K3 expose proxyUrl/model/requireApprovalFor/coachRuntime there | ADAPT: a small learner settings sheet in the chat panel; the VS Code editor stays for adults/staff | Studio |
| CGP-SHELL-27 | Admin-managed setting indicators | Rows show "Approved by your admin", "Managed", "Managed by your parent"; sign-in methods restricted by admin (observed) | `settings.mcp.appConnectModal.adminApproved`, `settings.general.inAppUpdates.status.managed`, `settings.chatGpt.timeManagement.managedByParent`, `electron.loginMethods.noneAllowed` | Service clamps model and capabilities per profile (REQ-K1, AB-03), but the learner is not shown which settings the class fixes | ADAPT: lock icon + "선생님이 정한 설정" on cohort-enforced rows | Studio |
| CGP-SHELL-28 | Beta, employee-only and debug settings | Desktop beta toggle, experimental features (restart required), Employee Only nav, Debug, GPU tearing debug, Chrome debug pages (observed) | `settings.general.desktopAppBeta.label`, `settings.general.experimentalFeatures.*`, `settings.nav.chatGptInternalSettings`, `settings.general.gpuTearingDebug.*`, `settings.debug.*` | Not exposed to learners | REJECT: internal tooling | Studio |

### C. Appearance, input and accessibility

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-29 | Theme and colors | Light/Dark/System; separate light and dark accent, background, foreground, contrast, fonts; translucent sidebar; copy/import theme; code theme (observed) | `settings.general.appearance.theme`, `settings.appearance.separateModes`, `settings.general.appearance.chromeTheme.*` (≈70); `general-settings-679bf39c78a4.js` | HP dark theme only: forest #151D19, ivory #F2F4E8, lime #D5F279 (#725). ui-philosophy §14 defines Paper #F4F6F0 for reading screens | ADAPT: HP light variant + follow-system; no theme import | Studio |
| CGP-SHELL-30 | Font sizes | UI font size, content font size, code font size (observed) | `settings.appearance.uiFontSize.description`, `settings.appearance.pages.fontSize.label`, `settings.general.appearance.codeFontSize` | No coverage found (searched docs and src for 글자 크기 / font size; only siteCheck.ts) | ADAPT: one chat text-size control (3 steps) for young readers | Studio |
| CGP-SHELL-31 | Reduced motion | Off / System / On for animations (observed) | `settings.general.appearance.reducedMotion.description` ("Reduce animations or match your system") | Only voicePopupHelpers.ts handles reduceMotion | ADOPT | Studio |
| CGP-SHELL-32 | Pointer cursors, font smoothing, diff markers | Minor display preferences (observed) | `settings.general.appearance.usePointerCursors.description`, `.fontSmoothing.label`, `.diffMarkerStyle.description` | None | DEFER: low value | Studio |
| CGP-SHELL-33 | Send key and IME | Enter vs ⌘+Enter for multiline (observed) | `settings.general.enterBehavior.cmdIfMultiline` | REQ-C16 keeps `isComposing`/keyCode 229 handling, input never disabled while streaming | ALREADY | Studio |
| CGP-SHELL-34 | Plain-text composer, smart punctuation, predictions | Keep Markdown literal; auto-format quotes/dashes; show predictions (observed) | `settings.general.composer.plainTextMode.description`, `settings.appearance.pages.smartPunctuation.description`, `settings.general.messagePredictions.label` | None | DEFER: predictions would write for the learner (conflicts with #2) | Studio |
| CGP-SHELL-35 | Educational tips toggle | "Show educational tips"; composer tips such as "Enable notifications" (observed) | `settings.general.educationalTips.label`, `composerTips.notifications.content` | ui-philosophy §9 intervention ladder; no tips toggle | ADAPT: tips follow the intervention ladder and can be switched off | Studio |
| CGP-SHELL-36 | App UI language selector | "Language for the app UI" (observed) | `settings.ide.language.description` | Korean-only learner product (CLAUDE.md language table) | DEFER: no second learner language planned; see 10 for menus | Studio |
| CGP-SHELL-37 | Local storage management | Auto-archive after inactivity, compress old history, app data folder, archived chats restore/delete, worktree cleanup (observed) | `settings.general.autoArchive.description`, `settings.general.rolloutCompression.description`, `settings.storage.*` (47); `device-storage-746efc55513b.js` | REQ-Q6 200 MB spool cap, REQ-Q12 cleanup of uploaded sessions; adultArchive.ts keeps last 20 page versions | ALREADY | Studio |
| CGP-SHELL-38 | Microphone, dictation, voice hotkey | Mic picker, dictation dictionary, single-tap dictation shortcut, voice picker (observed) | `settings.general.microphoneInput.*`, `settings.general.dictationDictionary.*`, `settings.general.realtimeVoice.*`; `voice-settings-397876358672.js` | requirements/voice-conversation.md; studio-requirements.md §R (owned by the voice domain) | ALREADY | Studio |
| CGP-SHELL-39 | Mini & Pets desktop companion | Floating pet on the desktop that manages chats; create/customize pet; show/focus hotkey (observed) | `settings.mini.*`, `settings.pets.*` (29); `pets-settings-route-7b9b39642ab9.js` | Coach naming (§F, REQ-A6) | REJECT: always-on desktop overlay for children; distraction | Studio |
| CGP-SHELL-40 | Toys | Confetti on request; audio visualizer from system audio (observed) | `settings.toys.audioVisualizer.description`, `settings.toys.*`; `general-settings-679bf39c78a4.js` | None | DEFER: celebration only after a verified result fits ui-philosophy #10; needs a design | Studio |
| CGP-SHELL-41 | Appshots | Hotkey captures the frontmost window into the current or a new chat (observed) | `settings.appshots.*`, `settings.appshotHotkey.*`; `appshots-settings-52a785d68f11.js` | visionInput.ts; page attach in chat (#308, extension.ts:694) | ALREADY | Studio |

### D. Onboarding and sign-in

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-42 | Teen welcome: interests → idea cards | Pick interests (Animals, Gaming, School, Science…), then 12 project ideas with prompts ("Animal avatar maker", "Study web app"), "Use prompt" or "Write my own prompt" (observed) | `electron.onboarding.teenWelcome.*` (20), `electron.onboarding.teenPrompts.*` (37); `onboarding-page-b0057625e2d6.js` | PRODUCT-INTENT "첫 체험은 카탈로그처럼 고르게 하는 데서 시작하지 않는다"; NAT-03; REQ-A4 | ADAPT: never the first screen; offered only when the learner says they have no idea, after one goal question | Studio |
| CGP-SHELL-43 | Role-based welcome | "What type of work do you do?" role cards, role-specific prompts using connected apps (observed) | `electron.onboarding.welcomeV2.role.title`, `.roleCopy.*`; `onboarding.health_department.*` (145) | PRODUCT-INTENT: no self-evaluation survey first. Chalk start.html "첫 강의 준비하기" 4 steps for instructors | REJECT (Studio). Chalk side ALREADY | Both |
| CGP-SHELL-44 | Getting-started checklist | Sidebar checklist with progress "{progressCount} of {totalCount}", collapse, hide setup (observed) | `sidebarOnboardingChecklist.progressCount`, `.hideSetup`, `.progressCountAriaLabel`; `sidebar-onboarding-checklist.electron-27e72c175c0d.js` | Chalk start.html has steps 1–4; persisted progress not verified | ADAPT for Chalk: instructor prep checklist with saved progress. Not for learners | Chalk |
| CGP-SHELL-45 | Sign-in methods and fallback | Google/Apple/Microsoft/email; browser handoff with "Browser didn't open?" + "Copy sign-in link"; "Continue as {account}"; admin can disable methods; API key and Bedrock (observed) | `electron.onboarding.login.browserDidNotOpen`, `.copyLink`, `.browserSession.continueAs`, `electron.loginMethods.noneAllowed`, `.login.bedrock.*`; `login-route-a70c13d542a7.js` | Participation code (REQ-A4), Google account preview (REQ-L13, extension.ts:230). No copy-link fallback found | ADAPT: browser-handoff fallback for Google sign-in. API key/Bedrock not offered to learners (AB-03) | Studio |
| CGP-SHELL-46 | Mini-game while waiting for sign-in | "Play Snake" (observed) | `electron.onboarding.login.snake.start` | None | REJECT: distraction during a step a child must finish | Studio |
| CGP-SHELL-47 | Conversational setup | Setup as a chat ("Help me set up ChatGPT for my work"), skip/restart (observed) | `electron.onboarding.desktopRole.*`, `electron.onboarding.conversationalOnboarding.*` (147); `step-3a84dae52e83.js` | Native trial is conversational (requirements/studio-native-trial.md, NAT-03) | ALREADY | Studio |
| CGP-SHELL-48 | Import from other AI apps | Detects Claude Code / Claude Cowork; imports projects, recent chats, MCP, hooks, plugins; CLAUDE.md → AGENTS.md (observed) | `electron.onboarding.welcomeV2.externalAgentImport.*`, `settings.import.*` (84) | None | DEFER: adult/instructor value only | Both |
| CGP-SHELL-49 | Example tour and accuracy education | Quick tour; "Check important details — While helpful, ChatGPT can be incorrect"; education variant "Made for your classroom" (observed) | `onboarding.accuracyEducation`, `onboarding.accuracyEducationBody`, `onboarding.exampleTour.*`, `onboarding.educationUse`; `route-3dd7e6ec6a21.js` | REQ-O1 exposes `minor_cohort` for client AI disclosure; no first-run accuracy card found | ADAPT: one card in the first session tied to an actual check the learner does | Studio |
| CGP-SHELL-50 | Workspace onboarding | Company/team name, "Anyone with a {domain} email can ask to join", connect workspace apps (observed) | `workspaceOnboarding.workspaceSetupTitle`, `.discoverabilityCheckboxWithDomain`; `success-page-bdb008344ede.js` | Class setup through Chalk console/issuer (ADM-01) | ALREADY (class creation); domain self-join REJECT (see 80) | Chalk |

### E. Minor safety, family and time

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-51 | Age status and unknown-age safeguards | Shows 18+ / Teen / unknown; unknown age gets extra safeguards until verified (observed) | `settings.chatGpt.age.unsureExplanation`, `.teenExplanation`, `.verify`; `age-settings-2cf650465349.js` | REQ-O1 fail-safe minor detection; docs/age-verification.md (roster + token gate) | ALREADY | Service |
| CGP-SHELL-52 | Parental controls linking | Parent/child invitations, parent adjusts features and time limits without seeing conversations (except safety), leave family group, graduation notice (observed) | `settings.chatGpt.parentalControls.*` (22), `settings.chatGpt.familyInvitation.*`, `settingsModal.addChildCTA`; `invitations-9ce6de3bb717.js` | age-verification.md: guardian consent (PIPA) is Jay-gated; `parent_coaching` family workshops | DEFER: needs the PIPA guardian-consent decision | Both |
| CGP-SHELL-53 | "Settings changed by someone" notice | "{triggeringName} updated your settings" notification to the teen (observed) | `settings.chatGpt.parentalControls.settingUpdateTitle`; `surface-e2ece38c2199.js` | ADM-11: no silent change of a running class; U3 distributes lesson settings (default off). No learner-visible notice of a teacher change found | ADAPT: tell the learner when the teacher changed their help level, model or tools | Studio |
| CGP-SHELL-54 | Quiet hours | Schedule hours when ChatGPT can't be used; ≤12 blocks; at least 5 minutes outside quiet hours each day; managed by parent (observed) | `settings.chatGpt.quietHours.*`, `settings.chatGpt.timeManagement.quietHours.title`, `settings.recurringSchedule.*`; `safety-settings-163320f448a6.js` | Service enforces a class window: `session_window` → "수업 시간이 끝났어요. 다음 시간에 다시 만나요." (proxyClient.ts:114, REQ-B5, REQ-Q9) | ADAPT: show the window before it ends; the server gate stays the authority | Studio |
| CGP-SHELL-55 | Study hours | Schedule when Study mode ("asks questions and gives hints before answering") is on (observed) | `settings.chatGpt.timeManagement.studyHours.studyModeDescription` | Help level per lesson stage: AE requirements, U3 lesson settings distribution, ui-philosophy #05 Progressive help | ALREADY (by stage, not by clock) | Both |
| CGP-SHELL-56 | Trusted contact | Adult (18+) nominates a contact who is alerted on serious self-harm risk; Korea-specific copy (observed) | `settingsModal.trustedContacts.*`, `settingsModal.trustedContacts.sectionDescriptionSecondaryKorea.v1`, `trustedContact.notification.*`; `trusted-contact-settings-d3a82a56af46.js` | REQ-O2 blocks self-harm instructions for minors; no escalation-to-adult path found | DEFER: needs a safeguarding policy (who is told, legal basis) before any UI | Service |
| CGP-SHELL-57 | Lockdown mode / external link confirmation | Limits web and external connections; "External links show the full URL and ask for confirmation before opening" (observed) | `settingsModal.lockdownModeEnableModalExternalLinks`, `settingsModal.lockdownModeEnableModalWebAccess`; `confirmation-9ffbef3de27f.js` | openExternal used in chatPanelProvider.ts, extension.ts, publishHost.ts; no minor-cohort confirmation rule found | ADAPT: full-URL confirmation before leaving Studio, on by default for minor cohorts | Studio |
| CGP-SHELL-58 | Locked chats with PIN | Hide chosen chats behind a PIN; reset deletes protected content (observed) | `settingsModal.accountPin.*`, `settings.chatGpt.security` (227 incl. locked chats); `account-pin-query-64eb5fe93d8b.js` | Sharing contract hps-classroom-share/1 (classroom-admin.md) | REJECT: conflicts with the class sharing contract for minors | Studio |

### F. Account, security, privacy

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-59 | Security and login | Authenticator/SMS MFA, passkeys/biometric, "Log out of all devices", connected apps (observed) | `settings.chatGpt.security.sessions.logOutAllLabel`, `emailMfaSmsEnrollment.*`, `settings.biometric.*` | Participation token; instructor reissue replaces one seat's token (chalk/README BOA-DIST) | DEFER: account mode is still a preview (REQ-L13) | Service |
| CGP-SHELL-60 | Email add/change/verify | 6-digit code, 2 changes per 24 h (observed) | `settings.chatGpt.email.*` | Google identity | DEFER | Service |
| CGP-SHELL-61 | Delete account | "Delete account—are you sure?" (observed) | `settings.chatGpt.account.deletion.*`; `account-settings-eba6de639a30.js` | ADM-14 handles withdrawal of shared records; no account deletion request found | ADAPT: learner or guardian can request deletion; result is visible | Service |
| CGP-SHELL-62 | Data export | Emails a download link of account details and chats; link expires after 24 h (observed) | `settings.chatGpt.dataControls.export.dialog.*`; `data-controls-settings-46d8b7750712.js` | AB-13 keeps export after limits; files are local; localTranscript.ts exists. No one-step export found | ADAPT: "내 작업 내보내기" zip of workspace + chat, local, no email | Studio |
| CGP-SHELL-63 | Training opt-out and privacy controls | "Improve the model for everyone", memory controls, marketing privacy, cookie center, info shared with apps (observed) | `settings.chatGpt.dataControls.training.*`, `settings.memory.*`, `settings.chatGpt.marketingPrivacy.*`, `settingsModal.privacy.cookieConsent.*` | Session-log upload is opt-in (session-log-consent.ko.md, REQ-Q9/Q10). Marketing cookies: none | ALREADY (consent); marketing parts REJECT | Service |
| CGP-SHELL-64 | Shared links management | List and delete shared links (observed) | `settings.chatGpt.sharedLinks.*`; `dialog-3fd48ccc540e.js` | Chalk /sharing "내 공유 기록"; ADM-14 withdrawal and expiry | ALREADY | Chalk |
| CGP-SHELL-65 | Account / workspace switcher | Switch accounts, log out of all accounts (observed) | `accountSwitch.loading.*`, `workspaceSwitcher.*` | REQ-Q2 rotates the session when identity changes | DEFER: shared family devices make mixed identities risky | Studio |
| CGP-SHELL-66 | Personalization | Nickname, occupation, custom instructions, Codex instructions (observed) | `settings.personalization.*`, `settings.chatGpt.personalization.*` (228) | Coach naming REQ-A6; REQ-STUDIO-EXTERNAL-INSTRUCTIONS | ALREADY | Studio |

### G. Usage, limits, billing

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-67 | Usage-remaining meter | Sidebar "{remaining}% usage remaining", progress bar, "Resets {cadence} · Next reset is at {time}"; tray Usage item; "Luna Reserve" for advanced models (observed) | `sidebarElectron.usageAlert.title`, `.resetAtWithCadenceTime`, `sidebarElectron.lunaReserve.title`; main `trayMenu.usage`; `app-initial-90eb42395b7d.js` | Spec exists: REQ-L9, AB-11, AB-15 (source, as-of time, own use, reserved, unconfirmed). Studio src only has exhaustion/expiry messages ("이용권의 AI 요청을 모두 썼어요…"); no pre-run remaining display found | ADAPT: show remaining pass requests and as-of time before running; no percent when unknown | Studio |
| CGP-SHELL-68 | Request more usage | "Notify admin" with cooldown; "Request more usage" with justification, pending state, update request (observed) | `sidebarElectron.usageAlert.notifyOwner.*`, `settings.usage.limits.requestJustificationPlaceholder`, `.requestPending`; `page-d40b312a477a.js` | AB-11 "추가 허용 요청"; Chalk budgets.html reviews requests | ADAPT: learner button "선생님께 더 요청하기" linked to the Chalk request | Both |
| CGP-SHELL-69 | Per-chat usage popover | Credits used, estimated cost, model/effort/speed breakdown, token counts (observed) | `threadUsagePopover.summary` ("{credits} credits used · Est. {cost}"), `usageCenter.thread.breakdown.*`; `local-conversation-page-2d025d4dd872.js` | AB-17: cost and tokens are not capability scores; REQ-L5 operator views | REJECT for learners; operator view ALREADY | Studio |
| CGP-SHELL-70 | Usage history | Daily chart by feature/model/surface, top chats, "Usage may be out of date", "Amounts and period boundaries are approximate" (observed) | `consumerUsage.history.*`, `consumerUsage.limitHistory.staleUsage`, `.approximateAmounts`, `consumerUsage.chats.*`; `billing-analytics-6dc2713da1c0.js` | Chalk budgets.html limits, pause and requests; AB-12/AB-15 as-of time and unconfirmed; no daily chart found | ADAPT: Chalk daily class usage with as-of time and unconfirmed segments | Chalk |
| CGP-SHELL-71 | Admin monthly per-member limit | "Your admin hasn't set a usage limit"; "{used} of {limit} credits used" (observed) | `settings.usage.limits.monthly.*` | Chalk budgets "학생 사용 상한", AB-04 | ALREADY | Chalk |
| CGP-SHELL-72 | Credits, auto-reload, instant reset | Buy credits, auto top-up, "Buy an instant reset", banked resets (observed) | `settings.usage.creditReload.*` (92), `settings.usage.autoTopUp.*`, `settings.usage.limits.buyReset.button` | INT-ACCESS-05 no upgrade pressure; AB-05 no automatic switch to personal payment | REJECT | Studio |
| CGP-SHELL-73 | Plans and checkout | Plan picker, checkout form, 29 payment methods, tax ID, bank mandates (observed) | `pricing.*` (226), `checkout.*`, `CheckoutForm.*`, `paymentMethodNames.*`, `settings.consumerBilling.*`; `checkout-page-7458ea132fa0.js` | REQ-L12 in-app pass purchase (Service decides payment), live with Toss since 2026-10-14 | ALREADY | Studio |
| CGP-SHELL-74 | Cancellation retention flow | "Things you lose", go-upsell, Plus offer, downgrade survey (observed) | `cancelSubscriptionThingsYouLoseModal.*`, `cancelSubscriptionGoUpsellModal.*`, `cancelSubscriptionPlusOfferModal.*`; `dialog-443a2d7ba7a7.js` | Passes are fixed-period, not subscriptions | REJECT: retention pressure conflicts with INT-ACCESS-05 | Studio |
| CGP-SHELL-75 | Transactions, invoices, balance | Transaction history, invoices, wallet balance, gift cards (observed) | `settingsModal.transactionHistory.*`, `settingsModal.walletBalance.*` | Receipts: Lab #1210 (sales decisions open) | DEFER: depends on the receipt decision | Service |
| CGP-SHELL-76 | Ads controls | Ad history, topics, personalization, "reduce message limits to remove ads" (observed) | `settings.ads.*` (43); `route-e5c8af547e5a.js` | None | REJECT | — |
| CGP-SHELL-77 | Seat types and team billing | Standard/premium seats, annual vs monthly, seat limits (observed) | `WorkspaceMembers.seatType*`, `teamBilling.*` | AB-02 institution passes | DEFER: institution sales not active | Service |
| CGP-SHELL-78 | App limits under subscription sharing | Per-app limits (inferred from strings) (observed strings) | `settings.usage.subscriptionSharing.*` (15) | None | DEFER | Service |

### H. Workspace and team administration

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-79 | Invite by email or CSV | Add emails or upload CSV (one per line), duplicate warning, invite limit, roles, verified-domain check, "Invited # users" (observed) | `admin-invite.importCSVTooltip`, `.duplicateEmailWarning`, `.inviteLimitWarning`, `.inviteSuccessCount` | Chalk issuer "학생 초대", ADM-01, BOA-DIST named batches. CSV import not found in issuer.html | ADAPT: roster paste/CSV with per-row result | Chalk |
| CGP-SHELL-80 | Workspace discovery and join requests | "{email} can join # workspaces", search by name, request to join (observed) | `workspaceDiscovery.*` (47); `workspace-discovery-c4960d9b290e.js` | Enrollment-mediated identity (age-verification.md) | REJECT: learners must not find or request classes on their own | — |
| CGP-SHELL-81 | Leave workspace | Leave with email confirmation (observed) | `leaveWorkspaceModal.*` | Class end via Chalk console | DEFER | Chalk |
| CGP-SHELL-82 | Agreements and policy acknowledgement | BAA / services agreement with "agreed on" timestamp; workspace policy acknowledgement (observed) | `workspaceAgreements.timestampLabel`, `workspacePolicy.title`; `agreements-settings-3f6c7e3ccd80.js` | Session-log consent (session-log-consent.ko.md) | ADAPT: class-rules acknowledgement at join, timestamped, readable by the teacher | Both |
| CGP-SHELL-83 | Workspace recovery | Payment failed / deactivated workspace, create personal workspace (observed) | `workspaceRecovery.*` (37); `gate.electron-fc32d88b7624.js` | AB-13; passPurchase.ts copy keeps files and chats after expiry/refund | ALREADY | Studio |
| CGP-SHELL-84 | Teams and Team Spaces | Teams inside a workspace, members, shared scheduled tasks, team plugins, Slack app, icon set (observed) | `settings.teams.*` (293), `teams.spaces.*`, `teams.icons.*` | None for student groups | DEFER: group work (모둠) is a later curriculum need | Chalk |
| CGP-SHELL-85 | Team activity log | "{actor} created/deleted automation", field changes (observed) | `settings.teams.activity.*` | ADM-07 records who viewed shared records | ALREADY | Chalk |
| CGP-SHELL-86 | Outdated-build banner | "Your build is # days old. A newer version is ready to install." (observed, internal alpha) | `sidebarElectron.internalAlphaUpdateBanner.body` | Chalk manage.html reports per action that an app version does not support it; no per-seat version column | ADAPT: Chalk shows each seat's app version and flags outdated seats before class | Chalk |

### I. Navigation chrome

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-87 | Product mode switcher | ChatGPT / ChatGPT Work / Codex modes (observed) | `sidebarElectron.productMode.*` | Common entry for trial and class (#915), unified-studio-experience.md | ALREADY | Studio |
| CGP-SHELL-88 | Sidebar customization | Pin/unpin/reorder destinations with announcements "moved to position {n} of {count}" (observed) | `sidebarCustomization.*` | None | DEFER | Studio |
| CGP-SHELL-89 | Help menu: guide, shortcuts, What's new | User guide, Keyboard shortcuts, What's new, set up remote / Chrome extension (observed) | `sidebarHelp.*`; `profile-dropdown-items-fd62d4277e96.js` | docs/RELEASE-NOTES-template.md (staff-facing); no in-app What's new | ADAPT: short Korean "새로운 기능" after an update | Studio |

### J. Consumer, commerce and agent-persona surfaces

| ID | Feature | What it does | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-SHELL-90 | Commerce and finance | Merchant onboarding and feeds (SFTP, 8 GB), business profiles, agentic checkout wallet, shopping, flight search, personal finance accounts, saved passwords (observed) | `merchantSettings.*` (258), `businessProfiles.*` (760), `codexWalletOnboardingEnrollment.*`, `shopping.*`, `flightSearch.*`, `personalFinance.*`, `restricted.wallet.*`, `restricted.passwords.*` | None | REJECT: consumer commerce; no learning purpose; minors | — |
| CGP-SHELL-91 | WhatsApp account link | Link WhatsApp number to ChatGPT (observed) | `account-link.*` | None | REJECT | — |
| CGP-SHELL-92 | Space (pages workspace) | Pages, folders, trash after 30 days, pinned items (observed) | `space.*` (392); `personalized-pages-4655a05eced7.js` | Owned by the documents domain | DEFER (other domain) | — |
| CGP-SHELL-93 | Writing style setup | Learns the user's writing style from connected apps (observed) | `tpp.*`, `workOnboarding.writingStyle.*`; `writing-style-setup-65e44750627e.js` | None | DEFER: would imitate the learner's voice; needs a judgment-preserving design | — |
| CGP-SHELL-94 | Persistent agent "dot" and characters | Named always-on agent with its own cloud computer, calls, texting; character/avatar editor (observed) | `restricted.aeon.*` (444), `restricted.aeonMessaging.*`, `restricted.characterEditor.*`, `restricted.avatarChooser.*`, `restricted.orbit*` | Coach identity (coachIdentity.ts, REQ-A6) | DEFER: avatar for the coach may help children; always-on agent does not fit minors | Studio |
| CGP-SHELL-95 | Cloud environments and desktops | Shared cloud environments, cloud desktop connection (observed) | `restricted.environmentSetup.*` (353), `restricted.cloudDesktop.*`, `settings.cloudEnvironments.*` | Owned by the execution domain | DEFER (other domain) | — |
| CGP-SHELL-96 | Codex Micro hardware | Assign chats/skills to physical keycaps (observed) | `settings.codexMicro.*` (223); `codex-micro-settings-40951540599d.js` | None | REJECT | — |
| CGP-SHELL-97 | Computer history (Chronicle) | Records past computer activity to "pick up where you left off" (observed) | `settings.chronicle.*` (155), `electron.onboarding.capabilitiesSetup.computerHistory.*` | None | REJECT: screen-history capture on a child's computer | — |
| CGP-SHELL-98 | Remote connections | Control other devices from this Mac; remote control (observed) | `settings.remoteConnections.*` (188), `settings.remoteControlConnections.*` | Owned by the remote/agent domain | DEFER (other domain) | — |

### Verdict counts

ADOPT 5 · ADAPT 29 · ALREADY 23 · DEFER 24 · REJECT 17 (98 rows). Hybrid rows are counted by their
main verdict.

### Settings sub-namespaces handled elsewhere

`settings` has 4,822 strings. Sub-namespaces above go to rows 01–41 and 51–89. The rest belong to
agent/coding/browser domains and get no verdict here: `browserUse` 317, `codexMicro` 223 (→96),
`remoteConnections` 188 (→98), `cloudEnvironments` 174 (→95), `chronicle` 155 (→97), `agent` 148,
`computerUse` 123, `localEnvironments` 120, `mcp` 118, `codeReview` 99, `automations` 92, `import` 84
(→48), `hooks` 71, `git` 55, `worktrees` 45, `userRules` 34, `chromeExtension` 16, `agentEnvironment` 12,
`codeReviewPlugin` 11, `pluginControls` 7, `legacyCodexCloud` 7, `openIn` 3, `plugins` 2.

## 2. Requirements (ADOPT and ADAPT rows)

| REQ ID | Requirement (one behavior) | Acceptance criteria | Priority | Traces to |
|---|---|---|---|---|
| REQ-SHELL-01 (CGP-01) | During an active class session window, Studio does not show an update install prompt or start an install. | With a valid class token inside its window and a newer release available: no install dialog, no restart, no download over metered warning; the banner may show "수업이 끝나면 설치할 수 있어요". After the window ends or with no class token, REQ-I2/I4 behavior returns. The user still approves every restart (REQ-I4). | P0 | #1, ADM-11 |
| REQ-SHELL-02 (CGP-01) | A downloaded and verified update installs on the next user-initiated quit when no coach turn is running. | Quit with a staged verified update and no active turn → install runs and next launch shows the new version. Quit during a running turn → REQ-SHELL-04 dialog first; no install if the user cancels. Failure keeps the old app (REQ-I13). | P1 | #1 |
| REQ-SHELL-03 (CGP-02) | An instructor can freeze the Studio version for a cohort for a date range. | Chalk setting saved per cohort; Studio in that cohort hides the update banner for the range and shows "선생님이 업데이트 시점을 정했어요" in About/update UI; a release marked security-critical overrides the freeze and is labelled so in Chalk. | P1 | #1, ADM-11 |
| REQ-SHELL-04 (CGP-04) | Quitting or closing the last window while a coach turn runs, a preview build is in progress or an unsent queued message exists asks for confirmation and names what will stop. | Cmd+Q / Alt+F4 / window close with an active turn → dialog "Studio를 끝낼까요? 지금 하고 있는 대답이 멈춰요."; Cancel keeps everything running; Quit stops the turn and keeps files. No dialog when nothing is active. Verified on macOS and Windows. | P0 | #1 |
| REQ-SHELL-05 (CGP-09) | A Chalk join link opens Studio on the join screen for the named class without carrying the participation code. | `hypeproof-studio://join?class=<id>` (scheme per build) opens the start page with the class name shown and the code field empty and focused; a link containing anything that looks like a token is rejected and logged without the value; unknown class → neutral start screen (REQ-A4). | P1 | #4, REQ-A4 |
| REQ-SHELL-06 (CGP-10) | Native menus, native dialogs and settings labels a learner can reach are shown in Korean. | On a Korean or non-Korean OS, App/Edit/View/Window/Help menus, quit/update/About dialogs and the learner settings sheet render Korean labels; a screenshot test lists zero English menu titles. | P1 | #1 |
| REQ-SHELL-07 (CGP-12) | The Dock/taskbar badge shows the count of unread teacher notices and help-request replies only. | New teacher notice → badge 1; opening the inbox clears it; coach replies and system events never change the badge; badge cleared on quit. | P2 | #2, ADM-05 |
| REQ-SHELL-08 (CGP-13) | Studio shows an OS notification only when the window is unfocused and either a teacher message arrives or a coach turn longer than 60 s finishes. | Focused window → no OS notification. Unfocused + teacher notice → one notification. Minor cohort → no sound by default. Learner can turn it off in the settings sheet. A notification never pauses the integrated browser (regression for extension.ts:694). | P2 | #4 |
| REQ-SHELL-09 (CGP-14) | While a coach turn, preview build or update download runs, Studio keeps the computer from sleeping and releases the block when it ends. | Power assertion present during an active turn (`pmset -g assertions` / `powercfg /requests`), absent within 5 s after the turn ends or fails. Display sleep is still allowed. | P1 | #1 |
| REQ-SHELL-10 (CGP-17) | Before any OS permission prompt, Studio shows its own Korean explanation of why the lesson step needs it, and asks only at that step. | First mic use in a voice lesson → Studio card "목소리로 말하려면 마이크가 필요해요" then the OS prompt; denying keeps text chat working with a way to retry; no permission prompt at first launch. | P1 | #2, #4 |
| REQ-SHELL-11 (CGP-22) | When the network is lost, the chat panel shows one offline banner that states what still works. | Disconnect network → within 5 s banner "인터넷이 끊겼어요. 만든 파일은 그대로 있고, 연결되면 다시 보낼 수 있어요."; send is queued (REQ-C16), not dropped; reconnect removes the banner within 5 s and sends the queue once. | P1 | #1, AB-13 |
| REQ-SHELL-12 (CGP-24) | The chat webview provides a "skip to input" link and keyboard-resizable panels. | First Tab focuses a visible skip link that moves focus to the composer; panel splitters are focusable with Arrow keys changing size in 16 px steps and have an accessible name. | P1 | #1 |
| REQ-SHELL-13 (CGP-25) | A render error in one panel shows a retry inside that panel and keeps the composer text and chat history. | Forced render exception in a panel → panel shows "이 부분을 보여주지 못했어요" + 다시 시도; composer draft and messages unchanged; error reported with request id (REQ-H4). | P1 | #1 |
| REQ-SHELL-14 (CGP-26) | The start page "설정" opens a learner settings sheet with at most 6 items; the full VS Code settings editor is reachable only from it via "고급 설정". | Sheet lists: 글자 크기, 화면 밝기(테마), 움직임 줄이기, 알림, 팁 보기, 내 작업 내보내기. For minor cohorts "고급 설정" is hidden. Studio (2026-10-26): REQ-STUDIO-START-SETTINGS; the sheet draws 글자 크기, 움직임 줄이기 and 알림 now, the other three join with REQ-SHELL-16/19/28; see decisions.md DEC-SHELL-R014. | P2 | #4 |
| REQ-SHELL-15 (CGP-27) | Settings fixed by the cohort profile are shown as locked with the reason. | A setting set by the profile (e.g. model, approval mode) shows a lock and "선생님이 정한 설정이에요"; the control is disabled; the learner can still read the current value. | P1 | #2, AB-03 |
| REQ-SHELL-16 (CGP-29) | Studio offers HP Dark, HP Light and "시스템 따라가기". | Switching updates the chat webview, start page and workbench theme together without reload; choice persists across restarts; explicit user VS Code theme settings are not overwritten (#725 rule). | P2 | #1 |
| REQ-SHELL-17 (CGP-30) | The learner can set chat text size to 보통 / 크게 / 아주 크게. | Body text 15 / 17 / 20 px; persists; applies to chat, start page and help panels; no clipped controls at 아주 크게 in a 320 px wide panel. | P1 | #1 |
| REQ-SHELL-18 (CGP-31) | Studio honors reduced motion from the OS and from its own setting. | With OS reduce-motion or the setting on, no transition longer than 0 ms except opacity ≤ 120 ms; typing indicator becomes static; streaming text appears without per-character animation. | P1 | #1 |
| REQ-SHELL-19 (CGP-35) | Tips follow the intervention ladder and can be turned off. | A tip appears at most once per session and only after an observed trigger (e.g. 3 failed runs); "팁 그만 보기" stops all tips until re-enabled; tips never appear while a turn streams. | P2 | #4, #6 |
| REQ-SHELL-20 (CGP-42) | Example project ideas are shown only after the learner says they have no idea of what to make. | First screen never shows idea cards; after the learner answers the goal question with "몰라요"-type intent, up to 6 ideas appear with "이걸로 시작" and "내가 정할래요"; picking one puts its text in the composer for editing, not auto-send. | P2 | #2, #6, NAT-03 |
| REQ-SHELL-21 (CGP-44) | Chalk shows the instructor a first-class preparation checklist whose progress is saved per instructor. | start.html steps 1–4 show "n / 4 완료"; progress survives reload and another device; each step links to its page; checklist can be hidden and reopened. | P2 | #1 |
| REQ-SHELL-22 (CGP-45) | If the browser does not open for Google sign-in, Studio offers to copy the sign-in link. | After 10 s without return, "브라우저가 안 열렸나요?" shows a copy button; copied link completes sign-in via `/account-return` (extension.ts:230); link expires with the state value. | P1 | #1 |
| REQ-SHELL-23 (CGP-49) | In the first session, Studio shows one card that AI can be wrong and links it to a check the learner performs. | Card appears once, after the first AI result: "AI도 틀릴 수 있어요. 결과를 직접 눌러 확인해 봐요." with the check action; dismissed state persists; minor cohorts always get it. | P1 | #3, #5 |
| REQ-SHELL-24 (CGP-53) | When the instructor changes a learner's lesson settings, the learner sees what changed before the next turn. | After a U3 settings change, next panel open shows "선생님이 도움 방식을 바꿨어요: <before> → <after>" once; the change is not applied to a turn already running (ADM-11). | P1 | #2 |
| REQ-SHELL-25 (CGP-54) | The chat panel shows when the current class window ends, 10 minutes before the end. | With a server-provided window end, a non-blocking line "수업이 10분 뒤에 끝나요" appears at T−10 min; at the end the server gate remains authoritative (REQ-B5); no countdown when the end time is unknown. | P1 | #4, #1 |
| REQ-SHELL-26 (CGP-57) | For minor cohorts, opening an external link shows the full URL and asks for confirmation. | Click on any external link → dialog with the full URL (host emphasized) and "열기 / 취소"; adults default off with a setting; links inside the lesson allowlist open without the dialog. | P1 | #2, REQ-O1 |
| REQ-SHELL-27 (CGP-61) | A learner or guardian can request account and data deletion, and the request's status is visible. | Request from the settings sheet or a Lab page creates a Service record; status shows 접수 / 처리 중 / 완료 / 보류(사유); shared records follow ADM-14; local files are not deleted without a separate confirmation. | P1 | INT-ACCESS-05, ADM-14 |
| REQ-SHELL-28 (CGP-62) | "내 작업 내보내기" saves a zip of the current workspace and the local chat transcript to a folder the learner picks. | Zip contains workspace files (excluding `.git`, `node_modules`) and transcript JSON/Markdown; no secrets or tokens (grep test); works offline; available after pass expiry (AB-13). | P2 | #1, AB-13 |
| REQ-SHELL-29 (CGP-67) | Before sending, a pass holder sees the remaining requests in the pass and when that number was confirmed. | Chat header shows "남은 요청 37회 · 3:42 확인"; value comes from Service; unknown → "확인 중" (never 0 or a percent); reserved/unconfirmed shown per AB-15; class tokens show the class source instead of a personal number. | P0 | INT-ACCESS-01, AB-11, AB-15, REQ-L9 |
| REQ-SHELL-30 (CGP-68) | A learner whose class allowance is low can ask the instructor for more, once per cooldown. | At ≤10% or exhausted, button "선생님께 더 요청하기" with optional reason (≤200 chars); creates a Chalk budgets request; state 요청함 / 승인 / 거절 shown; repeated requests within 10 min blocked with the reason. | P1 | #2, AB-11 |
| REQ-SHELL-31 (CGP-70) | Chalk budgets shows daily class usage with the as-of time and unconfirmed amounts separated. | Daily bars for the last 14 days; each bar splits confirmed / reserved / unconfirmed; header shows "기준 시각"; stale data (> 30 min) labelled; never shows unconfirmed as 0 (AB-15, ADM-08). | P1 | #5, AB-12 |
| REQ-SHELL-32 (CGP-79) | The issuer page accepts a pasted or CSV roster and reports a result per row. | Paste or upload ≤200 rows; duplicates and invalid handles flagged before issue; after issue each row shows 발급됨 / 실패(사유); failures do not block other rows (BOA-DIST-03). | P1 | #1, ADM-01 |
| REQ-SHELL-33 (CGP-82) | At first join, the learner acknowledges the class rules, and the time is recorded for the instructor. | Rules text from the cohort profile shown once; "알겠어요" records timestamp per seat; Chalk shows 확인함 / 미확인 per seat; changed rules require a new acknowledgement. | P2 | #2 |
| REQ-SHELL-34 (CGP-86) | Chalk shows each seat's Studio version and flags seats below the cohort's minimum. | Manage list gets a 버전 column from the heartbeat; seats below the minimum show amber "업데이트 필요" with icon + text; unknown version shows "확인 불가". | P1 | #1, ADM-02 |
| REQ-SHELL-35 (CGP-89) | After an update, the learner sees up to 3 short Korean "새로운 기능" lines once. | First launch on a new version shows a dismissible panel with ≤3 items from release notes written for learners; not shown during an active turn; reachable later from Help. | P2 | #3 (built 2026-10-26: bundled learner lines in `learnerReleaseNotes.ts`; "Help" = the settings dialog next to 키보드 단축키; see decisions.md CGP-SHELL-R-035) |

## 3. Design requirements (same rows)

Tokens: Deep forest #151D19, Panel #202C24, Lime #D5F279 (one primary CTA per screen), Amber #E6A373
(attention), Ink #F2F4E8, Paper #F4F6F0 (ui-philosophy §14). Status always uses icon + text, never color
alone.

| DES ID | Visual/interaction requirement | Acceptance (measurable) |
|---|---|---|
| DES-SHELL-01 (REQ-01/02) | Update state is a single line in the start page / About, not a modal, during class. | Line height ≤ 32 px; text ≥ 14 px; no animation; contrast ≥ 4.5:1 in dark and light; fits 320 px without truncating the verb. |
| DES-SHELL-02 (REQ-03) | Chalk freeze control is a date-range picker with the active state badge on the cohort row. | Badge "업데이트 고정 ~10/31" amber with lock icon; keyboard-operable date inputs; screen reader announces range. |
| DES-SHELL-03 (REQ-04) | Quit dialog is a native dialog with the safe action as default. | Default button "계속하기" (Enter); destructive "끝내기" secondary; body ≤ 2 lines Korean; Esc = cancel; VoiceOver/Narrator read title + body. |
| DES-SHELL-04 (REQ-05) | Join screen opened from a link shows class name above an empty code field. | Code field focused, 44 px tall, Korean IME not engaged for code (`inputmode=latin` equivalent); paste works; error text under field, not toast. |
| DES-SHELL-05 (REQ-06) | Korean menus follow macOS/Windows conventions. | Ellipsis on items that open dialogs ("업데이트 확인…"); accelerators unchanged; no mixed-language item. |
| DES-SHELL-06 (REQ-07) | Badge shows a number only. | Max "9+"; cleared within 1 s of opening the inbox. |
| DES-SHELL-07 (REQ-08) | OS notification text is short and names the sender. | Title "선생님 알림" or "대답이 끝났어요"; body ≤ 60 chars; no preview of the learner's content on lock screen for minors. |
| DES-SHELL-08 (REQ-09) | No visible UI; optional small "잠자기 막는 중" in the turn status for adults. | Status text 12 px, hidden for minors. |
| DES-SHELL-09 (REQ-10) | Permission explainer is an inline card in chat, not a modal. | Card width ≤ 100% of panel, min 280 px; one lime CTA "허용하기"; secondary "나중에"; icon for the device (mic/camera); works at 320 px. |
| DES-SHELL-10 (REQ-11) | Offline banner sits at the top of the chat panel. | Amber left border 4 px + icon; height ≤ 48 px; `role="status"` announces once; does not cover messages; light/dark both ≥ 4.5:1. |
| DES-SHELL-11 (REQ-12) | Skip link visible on focus; splitter focus ring. | Skip link appears at top-left on first Tab, 2 px lime focus ring; splitter hit area ≥ 8 px, focus ring 2 px; Arrow = 16 px, Shift+Arrow = 64 px. |
| DES-SHELL-12 (REQ-13) | Panel error state replaces only the failed panel. | Icon + 1 line + "다시 시도" button 36 px; composer remains interactive; no stack trace shown to learners. |
| DES-SHELL-13 (REQ-14) | Learner settings sheet is a right-side sheet over the chat. | Width 320–400 px; rows 48 px; each row label + control on one line at 320 px; Esc closes; focus returns to the opener; light/dark. Studio (2026-10-27): the start page sheet (REQ-STUDIO-START-SETTINGS) is a modal right-side sheet, full height, 320–400 px, 48 px one-line rows with select/checkbox controls; see decisions.md DEC-SHELL-D013. |
| DES-SHELL-14 (REQ-15) | Locked row shows lock icon and reason. | Lock icon 16 px + text "선생님이 정한 설정이에요" 13 px; control `aria-disabled=true` with the reason in its description. |
| DES-SHELL-15 (REQ-16) | HP Light uses Paper #F4F6F0 background and forest text. | Body text ≥ 7:1 contrast; lime CTA uses forest text on lime (≥ 4.5:1); theme switch without flash (> 1 frame of wrong background = fail). |
| DES-SHELL-16 (REQ-17) | Text size control is a 3-step segmented control with live preview. | Steps 15/17/20 px, line-height 1.6; Hangul line-break by word (`word-break: keep-all`); no horizontal scroll at 320 px with 아주 크게. |
| DES-SHELL-17 (REQ-18) | Reduced motion removes movement, keeps state changes. | All `transform` animations disabled; opacity fades ≤ 120 ms; verified with OS setting and the in-app toggle. |
| DES-SHELL-18 (REQ-19) | Tip is an inline chip under the last message. | One chip at a time; 13 px; dismiss × 24 px target inside a 44 px hit area; never overlaps the composer. |
| DES-SHELL-19 (REQ-20) | Idea cards appear as a list after the goal question. | ≤ 6 cards, one column at 320 px, two at ≥ 640 px; each card 2 lines max; "내가 정할래요" visible without scroll; picking an idea fills the composer and keeps Korean IME composition intact. |
| DES-SHELL-20 (REQ-21) | Chalk checklist uses the existing start.html steps with a progress line. | Progress text + bar; completed steps show check icon + "완료"; keyboard navigable. |
| DES-SHELL-21 (REQ-22) | Copy-link fallback appears under the waiting spinner. | Appears after 10 s; button 36 px; confirmation "링크를 복사했어요" inline for 3 s, announced by `role="status"`. |
| DES-SHELL-22 (REQ-23) | Accuracy card is an inline card in the chat stream. | Amber icon + 2 lines max; action button lime; dismissible; not shown again after dismissal. |
| DES-SHELL-23 (REQ-24) | Settings-change notice is a system line in chat, not a modal. | Distinct system style (Panel background, no avatar); before → after shown in plain words; announced once by `role="status"`. |
| DES-SHELL-24 (REQ-25) | Class-end line is quiet. | Single line under the header, 13 px, amber clock icon; no ticking seconds; not repeated after dismissal. |
| DES-SHELL-25 (REQ-26) | External link dialog emphasizes the host. | Host in bold, full URL wraps (no ellipsis); default focus on "취소"; Enter does not open the link. |
| DES-SHELL-26 (REQ-27) | Deletion request status is a row with a state chip. | States with icon + text; date shown; "보류" shows the reason inline. |
| DES-SHELL-27 (REQ-28) | Export shows progress and the result path. | Progress for > 1 s operations; result "저장했어요: <폴더>" with "폴더 열기"; works at 320 px. |
| DES-SHELL-28 (REQ-29) | Remaining-requests chip sits in the chat header next to the model name. | Text "남은 요청 37회" 13 px + clock "3:42 확인"; amber at ≤ 10% with icon; never a progress bar when total is unknown; tap opens AB-11 detail; fits 320 px with the model name truncated first. |
| DES-SHELL-29 (REQ-30) | Request-more button appears inside the low-allowance notice. | Secondary style; reason field ≤ 200 chars with counter; Korean IME composition does not trigger submit; state chip after sending. |
| DES-SHELL-30 (REQ-31) | Chalk daily chart is a stacked bar with a legend and a table alternative. | Confirmed solid, reserved hatched, unconfirmed outlined (pattern + label, not color only); "표로 보기" toggle gives the same numbers; as-of time in the header. |
| DES-SHELL-31 (REQ-32) | Roster import shows a preview table before issuing. | Invalid rows highlighted with icon + reason; count summary "정상 28 · 확인 필요 2"; issue button disabled until the instructor confirms. |
| DES-SHELL-32 (REQ-33) | Rules acknowledgement is a single screen at join. | Text ≤ 8 short lines, 17 px; one lime "알겠어요"; no scroll trap; Chalk column shows check icon + time. |
| DES-SHELL-33 (REQ-34) | Version column in Chalk manage list. | Column ≤ 96 px; outdated = amber icon + "업데이트 필요"; sortable; included in the dense comparison view (report-gap reset G1). |
| DES-SHELL-34 (REQ-35) | What's-new panel is dismissible and short. | ≤ 3 bullets, ≤ 40 chars each; close × with 44 px hit area; not modal; light/dark. |

## 4. Open questions and unknowns

1. Studio's built `Info.plist` permission strings and menu language were not checked: the snapshot has
   no build output or `product.json`. REQ-SHELL-06/10 assume VSCodium defaults (English).
2. `extensions/hypeproof-chat/package.json` is missing from the snapshot, so the actual contributed
   settings list (REQ-K1 says it is the source of truth) was not read.
3. Is the class window end time available to the client? The `session_window` error exists
   (REQ-B5), but a field with the end time was not found. REQ-SHELL-25 needs it from Service.
4. Remaining-request numbers for passes: AB-15 forbids inventing an exact count. Does Service expose a
   confirmed remaining value plus as-of time today? REQ-SHELL-29 depends on it.
5. Guardian linking (52), trusted contact (56) and account deletion (61) need Jay's PIPA/consent
   decisions (docs/age-verification.md marks them Jay-gated).
6. Update freeze (REQ-SHELL-03) versus security fixes: who may override a freeze, and is there a
   minimum-version gate in Service today? Not found.
7. Feature flags: many ChatGPT surfaces here (teen onboarding, quiet hours, trusted contact Korea copy,
   Popout Window) are shipped strings; whether they are on for any given account is unknown.
8. ChatGPT's Korean menu file has 220 keys; whether VS Code's native menu can be localized in Studio
   without a language pack (and its license/size cost) is unverified.


## Class window source decision (CGP-SHELL-R-025)

The existing classroom operations connect response already includes the class run's
server-provided start/end. Use it only for the matching verified classroom learner,
cohort and profile. Unknown and unpaired seats remain silent (DEC-25); token/grant
expiry is not a class end. The passive line counts down only within the final ten
minutes and disappears at the end without changing Service admission. Connection
snapshot freshness is explicit: schedule changes require a refreshed connection.

## Example project ideas (CGP-SHELL-R-020)

Built 2026-10-26 as `REQ-STUDIO-PROJECT-IDEAS` (`docs/studio-requirements.md`). Owner-delegated
choices: personal seats only; a narrow, fail-closed no-idea and goal-question check in the
webview; six Studio-owned ideas (no Service profile key exists for them); no list when the coach's
reply already carries reply choices; columns follow the chat pane width (DES-SHELL-19). See
`decisions.md` "CGP-SHELL-R-020".

## Work export decision (CGP-SHELL-R-028)

"내 작업 내보내기" in the chat settings dialog (every seat) writes one zip of the work folder (minus
`.git`, `node_modules`, `.hypeproof`, links and credential-bearing files) plus the transcript as JSON
and Markdown to a folder the learner picks. Local only, so it works offline and after a pass ends;
it never replaces a file and refuses rather than truncates past 300 MB / 20,000 files. Contract:
`docs/studio-requirements.md` "Work export zip (CGP-SHELL-R-028)"; choices in DEC-SHELL-R028.
