# ChatGPT desktop → Studio/Chalk parity: LEARN domain (learning & education)

Domain slug `learning-education`, ID prefix `CGP-LEARN`. Source: ChatGPT macOS v26.1013.40934
(`com.openai.codex`). Evidence = `findings/messages-en.json` (message ids + chunk names) and
read-only inspection of `app.asar:webview/assets/`. Studio state = `studio@origin/main:` snapshot.

Evidence labels: **observed** = string, asset or code is present in the bundle. **inferred** = my
reading of behavior from those strings/assets. Presence in the bundle does not prove the
feature is enabled for any given account (flags, plan, age, region gating are not visible).

## 0. What the bundle actually contains (orientation)

### 0.1 Interactive learning blocks: shape of the catalog

- **Volume (observed):** 20,184 messages across `learningBlock` (18,871), `learningBlocks` (525),
  `learning_blocks` (166), `learning-block` (164), `learning-blocks` (61), `chatgpt.learning_blocks.*` (20)
  and stand-alone science namespaces (`biogeochemicalCycles` 87, `human-body-systems-map` 71,
  `sql_key_constraints` 61, `cell-organelles` 47, `oil-spill-fate` 43, `atmospheric-pollution-plume` 32,
  `rna-processing` 31, `chromatography` 25). About **1,630 distinct topic keys**. The five naming styles
  (camelCase, snake_case, kebab-case, `V2`…`V5` suffixes) suggest several authoring generations
  (inferred).
- **Chunks (observed):** 1,735 `visualization-*.js` chunks, 143 `visualization-*.css`; plus `model-*.js`
  (387), `type-*.js` (1,006), `examples-*.js` (636), `analytics-*`, `notation-*`, `multivariable-block/scene`,
  `jsxgraph-2d-renderer`, `interactive-sampling`, `sort-step-slider`, `learning-block-time-loop`,
  `learning-block-number-line(-visualization)`, `learning-block-katex`, `learning-block-pointer-label`,
  `learning-block-path`, `learning-block-stroke`, `learning-block-image-icon`,
  `learning-block-currency-locale-provider`, `format-accessible-math`, `responsive-lottie-visualization`,
  shell `learning-block.client-21c5e8347938.js`, layout `learning-block-d82411db838b.css`.
- **Subject mix (inferred, keyword binning of topic keys; noisy):** life science dominates (cell biology,
  physiology, immunology, genetics, ecology, plant/animal diversity: several hundred); chemistry (acid/base,
  organic mechanisms, orbitals, thermochemistry); math (fractions, integers, sequences, transformations,
  multivariable calculus); statistics (ANOVA, Bayes, sampling distributions, z/p-values, confusion matrix);
  CS (sorts, search, heaps, call stack, CPU fetch-decode-execute, DNS, TCP/UDP, IEEE 754, SQL keys,
  Boolean logic); physics (gas laws, levers, circuits, kinematics); earth/environment (climate feedbacks,
  ozone, soil, landslide, wastewater, plate boundaries); economics/accounting (supply/demand, elasticity,
  accrual vs cash, double entry); music (chords, scales, fretboard, ADSR, drum grid); and **procedural
  how-to** (`adultCprAedSequence`, `fireExtinguisherPass`, `bowlineKnot`, `fourInHandNecktie`,
  `applyingSunscreen`, `applyingScreenProtector`, `classicDartPaperAirplane`, `basketballLayup`).
- **Block type contract (observed, `type-*.js`):** `{type: "IPV4_SUBNETTING_CIDR", version: 2,
  thumbnailAssetKey: "ipv4-subnetting-cidr-v1", parameters: {prefix_length: {kind: "integer",
  defaultValue: 26, min: 24, max: 30}, …}}`. Parameter kinds across all type files: `number` 325,
  `integer` 75, `enum` 76, `boolean` 6. Versions: v1 752, v2 149, v3 54, v4 41, v5 8, v6 1, v9 1.
  `examples-*.js` hold named presets: `{name: "initial_profile: young profile", initialValues: {…}}`.
  So a block = versioned type + typed, bounded parameters + named starting states (inferred: the model
  emits a type + parameter values; the client renders it).
- **Narrated diagrams (observed):** 784 Lottie JSON files, e.g. `endocytosis-vesicle-uptake-v1-*.json`:
  640×400, 30 fps, 150 frames; exactly three `markers` = "Initial membrane and concentration gradient" →
  "Continuous transport or causal membrane change" → "Meaningful transported final state";
  `meta.family` (curriculum grouping: `viruses-and-prokaryotes` 21, `pathogens-and-immune-defense` 20,
  `biogeochemical-cycles` 19, `cell-cycle-and-regulation` 17, …); `meta.reservedControls` (a 120×120
  region kept free for controls); `meta.labelAnchors` with `maxWidth`, `align`, `colorRole`; text layers
  in font `LearningBlockSans` with CSS class `learning-block-lottie-text-text` (labels are separable text,
  not baked pixels → localizable and themeable, inferred). 261 `image-icon-*@3x.webp` thumbnails.
- **Interaction mechanics (observed leaf-key frequencies, inferred taxonomy):**
  1. *Stage stepper* — `stage` token 1,100×, `stageSelectorLabel` 30, per-stage `title` + `sentence`
     (`learningBlock.waterCycle.control.stageLabel` "Water-cycle stage";
     `learningBlock.adultCprAedSequence.compress.title` "3. Compress").
  2. *Parameter controls* — sliders / steppers over `number|integer` params with a live caption
     (`learningBlock.standardScoreZ.standardScoreControlsAdjustXMuAnd`).
  3. *Mode/enum selectors* — `learning-block.autocorrelation.pattern-control`,
     `chatgpt.learning_blocks.rutherford_gold_foil.model.selector.aria`; overflow chooser
     `learningBlock.inputSelector.overflowMenuAriaLabel` "{value}. Show all {label} options".
  4. *Time loop* — `learningBlock.timeLoop.iconOnlyPlayAnimationAriaLabel` / `pauseAnimationAriaLabel`.
  5. *Algorithm stepping* — `learningBlock.sortControls.{play,pause,step,shuffle,finishPass}`.
  6. *Batch sampling / accumulate* — `chatgpt.learning_blocks.rutherford_gold_foil.fire.button.label`
     "Fire another batch".
  7. *Direct manipulation* — `dragInstruction` 19× (`learningBlock.absoluteValueDistance.dragInstruction`
     "Drag the point left or right").
  8. *Graphing* — `learningBlock.graph.{resetViewportButtonLabel, viewportXMinLabel, expandAxisButtonLabel,
     xInterceptTooltipLabel, asymptoteTooltipLabel, undefinedPointTooltipLabel}` (jsxgraph renderer).
  9. *3-D scene* — `learningBlock.multivariable.cameraInstructions` "Use the arrow keys to rotate the
     three-dimensional scene"; `pointInstructions` "…Page Up or Page Down to move in depth".
  10. *Spoken math* — `learningBlock.accessibleMath.{over,power,squareRoot}` ("{left} over {right}").
