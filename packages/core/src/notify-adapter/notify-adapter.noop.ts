import type { NotifyAdapter, SyncNotifyAdapter } from "./notify-adapter.ts";

const notifyNothingAsync = async (): Promise<void> => {};

const listenNothingAsync = async (): Promise<() => Promise<void>> => notifyNothingAsync;

export const noopNotifyAdapter: NotifyAdapter = Object.freeze({
  notifyJobsScheduled: notifyNothingAsync,
  listenJobScheduled: listenNothingAsync,
  notifyChainsCompleted: notifyNothingAsync,
  listenChainCompleted: listenNothingAsync,
  notifyJobAttemptsLost: notifyNothingAsync,
  listenJobAttemptLost: listenNothingAsync,
  close: notifyNothingAsync,
  [Symbol.asyncDispose]: notifyNothingAsync,
});

const notifyNothing = (): void => {};

const listenNothing = (): (() => void) => notifyNothing;

export const syncNoopNotifyAdapter: SyncNotifyAdapter = Object.freeze({
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
