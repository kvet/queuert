import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";

export const refetchJobForUpdate = async (
  helpers: Helpers,
  {
    txCtx,
    job,
    workerId,
    allowEmptyWorker,
  }: {
    txCtx: BaseTxContext;
    job: StateJob;
    workerId: string;
    allowEmptyWorker: boolean;
  },
): Promise<StateJob> => {
  const fetchedJob = await helpers.stateAdapter.getJobForUpdate({
    txCtx,
    jobId: job.id,
  });

  if (!fetchedJob) {
    throw new JobNotFoundError(`Job not found`, {
      jobId: job.id,
    });
  }

  if (fetchedJob.status === "completed") {
    helpers.observabilityHelper.jobAttemptAlreadyCompleted(fetchedJob, { workerId });
    throw new JobAlreadyCompletedError("Job is already completed", {
      jobId: fetchedJob.id,
    });
  }

  if (
    fetchedJob.leasedBy !== workerId &&
    !(allowEmptyWorker ? fetchedJob.leasedBy === null : false)
  ) {
    helpers.observabilityHelper.jobAttemptTakenByAnotherWorker(fetchedJob, { workerId });
    throw new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: fetchedJob.id,
      workerId,
      leasedBy: fetchedJob.leasedBy,
    });
  }

  if (fetchedJob.leasedUntil && fetchedJob.leasedUntil.getTime() < Date.now()) {
    helpers.observabilityHelper.jobAttemptLeaseExpired(fetchedJob, { workerId });
  }

  return fetchedJob;
};
