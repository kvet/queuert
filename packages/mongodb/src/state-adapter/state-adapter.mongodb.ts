import { type Collection, type Document, type WithId } from "mongodb";
import {
  BaseStateAdapterContext,
  type DeduplicationOptions,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { withRetry } from "queuert/internal";
import { MongoStateProvider } from "../state-provider/state-provider.mongodb.js";
import { isTransientMongoError } from "./errors.js";

type JobStatus = "blocked" | "pending" | "running" | "completed";

type DbJob = {
  _id: string;
  typeName: string;
  sequenceId: string;
  sequenceTypeName: string;
  input: unknown;
  output: unknown;

  rootSequenceId: string;
  originId: string | null;

  status: JobStatus;
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  leasedBy: string | null;
  leasedUntil: Date | null;

  deduplicationKey: string | null;

  updatedAt: Date;

  blockers: Array<{ blockedBySequenceId: string; index: number }>;
};

const mapDbJobToStateJob = (dbJob: WithId<Document> | DbJob): StateJob => {
  const job = dbJob as DbJob;
  return {
    id: job._id,
    typeName: job.typeName,
    sequenceId: job.sequenceId,
    sequenceTypeName: job.sequenceTypeName,
    input: job.input,
    output: job.output,

    rootSequenceId: job.rootSequenceId,
    originId: job.originId,

    status: job.status,
    createdAt: job.createdAt,
    scheduledAt: job.scheduledAt,
    completedAt: job.completedAt,
    completedBy: job.completedBy,

    attempt: job.attempt,
    lastAttemptError: job.lastAttemptError,
    lastAttemptAt: job.lastAttemptAt,

    leasedBy: job.leasedBy,
    leasedUntil: job.leasedUntil,

    deduplicationKey: job.deduplicationKey,

    updatedAt: job.updatedAt,
  };
};

export const createMongoStateAdapter = async <
  TContext extends BaseStateAdapterContext,
  TIdType extends string = string,
>({
  stateProvider,
  connectionRetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    multiplier: 5.0,
    maxDelayMs: 10 * 1000,
  },
  isTransientError = isTransientMongoError,
  collectionName = "queuert_jobs",
  idGenerator = () => crypto.randomUUID() as TIdType,
}: {
  stateProvider: MongoStateProvider<TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  collectionName?: string;
  idGenerator?: () => TIdType;
}): Promise<
  StateAdapter<TContext, TIdType> & {
    migrateToLatest: (context: TContext) => Promise<void>;
    collectionName: string;
  }
