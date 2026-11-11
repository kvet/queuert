import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { createInProcessNotifyAdapter } from "../../notify-adapter/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";

export const createCaseNotifyAdapter = async (
  createNotifyAdapter: StateAdapterConformanceContext["createNotifyAdapter"],
): Promise<NotifyAdapter> =>
  createNotifyAdapter ? createNotifyAdapter() : createInProcessNotifyAdapter();
