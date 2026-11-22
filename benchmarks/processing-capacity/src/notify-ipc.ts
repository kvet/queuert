import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import { type NotifyAdapter, createInProcessStateAdapter } from "queuert";

import { runSyncBenchmark } from "./utils.ts";

const directory = mkdtempSync(join(tmpdir(), "queuert-bench-ipc-"));
const sender = createIpcNotifyAdapter({ directory });
const receiver = createIpcNotifyAdapter({ directory });

const warmUp = Promise.withResolvers<void>();
const disposeWarmUp = receiver.listenJobsScheduled(["warm-up"], () => {
  warmUp.resolve();
});
const sendWarmUp = (): void => {
  sender.notifyJobsScheduled(["warm-up"]);
};
sendWarmUp();
const warmUpInterval = setInterval(sendWarmUp, 50);
await warmUp.promise;
clearInterval(warmUpInterval);
disposeWarmUp();

const notifyAdapter: NotifyAdapter<"sync"> = {
  ...receiver,
  notifyJobsScheduled: sender.notifyJobsScheduled,
  notifyChainsCompleted: sender.notifyChainsCompleted,
  notifyJobAttemptsLost: sender.notifyJobAttemptsLost,
  close: () => {
    sender.close();
    receiver.close();
  },
};

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — IPC NOTIFY",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter,
});

rmSync(directory, { recursive: true, force: true });
