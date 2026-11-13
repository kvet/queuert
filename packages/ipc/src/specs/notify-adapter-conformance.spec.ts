// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { conformanceTestSuite } from "@queuert/helpers/conformance";
import type { SyncNotifyAdapter } from "queuert";
import type { NotifyAdapterConformanceContext } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { it as baseIt, describe, expect } from "vitest";

import { createIpcNotifyAdapter } from "../notify-adapter/notify-adapter.ipc.ts";

const it = baseIt.extend("directory", { scope: "file" }, async ({}, { onCleanup }) => {
  const directory = await mkdtemp(join(tmpdir(), "queuert-ipc-"));
  onCleanup(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
});

const singleIt = it.extend(
  "conformance",
  { scope: "file" },
  async ({ directory }): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () => createIpcNotifyAdapter({ directory }),
  }),
);

const sharedDirectoryIt = it.extend(
  "conformance",
  { scope: "file" },
  async ({ directory }): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () => {
      const receiver = createIpcNotifyAdapter({ directory });
      const sender = createIpcNotifyAdapter({ directory });

      let connected = false;
      const disposeWarmUp = receiver.listenJobScheduled(["warm-up"], () => {
        connected = true;
      });
      await expect
        .poll(
          () => {
            sender.notifyJobsScheduled(["warm-up"]);
            return connected;
          },
          { timeout: 5000, interval: 50 },
        )
        .toBe(true);
      disposeWarmUp();

      const close = (): void => {
        sender.close();
        receiver.close();
      };
      const notifyAdapter: SyncNotifyAdapter = {
        ...receiver,
        notifyJobsScheduled: sender.notifyJobsScheduled,
        notifyChainsCompleted: sender.notifyChainsCompleted,
        notifyJobAttemptsLost: sender.notifyJobAttemptsLost,
        close,
        [Symbol.dispose]: close,
      };
      return notifyAdapter;
    },
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("IPC Notify Adapter Conformance", () => {
  conformanceTestSuite({ mode: "sync", it: singleIt, groups: notifyAdapterBaseGroups });
});

describe("IPC Notify Adapter Conformance - Sender and Receiver Sharing a Directory", () => {
  conformanceTestSuite({
    mode: "sync",
    it: sharedDirectoryIt,
    groups: notifyAdapterBaseGroups,
  });
});
