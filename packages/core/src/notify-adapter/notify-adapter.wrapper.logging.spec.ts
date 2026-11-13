import { expectToThrow } from "@queuert/helpers/expect.spec-helper";
import { describe, expect, test, vi } from "vitest";

import {
  createInProcessNotifyAdapter,
  createSyncInProcessNotifyAdapter,
} from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import { createObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import { noopNotifyAdapter } from "./notify-adapter.noop.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "./notify-adapter.wrapper.logging.ts";

const createLoggedAdapter = <
  TNotifyAdapter extends Parameters<typeof wrapNotifyAdapterWithLogging>[0]["notifyAdapter"],
>(
  notifyAdapter: TNotifyAdapter,
) => {
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

const expectReportedOnce = (
  log: ReturnType<typeof vi.fn>,
  operation: string,
  error: Error,
): void => {
  expect(log.mock.calls.map(([entry]) => entry)).toEqual([
    expect.objectContaining({ type: "notify_adapter_error", data: { operation }, error }),
  ]);
};

describe("wrapNotifyAdapterWithLogging", () => {
  test("reports a failed call once and fails with its error", async () => {
    const error = new Error("notify down");
    const notifyAdapter: NotifyAdapter = {
      ...createInProcessNotifyAdapter(),
      notifyJobsScheduled: async () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(notifyAdapter);

    await expectToThrow(() => wrapped.notifyJobsScheduled(["type-a"]), error);
    expectReportedOnce(log, "notifyJobsScheduled", error);
  });

  test("reports a failed unsubscribe once and fails with its error", async () => {
    const error = new Error("unsubscribe failed");
    const notifyAdapter: NotifyAdapter = {
      ...createInProcessNotifyAdapter(),
      listenChainCompleted: async () => async () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(notifyAdapter);

    const dispose = await wrapped.listenChainCompleted("chain-a", () => {});
    expect(log).not.toHaveBeenCalled();
    await expectToThrow(() => dispose(), error);
    expectReportedOnce(log, "listenChainCompleted", error);
  });

  test("reports a synchronous throw of an async adapter once and rejects with its error", async () => {
    const error = new Error("notify down");
    const notifyAdapter: NotifyAdapter = {
      ...noopNotifyAdapter,
      notifyJobsScheduled: () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(notifyAdapter);

    await expect(wrapped.notifyJobsScheduled(["type-a"])).rejects.toBe(error);
    expectReportedOnce(log, "notifyJobsScheduled", error);
  });

  test("reports a throw of a sync adapter once and rethrows it synchronously", () => {
    const error = new Error("notify down");
    const base = createSyncInProcessNotifyAdapter();
    const notifyAdapter: typeof base = {
      ...base,
      notifyJobsScheduled: () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(notifyAdapter);

    expect(() => {
      wrapped.notifyJobsScheduled(["type-a"]);
    }).toThrow(error);
    expectReportedOnce(log, "notifyJobsScheduled", error);
  });

  test("reports a failed unsubscribe of a sync adapter once and rethrows it synchronously", () => {
    const error = new Error("unsubscribe failed");
    const base = createSyncInProcessNotifyAdapter();
    const notifyAdapter: typeof base = {
      ...base,
      listenChainCompleted: () => () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(notifyAdapter);

    const dispose = wrapped.listenChainCompleted("chain-a", () => {});
    expect(log).not.toHaveBeenCalled();
    expect(() => {
      dispose();
    }).toThrow(error);
    expectReportedOnce(log, "listenChainCompleted", error);
  });
});
