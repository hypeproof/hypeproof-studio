package ai.hypeproof.studio;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Handler;
import android.os.Build;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewTreeObserver;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.Espresso;
import androidx.test.espresso.FailureHandler;
import androidx.test.espresso.IdlingRegistry;
import androidx.test.espresso.IdlingResource;
import androidx.test.espresso.InjectEventSecurityException;
import androidx.test.espresso.UiController;
import androidx.test.espresso.ViewAction;
import androidx.test.espresso.ViewInteraction;
import androidx.test.espresso.action.GeneralLocation;
import androidx.test.espresso.action.MotionEvents;
import androidx.test.espresso.base.DefaultFailureHandler;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import org.hamcrest.Matcher;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.rules.TestRule;
import org.junit.rules.TestWatcher;
import org.junit.runner.Description;
import org.junit.runners.model.Statement;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayingAtLeast;

/**
 * One way to tap a QuestionActivity control and prove the tap had its effect.
 *
 * Espresso's click() loops the main thread between DOWN and UP. A slow emulator
 * frame in that gap can pass the long-press timeout, so an icon button shows its
 * tooltip and never clicks. A tap can also land while a background refresh holds
 * model.busy, and the control ignores it. Both look like a later, unrelated failure.
 *
 * tap() waits for the activity to be idle (no busy model, no refresh poll about to
 * start), injects DOWN and UP as one sequence, and then requires the expected state.
 * On failure it writes the touch trace, busy state, logcat and input dispatcher state.
 */
final class UiSync {
    private UiSync() {}

    /** A tap must finish before the next 4 s refresh poll can start a refresh. */
    static final long POLL_GUARD_MS = 1000;
    /** The click's own effect is synchronous; this bounds one posted performClick. */
    static final long EXPECTATION_MS = 2000;
    private static final String TAG = "StudioUiSync";
    private static int fullCaptures;

    /** Runs on the main thread inside DOWN dispatch or for each delivered event. */
    interface Hook {
        default void touched(View view, MotionEvent event) {}
        /** Called after the target processed DOWN and before UP is dispatched. */
        default void afterDown(View view) {}
        default boolean interceptsDown() { return false; }
    }

    /** Taps when QuestionActivity is idle, then requires the expected state. */
    static void tap(ViewInteraction target, String label, Predicate<QuestionActivity> expected) {
        tap(target, label, true, null, expected);
    }

    /** Taps a control that is meant to work while a request is in flight. */
    static void tapWhileBusy(ViewInteraction target, String label, Predicate<QuestionActivity> expected) {
        tap(target, label, false, null, expected);
    }

    static void tap(ViewInteraction target, String label, boolean awaitIdle, Hook hook, Predicate<QuestionActivity> expected) {
        JSONArray trace = new JSONArray();
        AppIdle idle = awaitIdle ? new AppIdle(trace) : null;
        try {
            if (idle != null) IdlingRegistry.getInstance().register(idle);
            try {
                target.perform(new ShortTap(label, trace, hook, expected, idle));
            } finally {
                if (idle != null) IdlingRegistry.getInstance().unregister(idle);
            }
        } catch (RuntimeException | AssertionError failure) {
            capture("tap-" + label, trace, failure);
            throw failure;
        }
    }

