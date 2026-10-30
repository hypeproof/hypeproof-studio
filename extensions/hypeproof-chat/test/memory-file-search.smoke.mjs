// #3288: searching uses only the host-disclosed file list, never I/O or a model.
import assert from "node:assert/strict";
import { filterMemoryEntries } from "../src/activityMemoryView.ts";
const entries = Object.freeze([
  Object.freeze({ name: "수업.md", at: 3, text: "발표에 BLUE 표지를 썼다." }),
  Object.freeze({ name: "읽기.md", at: 2, text: null }),
  Object.freeze({ name: "기록.md", at: 1, text: "다른 내용" }),
]);
assert.equal(filterMemoryEntries(entries, "  "), entries);
assert.deepEqual(filterMemoryEntries(entries, " blue "), [entries[0]]);
assert.deepEqual(filterMemoryEntries(entries, "수업".normalize("NFD")), [entries[0]]);
assert.deepEqual(filterMemoryEntries(entries, "읽기"), [entries[1]]);
assert.deepEqual(filterMemoryEntries(entries, "null"), []);
assert.deepEqual(filterMemoryEntries(entries, ".*"), []); // Literal search, not a regular expression.
assert.deepEqual(filterMemoryEntries(entries, ".md"), entries); // Stable newest-first order.
assert.deepEqual(filterMemoryEntries(entries, "없는 내용"), []);
console.log("PASS memory file search: visible names/text, NFC, case, empty, null, literal and stable order");
