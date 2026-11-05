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
  attemptToken: string | null;
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

export type StateWorkerInfo = {
  id: string;
  typeNames: string[];
  concurrency: number;
  startedAt: Date;
  leaseUntil: Date;
  token: string;
  expired: boolean;
};

export type StateChain = StateChainInfo & { head: StateJobInfo; tail: StateJobInfo | undefined };
export type StateJob = StateJobInfo & { chain: StateChainInfo };
export type StateBlockedJob = StateJobBlockerInfo & { job: StateJobInfo };
export type StateDependentJob = StateJobBlockerInfo & { job: StateJob };

export type StateCount = { count: number; hasMore: boolean };
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
 * An adapter never throws Queuert's domain errors: an absent or already completed row is
 * reported as `undefined` in the result position it belongs to, and the caller decides which
 * error the user sees. Adapters still throw for driver errors and connection loss.
 *
 * @typeParam TTxContext - The transaction context type
 * @typeParam TJobId - The job ID type
 * @typeParam TWorkerId - The worker ID type
 */
export type StateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
> = {
  /** How the adapter was configured, with defaults applied. */
  config: Readonly<StateAdapterConfig<TJobId, TWorkerId>>;

  /** Runs `fn` in a transaction: commits on success, rolls back on error. */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /** Whether `txCtx` is in an open transaction, answered without a query. */
  isTransaction: (txCtx: TTxContext) => boolean;

  /** Gets chains by ID in input order; `lock` locks each head row. */
  getChains: (
    params: { chainIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => Promise<(StateChain | undefined)[]>;

  /** Gets jobs with their chains by ID in input order; `lock` also locks each chain head. */
  getJobs: (
    params: { jobIds: TJobId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => Promise<(StateJob | undefined)[]>;

  /** Gets workers by ID in input order; `lock` blocks claims under them until commit. */
  getWorkers: (
    params: { workerIds: TWorkerId[] } & (
      | ({ lock?: "exclusive" } & TransactionTxContextParam<TTxContext>)
      | ({ lock?: undefined } & AutocommitTxContextParam<TTxContext>)
    ),
  ) => Promise<(StateWorkerInfo | undefined)[]>;

  /** Creates chain heads; a deduplicated match returns `deduplicated: true`. */
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
  }) => Promise<(StateChain & { deduplicated: boolean })[]>;

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
  }) => Promise<((StateJob & { continuation: StateJobInfo }) | undefined)[]>;

  /** Completes each job with its output, ending its chain and recording `workerId` as `completedBy`; `undefined` on a miss. */
  completeJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        output: unknown;
        attemptToken?: string;
        workerId?: TWorkerId;
      }[];
    } & TransactionTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /** Returns jobs to pending, clearing any running attempt, or moves a blocked job's `scheduledAt`; `undefined` on a miss. */
  rescheduleJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        schedule?: ScheduleOptions;
        error?: string;
        attemptToken?: string;
      }[];
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /** Deletes chains, or none if one blocks an outside job: its slot then lists those jobs. */
  deleteChains: (
    params: { chainIds: TJobId[] } & TransactionTxContextParam<TTxContext>,
  ) => Promise<(StateChain | StateBlockedJob[] | undefined)[]>;

  /** Claims up to `limit` due jobs of `typeNames` with a new `attemptToken` while the worker row holds `workerToken` with a live lease, skipping locked rows so no two callers get the same job; fewer only when no more are available. */
  startJobAttempts: (
    params: {
      typeNames: string[];
      workerId: TWorkerId;
      workerToken: string;
      limit: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<(StateJob & { hasBlockers: boolean })[]>;

  /** Ms until a pending job of these types is due: 0 if now, `null` if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<number | null>;

  /** Adds blockers to jobs, `undefined` per non-head id; the caller then rolls back. */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => Promise<(StateJob & { blockers: (StateChainInfo | undefined)[] })[]>;

  /** Gets a job's blocker chains, one per blocker row in index order. */
  getJobBlockers: (
    params: { jobId: TJobId } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateChain[]>;

  /** Moves a completed chain's dependents to pending once all their blockers completed; one entry per blocker row. */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & TransactionTxContextParam<TTxContext>,
  ) => Promise<StateDependentJob[]>;

  /** Inserts a worker with a new `token` and a lease `leaseMs` from now; a duplicate id throws. */
  startWorker: (
    params: {
      workerId: TWorkerId;
      typeNames: string[];
      concurrency: number;
      leaseMs: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateWorkerInfo>;

  /** Extends a live lease holding `workerToken` to `leaseMs` from now; `undefined` otherwise. */
  extendWorkerLease: (
    params: {
      workerId: TWorkerId;
      workerToken: string;
      leaseMs: number;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateWorkerInfo | undefined>;

  /** Deletes the worker row holding `workerToken`; `undefined` otherwise. */
  stopWorker: (
    params: {
      workerId: TWorkerId;
      workerToken: string;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateWorkerInfo | undefined>;

  /** Distinct chain type names in the data. */
  getChainTypeNames: (params: AutocommitTxContextParam<TTxContext>) => Promise<string[]>;

  /** Distinct job type names in the data. */
  getJobTypeNames: (params: AutocommitTxContextParam<TTxContext>) => Promise<string[]>;

  /** Capped per-status chain counts per type name, in input order. */
  countChainsByTypeName: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ running: StateCount; completed: StateCount }[]>;

  /** Capped per-status job counts per type name, in input order. */
  countJobsByTypeName: (
    params: AutocommitTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<
    { blocked: StateCount; pending: StateCount; running: StateCount; completed: StateCount }[]
  >;

  /** Counts live and expired workers. */
  countWorkers: (params: AutocommitTxContextParam<TTxContext>) => Promise<StateWorkerCounts>;

  /** Counts live and expired workers per job type name, in input order. */
  countWorkersByTypeName: (
    params: { typeNames: string[] } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateWorkerCounts[]>;

  /** Counts running jobs per worker ID, in input order. */
  countRunningJobsByWorkerId: (
    params: { workerIds: TWorkerId[] } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<number[]>;

  /** Lists chains of a type, paginated, with status-dependent ordering. */
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
  ) => Promise<Page<StateChain>>;

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
  ) => Promise<Page<StateJob>>;

  /** Lists a chain's jobs by chain position, paginated. */
  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Lists jobs blocked by a chain, paginated. */
  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Lists workers by `startedAt`, paginated, filtered by `typeName` and `status`. */
  listWorkers: (
    params: {
      typeName?: string;
      status?: "live" | "expired";
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<Page<StateWorkerInfo>>;

  /**
   * Lists jobs running under a worker by `attemptAt`, paginated. A `null` `workerId` lists the
   * running jobs that hold no `attemptToken`, which only a worker of a version before 0.17 claims.
   */
  listWorkerJobs: (
    params: {
      workerId: TWorkerId | null;
      orderDirection: OrderDirection;
      page: PageParams;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Releases internal resources. Idempotent. */
  close: () => Promise<void>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, any, any> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, infer TJobId, any> ? TJobId : never;

export type GetStateAdapterWorkerId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, any, infer TWorkerId> ? TWorkerId : never;
