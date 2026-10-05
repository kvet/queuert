import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";

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

/** Base type for state adapter contexts. */
export type BaseTxContext = Record<string, unknown>;

/**
 * Read-only methods take an optional `txCtx` — omitting it lets the adapter run on
 * its own connection. Multi-statement mutating methods require one: they must be committed
 * or rolled back together with the caller's other writes.
 */
type ReadTxContextParam<TTxContext extends BaseTxContext> = { txCtx?: TTxContext };

/**
 * A write-intent lock only lasts as long as the transaction that took it, so `lock`
 * requires a `txCtx`. With one, any `lock` value passes — no narrowing needed.
 */
type LockTxContextParam<TTxContext extends BaseTxContext> =
  | { lock?: "exclusive"; txCtx: TTxContext }
  | { lock?: undefined; txCtx?: TTxContext };

/**
 * `lock: "write"` writes each chain's head row (a no-op update) instead of only locking it,
 * so a concurrent writer of the head conflicts at every isolation level.
 */
type ChainLockTxContextParam<TTxContext extends BaseTxContext> =
  | { lock?: "exclusive" | "write"; txCtx: TTxContext }
  | { lock?: undefined; txCtx?: TTxContext };

type WriteTxContextParam<TTxContext extends BaseTxContext> = { txCtx: TTxContext };

/**
 * Single-statement worker writes may run outside a transaction: without a `txCtx` the adapter
 * executes the statement on its own connection, in autocommit.
 */
type AutocommitTxContextParam<TTxContext extends BaseTxContext> = { txCtx?: TTxContext };

/**
 * Ownership condition for an attempt-scoped write: the job must be `running` in exactly this
 * attempt, held by this worker. A fenced write that does not match writes nothing.
 */
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
 */
