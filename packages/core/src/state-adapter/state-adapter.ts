import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type OrderDirection, type Page, type PageParams } from "../entities/pagination.js";
import { type ScheduleOptions } from "../entities/schedule.js";

export type StateJobStatus = "blocked" | "pending" | "running" | "completed";

export type StateChainStatus = "running" | "completed";

export type StateJobInfo = {
  id: string;
  typeName: string;
  chainId: string;
  chainIndex: number;
  status: StateJobStatus;
  createdAt: Date;
  input: unknown;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  continuedToId: string | null;
  output: unknown;
  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;
  attemptAt: Date | null;
  attemptBy: string | null;
  attemptUntil: Date | null;
  traceContext: string | null;
};

export type StateChainInfo = {
  id: string;
  typeName: string;
  status: StateChainStatus;
  deduplicationKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
  traceContext: string | null;
};

export type StateJobBlockerInfo = {
  jobId: string;
  blockedByChainId: string;
  index: number;
  traceContext: string | null;
};

export type StateChain = StateChainInfo & { head: StateJobInfo; tail: StateJobInfo | undefined };
export type StateJob = StateJobInfo & { chain: StateChainInfo };
export type StateBlockedJob = StateJobBlockerInfo & { job: StateJobInfo };
export type StateDependentJob = StateJobBlockerInfo & { job: StateJob };

export type StateCount = { count: number; hasMore: boolean };

/**
 * How a state adapter was configured, with defaults applied. Core reads it to generate and
 * validate job IDs and to enforce the blocker limit before any state is written.
 *
 * @typeParam TJobId - The job ID type
 */
export type StateAdapterConfig<TJobId extends string> = {
  /** Generates the ID of a job created without a caller-supplied one. */
  generateId: () => TJobId;
  /**
   * Returns `true` if the ID is acceptable. Core runs it on generated and caller-supplied IDs
   * and throws `InvalidJobIdError` on failure.
   */
  validateId: (id: TJobId) => boolean;
  /**
   * Most blocker chains a single job may declare. Core rejects a job declaring more with
   * `BlockerLimitExceededError`.
   */
  maxBlockersPerJob: number;
  /**
   * Per-type, per-status count at which `countByChainTypeNames` and `countByJobTypeNames` stop
   * counting and report `hasMore: true`.
   */
  countCap: number;
};

/** Whether a state adapter returns results directly (`"sync"`) or as promises (`"async"`). */
export type StateAdapterMode = "sync" | "async";

/** A result returned directly in sync mode and as a promise in async mode. */
export type StateResult<TMode extends StateAdapterMode, T> = TMode extends "sync" ? T : Promise<T>;

/** Base type for state adapter contexts. */
export type BaseTxContext = Record<string, unknown>;

type AutocommitTxContextParam<TTxContext extends BaseTxContext> = { txCtx?: TTxContext };
type TransactionTxContextParam<TTxContext extends BaseTxContext> = { txCtx: TTxContext };

/** Matches only a `running` job in exactly this attempt, held by this worker. */
export type StateAttemptFence = { attempt: number; workerId: string };

/**
 * Abstracts database operations for job persistence.
 *
 * An adapter never throws Queuert's domain errors: an absent or already completed row is
 * reported as `undefined` in the result position it belongs to, and the caller decides which
 * error the user sees. Adapters still throw for driver errors and connection loss.
 *
 * @typeParam TTxContext - The transaction context type
 * @typeParam TJobId - The job ID type
 * @typeParam TMode - Whether data methods return results directly or as promises
 */
