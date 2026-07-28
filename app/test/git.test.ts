import { describe, expect, it } from "vitest";
import { parseNameOnlyLog, readGitFacts } from "../src/core/git.js";
import { cannedGit, deadGit } from "./helpers.js";

const HDR = "\u0001";

describe("parseNameOnlyLog", () => {
  it("splits commits on the header delimiter and collects paths", () => {
    const out = [
      `${HDR}abc123\t2026-07-10T20:00:00-07:00\tfeat: loom runtime`,
      "src/systems/lore.js",
      "data/lore.json",
      "",
      `${HDR}def456\t2026-07-09T10:00:00-07:00\tdocs: style guide`,
      "design/prose_style_guide.md",
    ].join("\n");
    const commits = parseNameOnlyLog(out);
    expect(commits.length).toBe(2);
    expect(commits[0]?.hash).toBe("abc123");
    expect(commits[0]?.paths).toEqual(["src/systems/lore.js", "data/lore.json"]);
    expect(commits[1]?.subject).toBe("docs: style guide");
    expect(commits[1]?.paths).toEqual(["design/prose_style_guide.md"]);
  });

  it("empty and null are empty", () => {
    expect(parseNameOnlyLog(null)).toEqual([]);
    expect(parseNameOnlyLog("")).toEqual([]);
  });
});

describe("readGitFacts", () => {
  it("assembles facts from canned git output", async () => {
    const git = cannedGit({
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": " M src/a.ts\n?? new.md",
      "rev-list --count @{u}..HEAD": "4",
      "log -1": "2026-07-10T20:00:00-07:00\tfeat: loom",
      "log --since": `${HDR}abc\t2026-07-10T20:00:00-07:00\tfeat: loom\nsrc/a.ts`,
    });
    const f = (await readGitFacts(git, "/repo", 10))!;
    expect(f.branch).toBe("main");
    expect(f.uncommitted).toBe(2);
    expect(f.unpushed).toBe(4);
    expect(f.lastCommitAt).toBe("2026-07-10T20:00:00-07:00");
    expect(f.lastCommitMsg).toBe("feat: loom");
    expect(f.windowCommits.length).toBe(1);
  });

  it("no upstream reads as null unpushed, not zero", async () => {
    const git = cannedGit({
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-list --count @{u}..HEAD": null,
      "log -1": "2026-07-10T20:00:00-07:00\tx",
      "log --since": "",
    });
    const f = (await readGitFacts(git, "/repo", 10))!;
    expect(f.unpushed).toBeNull();
  });

  it("a dead git returns null facts, never throws", async () => {
    expect(await readGitFacts(deadGit, "/repo", 10)).toBeNull();
  });
});
