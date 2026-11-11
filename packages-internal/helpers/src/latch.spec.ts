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

  test("holds true once tripped without a value", () => {
    const latch = createLatch("closed");

    expect(latch.value).toBeUndefined();
    latch.trip();
    expect(latch.value).toBe(true);
  });

  test("holds the value of the call that tripped it", () => {
    const latch = createLatch<{ id: string }>("closed");
    const first = { id: "first" };

    expect(latch.trip(first)).toBe(true);
    expect(latch.trip({ id: "second" })).toBe(false);
    expect(latch.value).toBe(first);
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

  test("reset clears the held value", () => {
    const latch = createResettableLatch<string>("pending");

    latch.trip("first");
    latch.reset();

    expect(latch.value).toBeUndefined();
    expect(latch.trip("second")).toBe(true);
    expect(latch.value).toBe("second");
  });
});

test("createLatch exposes no reset", () => {
  expect(createLatch()).not.toHaveProperty("reset");
});
