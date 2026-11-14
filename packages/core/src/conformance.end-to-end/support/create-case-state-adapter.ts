import type { Mode, MaybePromise } from "@queuert/sync-async";

import type { StateAdapter } from "../../state-adapter/state-adapter.ts";
import type { EndToEndTxContext } from "../types.ts";

export const createCaseStateAdapter = (
  createStateAdapter: () => MaybePromise<StateAdapter<any, any, any, Mode>>,
): MaybePromise<StateAdapter<EndToEndTxContext, string, string, "async">> =>
  createStateAdapter() as MaybePromise<StateAdapter<EndToEndTxContext, string, string, "async">>;
