import { describe, expect, test, vi } from "vitest";

import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import { createObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import { createInProcessStateAdapter } from "./state-adapter.in-process.ts";
import type { StateAdapter } from "./state-adapter.ts";
import { wrapStateAdapterWithLogging } from "./state-adapter.wrapper.logging.ts";

const wrapWithLog = (stateAdapter: StateAdapter<any, any, any>) => {
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

describe("wrapStateAdapterWithLogging", () => {
  test("reports a rejected call once and rejects with its error", async () => {
    const error = new Error("connection lost");
    const { wrapped, log } = wrapWithLog({
      ...createInProcessStateAdapter(),
      getJobs: async () => {
        throw error;
      },
    });

    await expect(wrapped.getJobs({ jobIds: ["job-a"] })).rejects.toBe(error);
    expect(log.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        type: "state_adapter_error",
        data: { operation: "getJobs" },
        error,
      }),
    ]);
  });

  test("reports a synchronous throw once and rejects with its error", async () => {
    const error = new Error("connection lost");
    const { wrapped, log } = wrapWithLog({
      ...createInProcessStateAdapter(),
      getJobs: () => {
        throw error;
      },
    });

    await expect(wrapped.getJobs({ jobIds: ["job-a"] })).rejects.toBe(error);
    expect(log.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        type: "state_adapter_error",
        data: { operation: "getJobs" },
        error,
      }),
    ]);
  });
});