> => {
  const withRetryWrapper = async <T>(fn: () => Promise<T>): Promise<T> => {
    return withRetry(fn, connectionRetryConfig, { isRetryableError: isTransientError });
  };

  const getCollection = (context: TContext): Collection<DbJob> => {
    return stateProvider.getCollection(context) as unknown as Collection<DbJob>;
  };

  return {
    collectionName,

    provideContext: async (fn) => stateProvider.provideContext(fn) as ReturnType<typeof fn>,
    runInTransaction: async (context, fn) =>
      stateProvider.runInTransaction(context, fn) as ReturnType<typeof fn>,
    isInTransaction: async (context) => stateProvider.isInTransaction(context),

    migrateToLatest: async (context) => {
      const collection = getCollection(context);

      // Create indexes
      await withRetryWrapper(async () => {
        // Job acquisition index
        await collection.createIndex(
          { typeName: 1, scheduledAt: 1 },
          { partialFilterExpression: { status: "pending" } },
        );

        // Sequence lookup index
        await collection.createIndex({ sequenceId: 1, createdAt: -1 });

        // Root lookup for cascading deletes
        await collection.createIndex({ rootSequenceId: 1 });

        // Deduplication lookup (use $type to filter non-null strings since $ne is not supported in partial indexes)
        await collection.createIndex(
          { deduplicationKey: 1, createdAt: -1 },
          { partialFilterExpression: { deduplicationKey: { $type: "string" } } },
        );

        // Expired lease detection
        await collection.createIndex(
          { typeName: 1, leasedUntil: 1 },
          { partialFilterExpression: { status: "running", leasedUntil: { $type: "date" } } },
        );

        // Blocker lookup
        await collection.createIndex({ "blockers.blockedBySequenceId": 1 });

        // Continuation uniqueness
        await collection.createIndex(
          { sequenceId: 1, originId: 1 },
          { unique: true, partialFilterExpression: { originId: { $type: "string" } } },
        );
      });
    },

    getJobSequenceById: async ({ context, jobId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        // Get root job
        const rootJob = await collection.findOne({ _id: jobId });
        if (!rootJob) return undefined;

        // Get last job in sequence
        const lastJob = await collection.findOne(
          { sequenceId: jobId },
          { sort: { createdAt: -1 } },
        );

        return [
          mapDbJobToStateJob(rootJob),
          lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
        ];
      });
    },

    getJobById: async ({ context, jobId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const job = await collection.findOne({ _id: jobId });
        return job ? mapDbJobToStateJob(job) : undefined;
      });
    },

    createJob: async ({
      context,
      typeName,
      sequenceId,
      sequenceTypeName,
      input,
      rootSequenceId,
      originId,
      deduplication,
      schedule,
    }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const newId = idGenerator();

        // Check for existing continuation or deduplicated job
        if ((sequenceId && originId) || deduplication) {
          const existingQuery = buildDeduplicationQuery(
            sequenceId as string | undefined,
            originId as string | undefined,
            deduplication,
          );

          if (existingQuery) {
            const existing = await collection.findOne(existingQuery, { sort: { createdAt: -1 } });
            if (existing) {
              return { job: mapDbJobToStateJob(existing), deduplicated: true };
            }
          }
        }

        // Use findOneAndUpdate with upsert to get server-side timestamps via $$NOW
        const scheduledAtExpr = schedule?.at
          ? { $literal: schedule.at }
          : { $add: ["$$NOW", schedule?.afterMs ?? 0] };

        const job = await collection.findOneAndUpdate(
          { _id: newId },
          [
            {
              $set: {
                _id: { $literal: newId },
                typeName: { $literal: typeName },
                sequenceId: { $literal: (sequenceId as string) ?? newId },
                sequenceTypeName: { $literal: sequenceTypeName },
                input: { $literal: input ?? null },
                output: null,

                rootSequenceId: { $literal: (rootSequenceId as string) ?? newId },
                originId: { $literal: (originId as string) ?? null },

                status: "pending",
                createdAt: "$$NOW",
                scheduledAt: scheduledAtExpr,
                completedAt: null,
                completedBy: null,

                attempt: 0,
                lastAttemptError: null,
                lastAttemptAt: null,

                leasedBy: null,
                leasedUntil: null,

                deduplicationKey: { $literal: deduplication?.key ?? null },

                updatedAt: "$$NOW",

                blockers: [],
              },
            },
          ],
          { upsert: true, returnDocument: "after" },
        );

        return { job: mapDbJobToStateJob(job!), deduplicated: false };
      });
    },

    addJobBlockers: async ({ context, jobId, blockedBySequenceIds }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        // Add blockers to the job
        const blockers = blockedBySequenceIds.map((id, index) => ({
          blockedBySequenceId: id as string,
          index,
        }));

        await collection.updateOne({ _id: jobId }, { $push: { blockers: { $each: blockers } } });

        // Check status of each blocker
        const incompleteBlockerSequenceIds: string[] = [];

        for (const blocker of blockers) {
          // Get the last job in the blocker sequence
          const lastBlockerJob = await collection.findOne(
            { sequenceId: blocker.blockedBySequenceId },
            { sort: { createdAt: -1 } },
          );

          if (!lastBlockerJob || lastBlockerJob.status !== "completed") {
            incompleteBlockerSequenceIds.push(blocker.blockedBySequenceId);
          }
        }

        // If there are incomplete blockers, update status to blocked
        if (incompleteBlockerSequenceIds.length > 0) {
          const updatedJob = await collection.findOneAndUpdate(
            { _id: jobId, status: "pending" },
            { $set: { status: "blocked", updatedAt: new Date() } },
            { returnDocument: "after" },
          );

          if (updatedJob) {
            return { job: mapDbJobToStateJob(updatedJob), incompleteBlockerSequenceIds };
          }
        }

        const job = await collection.findOne({ _id: jobId });
        return { job: mapDbJobToStateJob(job!), incompleteBlockerSequenceIds: [] };
      });
    },

    scheduleBlockedJobs: async ({ context, blockedBySequenceId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        // Find all jobs that have this sequence as a blocker
        const blockedJobs = await collection
          .find({
            "blockers.blockedBySequenceId": blockedBySequenceId,
            status: "blocked",
          })
          .toArray();

        const scheduledJobs: StateJob[] = [];

        for (const blockedJob of blockedJobs) {
          const dbJob = blockedJob as unknown as DbJob;
          // Check if all blockers are completed
          let allBlockersCompleted = true;

          for (const blocker of dbJob.blockers) {
            const lastBlockerJob = await collection.findOne(
              { sequenceId: blocker.blockedBySequenceId },
              { sort: { createdAt: -1 } },
            );

            if (!lastBlockerJob || lastBlockerJob.status !== "completed") {
              allBlockersCompleted = false;
              break;
            }
          }

          if (allBlockersCompleted) {
            // Use aggregation pipeline for server-side date computation with $$NOW
            const updatedJob = await collection.findOneAndUpdate(
              { _id: dbJob._id, status: "blocked" },
              [{ $set: { status: "pending", scheduledAt: "$$NOW", updatedAt: "$$NOW" } }],
              { returnDocument: "after" },
            );

            if (updatedJob) {
              scheduledJobs.push(mapDbJobToStateJob(updatedJob));
            }
          }
        }

        return scheduledJobs;
      });
    },

    getJobBlockers: async ({ context, jobId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const job = await collection.findOne({ _id: jobId });
        if (!job) return [];

        const dbJob = job as unknown as DbJob;
        const result: [StateJob, StateJob | undefined][] = [];

        // Sort blockers by index
        const sortedBlockers = [...dbJob.blockers].sort((a, b) => a.index - b.index);

        for (const blocker of sortedBlockers) {
          // Get root job of blocker sequence
          const rootJob = await collection.findOne({ _id: blocker.blockedBySequenceId });
          if (!rootJob) continue;

          // Get last job in sequence
          const lastJob = await collection.findOne(
            { sequenceId: blocker.blockedBySequenceId },
            { sort: { createdAt: -1 } },
          );

          result.push([
            mapDbJobToStateJob(rootJob),
            lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
          ]);
        }

        return result;
      });
    },

    getNextJobAvailableInMs: async ({ context, typeNames }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const job = await collection.findOne(
          {
            typeName: { $in: typeNames },
            status: "pending",
          },
          { sort: { scheduledAt: 1 }, projection: { scheduledAt: 1 } },
        );

        if (!job) return null;

        const scheduledAt = (job as unknown as DbJob).scheduledAt;
        const now = new Date();
        const diff = scheduledAt.getTime() - now.getTime();

        return Math.max(0, diff);
      });
    },

    acquireJob: async ({ context, typeNames }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);

        // Use aggregation pipeline for server-side date computation with $$NOW
        const job = await collection.findOneAndUpdate(
          {
            typeName: { $in: typeNames },
            status: "pending",
            scheduledAt: { $lte: new Date() },
          },
          [
            {
              $set: {
                status: "running",
                updatedAt: "$$NOW",
                attempt: { $add: ["$attempt", 1] },
              },
            },
          ],
          { sort: { scheduledAt: 1 }, returnDocument: "after" },
        );

        return job ? mapDbJobToStateJob(job) : undefined;
      });
    },

    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);

        // Use aggregation pipeline for server-side date computation with $$NOW
        const job = await collection.findOneAndUpdate(
          { _id: jobId },
          [
            {
              $set: {
                leasedBy: { $literal: workerId },
                leasedUntil: { $add: ["$$NOW", leaseDurationMs] },
                status: "running",
                updatedAt: "$$NOW",
              },
            },
          ],
          { returnDocument: "after" },
        );

        return mapDbJobToStateJob(job!);
      });
    },

    rescheduleJob: async ({ context, jobId, schedule, error }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);

        // Use aggregation pipeline for server-side date computation with $$NOW
        const job = await collection.findOneAndUpdate(
          { _id: jobId },
          [
            {
              $set: {
                scheduledAt: schedule.at
                  ? { $literal: schedule.at }
                  : { $add: ["$$NOW", schedule.afterMs] },
                lastAttemptAt: "$$NOW",
                lastAttemptError: { $literal: error },
                leasedBy: null,
                leasedUntil: null,
                status: "pending",
                updatedAt: "$$NOW",
              },
            },
          ],
          { returnDocument: "after" },
        );

        return mapDbJobToStateJob(job!);
      });
    },

    completeJob: async ({ context, jobId, output, workerId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);

        // Use aggregation pipeline for server-side date computation with $$NOW
        const job = await collection.findOneAndUpdate(
          { _id: jobId },
          [
            {
              $set: {
                status: "completed",
                completedAt: "$$NOW",
                completedBy: { $literal: workerId },
                output: { $literal: output ?? null },
                leasedBy: null,
                leasedUntil: null,
                updatedAt: "$$NOW",
              },
            },
          ],
          { returnDocument: "after" },
        );

        return mapDbJobToStateJob(job!);
      });
    },

    removeExpiredJobLease: async ({ context, typeNames }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);

        // Use aggregation pipeline for server-side date computation with $$NOW
        const job = await collection.findOneAndUpdate(
          {
            typeName: { $in: typeNames },
            status: "running",
            leasedUntil: { $lt: new Date(), $ne: null },
          },
          [
            {
              $set: {
                leasedBy: null,
                leasedUntil: null,
                status: "pending",
                updatedAt: "$$NOW",
              },
            },
          ],
          { sort: { leasedUntil: 1 }, returnDocument: "after" },
        );

        return job ? mapDbJobToStateJob(job) : undefined;
      });
    },

    getExternalBlockers: async ({ context, rootSequenceIds }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const rootSequenceIdSet = new Set(rootSequenceIds as string[]);

        // Find all jobs in the given roots
        const jobsInRoots = await collection
          .find(
            { rootSequenceId: { $in: rootSequenceIds as string[] } },
            { projection: { _id: 1 } },
          )
          .toArray();
        const jobIdsInRoots = new Set(jobsInRoots.map((j) => j._id));

        // Find jobs outside these roots that have blockers pointing to jobs in these roots
        const externalJobs = await collection
          .find({
            rootSequenceId: { $nin: rootSequenceIds as string[] },
            "blockers.blockedBySequenceId": { $in: Array.from(jobIdsInRoots) },
          })
          .toArray();

        const result: { jobId: TIdType; blockedRootSequenceId: TIdType }[] = [];

        for (const externalJob of externalJobs) {
          for (const blocker of externalJob.blockers) {
            if (jobIdsInRoots.has(blocker.blockedBySequenceId)) {
              // Find the root of this blocker
              const blockerJob = await collection.findOne({ _id: blocker.blockedBySequenceId });
              if (blockerJob && rootSequenceIdSet.has(blockerJob.rootSequenceId)) {
                result.push({
                  jobId: externalJob._id as TIdType,
                  blockedRootSequenceId: blockerJob.rootSequenceId as TIdType,
                });
              }
            }
          }
        }

        return result;
      });
    },

    deleteJobsByRootSequenceIds: async ({ context, rootSequenceIds }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        // First get all jobs that will be deleted
        const jobs = await collection
          .find({ rootSequenceId: { $in: rootSequenceIds as string[] } })
          .toArray();

        // Delete them
        await collection.deleteMany({ rootSequenceId: { $in: rootSequenceIds as string[] } });

        return jobs.map(mapDbJobToStateJob);
      });
    },

    getJobForUpdate: async ({ context, jobId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        // In MongoDB, within a transaction, reads are consistent
        // There's no explicit FOR UPDATE, but the transaction provides isolation
        const job = await collection.findOne({ _id: jobId });
        return job ? mapDbJobToStateJob(job) : undefined;
      });
    },

    getCurrentJobForUpdate: async ({ context, sequenceId }) => {
      return withRetryWrapper(async () => {
        const collection = getCollection(context);
        const job = await collection.findOne({ sequenceId }, { sort: { createdAt: -1 } });
        return job ? mapDbJobToStateJob(job) : undefined;
      });
    },
  };
};

function buildDeduplicationQuery(
  sequenceId: string | undefined,
  originId: string | undefined,
  deduplication: DeduplicationOptions | undefined,
): Document | null {
  const conditions: Document[] = [];

  // Check for existing continuation
  if (sequenceId && originId) {
    conditions.push({ sequenceId, originId });
  }

  // Check for deduplication
  if (deduplication) {
    const dedupCondition: Document = {
      deduplicationKey: deduplication.key,
      $expr: { $eq: ["$_id", "$sequenceId"] }, // First job in sequence
    };

    // Apply strategy filter
    if (deduplication.strategy === "completed") {
      dedupCondition.status = { $ne: "completed" };
    }
    // "all" strategy matches any status

    // Apply time window
    if (deduplication.windowMs !== undefined) {
      const windowStart = new Date(Date.now() - deduplication.windowMs);
      dedupCondition.createdAt = { $gte: windowStart };
    }

    conditions.push(dedupCondition);
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { $or: conditions };
}

export type MongoStateAdapter<TContext extends BaseStateAdapterContext, TJobId> = StateAdapter<
  TContext,
  TJobId
>;
