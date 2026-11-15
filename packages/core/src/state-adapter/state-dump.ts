import type {
  StateChainInfo,
  StateChainStatus,
  StateJobBlockerInfo,
  StateJobInfo,
  StateWorkerInfo,
} from "./state-adapter.ts";

export type StateDumpWorker = Omit<StateWorkerInfo, "expired">;

export type StateDump = {
  capturedAt: Date;
  chains: StateChainInfo[];
  jobs: StateJobInfo[];
  blockers: StateJobBlockerInfo[];
  workers: StateDumpWorker[];
};

export type DumpJobRow = Omit<
  StateJobInfo,
  "createdAt" | "scheduledAt" | "completedAt" | "lastAttemptAt" | "attemptAt"
> & {
  createdAt: number;
  scheduledAt: number;
  completedAt: number | null;
  lastAttemptAt: number | null;
  attemptAt: number | null;
  chainStatus: StateChainStatus | null;
  chainCompletedAt: number | null;
  chainDeduplicationKey: string | null;
  chainTraceContext: string | null;
};

export type DumpWorkerRow = Omit<StateDumpWorker, "startedAt" | "leaseUntil"> & {
  startedAt: number;
  leaseUntil: number;
};

const shiftDate = (date: Date, offsetMs: number): Date => new Date(date.getTime() + offsetMs);

const shiftNullableDate = (date: Date | null, offsetMs: number): Date | null =>
  date === null ? null : shiftDate(date, offsetMs);

const shiftTime = (date: Date | null, offsetMs: number): number | null =>
  date === null ? null : date.getTime() + offsetMs;

export const shiftStateJob = (job: StateJobInfo, offsetMs: number): StateJobInfo => ({
  ...job,
  createdAt: shiftDate(job.createdAt, offsetMs),
  scheduledAt: shiftDate(job.scheduledAt, offsetMs),
  completedAt: shiftNullableDate(job.completedAt, offsetMs),
  lastAttemptAt: shiftNullableDate(job.lastAttemptAt, offsetMs),
  attemptAt: shiftNullableDate(job.attemptAt, offsetMs),
});

export const shiftStateChain = (chain: StateChainInfo, offsetMs: number): StateChainInfo => ({
  ...chain,
  createdAt: shiftDate(chain.createdAt, offsetMs),
  completedAt: shiftNullableDate(chain.completedAt, offsetMs),
});

export const shiftStateWorker = (worker: StateDumpWorker, offsetMs: number): StateDumpWorker => ({
  ...worker,
  startedAt: shiftDate(worker.startedAt, offsetMs),
  leaseUntil: shiftDate(worker.leaseUntil, offsetMs),
});

export const shiftStateDump = (dump: StateDump, offsetMs: number): StateDump => ({
  capturedAt: shiftDate(dump.capturedAt, offsetMs),
  chains: dump.chains.map((chain) => shiftStateChain(chain, offsetMs)),
  jobs: dump.jobs.map((job) => shiftStateJob(job, offsetMs)),
  blockers: dump.blockers,
  workers: dump.workers.map((worker) => shiftStateWorker(worker, offsetMs)),
});

export const createDumpRowMapper = (
  dump: StateDump,
  offsetMs: number,
): {
  job: (job: StateJobInfo) => DumpJobRow;
  worker: (worker: StateDumpWorker) => DumpWorkerRow;
} => {
  const chainsById = new Map(dump.chains.map((chain) => [chain.id, chain]));
  return {
    job: (job) => {
      const chain = job.chainIndex === 0 ? chainsById.get(job.chainId) : undefined;
      return {
        ...job,
        createdAt: job.createdAt.getTime() + offsetMs,
        scheduledAt: job.scheduledAt.getTime() + offsetMs,
        completedAt: shiftTime(job.completedAt, offsetMs),
        lastAttemptAt: shiftTime(job.lastAttemptAt, offsetMs),
        attemptAt: shiftTime(job.attemptAt, offsetMs),
        chainStatus: chain?.status ?? null,
        chainCompletedAt: shiftTime(chain?.completedAt ?? null, offsetMs),
        chainDeduplicationKey: chain?.deduplicationKey ?? null,
        chainTraceContext: chain?.traceContext ?? null,
      };
    },
    worker: (worker) => ({
      ...worker,
      startedAt: worker.startedAt.getTime() + offsetMs,
      leaseUntil: worker.leaseUntil.getTime() + offsetMs,
    }),
  };
};

export const createSqlDumpRowMapper = (
  dump: StateDump,
  offsetMs: number,
  encoding: { timestamp: (ms: number) => unknown; json: (value: unknown) => unknown },
): {
  job: (job: StateJobInfo) => Record<string, unknown>;
  blocker: (blocker: StateJobBlockerInfo) => Record<string, unknown>;
  worker: (worker: StateDumpWorker) => Record<string, unknown>;
} => {
  const mapRow = createDumpRowMapper(dump, offsetMs);
  const timestamp = (ms: number | null): unknown => (ms === null ? null : encoding.timestamp(ms));
  const json = (value: unknown): unknown => (value === null ? null : encoding.json(value));
  return {
    job: (job) => {
      const row = mapRow.job(job);
      return {
        id: row.id,
        type_name: row.typeName,
        chain_id: row.chainId,
        chain_index: row.chainIndex,
        continued_to_id: row.continuedToId,
        status: row.status,
        chain_status: row.chainStatus,
        chain_deduplication_key: row.chainDeduplicationKey,
        chain_trace_context: row.chainTraceContext,
        trace_context: row.traceContext,
        input: json(row.input),
        output: json(row.output),
        attempt: row.attempt,
        last_attempt_error: json(row.lastAttemptError),
        attempt_by: row.attemptBy,
        attempt_token: row.attemptToken,
        completed_by: row.completedBy,
        created_at: timestamp(row.createdAt),
        scheduled_at: timestamp(row.scheduledAt),
        completed_at: timestamp(row.completedAt),
        last_attempt_at: timestamp(row.lastAttemptAt),
        attempt_at: timestamp(row.attemptAt),
        chain_completed_at: timestamp(row.chainCompletedAt),
      };
    },
    blocker: (blocker) => ({
      job_id: blocker.jobId,
      blocked_by_chain_id: blocker.blockedByChainId,
      index: blocker.index,
      trace_context: blocker.traceContext,
    }),
    worker: (worker) => {
      const row = mapRow.worker(worker);
      return {
        id: row.id,
        type_names: json(row.typeNames),
        concurrency: row.concurrency,
        token: row.token,
        started_at: timestamp(row.startedAt),
        lease_until: timestamp(row.leaseUntil),
      };
    },
  };
};

export const chunkItems = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, chunk) =>
    items.slice(chunk * size, (chunk + 1) * size),
  );
