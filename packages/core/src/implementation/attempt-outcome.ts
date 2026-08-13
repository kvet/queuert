import { mapStateJobToJob, type AnyJob } from "../entities/job.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

/**
 * What a committed outcome left behind: the just-completed job, post-write, and
 * the successor it handed the chain to. A null continuation is the `{ output }`
 * outcome — the committed output is read off `job`. The successor is carried
 * whole because the row holds only its id, not its type.
 */
export type FinishResult = { job: StateJob; continuation: StateJob | null };

/**
 * Projects a committed outcome into the shape `finish` resolves to for callers.
 * Untyped here on purpose: the job-type generics are reapplied at the typed
 * edge, which knows the outcome that produced it.
 */
export const mapFinishResult = ({
  job,
  continuation,
}: FinishResult): AnyJob & { continuedTo?: AnyJob } => ({
  ...mapStateJobToJob(job),
  ...(continuation && { continuedTo: mapStateJobToJob(continuation) }),
});

/**
 * Tracks the "exactly one finish per completion" protocol shared by the worker
 * and workerless paths. Holds no opinion on which outcomes exist — each caller
 * dispatches its own.
 */
export const createFinishOnce = (): {
  begin: () => void;
  succeed: (result: FinishResult) => void;
  fail: (error: unknown) => void;
  requireFinished: () => FinishResult;
} => {
  /**
   * Latched on entry, not on success: the writes a finish performs are awaited,
   * so gating on `finishResult` would let two concurrent calls both past the
   * gate and both write.
   */
  let started = false;
  let finished: FinishResult | null = null;
  let failure: { error: unknown } | null = null;

  const throwLatchedFailure = () => {
    if (failure !== null) {
      throw failure.error;
    }
  };

  return {
    begin: () => {
      throwLatchedFailure();
      if (started) {
        throw new Error("finish can only be called once");
      }
      started = true;
    },
    succeed: (result) => {
      finished = result;
    },
    fail: (error) => {
      failure = { error };
    },
    /**
     * Asserts the callback actually settled the attempt, and hands back what it
     * settled on.
     *
     * Every outcome writes more than once — a continuation completes the
     * predecessor and inserts the successor, a completion completes the job and
     * then unblocks its dependents — so a failed `finish` can leave half of one
     * written. A callback that swallowed that failure and returned normally
     * would otherwise persist those writes, which is why the latched failure is
     * re-thrown here rather than only at the `finish` call site.
     */
    requireFinished: () => {
      throwLatchedFailure();
      if (finished === null) {
        throw new Error("finish must be called before the complete callback returns");
      }
      return finished;
    },
  };
};
