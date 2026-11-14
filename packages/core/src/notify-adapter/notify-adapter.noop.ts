import type { NotifyAdapter } from "./notify-adapter.ts";

const notifyNothing = (): void => {};

const listenNothing = (): (() => void) => notifyNothing;

export const noopNotifyAdapter: NotifyAdapter<"sync"> = Object.freeze({
  sync: true,
  notifyJobsScheduled: notifyNothing,
  listenJobScheduled: listenNothing,
  notifyChainsCompleted: notifyNothing,
  listenChainCompleted: listenNothing,
  notifyJobAttemptsLost: notifyNothing,
  listenJobAttemptLost: listenNothing,
  close: notifyNothing,
  [Symbol.dispose]: notifyNothing,
});
