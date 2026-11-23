import { createLatch } from "@queuert/helpers/latch";

import type { Helpers } from "../client/setup-helpers.ts";
import type { StateJob } from "../state-adapter/state-adapter.ts";

export type AttemptOwnership = {
  signals: ReadonlyMap<string, AbortSignal>;
  abort: (jobIds: string[]) => void;
  release: () => Promise<void>;
};

export const startAttemptOwnership = async (
  helpers: Helpers,
  {
    stateJobs,
    abortSignal,
  }: {
    stateJobs: StateJob[];
    abortSignal: AbortSignal;
  },
): Promise<AttemptOwnership> => {
  const abortControllers = new Map(
    stateJobs.map((stateJob) => [stateJob.id, new AbortController()]),
  );
  const abort = (jobIds: string[]) => {
    for (const jobId of jobIds) {
      abortControllers.get(jobId)?.abort();
    }
  };
  const abortAll = () => {
    abort([...abortControllers.keys()]);
  };
  abortSignal.addEventListener("abort", abortAll, { once: true });
  if (abortSignal.aborted) abortAll();

  const released = createLatch();
  const disposeAttemptLostListener = await helpers.notifyHelper.listenJobAttemptsLost(
    [...abortControllers.keys()],
    (jobId) => {
      if (!released.tripped) abort([jobId]);
    },
  );

  return {
    signals: new Map(
      [...abortControllers].map(([jobId, abortController]) => [jobId, abortController.signal]),
    ),
    abort,
    release: async () => {
      released.trip();
      try {
        await disposeAttemptLostListener();
      } finally {
        abortSignal.removeEventListener("abort", abortAll);
      }
    },
  };
};
