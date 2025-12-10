import { StateProvider } from "../state-provider/state-provider.js";
import { StateAdapter, StateJob } from "./state-adapter.js";
import {
  acquireJobSql,
  addJobBlockersSql,
  completeJobSql,
  createJobSql,
  DbJob,
  getJobBlockersSql,
  getJobByIdSql,
  getJobChainByIdSql,
  getNextJobAvailableInMsSql,
  markJobAsPendingSql,
  markJobAsWaitingSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobsSql,
  startJobAttemptSql,
} from "./state-adapter.pg/sql.js";
import { executeTypedSql } from "./state-adapter.pg/typed-sql.js";

const mapDbJobToStateJob = (dbJob: DbJob): StateJob => {
  return {
    id: dbJob.id,
    queueName: dbJob.queue_name,
    input: dbJob.input,
    output: dbJob.output,

    rootId: dbJob.root_id,
    chainId: dbJob.chain_id,
    originId: dbJob.origin_id,

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    updatedAt: new Date(dbJob.updated_at),
  };
};

export const createPgStateAdapter = ({
  stateProvider,
}: {
  stateProvider: StateProvider<any>;
}): StateAdapter => {
  return {
    getJobChainById: async ({ context, jobId }) => {
      const [jobChain] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: getJobChainByIdSql,
        params: [jobId],
      });

      return jobChain
        ? [
            mapDbJobToStateJob(jobChain.root_job),
            jobChain.last_chain_job ? mapDbJobToStateJob(jobChain.last_chain_job) : undefined,
          ]
        : undefined;
    },
    getJobById: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: getJobByIdSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({ context, queueName, input, rootId, chainId, originId, deduplication }) => {
      const [result] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: createJobSql,
        params: [
          queueName,
          input as any,
          rootId as any,
          chainId as any,
          originId as any,
          (deduplication?.key ?? null) as any,
          (deduplication ? (deduplication.strategy ?? "finalized") : null) as any,
          (deduplication?.windowMs ?? null) as any,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobBlockers: async ({ context, jobId, blockedByChainIds }) => {
      const jobs = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: addJobBlockersSql,
        params: [Array.from({ length: blockedByChainIds.length }, () => jobId), blockedByChainIds],
      });

      return jobs.map(mapDbJobToStateJob).map((job) => [job, undefined]);
    },
    scheduleBlockedJobs: async ({ context, blockedByChainId }) => {
      const jobs = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: scheduleBlockedJobsSql,
        params: [blockedByChainId],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobBlockers: async ({ context, jobId }) => {
      const jobChains = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return jobChains.map(({ root_job, last_chain_job }) => [
        mapDbJobToStateJob(root_job),
        last_chain_job ? mapDbJobToStateJob(last_chain_job) : undefined,
      ]);
    },

    getNextJobAvailableInMs: async ({ context, queueNames }) => {
      const [result] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: getNextJobAvailableInMsSql,
        params: [queueNames],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ context, queueNames }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: acquireJobSql,
        params: [queueNames],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },
    markJobAsWaiting: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: markJobAsWaitingSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    markJobAsPending: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: markJobAsPendingSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    startJobAttempt: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: startJobAttemptSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: renewJobLeaseSql,
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, afterMs, error }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: rescheduleJobSql,
        params: [jobId, afterMs, JSON.stringify(error)],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ context, jobId, output }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: completeJobSql,
        params: [jobId, output as any],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ context, queueNames }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: /* sql */ removeExpiredJobLeaseSql,
        params: [queueNames],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
  };
};
