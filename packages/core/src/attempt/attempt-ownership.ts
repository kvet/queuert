import { createLatch } from "@queuert/helpers/latch";

import type { Helpers } from "../setup-helpers.ts";
import type { StateJob } from "../state-adapter/state-adapter.ts";

export type AttemptOwnership = {
  signal: AbortSignal;
  abort: () => void;
  release: () => Promise<void>;
};

export const startAttemptOwnership = async (
  helpers: Helpers,
  {
    stateJob,
    abortSignal,
  }: {
    stateJob: StateJob;
    abortSignal: AbortSignal;
  },
): Promise<AttemptOwnership> => {
  const abortController = new AbortController();
  const abort = () => {
    abortController.abort();
  };
  abortSignal.addEventListener("abort", abort, { once: true });
  if (abortSignal.aborted) abort();

  const released = createLatch();
  const disposeAttemptLostListener = await helpers.notifyHelper.listenJobAttemptLost(
    stateJob.id,
    () => {
      if (!released.tripped) abortController.abort();
    },
  );

  return {
    signal: abortController.signal,
    abort,
    release: async () => {
      released.trip();
      try {
        await disposeAttemptLostListener().catch(() => {});
      } finally {
        abortSignal.removeEventListener("abort", abort);
      }
    },
  };
};
