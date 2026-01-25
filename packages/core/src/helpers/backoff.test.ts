import { describe, expect, test } from "vitest";
import { calculateBackoffMs } from "./backoff.js";

describe("calculateBackoffMs", () => {
  test("returns initial delay on first attempt", () => {
    const result = calculateBackoffMs(1, {
      initialDelayMs: 100,
      maxDelayMs: 10000,
    });
    expect(result).toBe(100);
  });

  test("applies exponential backoff with default multiplier", () => {
    const config = { initialDelayMs: 100, maxDelayMs: 10000 };

    expect(calculateBackoffMs(1, config)).toBe(100);
    expect(calculateBackoffMs(2, config)).toBe(200);
    expect(calculateBackoffMs(3, config)).toBe(400);
    expect(calculateBackoffMs(4, config)).toBe(800);
  });

  test("applies exponential backoff with custom multiplier", () => {
    const config = { initialDelayMs: 100, maxDelayMs: 10000, multiplier: 3 };

    expect(calculateBackoffMs(1, config)).toBe(100);
    expect(calculateBackoffMs(2, config)).toBe(300);
    expect(calculateBackoffMs(3, config)).toBe(900);
    expect(calculateBackoffMs(4, config)).toBe(2700);
  });

  test("caps delay at maxDelayMs", () => {
    const config = { initialDelayMs: 100, maxDelayMs: 500 };

    expect(calculateBackoffMs(1, config)).toBe(100);
    expect(calculateBackoffMs(2, config)).toBe(200);
    expect(calculateBackoffMs(3, config)).toBe(400);
    expect(calculateBackoffMs(4, config)).toBe(500);
    expect(calculateBackoffMs(5, config)).toBe(500);
  });

  test("handles multiplier of 1 (constant delay)", () => {
    const config = { initialDelayMs: 100, maxDelayMs: 1000, multiplier: 1 };

    expect(calculateBackoffMs(1, config)).toBe(100);
    expect(calculateBackoffMs(5, config)).toBe(100);
    expect(calculateBackoffMs(10, config)).toBe(100);
  });
});
