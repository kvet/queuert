import type { SyncAsync, ModeResult } from "@queuert/sync-async";

import type { ModeOf } from "../adapter-mode.ts";

export const runInModeOf = <TAdapter extends { readonly sync?: boolean }, T>(
  adapter: TAdapter,
  body: SyncAsync<[], T>,
): ModeResult<ModeOf<TAdapter>, T> =>
  (adapter.sync === true ? body.sync() : body.async()) as ModeResult<ModeOf<TAdapter>, T>;
