import { describe, expect, test } from "vitest";
import { createSignal } from "./signal.js";

describe("createSignal", () => {
  test("signalled starts as false", () => {
    const signal = createSignal();
    expect(signal.signalled).toBe(false);
  });

  test("signalled becomes true after signalOnce is called", () => {
    const signal = createSignal();
    signal.signalOnce();
    expect(signal.signalled).toBe(true);
  });

  test("onSignal resolves with the value passed to signalOnce", async () => {
    const signal = createSignal<string>();
    signal.signalOnce("test-value");
    const result = await signal.onSignal;
    expect(result).toBe("test-value");
  });

  test("multiple calls to signalOnce only use the first value", async () => {
    const signal = createSignal<number>();
    signal.signalOnce(1);
    signal.signalOnce(2);
    signal.signalOnce(3);
    const result = await signal.onSignal;
    expect(result).toBe(1);
    expect(signal.signalled).toBe(true);
  });

  test("works with void type (no value)", async () => {
    const signal = createSignal<void>();
    signal.signalOnce();
    await signal.onSignal;
    expect(signal.signalled).toBe(true);
  });

  test("onSignal can be awaited before signalOnce is called", async () => {
    const signal = createSignal<string>();
    const resultPromise = signal.onSignal;

    setTimeout(() => signal.signalOnce("delayed"), 10);

    const result = await resultPromise;
    expect(result).toBe("delayed");
  });

  test("signalled remains true after multiple checks", () => {
    const signal = createSignal();
    signal.signalOnce();
    expect(signal.signalled).toBe(true);
    expect(signal.signalled).toBe(true);
    expect(signal.signalled).toBe(true);
  });
});
