import type { Mode } from "@queuert/sync-async";
import { expectTypeOf, it } from "vitest";

import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter.in-process.ts";

it("is synchronous by default and asynchronous with mode: async", async () => {
  using syncAdapter = createInProcessStateAdapter();
  await using asyncAdapter = createInProcessStateAdapter({ mode: "async" });

  expectTypeOf(syncAdapter).toEqualTypeOf<InProcessStateAdapter>();
  expectTypeOf(asyncAdapter).toEqualTypeOf<InProcessStateAdapter<"async">>();
});

it("is of either mode when the mode is", () => {
  expectTypeOf((mode: Mode) => createInProcessStateAdapter({ mode })).returns.toEqualTypeOf<
    InProcessStateAdapter<Mode>
  >();
});