- **Every block carries a text equivalent (observed):** leaf counts `aria` 503, `ariaLabel` 412,
  `controlsDescription` 387, `title` 356, `sentence` 156, `visualizationDescription` 122, `summary` 116,
  `caption` 99, `thumbnailAria` 18. Descriptions interpolate current state
  (`learningBlock.waterCycle.visualization.ariaLabel` "…The highlighted stage is {stage}; the selected
  return route is {route}…"). Captions ship a short mobile variant
  (`learningBlock.waterCycle.caption.evaporation.mobileSentence`).
- **No grading inside blocks (observed absence, bounded):** a regex over all learning-block strings for
  correct/incorrect/try again/your answer/predict/quiz/score/hint hit 31 strings in 17 blocks, all of
  them subject content (F1 score, z-score, DNA proofreading "Correct pair"). Blocks are explore-only.
- **Layout (observed, `learning-block-d82411db838b.css`):** container query at `28rem` (448 px): below it
  the visualization stacks full width; at ≥28rem the visualization takes 50 % beside text unless the
  block declares `data-learning-block-wide-width` (fixed steps 32–46 rem, 520/580/680/720 px) or is a
  time loop. Fixed heights 312/320/344 px, min heights 268/324 px.
- **Shell around a block (observed, `learning-block.client-21c5e8347938.js`):**
  `chatgpt.contentReferences.learningBlock.open.ariaLabel` "Explore interactive learning block",
  `.dialog.title` "Interactive learning block", `.reset.ariaLabel`, `.copy.ariaLabel` "Copy learning block
  expression", `.mobile.undo`, `.mobile.loadError`, and a 3-reason feedback form
  (`.feedback.reason.incorrect` "A. The visualization is incorrect", `.helpful`, `.hide` "C. I prefer not to
  see this visualization"); `chatgpt.math_blocks.graphable_function_v2.expand_graph.label`.

### 0.2 Other learning surfaces

- **Server-driven study widgets (observed chunk names, no localized strings; copy is server-supplied,
  inferred):** `learning-quiz` (literals: "Done with the quiz", answer/check/correct/incorrect/lightbulb/
  results/restart/retry/share/celebration), `learning-flashcards` (front/back, known/missed/unreviewed,
  shuffle, undo, edit, restore), `conversational-onboarding-study` (quiz + slider + chart),
  language cards `learning-vocab-card`, `learning-fill-blank-card`, `learning-sentence-builder-card`,
  `learning-image-choice-card`, `learning-image-label-card`, `learning-audio-label-card`,
  `learning-speak-card` ("Live transcript", "I'd like to skip this speaking practice. Let's continue.",
  "Skipped"), `learning-voice-mode-launcher-card`. Progress persists server-side:
  `chatgptConversations.quiz.saveFailed` "Quiz progress couldn’t be saved",
  `chatgptConversations.flashcards.saveFailed` (chunk `chatgpt-dil-directive-renderer-impl-*`).
- **Pronunciation:** `codex.chatgpt.contentReferences.pronunciation.card.{play,playbackSpeed,addToFlashcards}`,
  `.inline.open` "Hear how to pronounce {content}" (`pronunciation-*.js`).
- **Audio summary formats:** `GizmoInformation.audioSummary.{podcast, executiveBriefing, studyGuide}`
  ("Study guide" = "Tutor-led explanation").
- **Teen experience ("pepper"):** `chatgpt.pepper.onboarding.learn.title` "Learn it your way",
  `.learn.description` "…guide you with questions and steps along the way", `.wellbeing.description`
  "…may remind you to take a break", `.personalization.accent_color.title`, `.personalization.voice.title`.
- **Parental controls ("amphora") + time management:** family invite/link/unlink, safety notifications,
  self-harm parent notice (`amphora.selfHarm.modal.intro.withName`, `.pausedNotice.v2` "…we’ve temporarily
  paused their ChatGPT account"), quiet hours (`chatgpt.parental_controls.quiet_hours.error.too_many_blocks`
  "at most 12 blocks", `.insufficient_break` "at least five minutes available each day",
  `chatGpt.quietHours.active.title` "Time for a break"), **study hours**
  (`chatgpt.parental_controls.study_hours.error.missing_blocks`), "Managed by your parent".
- **Verification:** `ageVerification.*`, `guardianVerification.*` (Persona), `settings.chatGpt.age.{teen,
  teenRange "17 or under", unsureExplanation}`, `trustedContact.*` (adult names an 18+ contact who may be
  notified about suicide risk).
- **Educator onboarding:** `k12.onboarding.role.{teacher, administrator_district_leader, it_staff}`,
  `.teacherDetails.grade.{preschool,k5,middle,high}`, `.teacherDetails.subject.*`,
  `.toolStep.{planLesson, classroomResources (rubric/checklist), communication (family message)}`;
  `educationOnboarding.apps.*`.
- **Student/teen starter catalogs:** `electron.onboarding.teenPrompts.*` (12 project ideas incl.
  `studyWebApp`, `scienceFairLab`, `dodgingGame`; subtitle "Choose an idea, or start with one of your own"),
  `electron.onboarding.welcomeV2.roleCopy.student.studyPlan`.
- **Character / presence:** `orbit.*` = "dots", a persistent personal agent (eligibility, desktop connection,
  messaging, meetings, schedules, safety pause `orbit.safety.pausedTitle.productName`). Rendered by a WASM
  character runtime `orbit-character-a46c99f7e8749621/runtime/` (`orbit-web-0.12.0`, 6.5 MB wasm + 3.5 MB
  data). Enums (`orbit-enums.d.mts`): `Category {Shape, Color, Eyes, Eyewear, Accessory}`;
  `ActivityKind {Working, Searching, Creating, Payment, Thinking, NeedsInput, Ready, Paused, Error}`;
  `ActivityOutcome {ArtifactReady, PaymentPaid, InputReceived, ThinkingResolved}`;
  `ReactionKind {Wave, Signature}`. Thumbnail index: 11 shapes, 9 eyes, 6 eyewear, 9 accessories, light/dark.
  `avatarOverlay.*` / `petOverlay.*` / `pets.*`: an always-available desktop "Mini" mascot with activity
  stack, quick chat, voice, and in-overlay approvals (`avatarOverlay.waitingRequest.allowOnce`);
  installable pets (`pets.install.title` "Install {petName}?").
- **Not learning, swept in by namespace:** `bazaar.*` (ads), `report.seller.*` (seller reports),
  `tortilla.*` (template gallery), `teams.*` (Team Spaces + icon picker), `lighthouseHome.*`
  (Mission Control feed), `defenseFactory.*` (Codex Security), `cme.*` / `health*` /
  `healthcareVerificationPage.*` (clinicians), `rosalind.*` (GPT-Rosalind bio-lab access application),
  `students.codexOffer.*` (US/Canada student credit promo).

### 0.3 Studio rules that decide the verdicts

- PRODUCT-INTENT principles (numbered as used below): **1** Useful work first, **2** Human judgment stays
  visible, **3** Learning is embedded (behavior in real work over separate tests), **4** Minimum necessary
  intervention, **5** Evidence over claims, **6** Adapt, do not script, **7** Capability models are
  hypotheses, not UI labels.
- `CLAUDE.md`: capability names/scores are not learner-facing during work (SX-01/06/07/59).
- `docs/requirements/studio-learning-experience.md`: SX-05 (learning info in coach rail/drawer, never
  mixed into the work canvas), SX-07 (unrequested intervention only if it helps the current task),
  SX-08 (intervention ladder), SX-10 (no direct answers except safety/legal), SX-29 (no badges, streaks,
  ranking, celebration animation, character selection in the learning-experience profile), SX-35/39
  (banned labels and instructor-side rankings), SX-49/50 (fixed tokens; status never by color only),
  SX-57 (no traps for observation).
- `docs/design/chalk-plan-to-lesson.md` §2: `SessionDesign.steps[]` = id/title/instructions/hint/acceptance
  plus optional `help · ui · evidence · gate`; acceptance has no scores/grades (OUT-05).
- `docs/requirements/chalk-authoring.md`: VER-01 (draft vs immutable confirmed version), CH-04 (step
  instructions/hints/acceptance), CH-07 (clone lesson to next cohort), RUN-01 (rehearse as student).
- Search for interactive visualization coverage in Studio: `grep -E '시각화|visuali[sz]'` over
  `docs/requirements`, `docs/design`, `docs/studio-requirements.md`, `PRODUCT-INTENT.md`, `chalk/README.md`
  → 0 files; `quiz|퀴즈|flashcard|플래시` → 0 files; `quiet hours|사용 시간|time limit|study hours` → 0;
  `pronunciation|발음` → 0; `1388|109|상담전화|helpline` in `extensions/hypeproof-chat/src` → 0 relevant.
  A bounded search is not proof of absence.

## 1. Feature inventory

| ID | Feature | What it does (observed/inferred) | Evidence (msg ids, chunks) | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-LEARN-01 | Interactive learning block (inline explorable) | Observed: a block renders inside an assistant answer; "Explore" opens it in a dialog; controls change a live diagram and caption. Inferred: model picks block type + parameters from conversation. | `chatgpt.contentReferences.learningBlock.open.ariaLabel`, `.dialog.title`; `learning-block.client-21c5e8347938.js`; 1,735 `visualization-*.js` | No coverage found (searched: 시각화/visuali[sz]/interactive/simulation in docs/requirements, docs/design, studio-requirements.md). Closest home: `hps-lesson` details in coach rail (SX-05) and `SessionDesign.steps[].ui/help` (chalk-plan-to-lesson §2). | ADAPT — instructor attaches a block to a lesson step; it opens in the coach rail/drawer as material, never in the work canvas and never chosen autonomously by the coach for minors in v1. | Both |
| CGP-LEARN-02 | Versioned parametric block type contract | Observed: `{type, version, thumbnailAssetKey, parameters{kind,defaultValue,min,max}}` + named example presets. | `type-103197d7f37d.js` (`IPV4_SUBNETTING_CIDR`), `examples-10c1d1cbcaed.js`; kinds number 325 / integer 75 / enum 76 / boolean 6 | Chalk VER-01 (immutable confirmed version), REQ-B8 (module pin) exist for lessons; nothing for embedded interactive components. | ADAPT — the block reference stored in a confirmed lesson pins type + version + parameter values; validator rejects out-of-range values. | Chalk + Service |
| CGP-LEARN-03 | Stage-stepper mechanic | Observed: stage selector with numbered titles and one-sentence captions; procedural how-to uses the same pattern. | `learningBlock.waterCycle.control.stageLabel`, `learningBlock.adultCprAedSequence.{check,call,compress,attach}.title`; `stage` 1,100× | SessionDesign steps exist for *lesson* flow, not for in-material steps. | ADAPT — first block mechanic to support (fits elementary "do one step" pacing). | Studio |
| CGP-LEARN-04 | Parameter / mode controls with live caption | Observed: sliders, enum selectors, overflow chooser; caption re-states the current result. | `learningBlock.inputSelector.*`, `learning-block.autocorrelation.pattern-control`, `learningBlock.standardScoreZ.*` | No coverage found. | ADAPT | Studio |
| CGP-LEARN-05 | Time loop and algorithm stepper (play/pause/step/shuffle) | Observed: play/pause animation and step-wise algorithm runs. | `learningBlock.timeLoop.*` (`learning-block-time-loop-*.js`), `learningBlock.sortControls.*` (`sort-step-slider-*.js`) | No coverage found. | ADAPT — step is default, autoplay never starts on its own. | Studio |
| CGP-LEARN-06 | Batch sampling / accumulate trials | Observed: "Fire another batch" accumulates outcomes against a model choice. | `chatgpt.learning_blocks.rutherford_gold_foil.{fire.button.label, caption.outcome.nuclear}`; `interactive-sampling-*.js` | Studio's own experiment/test loop (SX-15 retest, CR verdicts) is about the learner's product, not about models. | ADAPT — maps to Verify: learner states an expectation, runs a batch, compares. Expectation is the learner's text, not a graded answer. | Studio |
| CGP-LEARN-07 | 2-D function graphing with viewport + feature tooltips | Observed: window xmin/xmax/ymin/ymax, reset viewport, expand axis, intercept/extremum/asymptote tooltips. | `learningBlock.graph.*` (`jsxgraph-2d-renderer-*.js`, `interactive-sampling-*.js`); `chatgpt.math_blocks.graphable_function_v2.*` | No coverage found. | DEFER — no current Studio course needs function graphing; revisit when a math curriculum is bound. | Studio |
| CGP-LEARN-08 | 3-D multivariable scene | Observed: keyboard-rotatable scene, point movement in depth. | `learningBlock.multivariable.*` (`multivariable-scene-*.js`) | None. | REJECT for the learner app now — university-level content, outside current audiences (elementary, adult workshop, AI for Good). | — |
| CGP-LEARN-09 | Narrated diagram (Lottie, 3 semantic beats) | Observed: 784 diagrams, 3 markers (initial → causal change → final), separable text layers with `labelAnchors.maxWidth` and `colorRole`, reserved control area, curriculum `family`. | `endocytosis-vesicle-uptake-v1-1dfeb42334d5.json`, `enzyme-competitive-inhibition-binding-v1-*.json`; `responsive-lottie-visualization-*.js` | No coverage found. | ADAPT — adopt the *format rules* (3 beats, text layers, maxWidth, colorRole) for any diagram Chalk attaches; author our own content. | Both |
| CGP-LEARN-10 | Text-equivalent state description for every block | Observed: aria description interpolates current stage/value; controls help string per block; spoken math. | leaf counts aria 503 / ariaLabel 412 / controlsDescription 387; `learningBlock.waterCycle.visualization.ariaLabel`; `learningBlock.accessibleMath.over` | Studio a11y rules exist for chat/Chalk (DES-06/11 in classroom-design; TUX-A11Y-01) but not for visual materials. | ADOPT — mandatory for any block Studio ships. | Studio |
| CGP-LEARN-11 | Responsive caption variants + container layout | Observed: `sentence` vs `mobileSentence`; 28rem container query switches stacked ↔ side-by-side. | `learningBlock.waterCycle.caption.*.mobileSentence`; `learning-block-d82411db838b.css` | Studio coach rail is narrow (VS Code side panel); no material layout rule. | ADOPT | Studio |
| CGP-LEARN-12 | Block reset / undo | Observed: reset to initial state; undo on mobile. | `chatgpt.contentReferences.learningBlock.reset.ariaLabel`, `.mobile.undo` | None for materials (WEB-05 covers project restore). | ADOPT | Studio |
| CGP-LEARN-13 | "This is incorrect / helpful / hide it" feedback on a block | Observed: 3-reason form + free text, submit success/error. | `chatgpt.contentReferences.learningBlock.feedback.reason.{incorrect,helpful,hide}`, `.feedback.submit` | Problem report exists: REQ-H* (`/v1/report`, `reportProblem.ts`), not tied to lesson material. | ADAPT — "자료가 틀린 것 같아요" goes to the lesson owner (instructor) with block type+version; "숨기기" is a per-learner collapse, recorded as a neutral event, never a score. | Both |
| CGP-LEARN-14 | Copy block expression | Observed: copy the math/notation expression of a block. | `chatgpt.contentReferences.learningBlock.copy.ariaLabel` | None. | DEFER — low value for current courses. | Studio |
| CGP-LEARN-15 | Block catalog with thumbnails and curriculum families | Observed: ~1,630 topic keys, 261 webp thumbnails, `thumbnailAssetKey`, Lottie `meta.family`. | `image-icon-*@3x-*.webp`; `type-*.js`; Lottie `meta.family` | Chalk authoring has no material picker (CH-04 edits text hints only). | ADAPT — Chalk picker filtered by `audience_tier` and subject family; Studio-owned catalog, not OpenAI content. | Chalk |
| CGP-LEARN-16 | Graded quiz widget with results and celebration | Observed literals: check, correct/incorrect, lightbulb, results, restart, share, celebration; progress saved server-side. | `learning-quiz-ab5882cf8875.js` (`quiz.dil.tsx`); `chatgptConversations.quiz.saveFailed` | Conflicts with SX-29 (no celebration/badges), principle 3 (behavior in real work over separate tests), SX-35 banned labels. | REJECT — a score/celebration loop is exactly what SX-29 forbids. If prerequisite checks are ever wanted, they belong to Chalk rehearsal, not the learner app. | — |
| CGP-LEARN-17 | Flashcards (known/missed/unreviewed, shuffle, edit) | Observed literals and save errors. | `learning-flashcards-b0c91c6d5f49.js`; `chatgptConversations.flashcards.saveFailed`; `codex.chatgpt.contentReferences.pronunciation.card.addToFlashcards` | None. | DEFER — memorization review is not Studio's thesis; revisit only if a curriculum needs vocabulary retention. | — |
| CGP-LEARN-18 | Language-learning practice cards (vocab, fill-blank, sentence builder, image choice/label, audio label, speak with live transcript, voice launcher) | Observed chunk names and literals; copy server-supplied (inferred). | `learning-*-card-*.js`, `learning-speak-card-26df3c0ac0ee.js` | None; voice exists separately (`docs/requirements/voice-conversation.md` VO-01–14). | DEFER — out of current curricula. Note one pattern worth keeping: the speak card's explicit "skip this practice" sends a skip turn and marks "Skipped" (matches principle 4). | — |
| CGP-LEARN-19 | Pronunciation widget (play, speed, inline "hear how to pronounce") | Observed. | `codex.chatgpt.contentReferences.pronunciation.*` (`pronunciation-a51b4cac31cf.js`) | None. | DEFER | — |
| CGP-LEARN-20 | Audio summary "Study guide" format | Observed: podcast / executive briefing / study guide formats with content instructions. | `GizmoInformation.audioSummary.{studyGuide, studyGuideDescription, podcast}` | None. | DEFER — a tutor-led recap competes with SX-25 (reflection only at boundaries, in the learner's own words). | — |
| CGP-LEARN-21 | Teen "Learn it your way" guided help | Observed: onboarding promise to guide "with questions and steps" (example prompt `3(2x-5)=4x+8`). | `chatgpt.pepper.onboarding.learn.{title,description,prompt}` | ALREADY — intervention ladder SX-08 (question → structure → hint → example), no direct answers SX-10. | ALREADY | Studio |
| CGP-LEARN-22 | Teen personalization (accent color, voice) | Observed. | `chatgpt.pepper.personalization.accent_color.title`, `.voice.title` | Fixed design tokens SX-49; coach naming REQ-A6/F1 for kids. | REJECT — theme color choice conflicts with SX-49 token roles; voice choice covered by VO rows if ever needed. | — |
| CGP-LEARN-23 | Teen wellbeing "take a break" reminders | Observed. | `chatgpt.pepper.onboarding.wellbeing.description` | Classroom session window gates use (REQ-M9); no break reminder. | DEFER — class time is instructor-run; personal 14+ preview could use it later. | Studio |
| CGP-LEARN-24 | Parental link (family invite, link/unlink, graduation at 18) | Observed. | `amphora.familyInvite.*`, `amphora.relationship.unlinkConfirm`, `amphora.settings.u18GraduationUnlinkNotice.*` | Classroom path: enrollment → roster → token (docs/age-verification.md, REQ-O6); guardian report delivery batch (classroom-admin.md §recipients). | DEFER — consumer family accounts are not Studio's model; guardian contact comes from the operator roster (PIPA flow is Jay-gated). | Service |
| CGP-LEARN-25 | Minor safety notice on self-harm (to guardian) + account pause | Observed: guardian notice with "how we responded", resources, temporary pause. | `amphora.selfHarm.modal.{intro.withName, pausedNotice.v2, bulletListen, immediateRisk.v2}`, `amphora.settings.safetyNotifications` | Partial: REQ-O2 blocks self-harm-instruction input for minor cohorts with a kid-friendly message; no learner resource line and no adult escalation found (searched 1388/109/helpline/상담전화). | ADAPT — in class the responsible adult is the instructor: learner sees Korean help lines; instructor gets an immediate safety signal (category + time, no transcript). Guardian notification stays an operator process. | Both |
| CGP-LEARN-26 | Trusted contact (adult-designated) | Observed. | `trustedContact.publicLink.accept.accordion.whatToExpectOne.v2`, `trustedContact.notification.alert.modal.howYouCanHelpHeading` | None. | DEFER — adult personal accounts only; revisit with the personal 14+ preview. | Service |
| CGP-LEARN-27 | Quiet hours / study hours schedules (≤12 blocks, ≥5 min free per day, "managed by your parent") | Observed with validation rules. | `chatgpt.parental_controls.quiet_hours.error.*`, `.study_hours.error.*`, `chatGpt.quietHours.active.{title,nextAllowed}` | ALREADY for classes: session window in the gate (REQ-M9) + instructor pause/resume (ADM-10). No personal-account schedule. | ALREADY (class) / DEFER (personal) | Service |
| CGP-LEARN-28 | Age & guardian verification (Persona) | Observed: verify age, verify with guardian, pending/refresh states. | `ageVerification.*` (`verify-age-page-*.js`), `guardianVerification.*`, `settings.chatGpt.age.*` | ALREADY — known population via enrollment (docs/age-verification.md, REQ-O1/O6); personal preview is 14+ public signup. | ALREADY | Service |
| CGP-LEARN-29 | Educator onboarding: role, grade band, subject, starter tasks (lesson plan, rubric, family message) | Observed. | `k12.onboarding.role.*`, `.teacherDetails.grade.{preschool,k5,middle,high}`, `.toolStep.{planLesson,classroomResources,communication}` | Partial: CH-01 stores audience/time/goal; plan-to-lesson converts a plan; no first-run question for grade band/subject. | ADAPT — Chalk first run asks grade band + subject once and pre-fills CH-01/`audience_tier`; "rubric" becomes an observable completion checklist (no points, OUT-05). | Chalk |
| CGP-LEARN-30 | Teen/student project-idea catalog at first run | Observed: 12 idea cards; "Choose an idea, or start with one of your own". | `electron.onboarding.teenPrompts.*`, `.welcomeV2.roleCopy.student.studyPlan` | Studio trial has 3 start examples (studio-native-trial-ux.md); PRODUCT-INTENT says the first experience does not start from a catalog. | REJECT — catalog-first conflicts with the first-experience intent; keep the existing 3 examples. | — |
| CGP-LEARN-31 | Customizable companion character (shape/color/eyes/eyewear/accessory) | Observed: WASM character runtime, picker thumbnails, light/dark. | `orbit-character-a46c99f7e8749621/runtime/orbit-enums.d.mts`, `orbit-thumbnails/index.json` | SX-29 forbids character selection in the learning-experience profile; kids cohorts name the coach (REQ-F1/F9). | REJECT — character selection is an explicit SX-29 negative. | — |
| CGP-LEARN-32 | Activity-state vocabulary (Working, Searching, Creating, Thinking, NeedsInput, Ready, Paused, Error) | Observed enum; overlay shows "Running" / "Needs input". | `ActivityKind` in `orbit-enums.d.mts`; `avatarOverlay.statusRunning`, `.statusWaiting` "Needs input" | Partial: unified timeline REQ-C17, `toolActivity.ts`, approval modals (REQ-E1). No single named state set. | ADAPT — one small text+icon run state in the chat header, no character. | Studio |
| CGP-LEARN-33 | Desktop mascot overlay ("Mini"/pets) with notification stack, quick chat, out-of-context approvals | Observed. | `avatarOverlay.*`, `petOverlay.*`, `pets.install.*`, `avatar-overlay-native-page-*.js` | None; conflicts with SX-29 and with approvals shown in context (REQ-E1). | REJECT — always-on-top mascot + approving actions outside the work context harms judgment visibility for children. | — |
| CGP-LEARN-34 | Persistent personal agent ("dots") with eligibility, desktop access, messaging, schedules, safety pause | Observed. | `orbit.eligibility.*`, `orbit.desktopConnection.*`, `orbit.messaging.*`, `orbit.safety.pausedTitle.productName` | Out of LEARN scope; Studio coach is session/lesson-bound. | DEFER — belongs to the agent domain, not learning. | — |
| CGP-LEARN-35 | Team Spaces with shared agent instructions + icon picker | Observed. | `teams.spaces.instructions.set`, `teams.icons.education_classroom_globe` | ALREADY in classroom form: cohort profile / `coach_brief` gives the class shared instructions (chalk-plan-to-lesson §3); team brain REQ-STUDIO-TEAM-BRAIN-CALL; team contribution SX-24. | ALREADY | Both |
| CGP-LEARN-36 | Template gallery (create/use/edit, by creator) | Observed. | `tortilla.gallery.*`, `tortilla.details.actions.use` | Partial: CH-07 clone lesson to next cohort; WEB-09 supported web-app templates. | ALREADY (CH-07) — a public cross-instructor gallery is DEFER (IP/ownership intent in PRODUCT-INTENT). | Chalk |
| CGP-LEARN-37 | Mission Control feed with keyboard triage (next/previous, dismiss and advance, quick send) | Observed. | `lighthouseHome.keyboard.{next,dismiss,open}`, `lighthouseHome.quickSend.description` | Chalk board lists help requests (ADM-02/05, CLS-01); keyboard operation required (classroom-design DES-06) but no triage shortcuts. | ADAPT — keyboard triage of the help-request queue for one instructor. | Chalk |
| CGP-LEARN-38 | Clinician CME credit auto-detected from conversations | Observed. | `cme.automaticAnnouncement.description` "Clinicians now detects eligible conversations for you", `cme.profile.*` | Conflicts with SX-43 (chat activity is not ability evidence) and HC-07. | REJECT | — |
| CGP-LEARN-39 | Health / clinician verification workspace | Observed. | `healthcareVerificationPage.*`, `health.*`, `HealthV3*` | Not in scope. | REJECT | — |
| CGP-LEARN-40 | GPT-Rosalind lab access application (biosafety, .edu members) | Observed. | `rosalind.labApplication.title`, `rosalind.researchDetails.*`, `rosalind.review.certifyAccuracy` | Not in scope. | REJECT | — |
| CGP-LEARN-41 | Student verification promo credits | Observed. | `students.codexOffer.success.description` "$100 in credits…" | Consumer billing promo; Studio passes are REQ-L12. | REJECT | — |
| CGP-LEARN-42 | Ads ("bazaar") and seller reporting | Observed. | `bazaar.ad.shortLabel`, `bazaar.ad.tooltip.why`, `report.seller.category.*` | — | REJECT — ads and shopping have no place in a minors' learning product. | — |
| CGP-LEARN-43 | Codex Security ("defenseFactory") editors/environment | Observed. | `defenseFactory.editors.title`, `defenseFactory.environment.createTitle` | — | REJECT (not learning; covered by other domains if at all). | — |

Verdict counts (rows 01–43): ADOPT 3 · ADAPT 13 · ALREADY 5 · DEFER 10 · REJECT 12. Row lists are in the
summary tally at the end. Rows 27 and 36 count as ALREADY; their DEFER halves are noted in the row.

## 2. Requirements (ADOPT / ADAPT rows)

Learner-facing copy proposals are Korean (product copy). Priority reflects Studio's current state, not
ChatGPT's.

| REQ ID | Requirement (testable, one behavior) | Acceptance criteria | Priority | Traces to |
|---|---|---|---|---|
| REQ-CGP-LEARN-01 | An interactive block appears for a learner only when the confirmed lesson version attaches it to the current `SessionDesign` step (`steps[].materials[]`); the coach cannot insert one on its own in v1. | (a) A lesson without `materials[]` renders no block in any coach reply. (b) A prompt asking the coach "그림으로 보여줘" in a lesson without materials yields text only. (c) Attached block renders in the coach rail/drawer for that step only; switching steps hides it. | P0 | 4, 6 (SX-05, SX-07) |
| REQ-CGP-LEARN-02 | A block never sits in the work canvas and never shows capability names, scores, grades or "correct/incorrect" judgments. | (a) DOM of the canvas region contains no element with `data-hps-material`. (b) Bundle scan for SX-35 banned strings and capability labels (FRAMING…OWNERSHIP, 7-asset names) inside block assets = 0 hits. (c) No block emits an observation event whose `evidence_type` is computed from block interaction alone. | P0 | 7 (SX-01/59, SX-43) |
| REQ-CGP-LEARN-03 | Every block exposes a live text equivalent: a title, a controls help sentence, and a state description that updates on each change. | (a) Each block type in the catalog validator has non-empty `title`, `controlsHelp`, `stateDescription` (ko). (b) Changing any control updates an `aria-live="polite"` region within 500 ms with the new state sentence. (c) Screen-reader run (VoiceOver) can complete the block's steps without seeing the canvas. | P0 | 3 (DES-11 classroom-design) |
| REQ-CGP-LEARN-04 | Block references in a confirmed lesson pin `type`, `version` and parameter values; the validator rejects unknown types, unknown versions and out-of-range values. | (a) Confirm (VER-01) fails with a field-level error for `prefix_length: 31` when `max: 30`. (b) A running class keeps rendering v1 after v2 is published. (c) Rehearsal pass (VER-02) is invalidated when a block's type/version/params change. | P1 | 6 (VER-01/02, REQ-B8) |
| REQ-CGP-LEARN-05 | Stage-stepper blocks advance only on learner action and show one step's title + one sentence at a time. | (a) No auto-advance timer exists. (b) Step N of M is shown as text ("2 / 4 단계"). (c) Back/forward work by button and by ←/→ when focused. | P1 | 4 |
| REQ-CGP-LEARN-06 | Parameter and mode controls are bounded by the type schema and re-state the result in the caption after every change. | (a) Slider/stepper cannot exceed `min/max`. (b) Enum selector shows all options or an overflow list labelled "{값}. {라벨} 전체 보기". (c) Caption text changes with value (snapshot test per preset). | P1 | 3 |
| REQ-CGP-LEARN-07 | Animated blocks start paused; play is an explicit action and step-by-step is always available. | (a) Initial state = paused with a visible Play control. (b) `prefers-reduced-motion: reduce` hides autoplay and keeps Step. (c) Pausing preserves the current frame. | P1 | 4 |
| REQ-CGP-LEARN-08 | In a sampling block, the learner writes an expectation before the first batch; the result is shown beside the learner's own sentence, without a verdict. | (a) "실행" is disabled until the expectation field has 1–200 chars (copy: "먼저 어떤 결과가 나올지 한 줄로 적어 보세요"). (b) After the batch, the screen shows learner text above the outcome counts (SX-53 order). (c) No "맞았어요/틀렸어요" string appears; the expectation is saved as `criterion_set` (actor=student) only if the step's design lists it. | P2 | 2, 5 (SX-14, SX-53, SX-57) |
| REQ-CGP-LEARN-09 | Narrated diagrams attached by Chalk follow the 3-beat format with separable, localizable text layers. | (a) Validator requires exactly 3 markers (start / change / result). (b) All labels are text layers with `maxWidth`; Korean label overflow beyond `maxWidth` fails validation. (c) Colors are role names (`text`, `accent`…), resolved by theme. | P1 | 3 |
| REQ-CGP-LEARN-10 | A learner can reset a block to its preset and undo the last change. | (a) "처음으로" restores preset values exactly. (b) Undo reverts one change; disabled when history is empty. (c) Reset/undo do not emit observation events. | P1 | 4 |
| REQ-CGP-LEARN-11 | A learner can report "자료가 틀린 것 같아요" on a block; the report reaches the lesson owner with block identity, and the learner can collapse a block they do not want. | (a) Report payload = lesson id, step id, block type, version, params, optional learner text; no transcript. (b) Report appears in Chalk for the lesson's instructor within the existing report flow (REQ-H*). (c) "접기" collapses the block for that learner; state persists for the session; it is not an evidence event. | P1 | 2, 5 |
| REQ-CGP-LEARN-12 | Chalk offers a block picker filtered by the lesson's `audience_tier` and subject family, showing a thumbnail, title and one-line purpose. | (a) Picker for a grade 3–4 lesson hides blocks tagged above that tier. (b) Each card has a thumbnail with alt text. (c) Inserting a block adds it to the chosen step's `materials[]` in the draft only. | P2 | 6 (CH-04) |
| REQ-CGP-LEARN-13 | When minor-cohort input is blocked for self-harm, the learner sees Korean help lines and the class instructor gets an immediate safety signal without conversation text. | (a) Block response copy includes 자살예방상담전화 109 and 청소년상담 1388 and "선생님께 바로 이야기해도 괜찮아요". (b) Chalk shows a pinned safety item for that seat within 10 s: category, time, seat; no matched text (REQ-O5 hygiene). (c) Adult cohorts unaffected (REQ-O4). (d) Guardian notification is not automated; the item links to the operator protocol. | P0 | 2 (REQ-O2, SX-10 safety exception) |
| REQ-CGP-LEARN-14 | Chalk first run asks the instructor once for grade band and subject and pre-fills the lesson audience. | (a) Options: 유아 / 초 1–2 / 초 3–4 / 초 5–6 / 중 / 고 / 성인; subject list editable. (b) Values pre-fill CH-01 and `audience_tier`, editable per lesson. (c) Skippable; skip leaves fields empty, not defaulted. | P2 | 6 |
| REQ-CGP-LEARN-15 | Chalk's "completion checklist" helper produces observable acceptance items, never points or grade levels. | (a) Generated items are "무엇을 만들면 끝인가" sentences. (b) Output containing 점/등급/우수/미흡 is rejected (OUT-05, SX-35). | P2 | 5, 7 |
| REQ-CGP-LEARN-16 | The Studio header shows one coach run state from a fixed set: 준비됨 / 생각 중 / 찾는 중 / 만드는 중 / 확인이 필요해요 / 멈춤 / 문제가 생겼어요. | (a) Exactly one state visible at a time, derived from the existing timeline (REQ-C17) and approval state (REQ-E1). (b) "확인이 필요해요" appears whenever an approval is pending. (c) No character or animation is required to convey state. | P2 | 2 |
| REQ-CGP-LEARN-17 | Chalk help-request queue supports keyboard triage: next, previous, open, resolve-and-advance. | (a) J/K (or ↓/↑) moves selection; Enter opens; a documented key resolves and advances. (b) "?" shows the shortcut list. (c) Shortcuts never fire inside text inputs (Korean IME composition safe). | P2 | 1 (one-instructor intent, ADM-05, DES-06) |

REQ-CGP-LEARN-15 status (2026-10-26, CGP-LEARN-R-015): implemented in Chalk `/authoring` as the completion-condition helper. Requirement: `docs/requirements/chalk-authoring.md` "완료 조건 도우미". Test: T-49. Owner choices are in `decisions.md`: bare 점 is allowed, the check runs on the page and in the Chalk forwarder, and there is no Service text check.

## 3. Design requirements (same rows)

| DES ID | Visual/interaction requirement | Acceptance (measurable) |
|---|---|---|
| DES-CGP-LEARN-01 | Block lives in the coach rail as a collapsible "자료" card under the current step; opening expands in place (no modal, SX-52). | Collapsed card height ≤ 72 px with thumbnail 48×48, title, "열어 보기". Expanded content never overlaps the canvas. Rail width 280–480 px supported. Light/dark via tokens (Panel background, Ink light text; SX-49). |
| DES-CGP-LEARN-02 | No judgment visuals inside blocks. | No green-check/red-x result glyphs, no confetti/celebration, no score numerals tied to the learner. Color-removed render still conveys every state with text (SX-50). |
| DES-CGP-LEARN-03 | Live text equivalent is visible, not only for screen readers. | Caption line under the diagram, ≥ 14 px, contrast ≥ 4.5:1; `aria-live="polite"`; update ≤ 500 ms after input; 200 % zoom keeps caption readable without horizontal scroll. |
| DES-CGP-LEARN-04 | Version/params are visible to instructors only. | Chalk step editor shows "type · v2 · preset" chip; learner UI never shows type ids or versions. |
| DES-CGP-LEARN-05 | Stage stepper. | Text "2 / 4 단계" + step title (16 px semibold) + one sentence (≤ 60 Korean chars, mobile variant ≤ 30). Prev/Next buttons ≥ 44×44 px; ←/→ when focused; focus ring 3:1. |
| DES-CGP-LEARN-06 | Controls. | Sliders show current value as text; keyboard step = 1 unit, PageUp/PageDown = 10 %; enum ≤ 4 options as segmented control, > 4 as list with overflow "{값}. {라벨} 전체 보기". Korean IME: no shortcut fires while `isComposing`. |
| DES-CGP-LEARN-07 | Motion. | Starts paused; Play/Pause/Step buttons 44×44 px with labels "재생" / "멈춤" / "한 단계"; `prefers-reduced-motion` → no autoplay, transitions ≤ 0 ms; no flashing > 3 Hz. |
| DES-CGP-LEARN-08 | Expectation-first sampling. | Expectation input (1–200 chars) above the Run button; result area lists learner sentence first in larger type (SX-53), counts second in secondary style; no verdict colors. |
| DES-CGP-LEARN-09 | Diagram format. | 640×400 artboard scaled to container; 3 markers; label boxes respect `maxWidth` with Korean at 14 px min; colors are role tokens that resolve in light and dark; a 120×120 control area is reserved. |
| DES-CGP-LEARN-10 | Reset/undo. | Text buttons "처음으로", "되돌리기" (not Primary; SX-04 one Primary per screen); disabled state visibly distinct and announced. |
| DES-CGP-LEARN-11 | Report/collapse. | Overflow menu on the card: "자료가 틀린 것 같아요", "접기". Report opens inline (not modal) with an optional 0–300 char field; success toast "선생님께 전달했어요". |
| DES-CGP-LEARN-12 | Chalk picker. | Grid of cards (thumbnail with alt, title, one-line purpose, tier tag as text). 375 px: one column, no horizontal scroll (classroom-design DES-03). Keyboard navigable. |
| DES-CGP-LEARN-13 | Safety block + instructor signal. | Learner: inline calm message, no red alarm styling, two tap-to-call numbers rendered as text (109, 1388), no sound. Chalk: safety item pinned above the list with Amber + icon + text label "안전 확인 필요" (SX-50), never in a ranking or score column. |
| DES-CGP-LEARN-14 | Instructor first-run. | Single screen, two questions, chips ≥ 44 px, "나중에" text button; works at 375 px and 1280 px. |
| DES-CGP-LEARN-15 | Checklist output. | Rendered as plain checklist rows (no points column, no level headers). |
| DES-CGP-LEARN-16 | Run state. | One 20 px icon + text label in the chat header, ≥ 14 px; state change announced via `aria-live`; no animated character; color only as reinforcement. |
| DES-CGP-LEARN-17 | Keyboard triage. | Selected row has a 2 px focus outline at 3:1; shortcut sheet opens inline; all actions also reachable by mouse/touch at 44×44 px. |

Layout rule applied to all blocks (DES from CGP-LEARN-11): container ≥ 448 px (28 rem) → diagram 50 % beside
text; < 448 px (VS Code side rail is usually below this) → stacked, diagram full width then caption; at 320 px
width nothing scrolls horizontally and captions use the short variant.

REQ/DES-CGP-LEARN-14 as built (2026-10-26, DEC-LEARN-14): Chalk `/authoring` asks once per browser
(`localStorage`, no Service store), pre-fills only lessons made with 새 강의 만들기, maps 초 1–6 → lv1, 중/고 → lv2,
성인 → adult and 유아 → no tier, and adds a per-lesson 대상 단계 select. Owning requirement: chalk-authoring CH-01.
DES-CGP-LEARN-14 closed (2026-10-27, CGP-LEARN-D-014, DEC-LEARN-14d): the R-014 panel already met one screen, two questions,
44px chips and 375/1280 px; 나중에 was an outlined ghost button, so it now draws no border (a text button beside the filled
저장). T-48 measures each clause in headless Chromium.

DES-CGP-LEARN-15 status (2026-10-27, CGP-LEARN-D-015): already met on main by the CGP-LEARN-R-015 build. Chalk `/authoring`
draws the checklist as one list row per item (sentence + record kind + row actions), with no points column and no level
headers. Proved by a computed headless test (T-50, `chalk/test/checklist-output.browser.mjs`). Decision: `decisions.md`
CGP-LEARN-D-015.

## 4. Open questions / unknowns

1. **Who generates blocks?** ChatGPT appears to let the model choose type + params at answer time
   (inferred). REQ-CGP-LEARN-01 deliberately restricts Studio v1 to instructor-attached blocks. Is
   coach-selected material ever acceptable for adult cohorts (useful-work-first) while staying off for
   minors?
2. **Content source and licence.** OpenAI's catalog (~1,630 topics, 784 diagrams) cannot be reused. Who
   authors Studio's first blocks, and which curricula need them first (kids grade 3–4/5–6 game/web lessons,
   AI for Good v5)? No Studio course today obviously needs science visualizations.
3. **Evidence contract.** Should the expectation in a sampling block (REQ-CGP-LEARN-08) ever become a
   `criterion_set` event, or stay outside measurement-core entirely? Needs MC/SX owner decision so it does
   not become a disguised quiz (SX-57).
4. **Schema home.** `materials[]` on `SessionDesign.steps[]` is new; chalk-plan-to-lesson §2 only lists
   `help · ui · evidence · gate`. Does `ui` already carry this, or is a schema bump (`hps-session-design`)
   needed?
5. **Rendering runtime in the webview.** Lottie/JSX-graph libraries add bundle weight and CSP surface
   (REQ-L2 iframe sandbox, `cspBuilder.ts`). Sandboxed iframe per block vs in-webview component is
   undecided.
6. **Safety escalation (REQ-CGP-LEARN-13).** Legal/PIPA review is Jay-gated (age-verification.md). Who is
   the responsible adult outside class hours for the personal 14+ preview? ChatGPT pauses the account;
   Studio should probably not pause a learner mid-class without the instructor. Needs a decision.
7. **Gating unknowns on the ChatGPT side.** Strings show quizzes, flashcards, study hours and teen
   onboarding ship in the bundle; whether they are enabled for Korean accounts, the desktop app, or
   only web/mobile is not visible.
8. **Quiz rejection scope.** If an instructor explicitly wants a pre-class readiness check, does it belong
   in Chalk rehearsal (RUN-01) as an instructor tool, keeping the learner app quiz-free?

## Summary tally

- ADOPT 3: 10, 11, 12.
- ADAPT 13: 01, 02, 03, 04, 05, 06, 09, 13, 15, 25, 29, 32, 37.
- ALREADY 5: 21, 27 (class), 28, 35, 36.
- DEFER 10: 07, 14, 17, 18, 19, 20, 23, 24, 26, 34.
- REJECT 12: 08, 16, 22, 30, 31, 33, 38, 39, 40, 41, 42, 43.
- 43 inventory rows, 17 requirements, 17 design requirements.

## Implementation notes

- **REQ-CGP-LEARN-17 (CGP-LEARN-R-017), 2026-10-26.** Implemented in Chalk `/manage` as REQ-CHALK-HELP-TRIAGE (`docs/requirements/classroom-admin.md#help-queue-keyboard-triage`), with DES-CGP-LEARN-17. Agent choices under the owner rules (recorded in `decisions.md`): "resolve" for the instructor is 답변 완료 · 학생 확인 대기, because only the learner marks a request resolved (ADM-05); the documented key is `E`; selection is keyboard focus on the row's own button; keys listen only in the help region and the open record.
- **CGP-LEARN-R-016 (REQ-CGP-LEARN-16), 2026-10-26.** Implemented in Studio as REQ-STUDIO-COACH-RUN-STATE (`docs/studio-requirements.md`), with DES-CGP-LEARN-16. Owner-delegated choices (precedence, icon-based activity classifier with unknown → 생각 중, which dialogs count as approval, the personal heading's run note leaving the row, every seat) are recorded in `../decisions.md`.
- **CGP-LEARN-D-016 (DES-CGP-LEARN-16), 2026-10-27.** Already met on main by the R-016 work (20px icon + words at 14px in the chat header, polite live region, no animation, colour only reinforcing). The one unguarded clause was "state change announced": nothing failed if the region was remounted per state. `test/coach-run-state-browser.smoke.mjs` now proves in headless Chromium that the live region is the same mounted node across all seven states and its words change in place. Recorded in `../decisions.md`.