    /**
     * Taps the menu icon once when idle and requires menu() to have shown its dialog.
     * The icon carries a tooltip, so a stretched tap would show the tooltip instead.
     */
    static void openMenu() {
        java.util.function.Consumer<JSONObject> previous = QuestionActivity.testMenuObservation;
        java.util.concurrent.atomic.AtomicInteger shown = new java.util.concurrent.atomic.AtomicInteger();
        QuestionActivity.testMenuObservation = value -> {
            if (previous != null) previous.accept(value);
            if ("shown".equals(value.optString("phase"))) shown.incrementAndGet();
        };
        try {
            tap(androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withContentDescription("메뉴")), "menu", activity -> shown.get() > 0);
        } finally {
            QuestionActivity.testMenuObservation = previous;
        }
    }

    /** Waits for QuestionActivity to be idle with the same rule tap() uses. */
    static void awaitIdle(ViewInteraction anyView) {
        JSONArray trace = new JSONArray();
        AppIdle idle = new AppIdle(trace);
        IdlingRegistry.getInstance().register(idle);
        try {
            anyView.check((view, missing) -> { if (missing != null) throw missing; });
        } finally {
            IdlingRegistry.getInstance().unregister(idle);
        }
    }

    static QuestionActivity resumedQuestionActivity() {
        for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))
            if (activity instanceof QuestionActivity) return (QuestionActivity) activity;
        return null;
    }

    private static QuestionActivity activityOf(View view) {
        Context context = view.getContext();
        while (context instanceof ContextWrapper) {
            if (context instanceof QuestionActivity) return (QuestionActivity) context;
            context = ((ContextWrapper) context).getBaseContext();
        }
        return resumedQuestionActivity();
    }

    static Object field(Object owner, String name) {
        try {
            var field = owner.getClass().getDeclaredField(name);
            field.setAccessible(true);
            return field.get(owner);
        } catch (ReflectiveOperationException problem) {
            throw new AssertionError(problem);
        }
    }

    /** Null when idle; otherwise the first reason the activity is not idle. */
    static String busyReason(QuestionActivity activity) {
        if (activity == null) return null;
        ReflectionModel model = (ReflectionModel) field(activity, "model");
        if (model != null && model.busy) return "model.busy";
        NativeTeamModel team = (NativeTeamModel) field(activity, "team");
        if (team != null && team.busy) return "team.busy";
        NativeProductExperience experience = (NativeProductExperience) field(activity, "experience");
        if (experience != null && experience.busy) return "experience.busy";
        long due = activity.pollDueAt;
        if (due > 0) {
            long left = due - SystemClock.uptimeMillis();
            if (left < POLL_GUARD_MS) return "refresh poll due in " + left + " ms";
        }
        return null;
    }

    private static JSONObject state(String phase, View view, MotionEvent event) {
        JSONObject row = new JSONObject();
        try {
            row.put("phase", phase).put("uptime_ms", SystemClock.uptimeMillis())
                .put("long_press_timeout_ms", ViewConfiguration.getLongPressTimeout())
                .put("tap_timeout_ms", ViewConfiguration.getTapTimeout());
            if (view != null) {
                row.put("attached", view.isAttachedToWindow()).put("enabled", view.isEnabled())
                    .put("pressed", view.isPressed()).put("shown", view.isShown())
                    .put("window_focus", view.hasWindowFocus()).put("focused", view.hasFocus());
                // Where the view and its window are now, and whether a layout is still pending.
                // A tap point from a new layout with an old input window frame misses the view.
                int[] onScreen = new int[2];
                view.getLocationOnScreen(onScreen);
                View root = view.getRootView();
                int[] rootOnScreen = new int[2];
                root.getLocationOnScreen(rootOnScreen);
                row.put("view_on_screen", new JSONArray().put(onScreen[0]).put(onScreen[1]))
                    .put("view_size", new JSONArray().put(view.getWidth()).put(view.getHeight()))
                    .put("root_on_screen", new JSONArray().put(rootOnScreen[0]).put(rootOnScreen[1]))
                    .put("root_size", new JSONArray().put(root.getWidth()).put(root.getHeight()))
                    .put("view_layout_requested", view.isLayoutRequested())
                    .put("root_layout_requested", root.isLayoutRequested());
            }
            QuestionActivity activity = view == null ? resumedQuestionActivity() : activityOf(view);
            if (activity != null) {
                ReflectionModel model = (ReflectionModel) field(activity, "model");
                NativeTeamModel team = (NativeTeamModel) field(activity, "team");
                NativeProductExperience experience = (NativeProductExperience) field(activity, "experience");
                row.put("activity_window_focus", activity.hasWindowFocus())
                    .put("model_busy", model != null && model.busy)
                    .put("team_busy", team != null && team.busy)
                    .put("experience_busy", experience != null && experience.busy)
                    .put("poll_due_in_ms", activity.pollDueAt == 0 ? JSONObject.NULL : activity.pollDueAt - SystemClock.uptimeMillis());
            } else {
                row.put("activity", JSONObject.NULL);
            }
            if (event != null) {
                row.put("action", event.getActionMasked()).put("event_time_ms", event.getEventTime())
                    .put("down_time_ms", event.getDownTime()).put("event_duration_ms", event.getEventTime() - event.getDownTime());
            }
        } catch (JSONException | RuntimeException | AssertionError problem) {
            try { row.put("observation_error", problem.getClass().getName()); } catch (JSONException ignored) { /* Keep the trace row. */ }
        }
        return row;
    }

    private static synchronized void record(JSONArray trace, JSONObject row) {
        if (trace.length() < 256) trace.put(row);
    }

    /** Idle when no model is busy and the next refresh poll is not about to start. */
    static final class AppIdle implements IdlingResource {
        private final Handler main = new Handler(Looper.getMainLooper());
        private final JSONArray trace;
        private volatile ResourceCallback callback;
        private boolean recheckPosted;
        private String lastReason;
        // Only the wait before the tap counts. Espresso also waits for idle after an
        // action; a tap that starts a held request must not wait for that request.
        private volatile boolean armed = true;
        void disarm() { armed = false; }
        private final Runnable recheck = () -> {
            recheckPosted = false;
            if (isIdleNow()) {
                ResourceCallback current = callback;
                if (current != null) current.onTransitionToIdle();
            }
        };
        AppIdle(JSONArray trace) { this.trace = trace; }
        @Override public String getName() { return "QuestionActivity busy and refresh poll"; }
        @Override public void registerIdleTransitionCallback(ResourceCallback callback) { this.callback = callback; }
        @Override public boolean isIdleNow() {
            if (!armed) return true;
            String reason = busyReason(resumedQuestionActivity());
            if (reason == null) {
                if (lastReason != null) {
                    try { record(trace, state("idle_after_" + lastReason, null, null)); } catch (RuntimeException ignored) { /* Trace only. */ }
                    lastReason = null;
                }
                return true;
            }
            if (!reason.startsWith("refresh poll") && !reason.equals(lastReason)) record(trace, state("waiting_" + reason, null, null));
            lastReason = reason;
            // Re-check on the main thread; Espresso does not poll a busy resource.
            if (!recheckPosted) { recheckPosted = true; main.postDelayed(recheck, 16); }
            return false;
        }
    }

    private static final class ShortTap implements ViewAction {
        private final String label;
        private final JSONArray trace;
        private final Hook hook;
        private final Predicate<QuestionActivity> expected;
        private final AppIdle idle;
        ShortTap(String label, JSONArray trace, Hook hook, Predicate<QuestionActivity> expected, AppIdle idle) {
            this.label = label; this.trace = trace; this.hook = hook; this.expected = expected; this.idle = idle;
        }
        @Override public Matcher<View> getConstraints() { return isDisplayingAtLeast(90); }
        @Override public String getDescription() { return "one short DOWN/UP tap that must have its effect: " + label; }
        @Override public void perform(UiController ui, View view) {
            if (idle != null) idle.disarm();
            record(trace, state("before_tap", view, null));
            if (!view.isEnabled()) throw new AssertionError(label + ": target is disabled when idle");
            if (!view.hasWindowFocus()) throw new AssertionError(label + ": target window has no focus");
            awaitCommittedLayout(ui, view);
            view.setOnTouchListener((touched, event) -> {
                record(trace, state("delivered", touched, event));
                if (hook != null) hook.touched(touched, event);
                if (hook != null && hook.interceptsDown() && event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    // Let the control process DOWN itself, then run the hook before UP.
                    boolean handled = touched.onTouchEvent(event);
                    hook.afterDown(touched);
                    record(trace, state("after_down_hook", touched, null));
                    return handled;
                }
                return false;
            });
            // Both events are queued before Espresso waits, so a slow frame cannot
            // separate DOWN and UP by more than the frame itself.
            float[] xy = GeneralLocation.VISIBLE_CENTER.calculateCoordinates(view);
            JSONObject inject = state("inject", view, null);
            try { inject.put("tap_xy", new JSONArray().put((double) xy[0]).put((double) xy[1])); } catch (JSONException ignored) { /* Trace only. */ }
            record(trace, inject);
            MotionEvent down = MotionEvents.obtainDownEvent(xy, new float[]{1, 1}, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.BUTTON_PRIMARY);
            MotionEvent up = MotionEvents.obtainUpEvent(down, down.getDownTime() + ViewConfiguration.getTapTimeout() / 2, xy);
            try {
                if (!ui.injectMotionEventSequence(List.of(down, up))) throw new AssertionError(label + ": DOWN/UP injection was refused");
            } catch (InjectEventSecurityException problem) {
                throw new AssertionError(label + ": DOWN/UP injection was refused", problem);
            } finally {
                down.recycle(); up.recycle(); view.setOnTouchListener(null);
            }
            long deadline = SystemClock.uptimeMillis() + EXPECTATION_MS;
            for (;;) {
                QuestionActivity activity = activityOf(view);
                if (activity != null && expected.test(activity)) { record(trace, state("expected_state", view, null)); return; }
                if (SystemClock.uptimeMillis() >= deadline) {
                    record(trace, state("expectation_missing", view, null));
                    throw new AssertionError(label + ": the tap did not produce its expected state");
                }
                ui.loopMainThreadForAtLeast(16);
            }
        }

        /**
         * Requires the target's window to have no pending layout and then one committed
         * frame with no new layout after it, so the tap point and the window frame that
         * input uses come from the same layout. A dialog that just grew is re-centred by
         * its next layout; a tap computed before that frame reaches the old window frame.
         *
         * This is a precondition, not a delay: it returns as soon as a frame commits on a
         * settled layout. The bound is the existing EXPECTATION_MS, reached only when no
         * such frame commits.
         */
        private void awaitCommittedLayout(UiController ui, View view) {
            View root = view.getRootView();
            long deadline = SystemClock.uptimeMillis() + EXPECTATION_MS;
            for (;;) {
                while (root.isLayoutRequested()) {
                    if (SystemClock.uptimeMillis() >= deadline) {
                        record(trace, state("layout_pending", view, null));
                        throw new AssertionError(label + ": the target window still had a pending layout");
                    }
                    ui.loopMainThreadForAtLeast(16);
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    // registerFrameCommitCallback is API 29+. CI runs API 35; older devices tap after layout only.
                    record(trace, state("frame_commit_unavailable", view, null));
                    return;
                }
                AtomicBoolean committed = new AtomicBoolean();
                root.getViewTreeObserver().registerFrameCommitCallback(() -> committed.set(true));
                // Without a dirty view no frame is drawn, and the callback would not run.
                root.invalidate();
                while (!committed.get()) {
                    if (SystemClock.uptimeMillis() >= deadline) {
                        record(trace, state("frame_not_committed", view, null));
                        throw new AssertionError(label + ": no frame committed before the tap");
                    }
                    ui.loopMainThreadForAtLeast(16);
                }
                if (!root.isLayoutRequested()) {
                    record(trace, state("frame_committed", view, null));
                    return;
                }
                // The frame requested another layout, which can move the window again.
                record(trace, state("layout_requested_after_frame", view, null));
            }
        }
    }

    /** Writes the trace, then logcat and input state for the first few failures. */
    static synchronized void capture(String name, JSONArray trace, Throwable failure) {
        try {
            Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            File dir = new File(context.getExternalFilesDir(null), "evidence/failures");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create failure evidence directory");
            String base = name.replaceAll("[^A-Za-z0-9._-]", "_") + "-" + SystemClock.elapsedRealtime();
            String message = String.valueOf(failure);
            JSONObject summary = new JSONObject().put("name", name).put("uptime_ms", SystemClock.uptimeMillis())
                .put("failure", message.substring(0, Math.min(message.length(), 4096)));
            if (trace != null) summary.put("trace", trace);
            Files.write(new File(dir, base + ".json").toPath(), summary.toString(2).getBytes(StandardCharsets.UTF_8));
            // Six full captures keep the artifact bounded; a later failure still keeps its JSON.
            if (fullCaptures >= 6) return;
            fullCaptures++;
            shell("timeout 5 logcat -d -v threadtime -b main -b system -b crash -t 3000", new File(dir, base + "-logcat.txt"));
            shell("timeout 3 dumpsys input", new File(dir, base + "-input.txt"));
            shell("timeout 3 dumpsys window windows", new File(dir, base + "-window.txt"));
        } catch (Exception | AssertionError problem) {
            Log.e(TAG, "Failure evidence capture failed", problem);
        }
    }

    static void shell(String command, File out) throws IOException {
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(output); FileOutputStream file = new FileOutputStream(out)) {
            byte[] buffer = new byte[8192];
            int count, total = 0, limit = 1024 * 1024;
            while (total < limit && (count = input.read(buffer, 0, Math.min(buffer.length, limit - total))) != -1) { file.write(buffer, 0, count); total += count; }
        }
    }

    /**
     * The device did not give the app's window input focus. This is a device or
     * window-manager state, not a product result, and every later Espresso lookup
     * fails the same way, so it carries its own message.
     */
    static final class DeviceFocusLost extends AssertionError {
        DeviceFocusLost(String message, Throwable cause) { super(message, cause); }
    }

    /**
     * Moves the scenario to RESUMED and requires its window to gain input focus.
     * moveToState returns when the activity is resumed; window focus arrives later
     * from the window manager. Bound: the existing EXPECTATION_MS. The wait is a
     * focus-change listener, so it returns as soon as focus arrives.
     */
    static <A extends Activity> void resumeWithFocus(ActivityScenario<A> scenario, String where) {
        scenario.moveToState(Lifecycle.State.RESUMED);
        awaitWindowFocus(scenario, where);
    }

    static <A extends Activity> void awaitWindowFocus(ActivityScenario<A> scenario, String where) {
        CountDownLatch focused = new CountDownLatch(1);
        AtomicReference<View> decor = new AtomicReference<>();
        ViewTreeObserver.OnWindowFocusChangeListener listener = hasFocus -> { if (hasFocus) focused.countDown(); };
        scenario.onActivity(activity -> {
            View root = activity.getWindow().getDecorView();
            decor.set(root);
            if (root.hasWindowFocus()) focused.countDown();
            else root.getViewTreeObserver().addOnWindowFocusChangeListener(listener);
        });
        boolean arrived;
        try {
            arrived = focused.await(EXPECTATION_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException problem) {
            Thread.currentThread().interrupt();
            throw new AssertionError(where + ": interrupted while waiting for window focus", problem);
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                View root = decor.get();
                if (root != null && root.getViewTreeObserver().isAlive()) root.getViewTreeObserver().removeOnWindowFocusChangeListener(listener);
            });
        }
        if (!arrived) throw deviceFocusLost(where + ": the window did not gain input focus after RESUMED", null);
    }

    /**
     * Reports a lost device focus as DeviceFocusLost, with the window manager's focus
     * line in the message and dumpsys window and activity output in evidence/failures.
     *
     * At test start it requires that no activity left over from an earlier test is
     * shown without window focus. A launcher focus before launch is normal, so the
     * start check cannot see a device that loses focus only on the next launch; the
     * classification of RootViewWithoutFocusException covers that case. No retry.
     */
    static TestRule deviceFocusRule() {
        return (base, description) -> new Statement() {
            @Override public void evaluate() throws Throwable {
                focusAtFailure = null;
                // A class that sets its own handler in @Before wraps it with focusAware().
                Espresso.setFailureHandler(focusAware(new DefaultFailureHandler(InstrumentationRegistry.getInstrumentation().getTargetContext())));
                String leftover = leftoverWithoutFocus();
                if (leftover != null) throw deviceFocusLost(description.getMethodName() + ": at test start " + leftover, null);
                try {
                    base.evaluate();
                } catch (DeviceFocusLost lost) {
                    throw lost;
                } catch (Throwable failure) {
                    if (!lostRootFocus(failure)) throw failure;
                    // @After has closed the scenario by now, so the launcher holds focus.
                    // Report the snapshot that the failure handler took before teardown.
                    String snapshot = focusAtFailure;
                    throw new DeviceFocusLost("device focus lost (device state, not a product result): " + description.getMethodName()
                        + ": Espresso found no root with window focus ["
                        + (snapshot != null ? "at failure, before teardown: " + snapshot : "no snapshot before teardown") + "]", failure);
                } finally {
                    focusAtFailure = null;
                }
            }
        };
    }

    /** Focus state taken at the failing Espresso lookup, before @After closes the scenario. */
    private static volatile String focusAtFailure;

    /**
     * Wraps an Espresso failure handler. When a lookup fails because no root has window
     * focus, it records window manager and input dispatcher focus first, then delegates.
     */
    static FailureHandler focusAware(FailureHandler delegate) {
        return (error, matcher) -> {
            if (lostRootFocus(error) && focusAtFailure == null) focusAtFailure = focusSnapshot("root-without-focus");
            delegate.handle(error, matcher);
        };
    }

    private static String leftoverWithoutFocus() {
        AtomicReference<String> found = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            for (Stage stage : new Stage[]{Stage.RESUMED, Stage.PAUSED})
                for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))
                    // Only app activities; ActivityScenario's own EmptyActivity is not shown to the user.
                    if (found.get() == null && activity.getClass().getName().startsWith("ai.hypeproof.studio.") && !activity.hasWindowFocus())
                        found.set(activity.getClass().getSimpleName() + " is " + stage + " without window focus");
        });
        return found.get();
    }

    private static boolean lostRootFocus(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause())
            if (cause.getClass().getName().endsWith("RootViewWithoutFocusException")) return true;
        return false;
    }

    /** For failures raised inside the test (resume or start checks), before teardown. */
    private static DeviceFocusLost deviceFocusLost(String message, Throwable cause) {
        return new DeviceFocusLost("device focus lost (device state, not a product result): " + message + " [" + focusSnapshot("device-focus-lost") + "]", cause);
    }

    /**
     * Writes dumpsys window, input and activity to evidence/failures and returns window
     * manager focus next to input dispatcher focus, the focus request result and the
     * app window's input flags and alpha. The two focus owners can differ: a window can
     * be focused in the window manager while input treats it as NOT_VISIBLE.
     */
    static String focusSnapshot(String label) {
        try {
            Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            File dir = new File(context.getExternalFilesDir(null), "evidence/failures");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create failure evidence directory");
            String base = label + "-" + SystemClock.elapsedRealtime();
            File window = new File(dir, base + "-window.txt");
            File input = new File(dir, base + "-input.txt");
            shell("timeout 3 dumpsys window", window);
            shell("timeout 3 dumpsys input", input);
            shell("timeout 3 dumpsys activity activities", new File(dir, base + "-activity.txt"));
            return describeFocus(Files.readAllLines(window.toPath(), StandardCharsets.UTF_8),
                Files.readAllLines(input.toPath(), StandardCharsets.UTF_8), context.getPackageName());
        } catch (Exception | AssertionError problem) {
            Log.e(TAG, "Device focus evidence capture failed", problem);
            return "focus unknown: " + problem.getClass().getSimpleName();
        }
    }

    /** Pure parser for focusSnapshot; package-private for a unit check of its output. */
    static String describeFocus(List<String> window, List<String> input, String appPackage) {
        StringBuilder wm = new StringBuilder();
        for (String line : window)
            if (line.contains("mCurrentFocus=") || line.contains("mFocusedApp=")) wm.append(wm.length() == 0 ? "" : "; ").append(line.trim());
        String focused = section(input, "FocusedWindows:");
        String requests = section(input, "FocusRequests:");
        StringBuilder app = new StringBuilder();
        for (String line : input) {
            String text = line.trim();
            // Input window rows look like "7: name=40701a1 <package>/<activity>, id=184, ..., inputConfig=..., alpha=0, ...".
            if (text.matches("\\d+: name=\\S+ " + java.util.regex.Pattern.quote(appPackage) + "/.*") && text.contains("inputConfig=")) {
                int end = text.indexOf(", frame=");
                app.append(app.length() == 0 ? "" : "; ").append(end > 0 ? text.substring(0, end) : text);
            }
        }
        return "WM " + (wm.length() == 0 ? "focus line missing" : wm)
            + " | InputDispatcher FocusedWindows: " + focused
            + " | FocusRequests: " + requests
            + " | app input windows: " + (app.length() == 0 ? "none" : app);
    }

    /** The text after a "Key:" line plus its more-indented continuation lines. */
    private static String section(List<String> lines, String key) {
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            int at = line.indexOf(key);
            if (at < 0 || !line.substring(0, at).trim().isEmpty()) continue;
            StringBuilder value = new StringBuilder(line.substring(at + key.length()).trim());
            for (int j = i + 1; j < lines.size(); j++) {
                String next = lines.get(j);
                int indent = next.length() - next.replaceAll("^\\s+", "").length();
                if (next.trim().isEmpty() || indent <= at) break;
                value.append(value.length() == 0 ? "" : "; ").append(next.trim());
            }
            return value.length() == 0 ? "<empty>" : value.toString();
        }
        return "missing";
    }

    /** Captures logcat and input state when a test fails outside a tap. */
    static TestWatcher failureWatcher() {
        return new TestWatcher() {
            @Override protected void failed(Throwable failure, Description description) {
                capture("test-" + description.getMethodName(), null, failure);
            }
        };
    }
}
