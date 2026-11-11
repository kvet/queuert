import { noopAsync } from "@queuert/helpers";

import type { NotifyAdapter } from "./notify-adapter.ts";

const listenNothing = async (): Promise<() => Promise<void>> => noopAsync;

export const noopNotifyAdapter: NotifyAdapter = Object.freeze({
  notifyJobsScheduled: noopAsync,
  listenJobScheduled: listenNothing,
  notifyChainsCompleted: noopAsync,
  listenChainCompleted: listenNothing,
  notifyJobAttemptsLost: noopAsync,
  listenJobAttemptLost: listenNothing,
  close: noopAsync,
  [Symbol.asyncDispose]: noopAsync,
});
