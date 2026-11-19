// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { conformanceTestSuite } from "@queuert/helpers/conformance";
import {
  notifyAdapterEndToEndGroups,
  type NotifyAdapterConformanceContext,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createIpcNotifyAdapter } from "../notify-adapter/notify-adapter.ipc.ts";

const it = baseIt.extend(
  "conformance",
  { scope: "file" },
  async ({}, { onCleanup }): Promise<NotifyAdapterConformanceContext> => {
    const directory = await mkdtemp(join(tmpdir(), "queuert-ipc-"));
    onCleanup(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    return {
      createNotifyAdapter: () => createIpcNotifyAdapter({ directory }),
    };
  },
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("IPC Notify Adapter End-to-End Conformance", () => {
  conformanceTestSuite({ it, groups: notifyAdapterEndToEndGroups });
});
