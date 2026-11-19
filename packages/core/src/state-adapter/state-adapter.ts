import type { Mode, ModeResult } from "@queuert/sync-async";

import type { AdapterLifecycle } from "../adapter-mode.ts";
import type { DeduplicationOptions } from "../entities/deduplication.ts";
import type { OrderDirection, Page, PageParams } from "../entities/pagination.ts";
import type { ScheduleOptions } from "../entities/schedule.ts";

/** A job's status as a state adapter stores it. */
export type StateJobStatus = "blocked" | "pending" | "running" | "completed";

/** A chain's status as a state adapter stores it. */
export type StateChainStatus = "running" | "completed";

/** A job row as a state adapter returns it, without its chain. */
export type StateJobInfo = {
  /** Job ID. */
  id: string;
  /** Job type name. */
  typeName: string;
  /** ID of the chain the job belongs to, equal to the ID of the chain's head job. */
  chainId: string;
  /** Position in the chain, starting at 0 for the head. */
  chainIndex: number;
  /** Current status. */
  status: StateJobStatus;
  /** When the job was created. */
  createdAt: Date;
  /** Stored input. */
  input: unknown;
  /** When the job becomes eligible for processing. */
  scheduledAt: Date;
  /** When the job completed, or `null` before. */
  completedAt: Date | null;
  /** Worker that completed the job, or `null` for a workerless completion or before. */
  completedBy: string | null;
  /** ID of the job it continued to, or `null` for a terminal or not yet completed job. */
  continuedToId: string | null;
  /** Stored output of a terminally completed job, otherwise `null`. */
  output: unknown;
  /** Number of processing attempts so far. */
  attempt: number;
  /**
   * Number of attempts in a row that failed or were reclaimed; any other attempt outcome or a client
   * reschedule resets it to 0.
   */
  consecutiveFailures: number;
  /** When the last attempt that returned the job to pending ended, or `null` before one. */
  lastAttemptAt: Date | null;
  /** Serialized error of the last attempt when it failed or was reclaimed, otherwise `null`. */
  lastAttemptError: string | null;
  /** The reason a handler or client gave for the last reschedule, or `null` when none was given. */
  lastRescheduleReason: string | null;
  /** When the current attempt started, or `null` when the job is not running. */
  attemptAt: Date | null;
  /** Worker that owns the current attempt, or `null` when the job is not running. */
  attemptBy: string | null;
  /** Token of the current attempt, which attempt-scoped writes must present. */
  attemptToken: string | null;
  /** Serialized trace context of the job, for observability adapters. */
  traceContext: string | null;
};

/** A chain row as a state adapter returns it, without its jobs. */
export type StateChainInfo = {
  /** Chain ID, equal to the ID of its head job. */
  id: string;
  /** Chain type name, the type name of its head job. */
  typeName: string;
  /** Current status. */
  status: StateChainStatus;
  /** Deduplication key the chain was created with, or `null`. */
  deduplicationKey: string | null;
  /** When the chain was created. */
  createdAt: Date;
  /** When the chain completed, or `null` while running. */
  completedAt: Date | null;
  /** Serialized trace context of the chain, for observability adapters. */
  traceContext: string | null;
  /** Whether at least one blocker row references the chain. */
  blocking: boolean;
};

/** One blocker of a job: the chain the job waits for, in the order its blockers were added. */
export type StateJobBlockerInfo = {
  /** ID of the blocked job. */
  jobId: string;
  /** ID of the chain the job waits for. */
  blockedByChainId: string;
  /** Position of the blocker among the job's blockers. */
  index: number;
  /** Serialized trace context of the blocker link, for observability adapters. */
  traceContext: string | null;
};

/** A worker row as a state adapter returns it. */
export type StateWorkerInfo = {
  /** Worker ID. */
  id: string;
  /** Job type names the worker processes. */
  typeNames: string[];
  /** Maximum number of attempts the worker runs at once. */
  concurrency: number;
  /** When the worker registered. */
  startedAt: Date;
  /** When the worker's lease ends unless renewed. */
  leaseUntil: Date;
  /** Token of the worker's current registration. */
  token: string;
  /** Whether the lease has ended, in database time. */
  expired: boolean;
};