export type StateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = {
  /** Whether two `withTransaction` callbacks can run concurrently. */
  transactionConcurrency: "concurrent" | "serialized";

  /** Executes a callback within a transaction. Commits on success, rolls back on error. */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Gets chains by their IDs, in input order, `undefined` for missing chains. Pass
   * `lock: "exclusive"` to acquire a write-intent lock on each chain's head row, or
   * `lock: "write"` to write each head row (a no-op update that leaves its values unchanged).
   *
   * The head row is the serialization point between completing a chain and adding a blocker
   * on it: both sides write it. `"write"` is what the blocker side uses, because a lock alone
   * does not conflict with a concurrent completer under REPEATABLE READ or SERIALIZABLE.
   */
  getChains: (
    params: { chainIds: TJobId[] } & ChainLockTxContextParam<TTxContext>,
  ) => Promise<(StateChain | undefined)[]>;

  /**
   * Gets jobs by their IDs, with their chains, in input order, `undefined` for missing
   * jobs. Pass `lock: "exclusive"` to acquire a write-intent lock on each job **and its
   * chain's head row**, in a consistent id order.
   */
  getJobs: (
    params: { jobIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /** Creates chain heads. Deduplicated matches return `deduplicated: true`. */
  createJobs: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      deduplication?: DeduplicationOptions;
      traceContext?: string | null;
      chainTraceContext?: string | null;
    }[];
  }) => Promise<(StateChain & { deduplicated: boolean })[]>;

  /**
   * Completes each `continueFromId` and inserts its chain successor, linking the two. Each
   * result is the completed predecessor, with its successor under `continuation`. Results are
   * in input order, `undefined` for an id with no matching job, one already completed, or one
   * that does not match its `fence`. A colliding caller-supplied id or an already taken chain
   * position still throws.
   *
   * All-or-nothing per job: a job that does not complete gets no successor.
   */
  continueJobs: (params: {
    txCtx: TTxContext;
    completedBy?: string | null;
    jobs: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      traceContext?: string | null;
      continueFromId: TJobId;
      fence?: StateAttemptFence;
    }[];
  }) => Promise<((StateJob & { continuation: StateJobInfo }) | undefined)[]>;

  /**
   * Completes each job with its terminal output, ending its chain and setting the chain's
   * `completedAt`. Results are in input order, `undefined` for an id with no matching job, one
   * already completed, or one that does not match its `fence`.
   *
   * All-or-nothing per job: the chain head is written only for a job that completes, so a
   * fence miss leaves the head untouched. Writing the head is what serializes this call
   * against a concurrent `getChains({ lock: "write" })` from a blocker being added.
   */
  completeJobs: (
    params: {
      completedBy?: string | null;
      jobs: {
        jobId: TJobId;
        output: unknown;
        fence?: StateAttemptFence;
      }[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /**
   * Returns jobs to pending, clearing any running attempt. A blocked job keeps its
   * `blocked` status and only moves its `scheduledAt`. Skips completed and missing ids, and
   * ids that do not match their `fence`.
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
  ) => Promise<(StateJob | undefined)[]>;

  /**
   * Deletes all jobs in the given chains atomically, returning each deleted chain in input
   * order, `undefined` for missing chains. If any chain is referenced as a blocker by a job
   * outside the set, nothing is deleted: that chain's position holds the referencing
   * `StateBlockedJob[]` and every other position is `undefined`.
   */
  deleteChains: (
    params: { chainIds: TJobId[] } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateChain | StateBlockedJob[] | undefined)[]>;

  /**
   * Atomically selects a pending job of one of the `timeoutMsByTypeName` keys and starts an
   * attempt: increments `attempt`, sets `attemptBy`, and sets `attemptUntil` to now plus the
   * acquired type's timeout. Returns it with its chain. Two parallel callers must never receive
   * the same job — locked rows must be skipped, not waited on.
   */
  startJobAttempt: (
    params: {
      timeoutMsByTypeName: Record<string, number>;
      workerId: string;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateJob | undefined>;

  /** Ms until a pending job of these types can be attempted: 0 if due now, null if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & ReadTxContextParam<TTxContext>,
  ) => Promise<number | null>;

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
  ) => Promise<StateJob | undefined>;

  /**
   * Releases an expired job attempt back to the pending pool, stamping `lastAttemptAt` and
   * `lastAttemptError` so a reclaim is distinguishable from a voluntary reschedule.
   */
  reclaimExpiredJobAttempt: (
    params: {
      typeNames: string[];
      ignoredJobIds?: TJobId[];
      lastAttemptError: string;
    } & AutocommitTxContextParam<TTxContext>,
  ) => Promise<StateJob | undefined>;

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
  }) => Promise<(StateJob & { blockers: (StateChainInfo | undefined)[] })[]>;

  /**
   * Gets the blocker chains for a job, one per blocker row in index order — a chain listed
   * twice as a blocker appears twice.
   */
  getJobBlockers: (
    params: { jobId: TJobId } & ReadTxContextParam<TTxContext>,
  ) => Promise<StateChain[]>;

  /**
   * Unblocks jobs when a blocker chain completes, transitioning each dependent whose blockers
   * are now all complete from `blocked` to `pending`. Returns one entry per blocker row on the
   * chain, whatever its job's status, with the job's own chain.
   */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateDependentJob[]>;

  /** Returns distinct chain type names present in the data. */
  listChainTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  /** Returns distinct job type names present in the data. */
  listJobTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  /** Returns capped per-status counts for each requested chain type name, in input order. */
  countByChainTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ running: StateCount; completed: StateCount }[]>;

  /** Returns capped per-status counts for each requested job type name, in input order. */
  countByJobTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<
    { blocked: StateCount; pending: StateCount; running: StateCount; completed: StateCount }[]
  >;

  /** Lists chains with pagination, status-dependent ordering, and filtering. */
  listChains: (
    params: ReadTxContextParam<TTxContext> & {
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

  /** Lists jobs with pagination, status-dependent ordering, and filtering. */
  listJobs: (
    params: ReadTxContextParam<TTxContext> & {
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
  ) => Promise<Page<StateJob>>;

  /** Lists jobs within a specific chain, ordered by position in the chain. */
  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Lists jobs that depend on the given chain as a blocker. */
  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Releases internal resources. Idempotent. */
  close: () => Promise<void>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, any> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, infer TJobId> ? TJobId : never;
