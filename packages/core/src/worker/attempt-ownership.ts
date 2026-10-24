import { type Helpers } from "../setup-helpers.js";
import { type StateAttemptFence, type StateJob } from "../state-adapter/state-adapter.js";
import { type AttemptConfig, createAttemptHeartbeat } from "./attempt-heartbeat.js";

/** A worker's hold on one attempt while its handler runs. */
export type AttemptOwnership = {
  /** Aborts when the worker stops, the heartbeat loses the attempt, or the attempt is lost. */
  signal: AbortSignal;
  /** Aborts the signal, for an attempt found lost. */
  abort: () => void;
  /** Reports `jobAttemptExpired` once, if the lease has run out. */
  reportExpiredLease: () => void;
  /** Records a successful `complete` write, after which a missed extension no longer aborts. */
  markCompleteWritten: () => void;
  /** Stops extending the lease. */
  stopHeartbeat: () => Promise<void>;
  /**
   * Ends the hold once the handler has returned: stops the heartbeat and removes the attempt-lost
   * and worker stop listeners. A loss notification is ignored from the moment `release` is called,
   * before its first await.
   */
  release: () => Promise<void>;
};

/**
 * Starts holding an attempt: listens for the worker stopping, extends the lease on a heartbeat,
 * and listens for the attempt being lost.
 */
export const startAttemptOwnership = async (
  helpers: Helpers,
  {
    stateJob,
    fence,
    workerId,
    attemptConfig,
    stopSignal,
  }: {
    stateJob: StateJob;
    fence: StateAttemptFence;
    workerId: string;
    attemptConfig: AttemptConfig;
    stopSignal: AbortSignal;
  },
): Promise<AttemptOwnership> => {
  const abortController = new AbortController();
  const onStop = () => {
    abortController.abort();
  };
  stopSignal.addEventListener("abort", onStop, { once: true });
  if (stopSignal.aborted) onStop();

  let leaseUntil = stateJob.attemptUntil;
  let expiredReported = false;
  const reportExpiredLease = () => {
    if (expiredReported || leaseUntil === null || leaseUntil.getTime() >= Date.now()) return;
    expiredReported = true;
    helpers.observabilityHelper.jobAttemptExpired(stateJob, { workerId });
  };

  let completeWritten = false;
  // An extension is never awaited by `complete`: on Postgres it would block on the row `complete` just
  // wrote, and on SQLite and in-process on the write lock the caller's transaction holds.
  const attemptHeartbeat = createAttemptHeartbeat({
    config: attemptConfig,
    extend: async (timeoutMs) => {
      try {
        const extended = await helpers.stateAdapter.extendJobAttempt({
          jobId: stateJob.id,
          fence,
          timeoutMs,
        });
        if (extended) {
          reportExpiredLease();
          leaseUntil = extended.attemptUntil;
          helpers.observabilityHelper.jobAttemptExtended(stateJob, { workerId });
          return true;
        }
        // After our own `complete` write, a miss is an extension that waited for its COMMIT.
        if (!completeWritten) abortController.abort();
        return false;
      } catch {
        abortController.abort();
        return false;
      }
    },
  });

  let released = false;
  let disposeAttemptLostListener: (() => Promise<void>) | null = null;
  try {
    disposeAttemptLostListener = await helpers.notifyAdapter.listenJobAttemptLost(
      stateJob.id,
      // Sent when the attempt is lost: reclaimed after its lease expired, or completed by
      // workerless completion. Aborts the signal unless the hold was already released.
      () => {
        if (!released) abortController.abort();
      },
    );
  } catch {}

  return {
    signal: abortController.signal,
    abort: () => {
      abortController.abort();
    },
    reportExpiredLease,
    markCompleteWritten: () => {
      completeWritten = true;
    },
    stopHeartbeat: attemptHeartbeat.stop,
    release: async () => {
      released = true;
      try {
        await Promise.all([disposeAttemptLostListener?.(), attemptHeartbeat.stop()]);
      } finally {
        stopSignal.removeEventListener("abort", onStop);
      }
    },
  };
};