export type StateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TMode extends StateAdapterMode = "async",
> = {
  /** How the adapter was configured, with defaults applied. */
  config: Readonly<StateAdapterConfig<TJobId>>;

  /**
   * Whether every data method returns its result directly (`"sync"`) or as a promise
   * (`"async"`). Fixed at construction.
   */
  mode: TMode;

  /**
   * Executes a callback within a transaction. Commits on success, rolls back on error. In sync
   * mode the callback must be synchronous.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => StateResult<TMode, T>) => StateResult<TMode, T>;

  /**
   * Whether `txCtx` is inside an open transaction. Must be synchronous and must not query the
   * database.
   */
  isTransaction: (txCtx: TTxContext) => boolean;

  /**
   * Gets chains by their IDs, in input order, `undefined` for missing chains. Pass
   * `lock: "exclusive"` to acquire a write-intent lock on each chain's head row.
   */
  getChains: (
    params: { chainIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => StateResult<TMode, (StateChain | undefined)[]>;

  /**
   * Gets jobs by their IDs, with their chains, in input order, `undefined` for missing
   * jobs. Pass `lock: "exclusive"` to acquire a write-intent lock on each job **and its
   * chain's head row**, in a consistent id order.
   */
  getJobs: (
    params: { jobIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => StateResult<TMode, (StateJob | undefined)[]>;

  /** Creates chain heads. Deduplicated matches return `deduplicated: true`. */
  createJobs: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      deduplication?: DeduplicationOptions;
      traceContext?: string | null;
      chainTraceContext?: string | null;
    }[];
  }) => StateResult<TMode, (StateChain & { deduplicated: boolean })[]>;

  /**
   * Completes each `continueFromId` and inserts its chain successor, linking the two. Each
   * result is the completed predecessor, with its successor under `continuation`. Results are
   * in input order, `undefined` for an id with no matching job, one already completed, or one
   * that misses its `fence`. A colliding id or an already taken chain position still throws.
   */
  continueJobs: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      traceContext?: string | null;
      continueFromId: TJobId;
      fence?: StateAttemptFence;
    }[];
  }) => StateResult<TMode, ((StateJob & { continuation: StateJobInfo }) | undefined)[]>;

  /**
   * Completes each job with its terminal output, ending its chain and setting the chain's
   * `completedAt`. Results are in input order, `undefined` for an id with no matching job, one
   * already completed, or one that does not match its `fence`.
   */
  completeJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        output: unknown;
        fence?: StateAttemptFence;
      }[];
    } & TransactionTxContextParam<TTxContext>,
  ) => StateResult<TMode, (StateJob | undefined)[]>;

  /**
   * Returns jobs to pending, clearing any running attempt. A blocked job keeps its
   * `blocked` status and only moves its `scheduledAt`. Skips ids that are missing, completed, or
   * miss their `fence`.
   */
  rescheduleJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        schedule?: ScheduleOptions;
        error?: string;
        fence?: StateAttemptFence;
      }[];
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, (StateJob | undefined)[]>;

  /**
   * Deletes all jobs in the given chains atomically, returning each deleted chain in input
   * order, `undefined` for missing chains. If any chain is referenced as a blocker by a job
   * outside the set, nothing is deleted: that chain's position holds the referencing
   * `StateBlockedJob[]` and every other position is `undefined`.
   */
  deleteChains: (
    params: { chainIds: TJobId[] } & TransactionTxContextParam<TTxContext>,
  ) => StateResult<TMode, (StateChain | StateBlockedJob[] | undefined)[]>;

  /**
   * Atomically selects up to `limit` (at least 1) due pending jobs of the `timeoutMsByTypeName`
   * keys and starts an attempt on each: increments `attempt`, sets `attemptBy`, and sets
   * `attemptUntil` to now plus the job type's timeout. Returns them with their chains, in no
   * particular order, fewer than `limit` only when no more due jobs are available to this
   * caller. Which types fill a batch is adapter-specific: the PostgreSQL adapter takes types in
   * random order and the oldest due jobs within each. Two parallel callers must never receive
   * the same job — locked rows must be skipped, not waited on. `hasBlockers` gates
   * `getJobBlockers`.
   */
  startJobAttempts: (
    params: {
      timeoutMsByTypeName: Record<string, number>;
      workerId: string;
      limit: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, (StateJob & { hasBlockers: boolean })[]>;

  /** Ms until a pending job of these types can be attempted: 0 if due now, null if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, number | null>;

  /**
   * Extends a running job attempt's deadline. Returns `undefined` when the job does not match
   * the `fence` — it is gone, finished, or the attempt is someone else's.
   */
  extendJobAttempt: (
    params: {
      jobId: TJobId;
      fence: StateAttemptFence;
      timeoutMs: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, StateJob | undefined>;

  /**
   * Selects up to `limit` (at least 1) `running` jobs of `typeNames` whose `attemptUntil` has
   * passed, excluding `ignoredJobIds`, and releases them back to the pending pool, setting
   * `lastAttemptAt` to now and `lastAttemptError` to the given error, as a reschedule after a
   * handler error does. Returns the released jobs in no particular order, fewer than `limit`
   * only when no more expired attempts are available to this caller. Locked rows must be
   * skipped, not waited on.
   */
  reclaimExpiredJobAttempts: (
    params: {
      typeNames: string[];
      ignoredJobIds?: TJobId[];
      lastAttemptError: string;
      limit: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, StateJob[]>;

  /**
   * Adds blocker dependencies to jobs, in input order, with one `blockers` entry per
   * `blockedByChainIds` position — `undefined` at a position whose id does not name a chain
   * head. Rows for the resolvable positions may already be written, so the caller is expected
   * to abort the transaction, which is what rolls them back.
   */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => StateResult<TMode, (StateJob & { blockers: (StateChainInfo | undefined)[] })[]>;

  /**
   * Gets the blocker chains for a job, one per blocker row in index order — a chain listed
   * twice as a blocker appears twice.
   */
  getJobBlockers: (
    params: { jobId: TJobId } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, StateChain[]>;

  /**
   * Unblocks jobs when a blocker chain completes, transitioning each dependent whose blockers
   * are now all complete from `blocked` to `pending`. Returns one entry per blocker row on the
   * chain, whatever its job's status, with the job's own chain.
   */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & TransactionTxContextParam<TTxContext>,
  ) => StateResult<TMode, StateDependentJob[]>;

  /** Returns distinct chain type names present in the data. */
  listChainTypeNames: (
    params: AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, string[]>;

  /** Returns distinct job type names present in the data. */
  listJobTypeNames: (params: AutocommitTxContextParam<TTxContext>) => StateResult<TMode, string[]>;

  /** Returns capped per-status counts for each requested chain type name, in input order. */
  countByChainTypeNames: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => StateResult<TMode, { running: StateCount; completed: StateCount }[]>;

  /** Returns capped per-status counts for each requested job type name, in input order. */
  countByJobTypeNames: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => StateResult<
    TMode,
    { blocked: StateCount; pending: StateCount; running: StateCount; completed: StateCount }[]
  >;

  /** Lists chains with pagination, status-dependent ordering, and filtering. */
  listChains: (
    params: AutocommitTxContextParam<TTxContext> & {
      typeName: string;
      independent?: boolean;
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "running"; orderBy: "createdAt" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => StateResult<TMode, Page<StateChain>>;

  /** Lists jobs with pagination, status-dependent ordering, and filtering. */
  listJobs: (
    params: AutocommitTxContextParam<TTxContext> & {
      typeName: string;
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "blocked"; orderBy: "createdAt" | "scheduledAt" }
        | { status: "pending"; orderBy: "createdAt" | "scheduledAt" }
        | { status: "running"; orderBy: "createdAt" | "attemptAt" | "attemptUntil" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => StateResult<TMode, Page<StateJob>>;

  /** Lists jobs within a specific chain, ordered by position in the chain. */
  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, Page<StateJob>>;

  /** Lists jobs that depend on the given chain as a blocker. */
  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => StateResult<TMode, Page<StateJob>>;

  /** Releases internal resources. Idempotent. In sync mode it returns once they are released. */
  close: () => StateResult<TMode, void>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, any, any> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, infer TJobId, any> ? TJobId : never;

export type GetStateAdapterMode<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, any, infer TMode> ? TMode : never;