/**
 * A chain with its head job and its tail: the latest job continued from the head, whether or not
 * the chain completed, or `undefined` while the head is its only job.
 */
export type StateChain = StateChainInfo & { head: StateJobInfo; tail: StateJobInfo | undefined };
/** A job with its chain. */
export type StateJob = StateJobInfo & { chain: StateChainInfo };
/** A blocker with the job it blocks. */
export type StateBlockedJob = StateJobBlockerInfo & { job: StateJobInfo };
/** A blocker with the blocked job and that job's chain. */
export type StateDependentJob = StateJobBlockerInfo & { job: StateJob };

/** A count that stops at the adapter's `countCap`; `hasMore` is set when it stopped. */
export type StateCount = { count: number; hasMore: boolean };
/** Numbers of workers whose lease is live and whose lease has ended. */
export type StateWorkerCounts = { live: number; expired: number };

/**
 * A state adapter's resolved configuration, with defaults applied.
 *
 * @typeParam TJobId - The job ID type
 * @typeParam TWorkerId - The worker ID type
 */
export type StateAdapterConfig<TJobId extends string, TWorkerId extends string> = {
  /** Generates a job ID. */
  generateJobId: () => TJobId;
  /** Checks a job ID. */
  validateJobId: (id: TJobId) => boolean;
  /** Generates a new worker ID on every call. */
  generateWorkerId: () => TWorkerId;
  /** Checks a worker ID. */
  validateWorkerId: (id: TWorkerId) => boolean;
  /** Maximum number of blocker chains per job. */
  maxBlockersPerJob: number;
  /**
   * Per-status count at which `countChainsByTypeName` and `countJobsByTypeName` stop counting
   * and report `hasMore`.
   */
  countCap: number;
};

/** Base type for state adapter contexts. */
export type BaseTxContext = Record<string, unknown>;

type AutocommitTxContextParam<TTxContext extends BaseTxContext> = { txCtx?: TTxContext };
type TransactionTxContextParam<TTxContext extends BaseTxContext> = { txCtx: TTxContext };

/**
 * Abstracts database operations for job persistence.
 *
 * In the `"async"` mode its methods return promises. In the `"sync"` mode, for drivers
 * that run statements synchronously (better-sqlite3, node:sqlite, bun:sqlite), it sets
 * `sync: true`, every method returns its result directly, and a failure throws instead of
 * rejecting, so the client, `complete` and `fence` over it run inside the driver's own
 * synchronous transaction. `StateAdapter<any, any, any, "async" | "sync">` is an adapter of
 * either mode.
 *
 * An adapter never throws Queuert's domain errors: an absent or already completed row is
 * reported as `undefined` in the result position it belongs to, and the caller decides which
 * error the user sees. Adapters still throw for driver errors and connection loss.
 *
 * @typeParam TTxContext - The transaction context type
 * @typeParam TJobId - The job ID type
 * @typeParam TWorkerId - The worker ID type
 * @typeParam TMode - Whether the methods return promises or plain values
 */
export type StateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
  TMode extends Mode,
