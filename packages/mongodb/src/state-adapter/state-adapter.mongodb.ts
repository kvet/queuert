import { Collection, type Document, type WithId } from "mongodb";
import {
  BaseStateAdapterContext,
  type DeduplicationOptions,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { wrapStateAdapterWithRetry } from "queuert/internal";
import { MongoStateProvider } from "../state-provider/state-provider.mongodb.js";
import { isTransientMongoError } from "./errors.js";

type JobStatus = "blocked" | "pending" | "running" | "completed";

type DbJob = {
  _id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  input: unknown;
  output: unknown;

  rootChainId: string;
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

  blockers: Array<{ blockedByChainId: string; index: number }>;
};

const mapDbJobToStateJob = (dbJob: WithId<Document> | DbJob): StateJob => {
  const job = dbJob as DbJob;
  return {
    id: job._id,
    typeName: job.typeName,
    chainId: job.chainId,
    chainTypeName: job.chainTypeName,
    input: job.input,
    output: job.output,

    rootChainId: job.rootChainId,
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
  TTxContext extends BaseStateAdapterContext,
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
  idGenerator = () => crypto.randomUUID() as TIdType,
}: {
  stateProvider: MongoStateProvider<TTxContext, TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  idGenerator?: () => TIdType;
}): Promise<
  StateAdapter<TTxContext, TContext, TIdType> & {
    migrateToLatest: () => Promise<void>;
  }
> => {
  const getCollection = (context: TTxContext | TContext): Collection<DbJob> => {
    return stateProvider.getCollection(context) as unknown as Collection<DbJob>;
  };

  const rawAdapter: StateAdapter<TTxContext, TContext, TIdType> = {
    provideContext: stateProvider.provideContext,
    runInTransaction: stateProvider.runInTransaction,
    isInTransaction: stateProvider.isInTransaction,

    getJobChainById: async ({ context, jobId }) => {
      const collection = getCollection(context);
      // Get root job
      const rootJob = await collection.findOne({ _id: jobId });
      if (!rootJob) return undefined;

      // Get last job in chain
      const lastJob = await collection.findOne({ chainId: jobId }, { sort: { createdAt: -1 } });

      return [
        mapDbJobToStateJob(rootJob),
        lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
      ];
    },

    getJobById: async ({ context, jobId }) => {
      const collection = getCollection(context);
      const job = await collection.findOne({ _id: jobId });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({
      context,
      typeName,
      chainId,
      chainTypeName,
      input,
      rootChainId,
      originId,
      deduplication,
      schedule,
    }) => {
      const collection = getCollection(context);
      const newId = idGenerator();

      // Check for existing continuation or deduplicated job
      if ((chainId && originId) || deduplication) {
        const existingQuery = buildDeduplicationQuery(
          chainId as string | undefined,
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
              chainId: { $literal: (chainId as string) ?? newId },
              chainTypeName: { $literal: chainTypeName },
              input: { $literal: input ?? null },
              output: null,

              rootChainId: { $literal: (rootChainId as string) ?? newId },
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
    },

    addJobBlockers: async ({ context, jobId, blockedByChainIds }) => {
      const collection = getCollection(context);
      // Add blockers to the job
      const blockers = blockedByChainIds.map((id, index) => ({
        blockedByChainId: id as string,
        index,
      }));

      await collection.updateOne({ _id: jobId }, { $push: { blockers: { $each: blockers } } });

      // Check status of each blocker
      const incompleteBlockerChainIds: string[] = [];

      for (const blocker of blockers) {
        // Get the last job in the blocker chain
        const lastBlockerJob = await collection.findOne(
          { chainId: blocker.blockedByChainId },
          { sort: { createdAt: -1 } },
        );

        if (!lastBlockerJob || lastBlockerJob.status !== "completed") {
          incompleteBlockerChainIds.push(blocker.blockedByChainId);
        }
      }

      // If there are incomplete blockers, update status to blocked
      if (incompleteBlockerChainIds.length > 0) {
        const updatedJob = await collection.findOneAndUpdate(
          { _id: jobId, status: "pending" },
          { $set: { status: "blocked", updatedAt: new Date() } },
          { returnDocument: "after" },
        );

        if (updatedJob) {
          return { job: mapDbJobToStateJob(updatedJob), incompleteBlockerChainIds };
        }
      }

      const job = await collection.findOne({ _id: jobId });
      return { job: mapDbJobToStateJob(job!), incompleteBlockerChainIds: [] };
    },

    scheduleBlockedJobs: async ({ context, blockedByChainId }) => {
      const collection = getCollection(context);
      // Find all jobs that have this chain as a blocker
      const blockedJobs = await collection
        .find({
          "blockers.blockedByChainId": blockedByChainId,
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
            { chainId: blocker.blockedByChainId },
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
    },

    getJobBlockers: async ({ context, jobId }) => {
      const collection = getCollection(context);
      const job = await collection.findOne({ _id: jobId });
      if (!job) return [];

      const dbJob = job as unknown as DbJob;
      const result: [StateJob, StateJob | undefined][] = [];

      // Sort blockers by index
      const sortedBlockers = [...dbJob.blockers].sort((a, b) => a.index - b.index);

      for (const blocker of sortedBlockers) {
        // Get root job of blocker chain
        const rootJob = await collection.findOne({ _id: blocker.blockedByChainId });
        if (!rootJob) continue;

        // Get last job in chain
        const lastJob = await collection.findOne(
          { chainId: blocker.blockedByChainId },
          { sort: { createdAt: -1 } },
        );

        result.push([
          mapDbJobToStateJob(rootJob),
          lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
        ]);
      }

      return result;
    },

    getNextJobAvailableInMs: async ({ context, typeNames }) => {
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
    },

    acquireJob: async ({ context, typeNames }) => {
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
    },

    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
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
    },

    rescheduleJob: async ({ context, jobId, schedule, error }) => {
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
    },

    completeJob: async ({ context, jobId, output, workerId }) => {
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
    },

    removeExpiredJobLease: async ({ context, typeNames }) => {
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
    },

    getExternalBlockers: async ({ context, rootChainIds }) => {
      const collection = getCollection(context);
      const rootChainIdSet = new Set(rootChainIds as string[]);

      // Find all jobs in the given roots
      const jobsInRoots = await collection
        .find({ rootChainId: { $in: rootChainIds as string[] } }, { projection: { _id: 1 } })
        .toArray();
      const jobIdsInRoots = new Set(jobsInRoots.map((j) => j._id));

      // Find jobs outside these roots that have blockers pointing to jobs in these roots
      const externalJobs = await collection
        .find({
          rootChainId: { $nin: rootChainIds as string[] },
          "blockers.blockedByChainId": { $in: Array.from(jobIdsInRoots) },
        })
        .toArray();

      const result: { jobId: TIdType; blockedRootChainId: TIdType }[] = [];

      for (const externalJob of externalJobs) {
        for (const blocker of externalJob.blockers) {
          if (jobIdsInRoots.has(blocker.blockedByChainId)) {
            // Find the root of this blocker
            const blockerJob = await collection.findOne({ _id: blocker.blockedByChainId });
            if (blockerJob && rootChainIdSet.has(blockerJob.rootChainId)) {
              result.push({
                jobId: externalJob._id as TIdType,
                blockedRootChainId: blockerJob.rootChainId as TIdType,
              });
            }
          }
        }
      }

      return result;
    },

    deleteJobsByRootChainIds: async ({ context, rootChainIds }) => {
      const collection = getCollection(context);
      // First get all jobs that will be deleted
      const jobs = await collection
        .find({ rootChainId: { $in: rootChainIds as string[] } })
        .toArray();

      // Delete them
      await collection.deleteMany({ rootChainId: { $in: rootChainIds as string[] } });

      return jobs.map(mapDbJobToStateJob);
    },

    getJobForUpdate: async ({ context, jobId }) => {
      const collection = getCollection(context);
      // In MongoDB, within a transaction, reads are consistent
      // There's no explicit FOR UPDATE, but the transaction provides isolation
      const job = await collection.findOne({ _id: jobId });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    getCurrentJobForUpdate: async ({ context, chainId }) => {
      const collection = getCollection(context);
      const job = await collection.findOne({ chainId }, { sort: { createdAt: -1 } });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
  };

  return {
    ...wrapStateAdapterWithRetry({
      stateAdapter: rawAdapter,
      retryConfig: connectionRetryConfig,
      isRetryableError: isTransientError,
    }),
    migrateToLatest: async () => {
      await stateProvider.provideContext(async (context) => {
        const collection = getCollection(context);

        // Create indexes
        // Job acquisition index
        await collection.createIndex(
          { typeName: 1, scheduledAt: 1 },
          { partialFilterExpression: { status: "pending" } },
        );

        // Chain lookup index
        await collection.createIndex({ chainId: 1, createdAt: -1 });

        // Root lookup for cascading deletes
        await collection.createIndex({ rootChainId: 1 });

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
        await collection.createIndex({ "blockers.blockedByChainId": 1 });

        // Continuation uniqueness
        await collection.createIndex(
          { chainId: 1, originId: 1 },
          { unique: true, partialFilterExpression: { originId: { $type: "string" } } },
        );
      });
    },
  };
};

function buildDeduplicationQuery(
  chainId: string | undefined,
  originId: string | undefined,
  deduplication: DeduplicationOptions | undefined,
): Document | null {
  const conditions: Document[] = [];

  // Check for existing continuation
  if (chainId && originId) {
    conditions.push({ chainId, originId });
  }

  // Check for deduplication
  if (deduplication) {
    const dedupCondition: Document = {
      deduplicationKey: deduplication.key,
      $expr: { $eq: ["$_id", "$chainId"] }, // First job in chain
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

export type MongoStateAdapter<
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TContext, TJobId>;
