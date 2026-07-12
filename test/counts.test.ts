import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIdeas, parseRoadmap, parseShipped } from "../src/core/parse/counts.js";

const ideas = readFileSync(new URL("./fixtures/ideas.IDEAS.md", import.meta.url), "utf8");
const shipped = readFileSync(new URL("./fixtures/shipped.SHIPPED.md", import.meta.url), "utf8");
const roadmap = readFileSync(new URL("./fixtures/roadmap.ROADMAP.md", import.meta.url), "utf8");

describe("parseIdeas (state.js regex parity)", () => {
  const f = parseIdeas(ideas)!;
  it("total counts [ ], [~], and [x]", () => {
    expect(f.total).toBe(5);
  });
  it("untriaged counts only [ ]", () => {
    expect(f.untriaged).toBe(3);
  });
  it("oldest untriaged reads the date prefix; undated lines do not break it", () => {
    expect(f.oldestUntriagedDate).toBe("2026-06-15");
  });
  it("null in, null out", () => {
    expect(parseIdeas(null)).toBeNull();
  });
});

describe("parseShipped", () => {
  const f = parseShipped(shipped)!;
  it("counts entry bullets", () => {
    expect(f.total).toBe(5);
  });
  it("takes the first (newest) date header", () => {
    expect(f.lastEntryDate).toBe("2026-07-08");
  });
});

describe("parseRoadmap", () => {
  const f = parseRoadmap(roadmap)!;
  it("counts open items in Next + Later only", () => {
    expect(f.count).toBe(4);
  });
  it("top item is the first open Next entry", () => {
    expect(f.topItem).toContain("evolution stage B");
  });
});
