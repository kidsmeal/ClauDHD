import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findPlanFiles, parsePlanProgress, parseSentinel } from "../src/core/parse/plan.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { memFs } from "./helpers.js";

const statusPlan = readFileSync(new URL("./fixtures/plans/status-plan.md", import.meta.url), "utf8");
const checkboxPlan = readFileSync(new URL("./fixtures/plans/checkbox-plan.md", import.meta.url), "utf8");
const onelinePlan = readFileSync(new URL("./fixtures/plans/oneline.plan.md", import.meta.url), "utf8");

describe("parsePlanProgress with Status lines (the real gantry shape)", () => {
  const p = parsePlanProgress("design/status-plan.md", statusPlan, 1000);

  it("phase units are ## Phase headings", () => {
    expect(p.phasesTotal).toBe(4);
    expect(p.basis).toBe("status");
  });

  it("only the done vocabulary counts as done", () => {
    // committed yes; "ready to commit" no (first word 'ready'); DEFERRED no;
    // missing Status line no.
    expect(p.phasesDone).toBe(1);
    expect(p.phases.map((ph) => ph.done)).toEqual([true, false, false, false]);
  });

  it("records the basis for each phase (the evidence trail)", () => {
    expect(p.phases[0]?.basis).toBe("status: committed");
    expect(p.phases[1]?.basis).toBe("status: ready");
    expect(p.phases[3]?.basis).toBe("no status line");
  });
});

describe("parsePlanProgress fallbacks", () => {
  it("checkbox counting when a plan has no Phase headings", () => {
    const p = parsePlanProgress("old.md", checkboxPlan, 1000);
    expect(p.basis).toBe("checkbox");
    expect(p.phasesTotal).toBe(4);
    expect(p.phasesDone).toBe(2);
  });

  it("one Status line above the phases marks nothing done (godot-mcp shape)", () => {
    const p = parsePlanProgress("procgen.plan.md", onelinePlan, 1000);
    expect(p.phasesTotal).toBe(7);
    expect(p.phasesDone).toBe(0);
    expect(p.phases.every((ph) => ph.basis === "no status line")).toBe(true);
  });
});

describe("findPlanFiles", () => {
  const fs = memFs({
    "/repo/plans/feature-plan.md": "x",
    "/repo/design/loop_v2/skills_reviewed-plan.md": "x",
    "/repo/docs/design/procgen-tools.plan.md": "x",
    "/repo/docs/archive/dead-plan.md": "x",
    "/repo/node_modules/pkg/evil-plan.md": "x",
    "/repo/.gantry/tmp-plan.md": "x",
    "/repo/README.md": "x",
  });

  it("finds both name shapes recursively, skipping archive and the transient dirs", async () => {
    const found = await findPlanFiles(fs, "/repo", DEFAULT_CONFIG.planSkipSegments);
    expect(found).toEqual([
      "design/loop_v2/skills_reviewed-plan.md",
      "docs/design/procgen-tools.plan.md",
      "plans/feature-plan.md",
    ]);
  });
});

describe("parseSentinel", () => {
  it("reads plan/phase/started and ignores the extra fields gantry writes", () => {
    const s = parseSentinel(
      JSON.stringify({
        plan: "design/x-plan.md",
        phase: 3,
        started: "2026-07-01T10:00:00Z",
        files: ["a.ts"],
        allow: ["src/**"],
        session: "abc",
      }),
      5000
    )!;
    expect(s.plan).toBe("design/x-plan.md");
    expect(s.phase).toBe("3");
    expect(s.started).toBe("2026-07-01T10:00:00Z");
    expect(s.mtimeMs).toBe(5000);
  });

  it("rejects garbage and missing plan field", () => {
    expect(parseSentinel("{oops", 1)).toBeNull();
    expect(parseSentinel(JSON.stringify({ phase: 1 }), 1)).toBeNull();
    expect(parseSentinel(null, 1)).toBeNull();
  });
});
