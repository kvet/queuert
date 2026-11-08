import { noop, noopAsync } from "@queuert/helpers";

import type { NotifyHelper } from "./notify-helper.ts";

const listenNothing = async (): Promise<() => Promise<void>> => noopAsync;

export const createNoopNotifyHelper = (): NotifyHelper => ({
  notifyJobsScheduled: noop,
  notifyChainsCompleted: noop,
  notifyJobAttemptsLost: noop,
  listenJobScheduled: listenNothing,
  listenChainCompleted: listenNothing,
  listenJobAttemptLost: listenNothing,
});
