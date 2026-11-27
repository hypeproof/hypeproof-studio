// The instructor's tool policy for the local runner (the Chalk contract turn uses it).
// Moved here from the removed legacy turn file chalk/instructorTurn.ts (C-5).
import type { ResolvedProfile } from "../protocol";

// Instructor tool policy — NOT a student profile.
// Grants Read + Write (workspace tools) + browser (live_preview_start / browser_open).
// Shell and subagents are off.
export const INSTRUCTOR_TOOL_PROFILE: ResolvedProfile = {
  profile_id: "chalk-instructor",
  display_name: "강사",
  language: "ko",
  series_index: 0,
  series_total: 1,
  assets_focus: [],
  welcome: { greeting_md: "", example_prompts: [] },
  publishing: { enabled: false, strategy: "none" },
  preview: { type: "iframe", auto_start: false },
  sdk_tools: { read: true, write: true, browser: true },
  ux: {
    coach: {
      naming_mode: "fixed",
      fallback_name: "코치",
      naming_prompt_md: "",
      personality_prompt_md: "",
    },
    suggestions: { initial: [], follow_up: [] },
    hints: {
      short_input: { enabled: false, min_chars: 0, message_md: "" },
      roll_input_button: { enabled: false, label: "", probe_md: "" },
    },
    retry_button: { enabled: false, show_counter: false },
  },
};
