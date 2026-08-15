import { mapStateJobToJob, type AnyJob } from "../entities/job.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

export type FinishResult = { job: StateJob; continuation: StateJob | null };

export const mapFinishResult = ({
  job,
  continuation,
}: FinishResult): AnyJob & { continuedTo?: AnyJob } => ({
  ...mapStateJobToJob(job),
  ...(continuation && { continuedTo: mapStateJobToJob(continuation) }),
});

export const createFinishOnce = (): {
  begin: () => void;
  succeed: (result: FinishResult) => void;
  fail: (error: unknown) => void;
  requireFinished: (fallbackErrorMessage: string) => FinishResult;
} => {
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
    requireFinished: (fallbackErrorMessage: string) => {
      throwLatchedFailure();
      if (finished === null) {
        throw new Error(fallbackErrorMessage);
      }
      return finished;
    },
  };
};
