import { sleep } from "@queuert/helpers";

import { type Helpers } from "../setup-helpers.js";
import { type StateAttemptFence, type StateJob } from "../state-adapter/state-adapter.js";
import { type AttemptConfig } from "./attempt-config.js";

export type AttemptOwnership = {
  signal: AbortSignal;
  abort: () => void;
  trackCompleteSlot: (completeSlot: { write: unknown }) => void;
  stopHeartbeat: () => Promise<void>;
  release: () => Promise<void>;
};

export const startAttemptOwnership = async (
  helpers: Helpers,
  {
    stateJob,
    fence,
    attemptConfig,
    stopSignal,
  }: {
    stateJob: StateJob;
    fence: StateAttemptFence;
    attemptConfig: AttemptConfig;
    stopSignal: AbortSignal;
  },
): Promise<AttemptOwnership> => {
  const abortController = new AbortController();
  const abort = () => {
    abortController.abort();
  };
  stopSignal.addEventListener("abort", abort, { once: true });
  if (stopSignal.aborted) abort();

  const completeSlots = new Set<{ write: unknown }>();
  const heartbeatController = new AbortController();
  const runHeartbeat = async () => {
    while (!heartbeatController.signal.aborted) {
      await sleep(attemptConfig.heartbeatMs, { signal: heartbeatController.signal });
      if (heartbeatController.signal.aborted) return;
      try {
        const extended = await helpers.stateAdapter.extendJobAttempt({
          jobId: stateJob.id,
          fence,
          timeoutMs: attemptConfig.timeoutMs,
        });
        if (!extended) {
          const completeWritten = [...completeSlots].some((slot) => slot.write !== null);
          if (!completeWritten) abortController.abort();
          return;
        }
      } catch {
        abortController.abort();
        return;
      }
    }
  };
  const heartbeat = runHeartbeat();
  const stopHeartbeat = async () => {
    heartbeatController.abort();
    await heartbeat;
  };

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
    trackCompleteSlot: (completeSlot) => {
      completeSlots.add(completeSlot);
    },
    stopHeartbeat,
    release: async () => {
      released = true;
      try {
        await Promise.all([disposeAttemptLostListener?.().catch(() => {}), stopHeartbeat()]);
      } finally {
        stopSignal.removeEventListener("abort", abort);
      }
    },
  };
};
