import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";

export const refetchJobLocked = async (
  helpers: Helpers,
  {
    txCtx,
    job,
    workerId,
  }: {
    txCtx: BaseTxContext;
    job: StateJob;
    workerId: string;
  },
): Promise<StateJob> => {
  const [fetched] = await helpers.stateAdapter.getJobs({
    txCtx,
    jobIds: [job.id],
    lock: "exclusive",
  });

  if (!fetched) {
    throw new JobNotFoundError(`Job not found`, {
      jobId: job.id,
    });
  }

  if (fetched.completedAt !== null) {
    helpers.observabilityHelper.jobAttemptAlreadyCompleted(fetched, { workerId });
    throw new JobAlreadyCompletedError("Job is already completed", {
      jobId: fetched.id,
    });
  }

  if (fetched.attemptBy !== workerId) {
    helpers.observabilityHelper.jobAttemptTakenByAnotherWorker(fetched, { workerId });
    throw new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: fetched.id,
      workerId,
      attemptBy: fetched.attemptBy,
    });
  }

  if (fetched.attemptUntil && fetched.attemptUntil.getTime() < Date.now()) {
    helpers.observabilityHelper.jobAttemptExpired(fetched, { workerId });
  }

  return fetched;
};
