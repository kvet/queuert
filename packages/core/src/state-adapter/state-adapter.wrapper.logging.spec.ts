import { expectToThrow } from "@queuert/helpers/expect.spec-helper";
import { describe, expect, test, vi } from "vitest";

import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import { createObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import {
  createInProcessStateAdapter,
  createSyncInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import { wrapStateAdapterWithLogging } from "./state-adapter.wrapper.logging.ts";

const createLoggedAdapter = <
  TStateAdapter extends Parameters<typeof wrapStateAdapterWithLogging>[0]["stateAdapter"],
>(
  stateAdapter: TStateAdapter,
) => {
  const log = vi.fn();
  const wrapped = wrapStateAdapterWithLogging({
    stateAdapter,
    observabilityHelper: createObservabilityHelper({
      log,
      adapter: createNoopObservabilityAdapter(),
    }),
  });
  return { wrapped, log };
};

const expectReportedOnce = (log: ReturnType<typeof vi.fn>, error: Error): void => {
  expect(log.mock.calls.map(([entry]) => entry)).toEqual([
    expect.objectContaining({
      type: "state_adapter_error",
      data: { operation: "getJobs" },
      error,
    }),
  ]);
};

describe("wrapStateAdapterWithLogging", () => {
  test("reports a failed call once and fails with its error", async () => {
    const error = new Error("connection lost");
    const base = createInProcessStateAdapter();
    const stateAdapter: typeof base = {
      ...base,
      getJobs: async () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(stateAdapter);

    await expectToThrow(() => wrapped.getJobs({ jobIds: ["job-a"] }), error);
    expectReportedOnce(log, error);
  });

  test("reports a synchronous throw of an async adapter once and rejects with its error", async () => {
    const error = new Error("connection lost");
    const base = createInProcessStateAdapter();
    const stateAdapter: typeof base = {
      ...base,
      getJobs: () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(stateAdapter);

    await expect(wrapped.getJobs({ jobIds: ["job-a"] })).rejects.toBe(error);
    expectReportedOnce(log, error);
  });

  test("reports a throw of a sync adapter once and rethrows it synchronously", () => {
    const error = new Error("connection lost");
    const base = createSyncInProcessStateAdapter();
    const stateAdapter: typeof base = {
      ...base,
      getJobs: () => {
        throw error;
      },
    };
    const { wrapped, log } = createLoggedAdapter(stateAdapter);

    expect(() => wrapped.getJobs({ jobIds: ["job-a"] })).toThrow(error);
    expectReportedOnce(log, error);
  });
});
