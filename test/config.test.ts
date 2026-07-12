import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig, parseConfigText } from "../src/core/config.js";

describe("config merge", () => {
  it("empty and missing fill entirely from defaults", () => {
    expect(parseConfigText(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfigText("")).toEqual(DEFAULT_CONFIG);
  });

  it("a partial file overrides only what it names", () => {
    const c = mergeConfig({ thresholds: { cursorBloatWarn: 60 }, roots: ["D:\\code"] });
    expect(c.thresholds.cursorBloatWarn).toBe(60);
    expect(c.thresholds.cursorBloatCrit).toBe(DEFAULT_CONFIG.thresholds.cursorBloatCrit);
    expect(c.roots).toEqual(["D:\\code"]);
    expect(c.launcher.resume).toBe(DEFAULT_CONFIG.launcher.resume);
  });

  it("unknown keys survive the merge (forward compatible)", () => {
    const c = mergeConfig({ futureKey: { a: 1 } }) as unknown as Record<string, unknown>;
    expect(c["futureKey"]).toEqual({ a: 1 });
  });

  it("wrong-typed values fall back to defaults instead of poisoning the app", () => {
    const c = mergeConfig({ thresholds: { cursorBloatWarn: "forty" }, roots: "not-an-array" });
    expect(c.thresholds.cursorBloatWarn).toBe(40);
    expect(c.roots).toEqual(DEFAULT_CONFIG.roots);
  });

  it("broken json falls back to defaults, never throws", () => {
    expect(parseConfigText("{oops")).toEqual(DEFAULT_CONFIG);
  });

  it("defaults are not shared mutable state", () => {
    const a = parseConfigText(null);
    a.thresholds.cursorBloatWarn = 999;
    expect(DEFAULT_CONFIG.thresholds.cursorBloatWarn).toBe(40);
  });
});
