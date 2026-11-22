import type { NotifyAdapter } from "./notify-adapter.ts";

const notifyNothing = (): void => {};

const listenNothing = (): (() => void) => notifyNothing;

export const noopNotifyAdapter: NotifyAdapter<"sync"> = Object.freeze({
  sync: true,
  notifyJobsScheduled: notifyNothing,
  listenJobsScheduled: listenNothing,
  notifyChainsCompleted: notifyNothing,
  listenChainsCompleted: listenNothing,
  notifyJobAttemptsLost: notifyNothing,
  listenJobAttemptsLost: listenNothing,
  close: notifyNothing,
  [Symbol.dispose]: notifyNothing,
});
