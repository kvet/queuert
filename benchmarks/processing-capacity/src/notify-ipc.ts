import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import { type SyncNotifyAdapter, createSyncInProcessStateAdapter } from "queuert";

import { runSyncBenchmark } from "./utils.ts";

const directory = mkdtempSync(join(tmpdir(), "queuert-bench-ipc-"));
const sender = createIpcNotifyAdapter({ directory });
const receiver = createIpcNotifyAdapter({ directory });

const warmUp = Promise.withResolvers<void>();
const disposeWarmUp = receiver.listenJobScheduled(["warm-up"], () => {
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

const notifyAdapter: SyncNotifyAdapter = {
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
  stateAdapter: createSyncInProcessStateAdapter(),
  notifyAdapter,
});

rmSync(directory, { recursive: true, force: true });
