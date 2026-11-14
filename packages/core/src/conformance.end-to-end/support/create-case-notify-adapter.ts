import type { Mode, MaybePromise } from "@queuert/sync-async";

import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { createInProcessNotifyAdapter } from "../../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "../../state-adapter/state-adapter.ts";

export const createCaseNotifyAdapter = (
  createNotifyAdapter: StateAdapterConformanceContext["createNotifyAdapter"],
  stateAdapter: StateAdapter<any, any, any, Mode>,
): MaybePromise<NotifyAdapter<"async">> =>
  (createNotifyAdapter
    ? createNotifyAdapter()
    : createInProcessNotifyAdapter({
        mode: stateAdapter.sync === true ? "sync" : "async",
      })) as MaybePromise<NotifyAdapter<"async">>;
