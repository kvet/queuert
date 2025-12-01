import { StateProvider } from "../state-provider/state-provider.js";
import { StateAdapter, StateJob } from "./state-adapter.js";
import {
  acquireJobSql,
  addJobDependenciesSql,
  completeJobSql,
  createJobSql,
  DbJob,
  getJobByIdSql,
  getJobChainByIdSql,
  getJobDependenciesSql,
  getNextJobAvailableInMsSql,
  linkJobSql,
  markJobSql,
  removeExpiredJobClaimsSql,
  rescheduleJobSql,
  scheduleDependentJobsSql,
  sendHeartbeatJobSql,
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
    parentId: dbJob.parent_id,

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at
      ? new Date(dbJob.last_attempt_at)
      : null,

    lockedBy: dbJob.locked_by,
    lockedUntil: dbJob.locked_until ? new Date(dbJob.locked_until) : null,

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
            jobChain.last_chain_job
              ? mapDbJobToStateJob(jobChain.last_chain_job)
              : undefined,
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

    createJob: async ({ context, queueName, input, parentId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: createJobSql,
        params: [queueName, input as any],
      });

      return mapDbJobToStateJob(job);
    },

    addJobDependencies: async ({ context, jobId, dependsOnChainIds }) => {
      const jobs = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: addJobDependenciesSql,
        params: [
          Array.from({ length: dependsOnChainIds.length }, () => jobId),
          dependsOnChainIds,
        ],
      });

      return jobs.map(mapDbJobToStateJob).map((job) => [job, undefined]);
    },
    scheduleDependentJobs: async ({ context, dependsOnChainId }) => {
      const jobIds = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: scheduleDependentJobsSql,
        params: [dependsOnChainId],
      });
      return jobIds;
    },
    getJobDependencies: async ({ context, jobId }) => {
      const jobChains = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: getJobDependenciesSql,
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
    markJob: async ({ context, jobId, status }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: markJobSql,
        params: [jobId, status],
      });

      return mapDbJobToStateJob(job);
    },
    sendHeartbeat: async ({ context, jobId, workerId, lockDurationMs }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: sendHeartbeatJobSql,
        params: [jobId, workerId, lockDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, afterMs, error }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: rescheduleJobSql,
        params: [jobId, afterMs, error as any],
      });

      return mapDbJobToStateJob(job);
    },
    linkJob: async ({ context, jobId, chainId }) => {
      const [job] = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: linkJobSql,
        params: [jobId, chainId],
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
    removeExpiredJobClaims: async ({ context, queueNames }) => {
      const jobIds = await executeTypedSql({
        executeSql: (...args) => stateProvider.executeSql(context, ...args),
        sql: /* sql */ removeExpiredJobClaimsSql,
        params: [queueNames],
      });
      return jobIds;
    },
  };
};
