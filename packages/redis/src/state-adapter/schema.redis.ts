import type { StateChainStatus, StateJobStatus } from "queuert";

export type IndexedJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainIndex: number;
  status: StateJobStatus;
  chainStatus: StateChainStatus | null;
  seq: string;
  createdAt: number;
  scheduledAt: number;
  completedAt: number | null;
  attemptAt: number | null;
  attemptBy: string | null;
  chainCompletedAt: number | null;
  blockers: { blockedByChainId: string }[];
};

export type IndexedWorker = {
  id: string;
  typeNames: string[];
  startedAt: number;
  leaseUntil: number;
};

type NumericField<TRecord> = {
  [K in keyof TRecord]: TRecord[K] extends number | null ? K : never;
}[keyof TRecord] &
  string;

export type IndexDefinition<TRecord> = {
  name: string;
  type: "zset" | "set" | "counter";
  where?: Partial<Record<keyof TRecord & string, string | number>>;
  each?: (record: TRecord) => string[];
  key: (record: TRecord, each: string) => string;
  member: (record: TRecord, each: string) => string;
  score?: NumericField<TRecord>;
};

export type IndexEntries = {
  zsets: [key: string, member: string, score: number][];
  sets: [key: string, member: string][];
  counters: [key: string, field: string][];
};

export type RedisKeys = {
  sequence: string;
  schemaFences: string;
  migrations: string;
  migrationLock: string;
  setVersions: string;
  commit: (token: string) => string;
  claim: (token: string) => string;
  indexRebuild: (key: string) => string;
  job: (id: string) => string;
  jobLock: (id: string) => string;
  worker: (id: string) => string;
  deduplication: (typeName: string, key: string) => string;
  due: (typeName: string) => string;
  jobs: (orderBy: string, status: StateJobStatus | "all", typeName: string) => string;
  chains: (orderBy: string, status: StateChainStatus | "all", typeName: string) => string;
  chainJobs: (chainId: string) => string;
  running: (workerId: string) => string;
  blockedBy: (chainId: string) => string;
  blockedJobs: (chainId: string) => string;
  blockerReferences: string;
  jobTypeNames: string;
  chainTypeNames: string;
  workers: string;
  workersOfType: (typeName: string) => string;
  workerLeases: string;
  workerLeasesOfType: (typeName: string) => string;
};

export type RedisSchema = {
  keyPrefix: string;
  keys: RedisKeys;
  jobIndexes: IndexDefinition<IndexedJob>[];
  workerIndexes: IndexDefinition<IndexedWorker>[];
  jobIndexEntries: (job: IndexedJob) => IndexEntries;
  workerIndexEntries: (worker: IndexedWorker) => IndexEntries;
};

export const SCHEMA_VERSION = 1;

export const opaqueRecordFields: string[] = [
  "input",
  "output",
  "lastAttemptError",
  "traceContext",
  "chainTraceContext",
  "deduplicationKey",
  "completedBy",
  "blockers",
];

const dueMemberSeparator = "|";

export const dueMember = (seq: string, id: string): string => `${seq}${dueMemberSeparator}${id}`;

export const dueJobId = (member: string): string =>
  member.slice(member.indexOf(dueMemberSeparator) + dueMemberSeparator.length);

export const dueJobIdLua = (member: string): string =>
  `string.sub(${member}, string.find(${member}, '${dueMemberSeparator}', 1, true) + ${dueMemberSeparator.length})`;

export const placeholder = (field: string): string => `\0${field}\0`;

export const placeholderFields = (text: string): string[] =>
  text.split("\0").filter((_, index) => index % 2 === 1);

const symbolicRecord: unknown = new Proxy({}, { get: (_, field) => placeholder(String(field)) });

export const symbolicIndex = <TRecord>(
  definition: IndexDefinition<TRecord>,
): { key: string; member: string } => ({
  key: definition.key(symbolicRecord as TRecord, placeholder("each")),
  member: definition.member(symbolicRecord as TRecord, placeholder("each")),
});

