import { describe, expect, it } from "vitest";

import { elapsedMs, formatDuration } from "./duration.js";

describe("formatDuration", () => {
  it.each([
    [0, "0ms"],
    [850, "850ms"],
    [999, "999ms"],
    [1000, "1.0s"],
    [3249, "3.2s"],
    [9999, "9.9s"],
    [10_000, "10s"],
    [48_900, "48s"],
    [59_999, "59s"],
    [60_000, "1m"],
    [63_000, "1m 03s"],
    [360_000, "6m"],
    [3_599_999, "59m 59s"],
    [3_600_000, "1h"],
    [7_500_000, "2h 05m"],
    [86_400_000, "1d"],
    [3 * 86_400_000 + 4 * 3_600_000, "3d 4h"],
    [-5, "0ms"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("elapsedMs", () => {
  it("never goes negative", () => {
    expect(elapsedMs(new Date(5000), new Date(2000))).toBe(0);
    expect(elapsedMs(new Date(2000), 5000)).toBe(3000);
  });
});
