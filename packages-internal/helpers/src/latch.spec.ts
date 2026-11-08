import { describe, expect, test } from "vitest";

import { createLatch, createResettableLatch } from "./latch.ts";

describe("createLatch", () => {
  test("starts untripped and does not throw", () => {
    const latch = createLatch("closed");

    expect(latch.tripped).toBe(false);
    expect(() => {
      latch.throwIfTripped();
    }).not.toThrow();
  });

  test("trip returns true only for the call that tripped it", () => {
    const latch = createLatch("closed");

    expect(latch.trip()).toBe(true);
    expect(latch.trip()).toBe(false);
    expect(latch.tripped).toBe(true);
  });

  test("throwIfTripped throws the message once tripped", () => {
    const latch = createLatch("NotifyAdapter is closed");
    latch.trip();

    expect(() => {
      latch.throwIfTripped();
    }).toThrow(new Error("NotifyAdapter is closed"));
  });

  test("throwIfTripped uses a per-call message when given", () => {
    const latch = createLatch("closed");
    latch.trip();

    expect(() => {
      latch.throwIfTripped("fence cannot be called after the attempt handler has ended");
    }).toThrow(new Error("fence cannot be called after the attempt handler has ended"));
  });
});

describe("createResettableLatch", () => {
  test("reset returns the latch to untripped so it can be tripped again", () => {
    const latch = createResettableLatch("the previous try is still running");

    expect(latch.trip()).toBe(true);
    expect(() => {
      latch.throwIfTripped();
    }).toThrow(new Error("the previous try is still running"));

    latch.reset();

    expect(latch.tripped).toBe(false);
    expect(() => {
      latch.throwIfTripped();
    }).not.toThrow();
    expect(latch.trip()).toBe(true);
  });
});

test("createLatch exposes no reset", () => {
  expect(createLatch()).not.toHaveProperty("reset");
});