export const createRedisKeys = (keyPrefix: string): RedisKeys => ({
  sequence: `${keyPrefix}sequence`,
  schemaFences: `${keyPrefix}schema-fences`,
  migrations: `${keyPrefix}migrations`,
  migrationLock: `${keyPrefix}migration-lock`,
  setVersions: `${keyPrefix}set-versions`,
  commit: (token) => `${keyPrefix}commit:${token}`,
  claim: (token) => `${keyPrefix}claim:${token}`,
  indexRebuild: (key) => `${keyPrefix}index-rebuild:${key.slice(keyPrefix.length)}`,
  job: (id) => `${keyPrefix}job:${id}`,
  jobLock: (id) => `${keyPrefix}job-lock:${id}`,
  worker: (id) => `${keyPrefix}worker:${id}`,
  deduplication: (typeName, key) => `${keyPrefix}deduplication:${JSON.stringify([typeName, key])}`,
  due: (typeName) => `${keyPrefix}due:${typeName}`,
  jobs: (orderBy, status, typeName) => `${keyPrefix}jobs:${orderBy}:${status}:${typeName}`,
  chains: (orderBy, status, typeName) => `${keyPrefix}chains:${orderBy}:${status}:${typeName}`,
  chainJobs: (chainId) => `${keyPrefix}chain-jobs:${chainId}`,
  running: (workerId) => `${keyPrefix}running:${workerId}`,
  blockedBy: (chainId) => `${keyPrefix}blocked-by:${chainId}`,
  blockedJobs: (chainId) => `${keyPrefix}blocked-jobs:${chainId}`,
  blockerReferences: `${keyPrefix}blocker-references`,
  jobTypeNames: `${keyPrefix}job-type-names`,
  chainTypeNames: `${keyPrefix}chain-type-names`,
  workers: `${keyPrefix}workers`,
  workersOfType: (typeName) => `${keyPrefix}workers-of-type:${typeName}`,
  workerLeases: `${keyPrefix}worker-leases`,
  workerLeasesOfType: (typeName) => `${keyPrefix}worker-leases-of-type:${typeName}`,
});

const createJobIndexes = (keys: RedisKeys): IndexDefinition<IndexedJob>[] => [
  {
    name: "chain_index_idx",
    type: "zset",
    key: (job) => keys.chainJobs(job.chainId),
    member: (job) => job.id,
    score: "chainIndex",
  },
  {
    name: "job_idx",
    type: "zset",
    key: (job) => keys.jobs("createdAt", "all", job.typeName),
    member: (job) => job.id,
    score: "createdAt",
  },
  {
    name: "job_status_idx",
    type: "zset",
    key: (job) => keys.jobs("createdAt", job.status, job.typeName),
    member: (job) => job.id,
    score: "createdAt",
  },
  {
    name: "job_pending_idx",
    type: "zset",
    where: { status: "pending" },
    key: (job) => keys.jobs("scheduledAt", "pending", job.typeName),
    member: (job) => job.id,
    score: "scheduledAt",
  },
  {
    name: "job_due_idx",
    type: "zset",
    where: { status: "pending" },
    key: (job) => keys.due(job.typeName),
    member: (job) => dueMember(job.seq, job.id),
    score: "scheduledAt",
  },
  {
    name: "job_blocked_idx",
    type: "zset",
    where: { status: "blocked" },
    key: (job) => keys.jobs("scheduledAt", "blocked", job.typeName),
    member: (job) => job.id,
    score: "scheduledAt",
  },
  {
    name: "job_running_idx",
    type: "zset",
    where: { status: "running" },
    key: (job) => keys.jobs("attemptAt", "running", job.typeName),
    member: (job) => job.id,
    score: "attemptAt",
  },
  {
    name: "job_completed_idx",
    type: "zset",
    where: { status: "completed" },
    key: (job) => keys.jobs("completedAt", "completed", job.typeName),
    member: (job) => job.id,
    score: "completedAt",
  },
  {
    name: "job_attempt_by_idx",
    type: "zset",
    where: { status: "running" },
    key: (job) => keys.running(job.attemptBy!),
    member: (job) => job.id,
    score: "attemptAt",
  },
  {
    name: "job_type_name_count",
    type: "counter",
    key: () => keys.jobTypeNames,
    member: (job) => job.typeName,
  },
  {
    name: "chain_idx",
    type: "zset",
    where: { chainIndex: 0 },
    key: (job) => keys.chains("createdAt", "all", job.typeName),
    member: (job) => job.id,
    score: "createdAt",
  },
  {
    name: "chain_status_idx",
    type: "zset",
    where: { chainIndex: 0 },
    key: (job) => keys.chains("createdAt", job.chainStatus!, job.typeName),
    member: (job) => job.id,
    score: "createdAt",
  },
  {
    name: "chain_completed_idx",
    type: "zset",
    where: { chainIndex: 0, chainStatus: "completed" },
    key: (job) => keys.chains("completedAt", "completed", job.typeName),
    member: (job) => job.id,
    score: "chainCompletedAt",
  },
  {
    name: "chain_type_name_count",
    type: "counter",
    where: { chainIndex: 0 },
    key: () => keys.chainTypeNames,
    member: (job) => job.typeName,
  },
  {
    name: "job_blocker_chain_idx",
    type: "set",
    each: (job) => job.blockers.map((blocker) => blocker.blockedByChainId),
    key: (_, blockedByChainId) => keys.blockedBy(blockedByChainId),
    member: (job) => job.id,
  },
  {
    name: "job_blocker_chain_created_idx",
    type: "zset",
    each: (job) => job.blockers.map((blocker) => blocker.blockedByChainId),
    key: (_, blockedByChainId) => keys.blockedJobs(blockedByChainId),
    member: (job) => job.id,
    score: "createdAt",
  },
  {
    name: "job_blocker_chain_count",
    type: "counter",
    each: (job) => job.blockers.map((blocker) => blocker.blockedByChainId),
    key: () => keys.blockerReferences,
    member: (_, blockedByChainId) => blockedByChainId,
  },
];

