import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlaceholderThread, parseNow } from "../src/core/parse/now.js";

const assassinrpg = readFileSync(new URL("./fixtures/now/assassinrpg.NOW.md", import.meta.url), "utf8");
const template = readFileSync(new URL("./fixtures/now/template.NOW.md", import.meta.url), "utf8");
const malformed = readFileSync(new URL("./fixtures/now/malformed.NOW.md", import.meta.url), "utf8");

describe("parseNow on the real assassinrpg exhibit", () => {
  const p = parseNow(assassinrpg)!;

  it("parses ok and sees the marker", () => {
    expect(p.parse.status).toBe("ok");
    expect(p.hasMarker).toBe(true);
  });

  it("measures the active-thread SECTION, not the file (the 251-conflation guard)", () => {
    // nowfile.js semantics: heading included, ### does not close, trailing
    // blanks stripped. The file is 250 lines; the section is 170.
    expect(p.cursor.activeThreadLineCount).toBe(170);
  });

  it("takes the thread name from the first bold span", () => {
    expect(p.cursor.activeThread).toContain("the Loom");
  });

  it("reads the machine-clean last-touched date", () => {
    expect(p.cursor.lastTouched).toBe("2026-07-08");
  });

  it("returns null nextAction when the section has no unchecked step (itself a signal)", () => {
    expect(p.cursor.nextAction).toBeNull();
  });

  it("counts queue items including numbered ones, ignoring placeholders", () => {
    expect(p.cursor.queueCount).toBe(2);
  });

  it("reads the file's own quick-fix cap from prose", () => {
    expect(p.cursor.quickFixCap).toBe(5);
    expect(p.cursor.quickFixCount).toBe(0);
  });

  it("counts loose ends", () => {
    expect(p.cursor.looseEndsCount).toBe(2);
  });

  it("names the grown sections (bloat evidence)", () => {
    expect(p.cursor.grownSections.length).toBe(13);
    expect(p.cursor.grownSections.some((s) => s.startsWith("Parked: story"))).toBe(true);
    expect(p.cursor.grownSections.some((s) => s.startsWith("Carried over"))).toBe(true);
  });
});

describe("parseNow on the template", () => {
  const p = parseNow(template)!;

  it("sees the placeholder thread", () => {
    expect(isPlaceholderThread(p.cursor.activeThread)).toBe(true);
  });

  it("finds the template's next action", () => {
    expect(p.cursor.nextAction).toContain("one tiny step");
  });

  it("has no grown sections", () => {
    expect(p.cursor.grownSections).toEqual([]);
  });

  it("has no self-declared quick-fix cap number mismatch", () => {
    expect(p.cursor.quickFixCap).toBe(3);
  });
});

describe("parseNow on a mangled file", () => {
  const p = parseNow(malformed)!;

  it("returns raw-fallback with the raw text, never throws", () => {
    expect(p.parse.status).toBe("raw-fallback");
    if (p.parse.status === "raw-fallback") {
      expect(p.parse.reason).toContain("Active thread");
      expect(p.parse.raw).toContain("hand-mangled");
    }
  });

  it("still surfaces what it could read", () => {
    expect(p.cursor.lastTouched).toBe("2026-07-01");
    expect(p.hasMarker).toBe(true);
  });
});

describe("parseNow input edges", () => {
  it("null in, null out", () => {
    expect(parseNow(null)).toBeNull();
  });
  it("empty file is a raw-fallback, not a crash", () => {
    const p = parseNow("")!;
    expect(p.parse.status).toBe("raw-fallback");
  });
});
