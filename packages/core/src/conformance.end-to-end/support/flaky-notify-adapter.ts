import type { MaybePromise } from "@queuert/helpers/maybe-promise";

import { isSyncAdapter } from "../../adapter-mode.ts";
import type { ConformanceNotifyAdapter } from "../../conformance/adapters.ts";
import { createFlakyBatchGenerator } from "./flaky-batch-generator.ts";

export type FlakyCallCounts = { calls: number; errors: number };

const flakyMethods = [
  "notifyJobsScheduled",
  "listenJobScheduled",
  "notifyChainsCompleted",
  "listenChainCompleted",
  "notifyJobAttemptsLost",
  "listenJobAttemptLost",
] as const;

export const createFlakyNotifyAdapter = <TNotifyAdapter extends ConformanceNotifyAdapter>(
  notifyAdapter: TNotifyAdapter,
): { notifyAdapter: TNotifyAdapter; counts: FlakyCallCounts } => {
  const counts: FlakyCallCounts = { calls: 0, errors: 0 };
  const shouldError = createFlakyBatchGenerator();
  const sync = isSyncAdapter(notifyAdapter);

  const wrap =
    (fn: (...args: unknown[]) => MaybePromise<unknown>) =>
    (...args: unknown[]) => {
      counts.calls++;
      if (shouldError()) {
        counts.errors++;
        const error = new Error("connection reset") as Error & { code: string };
        error.code = "ECONNRESET";
        if (sync) throw error;
        return Promise.reject(error);
      }
      return fn(...args);
    };

  const flaky: Record<string, unknown> = {};
  for (const name of flakyMethods) {
    flaky[name] = wrap(notifyAdapter[name] as (...args: unknown[]) => MaybePromise<unknown>);
  }

  return {
    counts,
    notifyAdapter: { ...notifyAdapter, ...flaky },
  };
};
