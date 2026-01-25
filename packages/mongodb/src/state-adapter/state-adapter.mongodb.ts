import { type Collection, type Document, type WithId } from "mongodb";
import {
  type BaseTxContext,
  type DeduplicationOptions,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { wrapStateAdapterWithRetry } from "queuert/internal";
import { type MongoStateProvider } from "../state-provider/state-provider.mongodb.js";
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

  blockers: { blockedByChainId: string; index: number }[];
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
  TTxContext extends BaseTxContext,
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
  stateProvider: MongoStateProvider<TTxContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  idGenerator?: () => TIdType;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<void>;
  }
> => {
  const getCollection = (): Collection<DbJob> =>
    stateProvider.getCollection() as unknown as Collection<DbJob>;

  const getSession = (txContext: TTxContext | undefined) => stateProvider.getSession(txContext);

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    runInTransaction: stateProvider.runInTransaction,

    getJobChainById: async ({ txContext, jobId }) => {
      const collection = getCollection();
      const rootJob = await collection.findOne({ _id: jobId }, { session: getSession(txContext) });
      if (!rootJob) return undefined;

      const lastJob = await collection.findOne(
        { chainId: jobId },
        { sort: { createdAt: -1 }, session: getSession(txContext) },
      );

      return [
        mapDbJobToStateJob(rootJob),
        lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
      ];
    },

    getJobById: async ({ txContext, jobId }) => {
      const collection = getCollection();
      const job = await collection.findOne({ _id: jobId }, { session: getSession(txContext) });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({
      txContext,
      typeName,
      chainId,
      chainTypeName,
      input,
      rootChainId,
      originId,
      deduplication,
      schedule,
    }) => {
      const collection = getCollection();
      const newId = idGenerator();

      if ((chainId && originId) || deduplication) {
        const existingQuery = buildDeduplicationQuery(
          chainId as string | undefined,
          originId as string | undefined,
          deduplication,
        );

        if (existingQuery) {
          const existing = await collection.findOne(existingQuery, {
            sort: { createdAt: -1 },
            session: getSession(txContext),
          });
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
        { upsert: true, returnDocument: "after", session: getSession(txContext) },
      );

      return { job: mapDbJobToStateJob(job!), deduplicated: false };
    },

    addJobBlockers: async ({ txContext, jobId, blockedByChainIds }) => {
      const collection = getCollection();
      const blockers = blockedByChainIds.map((id, index) => ({
        blockedByChainId: id as string,
        index,
      }));

      await collection.updateOne(
        { _id: jobId },
        { $push: { blockers: { $each: blockers } } },
        { session: getSession(txContext) },
      );

      const incompleteBlockerChainIds: string[] = [];

      for (const blocker of blockers) {
        const lastBlockerJob = await collection.findOne(
          { chainId: blocker.blockedByChainId },
          { sort: { createdAt: -1 }, session: getSession(txContext) },
        );

        if (!lastBlockerJob || lastBlockerJob.status !== "completed") {
          incompleteBlockerChainIds.push(blocker.blockedByChainId);
        }
      }

      if (incompleteBlockerChainIds.length > 0) {
        const updatedJob = await collection.findOneAndUpdate(
          { _id: jobId, status: "pending" },
          { $set: { status: "blocked", updatedAt: new Date() } },
          { returnDocument: "after", session: getSession(txContext) },
        );

        if (updatedJob) {
          return { job: mapDbJobToStateJob(updatedJob), incompleteBlockerChainIds };
        }
      }

      const job = await collection.findOne({ _id: jobId }, { session: getSession(txContext) });
      return { job: mapDbJobToStateJob(job!), incompleteBlockerChainIds: [] };
    },

    scheduleBlockedJobs: async ({ txContext, blockedByChainId }) => {
      const collection = getCollection();
      const blockedJobs = await collection
        .find(
          {
            "blockers.blockedByChainId": blockedByChainId,
            status: "blocked",
          },
          { session: getSession(txContext) },
        )
        .toArray();

      const scheduledJobs: StateJob[] = [];

      for (const blockedJob of blockedJobs) {
        const dbJob = blockedJob as unknown as DbJob;
        let allBlockersCompleted = true;

        for (const blocker of dbJob.blockers) {
          const lastBlockerJob = await collection.findOne(
            { chainId: blocker.blockedByChainId },
            { sort: { createdAt: -1 }, session: getSession(txContext) },
          );

          if (!lastBlockerJob || lastBlockerJob.status !== "completed") {
            allBlockersCompleted = false;
            break;
          }
        }

        if (allBlockersCompleted) {
          const updatedJob = await collection.findOneAndUpdate(
            { _id: dbJob._id, status: "blocked" },
            [{ $set: { status: "pending", scheduledAt: "$$NOW", updatedAt: "$$NOW" } }],
            { returnDocument: "after", session: getSession(txContext) },
          );

          if (updatedJob) {
            scheduledJobs.push(mapDbJobToStateJob(updatedJob));
          }
        }
      }

      return scheduledJobs;
    },

    getJobBlockers: async ({ txContext, jobId }) => {
      const collection = getCollection();
      const job = await collection.findOne({ _id: jobId }, { session: getSession(txContext) });
      if (!job) return [];

      const dbJob = job as unknown as DbJob;
      const result: [StateJob, StateJob | undefined][] = [];
      const sortedBlockers = [...dbJob.blockers].sort((a, b) => a.index - b.index);

      for (const blocker of sortedBlockers) {
        const rootJob = await collection.findOne(
          { _id: blocker.blockedByChainId },
          { session: getSession(txContext) },
        );
        if (!rootJob) continue;

        const lastJob = await collection.findOne(
          { chainId: blocker.blockedByChainId },
          { sort: { createdAt: -1 }, session: getSession(txContext) },
        );

        result.push([
          mapDbJobToStateJob(rootJob),
          lastJob && lastJob._id !== rootJob._id ? mapDbJobToStateJob(lastJob) : undefined,
        ]);
      }

      return result;
    },

    getNextJobAvailableInMs: async ({ txContext, typeNames }) => {
      const collection = getCollection();
      const job = await collection.findOne(
        {
          typeName: { $in: typeNames },
          status: "pending",
        },
        {
          sort: { scheduledAt: 1 },
          projection: { scheduledAt: 1 },
          session: getSession(txContext),
        },
      );

      if (!job) return null;

      const scheduledAt = (job as unknown as DbJob).scheduledAt;
      const now = new Date();
      const diff = scheduledAt.getTime() - now.getTime();

      return Math.max(0, diff);
    },

    acquireJob: async ({ txContext, typeNames }) => {
      const collection = getCollection();

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
        { sort: { scheduledAt: 1 }, returnDocument: "after", session: getSession(txContext) },
      );

      const [nextJob] = await collection
        .aggregate(
          [
            {
              $match: {
                typeName: { $in: typeNames },
                status: "pending",
                $expr: { $lte: ["$scheduledAt", "$$NOW"] },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          { session: getSession(txContext) },
        )
        .toArray();
      const hasMore = nextJob !== undefined;

      return job ? { job: mapDbJobToStateJob(job), hasMore } : { job: undefined, hasMore };
    },

    renewJobLease: async ({ txContext, jobId, workerId, leaseDurationMs }) => {
      const collection = getCollection();

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
        { returnDocument: "after", session: getSession(txContext) },
      );

      return mapDbJobToStateJob(job!);
    },

    rescheduleJob: async ({ txContext, jobId, schedule, error }) => {
      const collection = getCollection();

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
        { returnDocument: "after", session: getSession(txContext) },
      );

      return mapDbJobToStateJob(job!);
    },

    completeJob: async ({ txContext, jobId, output, workerId }) => {
      const collection = getCollection();

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
        { returnDocument: "after", session: getSession(txContext) },
      );

      return mapDbJobToStateJob(job!);
    },

    removeExpiredJobLease: async ({ txContext, typeNames }) => {
      const collection = getCollection();

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
        { sort: { leasedUntil: 1 }, returnDocument: "after", session: getSession(txContext) },
      );

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    getExternalBlockers: async ({ txContext, rootChainIds }) => {
      const collection = getCollection();
      const rootChainIdSet = new Set(rootChainIds as string[]);

      const jobsInRoots = await collection
        .find(
          { rootChainId: { $in: rootChainIds as string[] } },
          { projection: { _id: 1 }, session: getSession(txContext) },
        )
        .toArray();
      const jobIdsInRoots = new Set(jobsInRoots.map((j) => j._id));

      const externalJobs = await collection
        .find(
          {
            rootChainId: { $nin: rootChainIds as string[] },
            "blockers.blockedByChainId": { $in: Array.from(jobIdsInRoots) },
          },
          { session: getSession(txContext) },
        )
        .toArray();

      const result: { jobId: TIdType; blockedRootChainId: TIdType }[] = [];

      for (const externalJob of externalJobs) {
        for (const blocker of externalJob.blockers) {
          if (jobIdsInRoots.has(blocker.blockedByChainId)) {
            const blockerJob = await collection.findOne(
              { _id: blocker.blockedByChainId },
              { session: getSession(txContext) },
            );
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

    deleteJobsByRootChainIds: async ({ txContext, rootChainIds }) => {
      const collection = getCollection();
      const jobs = await collection
        .find(
          { rootChainId: { $in: rootChainIds as string[] } },
          { session: getSession(txContext) },
        )
        .toArray();

      await collection.deleteMany(
        { rootChainId: { $in: rootChainIds as string[] } },
        { session: getSession(txContext) },
      );

      return jobs.map(mapDbJobToStateJob);
    },

    getJobForUpdate: async ({ txContext, jobId }) => {
      const collection = getCollection();
      const job = await collection.findOne({ _id: jobId }, { session: getSession(txContext) });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    getCurrentJobForUpdate: async ({ txContext, chainId }) => {
      const collection = getCollection();
      const job = await collection.findOne(
        { chainId },
        { sort: { createdAt: -1 }, session: getSession(txContext) },
      );
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
      const collection = getCollection();

      await collection.createIndex(
        { typeName: 1, scheduledAt: 1 },
        { partialFilterExpression: { status: "pending" } },
      );

      await collection.createIndex({ chainId: 1, createdAt: -1 });
      await collection.createIndex({ rootChainId: 1 });

      await collection.createIndex(
        { deduplicationKey: 1, createdAt: -1 },
        { partialFilterExpression: { deduplicationKey: { $type: "string" } } },
      );

      await collection.createIndex(
        { typeName: 1, leasedUntil: 1 },
        { partialFilterExpression: { status: "running", leasedUntil: { $type: "date" } } },
      );

      await collection.createIndex({ "blockers.blockedByChainId": 1 });

      await collection.createIndex(
        { chainId: 1, originId: 1 },
        { unique: true, partialFilterExpression: { originId: { $type: "string" } } },
      );
    },
  };
};

const buildDeduplicationQuery = (
  chainId: string | undefined,
  originId: string | undefined,
  deduplication: DeduplicationOptions | undefined,
): Document | null => {
  const conditions: Document[] = [];

  if (chainId && originId) {
    conditions.push({ chainId, originId });
  }

  if (deduplication) {
    const dedupCondition: Document = {
      deduplicationKey: deduplication.key,
      $expr: { $eq: ["$_id", "$chainId"] },
    };

    if (deduplication.strategy === "completed") {
      dedupCondition.status = { $ne: "completed" };
    }

    if (deduplication.windowMs !== undefined) {
      const windowStart = new Date(Date.now() - deduplication.windowMs);
      dedupCondition.createdAt = { $gte: windowStart };
    }

    conditions.push(dedupCondition);
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { $or: conditions };
};

export type MongoStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TJobId>;
