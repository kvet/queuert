import { type Mode, type MaybePromise, syncAsync, step, wait } from "@queuert/sync-async";
import { describe, expectTypeOf, it } from "vitest";

import type { InProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import { runInModeOf } from "./adapters.ts";

describe("runInModeOf", () => {
  it("returns a plain value over a sync adapter", () => {
    expectTypeOf((stateAdapter: InProcessStateAdapter) =>
      runInModeOf(
        stateAdapter,
        syncAsync(function* () {
          return yield* step(1);
        }),
      ),
    ).returns.toEqualTypeOf<number>();
  });

  it("returns a promise over an async adapter", () => {
    expectTypeOf((stateAdapter: InProcessStateAdapter<"async">) =>
      runInModeOf(
        stateAdapter,
        syncAsync(function* () {
          return yield* step(Promise.resolve(1));
        }),
      ),
    ).returns.toEqualTypeOf<Promise<number>>();
  });

  it("returns either over an adapter whose mode is known only at runtime", () => {
    expectTypeOf((stateAdapter: StateAdapter<any, any, any, Mode>) =>
      runInModeOf(
        stateAdapter,
        syncAsync(function* () {
          return yield* step(1);
        }),
      ),
    ).returns.toEqualTypeOf<MaybePromise<number>>();
  });

  it("rejects a body that waits", () => {
    expectTypeOf((stateAdapter: StateAdapter<any, any, any, Mode>) =>
      runInModeOf(
        stateAdapter,
        // @ts-expect-error a waiting body has no synchronous run
        syncAsync(function* () {
          return yield* wait(Promise.resolve(1));
        }),
      ),
    ).toBeFunction();
  });
});
