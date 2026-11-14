import type { Mode } from "@queuert/sync-async";
import { describe, expectTypeOf, it } from "vitest";

import type { ModeOf } from "./adapter-mode.ts";
import type { NotifyAdapter } from "./notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "./state-adapter/state-adapter.ts";

describe("ModeOf", () => {
  it("reads the mode from the sync field", () => {
    expectTypeOf<ModeOf<StateAdapter<any, any, any, "sync">>>().toEqualTypeOf<"sync">();
    expectTypeOf<ModeOf<StateAdapter<any, any, any, "async">>>().toEqualTypeOf<"async">();
    expectTypeOf<ModeOf<NotifyAdapter<"sync">>>().toEqualTypeOf<"sync">();
    expectTypeOf<ModeOf<NotifyAdapter<"async">>>().toEqualTypeOf<"async">();
  });

  it("gives both modes for an adapter of either mode", () => {
    expectTypeOf<ModeOf<StateAdapter<any, any, any, Mode>>>().toEqualTypeOf<"async" | "sync">();
    expectTypeOf<ModeOf<NotifyAdapter<Mode>>>().toEqualTypeOf<"async" | "sync">();
  });
});

describe("adapter types of either mode", () => {
  it("accept an async and a sync adapter", () => {
    expectTypeOf<StateAdapter<any, any, any, "async">>().toExtend<
      StateAdapter<any, any, any, Mode>
    >();
    expectTypeOf<StateAdapter<any, any, any, "sync">>().toExtend<
      StateAdapter<any, any, any, Mode>
    >();
    expectTypeOf<NotifyAdapter<"async">>().toExtend<NotifyAdapter<Mode>>();
    expectTypeOf<NotifyAdapter<"sync">>().toExtend<NotifyAdapter<Mode>>();
  });

  it("close and dispose follow the mode", () => {
    expectTypeOf<NotifyAdapter<"sync">["close"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<NotifyAdapter<"async">["close"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<StateAdapter<any, any, any, "sync">>().toHaveProperty(Symbol.dispose);
    expectTypeOf<StateAdapter<any, any, any, "async">>().toHaveProperty(Symbol.asyncDispose);
  });
});
