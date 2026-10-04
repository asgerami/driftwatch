import { describe, expect, it } from "vitest";

import { applyEdits, unifiedDiff } from "./edit.js";

const text = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].join("\n") + "\n";
const at = (line: string) => text.indexOf(`${line}\n`);

describe("edits and diffs", () => {
  it("applies non-overlapping edits by original offsets", () => {
    expect(applyEdits("hello world", [{ start: 6, end: 11, text: "there" }, { start: 0, end: 5, text: "hi" }])).toBe("hi there");
    expect(() => applyEdits("abc", [{ start: 0, end: 2, text: "" }, { start: 1, end: 3, text: "" }])).toThrow();
  });

  it("writes one hunk per area, with three lines of context", () => {
    const diff = unifiedDiff("f.txt", text, [{ start: at("b"), end: at("b") + 1, text: "B" }, { start: at("l"), end: at("l") + 1, text: "L" }]);
    expect(diff).toBe(
      ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,5 +1,5 @@", " a", "-b", "+B", " c", " d", " e", "@@ -9,5 +9,5 @@", " i", " j", " k", "-l", "+L", " m", ""].join("\n"),
    );
  });

  it("shows a deleted line as only that line, and counts the shift", () => {
    const diff = unifiedDiff("f.txt", text, [{ start: at("c"), end: at("d"), text: "" }, { start: at("m"), end: at("m") + 1, text: "M" }]);
    expect(diff).toContain("@@ -1,7 +1,6 @@\n a\n b\n-c\n d\n e\n f\n g\n");
    expect(diff).toContain("@@ -10,4 +9,4 @@\n j\n k\n l\n-m\n+M\n");
  });
});