const createWorkerIndexes = (keys: RedisKeys): IndexDefinition<IndexedWorker>[] => [
  {
    name: "worker_idx",
    type: "zset",
    key: () => keys.workers,
    member: (worker) => worker.id,
    score: "startedAt",
  },
  {
    name: "worker_lease_idx",
    type: "zset",
    key: () => keys.workerLeases,
    member: (worker) => worker.id,
    score: "leaseUntil",
  },
  {
    name: "worker_type_idx",
    type: "zset",
    each: (worker) => worker.typeNames,
    key: (_, typeName) => keys.workersOfType(typeName),
    member: (worker) => worker.id,
    score: "startedAt",
  },
  {
    name: "worker_type_lease_idx",
    type: "zset",
    each: (worker) => worker.typeNames,
    key: (_, typeName) => keys.workerLeasesOfType(typeName),
    member: (worker) => worker.id,
    score: "leaseUntil",
  },
];

const compileIndexes = <TRecord>(
  definitions: IndexDefinition<TRecord>[],
): ((record: TRecord) => IndexEntries) => {
  const compiled = definitions.map((definition) => {
    const { key, member } = symbolicIndex(definition);
    const fields = [...new Set([...placeholderFields(key), ...placeholderFields(member)])].filter(
      (field) => field !== "each",
    );
    return {
      definition,
      where: Object.entries(definition.where ?? {}) as [keyof TRecord, unknown][],
      required: [
        ...fields,
        ...(definition.score === undefined ? [] : [definition.score]),
      ] as (keyof TRecord)[],
    };
  });
  return (record) => {
    const entries: IndexEntries = { zsets: [], sets: [], counters: [] };
    for (const { definition, where, required } of compiled) {
      if (where.some(([field, value]) => record[field] !== value)) continue;
      if (required.some((field) => record[field] === null || record[field] === undefined)) continue;
      const fanOut = definition.each === undefined ? [""] : new Set(definition.each(record));
      for (const each of fanOut) {
        const key = definition.key(record, each);
        const member = definition.member(record, each);
        if (definition.type === "zset") {
          entries.zsets.push([key, member, record[definition.score!] as number]);
        } else if (definition.type === "set") {
          entries.sets.push([key, member]);
        } else {
          entries.counters.push([key, member]);
        }
      }
    }
    return entries;
  };
};

export const createRedisSchema = (keyPrefix: string): RedisSchema => {
  const keys = createRedisKeys(keyPrefix);
  const jobIndexes = createJobIndexes(keys);
  const workerIndexes = createWorkerIndexes(keys);
  return {
    keyPrefix,
    keys,
    jobIndexes,
    workerIndexes,
    jobIndexEntries: compileIndexes(jobIndexes),
    workerIndexEntries: compileIndexes(workerIndexes),
  };
};

export const symbolicSchema: RedisSchema = createRedisSchema(placeholder("prefix"));

export const indexKeyHeads: { exact: boolean; head: string }[] = [
  ...new Map(
    [
      ...symbolicSchema.jobIndexes.map((definition) => symbolicIndex(definition).key),
      ...symbolicSchema.workerIndexes.map((definition) => symbolicIndex(definition).key),
    ].map((key) => {
      const [, , head, ...rest] = key.split("\0");
      return [head, { exact: rest.length === 0, head }] as const;
    }),
  ).values(),
];
