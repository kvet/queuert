import type { Mode } from "@queuert/sync-async";
import { expectTypeOf, it } from "vitest";

import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { createInProcessNotifyAdapter } from "./notify-adapter.in-process.ts";

it("is synchronous by default and asynchronous with mode: async", async () => {
  using syncAdapter = createInProcessNotifyAdapter();
  await using asyncAdapter = createInProcessNotifyAdapter({ mode: "async" });

  expectTypeOf(syncAdapter).toEqualTypeOf<NotifyAdapter<"sync">>();
  expectTypeOf(asyncAdapter).toEqualTypeOf<NotifyAdapter<"async">>();
});

it("is of either mode when the mode is", () => {
  expectTypeOf((mode: Mode) => createInProcessNotifyAdapter({ mode })).returns.toEqualTypeOf<
    NotifyAdapter<Mode>
  >();
});
