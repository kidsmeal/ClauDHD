import { describe, expect, it } from "vitest";
import { chooseSource } from "../src/core/precedence.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-07-12T12:00:00Z");

describe("chooseSource", () => {
  it("no usable state.json means the NOW.md parse", () => {
    expect(
      chooseSource({ stateUsable: false, stateGeneratedAt: null, stateMtimeMs: null, nowMtimeMs: T0, maxLagDays: 1 })
    ).toBe("now.md");
  });

  it("fresh state.json wins", () => {
    expect(
      chooseSource({
        stateUsable: true,
        stateGeneratedAt: new Date(T0).toISOString(),
        stateMtimeMs: T0,
        nowMtimeMs: T0 - DAY / 2,
        maxLagDays: 1,
      })
    ).toBe("state.json");
  });

  it("state.json older than NOW.md by more than the lag window loses", () => {
    expect(
      chooseSource({
        stateUsable: true,
        stateGeneratedAt: new Date(T0 - 3 * DAY).toISOString(),
        stateMtimeMs: T0 - 3 * DAY,
        nowMtimeMs: T0,
        maxLagDays: 1,
      })
    ).toBe("now.md");
  });

  it("falls back to the file mtime when generatedAt is missing", () => {
    expect(
      chooseSource({ stateUsable: true, stateGeneratedAt: null, stateMtimeMs: T0, nowMtimeMs: T0, maxLagDays: 1 })
    ).toBe("state.json");
  });

  it("state.json with no NOW.md mtime stands alone", () => {
    expect(
      chooseSource({ stateUsable: true, stateGeneratedAt: new Date(T0).toISOString(), stateMtimeMs: T0, nowMtimeMs: null, maxLagDays: 1 })
    ).toBe("state.json");
  });
});
