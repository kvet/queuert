import { type Helpers } from "../setup-helpers.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

export type AttemptOwnership = {
  signal: AbortSignal;
  abort: () => void;
  trackCompleteSlot: (completeSlot: { write: unknown }) => void;
  hasWrittenComplete: () => boolean;
  dispose: () => Promise<void>;
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

  const completeSlots = new Set<{ write: unknown }>();
  const disposed = { value: false };
  const disposeAttemptLostListener = await helpers.notifyAdapter
    .listenJobAttemptLost(stateJob.id, () => {
      if (!disposed.value) abort();
    })
    .catch(() => async () => {});

  return {
    signal: abortController.signal,
    abort,
    trackCompleteSlot: (completeSlot) => {
      completeSlots.add(completeSlot);
    },
    hasWrittenComplete: () => [...completeSlots].some((slot) => slot.write !== null),
    dispose: async () => {
      disposed.value = true;
      try {
        await disposeAttemptLostListener().catch(() => {});
      } finally {
        abortSignal.removeEventListener("abort", abort);
      }
    },
  };
};
