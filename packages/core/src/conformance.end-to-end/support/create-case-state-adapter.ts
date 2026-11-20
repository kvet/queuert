import type { Mode, MaybePromise } from "@queuert/sync-async";

import { createInProcessStateAdapter } from "../../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../../state-adapter/state-adapter.ts";
import type { EndToEndTxContext } from "../types.ts";

export const createCaseStateAdapter = (
  createStateAdapter: (() => MaybePromise<StateAdapter<any, any, any, Mode>>) | undefined,
  mode: Mode = "async",
): MaybePromise<StateAdapter<EndToEndTxContext, string, string, "async">> =>
  (createStateAdapter
    ? createStateAdapter()
    : createInProcessStateAdapter({ mode })) as MaybePromise<
    StateAdapter<EndToEndTxContext, string, string, "async">
  >;
