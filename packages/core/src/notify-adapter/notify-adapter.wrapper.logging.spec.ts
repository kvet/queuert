import { describe, expect, test, vi } from "vitest";

import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import { createObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import { noopNotifyAdapter } from "./notify-adapter.noop.spec-helper.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter.wrapper.logging.ts";

const wrapWithLog = (notifyAdapter: NotifyAdapter) => {
  const log = vi.fn();
  const wrapped = wrapNotifyAdapterWithLogging({
    notifyAdapter,
    observabilityHelper: createObservabilityHelper({
      log,
      adapter: createNoopObservabilityAdapter(),
    }),
  });
  return { wrapped, log };
};

describe("wrapNotifyAdapterWithLogging", () => {
  test("reports a rejected call once and rejects with its error", async () => {
    const error = new Error("notify down");
    const { wrapped, log } = wrapWithLog({
      ...noopNotifyAdapter,
      notifyJobsScheduled: async () => {
        throw error;
      },
    });

    await expect(wrapped.notifyJobsScheduled(["type-a"])).rejects.toBe(error);
    expect(log.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        type: "notify_adapter_error",
        data: { operation: "notifyJobsScheduled" },
        error,
      }),
    ]);
  });

  test("reports a synchronous throw once and rejects with its error", async () => {
    const error = new Error("notify down");
    const { wrapped, log } = wrapWithLog({
      ...noopNotifyAdapter,
      notifyJobsScheduled: () => {
        throw error;
      },
    });

    await expect(wrapped.notifyJobsScheduled(["type-a"])).rejects.toBe(error);
    expect(log.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        type: "notify_adapter_error",
        data: { operation: "notifyJobsScheduled" },
        error,
      }),
    ]);
  });
});
