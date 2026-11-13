import type { MaybePromise } from "@queuert/helpers/maybe-promise";
import { step } from "@queuert/helpers/steps";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createInProcessStateAdapter,
  createSyncInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import { type ConformanceStateAdapter, inMode, inTransaction } from "./adapters.ts";

describe("inMode", () => {
  it("returns a plain value over a sync adapter", () => {
    using stateAdapter = createSyncInProcessStateAdapter();
    const result = inMode(stateAdapter, function* () {
      return (yield* step(1)) + 1;
    });
    expectTypeOf(result).toEqualTypeOf<number>();
    expect(result).toBe(2);
  });

  it("returns a promise over an async adapter", async () => {
    await using stateAdapter = createInProcessStateAdapter();
    const result = inMode(stateAdapter, function* () {
      return (yield* step(Promise.resolve(1))) + 1;
    });
    expectTypeOf(result).toEqualTypeOf<Promise<number>>();
    expect(await result).toBe(2);
  });

  it("returns either over an adapter whose mode is known only at runtime", () => {
    using stateAdapter = createSyncInProcessStateAdapter();
    const conformanceAdapter: ConformanceStateAdapter = stateAdapter;
    const result = inMode(conformanceAdapter, function* () {
      return yield* step(1);
    });
    expectTypeOf(result).toEqualTypeOf<MaybePromise<number>>();
    expect(result).toBe(1);
  });

  it("fails an async body that steps over a plain value, after its finally blocks", async () => {
    await using stateAdapter = createInProcessStateAdapter();
    const log: string[] = [];
    const result = inMode(stateAdapter, function* () {
      try {
        yield* step(1);
      } finally {
        log.push("cleaned up");
      }
    });
    await expect(result).rejects.toThrow("An asynchronous step got a plain value");
    expect(log).toEqual(["cleaned up"]);
  });
});

describe("inTransaction", () => {
  it("fails an async transaction body that steps over a plain value, even when it catches it", async () => {
    await using stateAdapter = createInProcessStateAdapter();
    const result = inTransaction(stateAdapter, function* () {
      try {
        yield* step(1);
      } catch {
        return "caught";
      }
      return "stepped";
    });
    await expect(result).rejects.toThrow("An asynchronous step got a plain value");
  });
});
