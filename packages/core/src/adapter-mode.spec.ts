import { describe, expect, expectTypeOf, it } from "vitest";

import { type AdapterModeOf, isSyncAdapter } from "./adapter-mode.ts";
import type { NotifyAdapter, SyncNotifyAdapter } from "./notify-adapter/notify-adapter.ts";
import type { StateAdapter, SyncStateAdapter } from "./state-adapter/state-adapter.ts";

describe("isSyncAdapter", () => {
  it("is true only when the adapter sets sync: true", () => {
    expect(isSyncAdapter({ sync: true })).toBe(true);
    expect(isSyncAdapter({})).toBe(false);
    expect(isSyncAdapter({ sync: false })).toBe(false);
    expect(isSyncAdapter({ sync: "true" })).toBe(false);
  });
});

describe("AdapterModeOf", () => {
  it("reads the mode from the sync field", () => {
    expectTypeOf<AdapterModeOf<SyncStateAdapter<any, any, any>>>().toEqualTypeOf<"sync">();
    expectTypeOf<AdapterModeOf<StateAdapter<any, any, any>>>().toEqualTypeOf<"async">();
    expectTypeOf<AdapterModeOf<SyncNotifyAdapter>>().toEqualTypeOf<"sync">();
    expectTypeOf<AdapterModeOf<NotifyAdapter>>().toEqualTypeOf<"async">();
  });

  it("gives both modes for an adapter of either mode", () => {
    expectTypeOf<
      AdapterModeOf<StateAdapter<any, any, any> | SyncStateAdapter<any, any, any>>
    >().toEqualTypeOf<"async" | "sync">();
  });
});
