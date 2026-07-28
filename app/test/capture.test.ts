import { describe, expect, it } from "vitest";
import { buildIdeaLine, ideaStamp, substituteTemplate, tokenizeCommand } from "../src/core/capture.js";
import { parseIdeas } from "../src/core/parse/counts.js";

const AT = new Date(2026, 6, 12, 14, 30); // 2026-07-12 14:30 local

describe("buildIdeaLine (the idea.js contract)", () => {
  it("matches the exact shape: - [ ] YYYY-MM-DD HH:MM (while: out-of-session) text", () => {
    expect(buildIdeaLine("swap supabase storage to r2", AT)).toBe(
      "- [ ] 2026-07-12 14:30 (while: out-of-session) swap supabase storage to r2"
    );
  });

  it("zero-pads the stamp like idea.js stampNow", () => {
    expect(ideaStamp(new Date(2026, 0, 3, 9, 5))).toBe("2026-01-03 09:05");
  });

  it("flattens whitespace so the line stays one line", () => {
    expect(buildIdeaLine("a  b\n\nc\td", AT)).toContain(") a b c d");
  });

  it("the produced line feeds ClauDHD's own ideas math (regex parity)", () => {
    const ideas = `## Inbox\n\n${buildIdeaLine("x", AT)}\n`;
    const parsed = parseIdeas(ideas)!;
    expect(parsed.untriaged).toBe(1);
    expect(parsed.oldestUntriagedDate).toBe("2026-07-12");
  });
});

describe("launcher templates", () => {
  it("substitutes {path} everywhere", () => {
    expect(substituteTemplate('wt -d "{path}" powershell', "C:\\repos\\x")).toBe('wt -d "C:\\repos\\x" powershell');
  });

  it("tokenizes honoring quotes (paths with spaces stay one arg)", () => {
    const t = tokenizeCommand('wt -d "C:\\my repos\\x" powershell -NoExit -Command claude')!;
    expect(t.exe).toBe("wt");
    expect(t.args).toEqual(["-d", "C:\\my repos\\x", "powershell", "-NoExit", "-Command", "claude"]);
  });

  it("a quoted arg containing further quoting survives", () => {
    const t = tokenizeCommand('wt -d "C:\\x" powershell -NoExit -Command "claude -c"')!;
    expect(t.args).toEqual(["-d", "C:\\x", "powershell", "-NoExit", "-Command", "claude -c"]);
  });

  it("empty template reports null instead of a ghost spawn", () => {
    expect(tokenizeCommand("")).toBeNull();
    expect(tokenizeCommand("   ")).toBeNull();
  });
});