> = {
  /** How the adapter was configured, with defaults applied. */
  config: Readonly<StateAdapterConfig<TJobId, TWorkerId>>;

  /**
   * Runs `fn` in a transaction: commits on success, rolls back on error. In the `"sync"` mode, a
   * `fn` that returns a promise rolls the transaction back and throws.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => ModeResult<TMode, T>) => ModeResult<TMode, T>;

  /** Whether `txCtx` is in an open transaction, answered without a query. */
  isTransaction: (txCtx: TTxContext) => boolean;

  /** Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles. */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | ModeResult<TMode, void>) => void;

  /**
   * Runs `callback` synchronously when `txCtx`'s transaction, or the savepoint `txCtx` belongs to,
   * rolls back. Commit callbacks registered there never run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void) => void;

  /** Gets chains by ID in input order; `lock` locks each head row. */
  getChains: (
    params: { chainIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => ModeResult<TMode, (StateChain | undefined)[]>;

  /** Gets jobs with their chains by ID in input order; `lock` also locks each chain head. */
  getJobs: (
    params: { jobIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => ModeResult<TMode, (StateJob | undefined)[]>;

  /** Gets workers by ID in input order; `lock` blocks claims under them until commit. */
  getWorkers: (
    params: { workerIds: TWorkerId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => ModeResult<TMode, (StateWorkerInfo | undefined)[]>;

  /**
   * Creates chain heads. A deduplicated match returns the existing chain, with its latest
   * continuation as `tail` as `getChains` does, and `deduplicated: true`.
   */
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
  }) => ModeResult<TMode, (StateChain & { deduplicated: boolean })[]>;

  /** Completes each `continueFromId` and inserts its successor, recording `workerId` as `completedBy`; `undefined` on a miss, a taken id or chain position throws. */
  continueJobs: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      traceContext?: string | null;
      continueFromId: TJobId;
      attemptToken?: string;
      workerId?: TWorkerId;
    }[];
  }) => ModeResult<TMode, ((StateJob & { continuation: StateJobInfo }) | undefined)[]>;

  /**
   * Completes each job with its output, ending its chain and recording `workerId` as `completedBy`;
   * `undefined` on a miss. The chain's `blocking` is read as the completion writes the head.
   */
  completeJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        output: unknown;
        attemptToken?: string;
        workerId?: TWorkerId;
      }[];
    } & TransactionTxContextParam<TTxContext>,
  ) => ModeResult<TMode, (StateJob | undefined)[]>;

  /**
   * Returns jobs to pending, clearing any running attempt, or moves a blocked job's `scheduledAt`;
   * `undefined` on a miss. A running job given an `error` counts a failure: `consecutiveFailures`
   * goes up by 1, `lastAttemptError` holds the error and `lastRescheduleReason` is cleared. Every
   * other reschedule sets `consecutiveFailures` to 0 and `lastRescheduleReason` to `reason` or
   * `null`. Ending a running attempt sets `lastAttemptAt`, and `lastAttemptError` to `null` when no
   * `error` is given; rescheduling a job that is not running leaves both untouched.
   */
  rescheduleJobs: (
    params: {
      jobs: ({
        jobId: TJobId;
        schedule?: ScheduleOptions;
        attemptToken?: string;
      } & ({ error?: string; reason?: never } | { error?: never; reason?: string }))[];
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, (StateJob | undefined)[]>;

  /**
   * Deletes chains, or none if one blocks an outside job: its slot then lists those jobs. Deleted
   * chains are returned with `blocking` `false`, and each remaining chain the deleted blocker rows were
   * the last to reference gets `blocking` `false`.
   */
  deleteChains: (
    params: { chainIds: TJobId[] } & TransactionTxContextParam<TTxContext>,
  ) => ModeResult<TMode, (StateChain | StateBlockedJob[] | undefined)[]>;

  /** Claims up to `limit` due jobs of `typeNames` with a new `attemptToken` while the worker row holds `workerToken` with a live lease, skipping locked rows so no two callers get the same job; fewer only when no more are available. */
  startJobAttempts: (
    params: {
      typeNames: string[];
      workerId: TWorkerId;
      workerToken: string;
      limit: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, (StateJob & { hasBlockers: boolean })[]>;

  /** Ms until a pending job of these types is due: 0 if now, `null` if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, number | null>;

  /**
   * Adds blockers to jobs. A blocker id that does not name a chain head is reported as
   * `undefined` among the job's blockers, and the caller then rolls back. Sets `blocking` on each
   * blocker chain and returns those chains with it set.
   */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => ModeResult<TMode, (StateJob & { blockers: (StateChainInfo | undefined)[] })[]>;

  /** Gets a job's blocker chains, one per blocker row in index order. */
  getJobBlockers: (
    params: { jobId: TJobId } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateChain[]>;

  /**
   * Moves a completed chain's dependents to pending once all their blockers completed; one entry
   * per blocker row. Core skips this call when the completed chain's `blocking` is `false`.
   */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & TransactionTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateDependentJob[]>;

  /** Inserts a worker with a new `token` and a lease `leaseMs` from now; a duplicate id throws. */
  startWorker: (
    params: {
      workerId: TWorkerId;
      typeNames: string[];
      concurrency: number;
      leaseMs: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateWorkerInfo>;

  /** Extends a live lease holding `workerToken` to `leaseMs` from now; `undefined` otherwise. */
  extendWorkerLease: (
    params: {
      workerId: TWorkerId;
      workerToken: string;
      leaseMs: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateWorkerInfo | undefined>;

  /** Deletes the worker row holding `workerToken`; `undefined` otherwise. */
  stopWorker: (
    params: {
      workerId: TWorkerId;
      workerToken: string;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateWorkerInfo | undefined>;

  /** Distinct chain type names in the data. */
  getChainTypeNames: (params: AutocommitTxContextParam<TTxContext>) => ModeResult<TMode, string[]>;

  /** Distinct job type names in the data. */
  getJobTypeNames: (params: AutocommitTxContextParam<TTxContext>) => ModeResult<TMode, string[]>;

  /** Capped per-status chain counts per type name, in input order. */
  countChainsByTypeName: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => ModeResult<TMode, { running: StateCount; completed: StateCount }[]>;

  /** Capped per-status job counts per type name, in input order. */
  countJobsByTypeName: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => ModeResult<
    TMode,
    { blocked: StateCount; pending: StateCount; running: StateCount; completed: StateCount }[]
  >;

  /** Counts live and expired workers. */
  countWorkers: (
    params: AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateWorkerCounts>;

  /** Counts live and expired workers per job type name, in input order. */
  countWorkersByTypeName: (
    params: { typeNames: string[] } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, StateWorkerCounts[]>;

  /** Counts running jobs per worker ID, in input order. */
  countRunningJobsByWorkerId: (
    params: { workerIds: TWorkerId[] } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, number[]>;

  /** Lists chains of a type, paginated, with status-dependent ordering. */
  listChains: (
    params: AutocommitTxContextParam<TTxContext> & {
      typeName: string;
      blocking?: boolean;
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "running"; orderBy: "createdAt" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => ModeResult<TMode, Page<StateChain>>;

  /** Lists jobs of a type, paginated, with status-dependent ordering. */
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
        | { status: "running"; orderBy: "createdAt" | "attemptAt" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => ModeResult<TMode, Page<StateJob>>;

  /** Lists a chain's jobs by chain position, paginated. */
  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, Page<StateJob>>;

  /** Lists jobs blocked by a chain, paginated. */
  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, Page<StateJob>>;

  /** Lists workers by `startedAt`, paginated, filtered by `typeName` and `status`. */
  listWorkers: (
    params: {
      typeName?: string;
      status?: "live" | "expired";
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, Page<StateWorkerInfo>>;

  /** Lists jobs running under a worker by `attemptAt`, paginated. */
  listWorkerJobs: (
    params: {
      workerId: TWorkerId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => ModeResult<TMode, Page<StateJob>>;
} & AdapterLifecycle<TMode>;

export type GetStateAdapterTxContext<TStateAdapter> = 0 extends 1 & TStateAdapter
  ? any
  : TStateAdapter extends { isTransaction: (txCtx: infer TTxContext) => boolean }
    ? TTxContext
    : never;

export type GetStateAdapterJobId<TStateAdapter> = 0 extends 1 & TStateAdapter
  ? any
  : TStateAdapter extends { config: Readonly<StateAdapterConfig<infer TJobId, any>> }
    ? TJobId
    : never;

export type GetStateAdapterWorkerId<TStateAdapter> = 0 extends 1 & TStateAdapter
  ? any
  : TStateAdapter extends { config: Readonly<StateAdapterConfig<any, infer TWorkerId>> }
    ? TWorkerId
    : never;
