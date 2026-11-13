import type { MaybePromise } from "@queuert/helpers/maybe-promise";

import { isSyncAdapter } from "../../adapter-mode.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceStateAdapter } from "../../conformance/adapters.ts";
import {
  createInProcessNotifyAdapter,
  createSyncInProcessNotifyAdapter,
} from "../../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { EndToEndNotifyAdapter } from "../types.ts";

/**
 * The context's notify adapter, or an in-process one in the state adapter's mode. Typed as async,
 * like `EndToEndStateAdapter`; the cases await its results in both modes.
 */
export const createCaseNotifyAdapter = (
  createNotifyAdapter: StateAdapterConformanceContext["createNotifyAdapter"],
  stateAdapter: ConformanceStateAdapter,
): MaybePromise<EndToEndNotifyAdapter> =>
  (createNotifyAdapter
    ? createNotifyAdapter()
    : isSyncAdapter(stateAdapter)
      ? createSyncInProcessNotifyAdapter()
      : createInProcessNotifyAdapter()) as MaybePromise<EndToEndNotifyAdapter>;
