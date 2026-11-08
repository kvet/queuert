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

  let released = false;
  let disposeAttemptLostListener: (() => Promise<void>) | null = null;
  try {
    disposeAttemptLostListener = await helpers.notifyAdapter.listenJobAttemptLost(
      stateJob.id,
      () => {
        if (!released) abortController.abort();
      },
    );
  } catch {}

  return {
    signal: abortController.signal,
    abort,
    release: async () => {
      released = true;
      try {
        await disposeAttemptLostListener?.().catch(() => {});
      } finally {
        abortSignal.removeEventListener("abort", abort);
      }
    },
  };
};
