import type { StateJobBlockerInfo } from "queuert";
import { type DumpJobRow, type StateDump, createDumpRowMapper } from "queuert/conformance-internal";

import { encodeRecord } from "../state-adapter/redis-transaction.ts";
import {
  type IndexEntries,
  createRedisSchema,
  opaqueRecordFields,
} from "../state-adapter/schema.redis.ts";
import {
  type StoredJob,
  type StoredWorker,
  nextSeq,
} from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

const WRITE_SCRIPT = `
local cursor = 1
local function take()
  local value = ARGV[cursor]
  cursor = cursor + 1
  return value
end
local version = redis.call('INCR', KEYS[1])
local setVersionsKey = take()
for _ = 1, tonumber(take()) do
  local key = take()
  local data = take()
  local opaque = take()
  if opaque == '' then
    redis.call('HSET', key, 'v', version, 'd', data)
  else
    redis.call('HSET', key, 'v', version, 'd', data, 'u', opaque)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  local member = take()
  redis.call('ZADD', key, take(), member)
end
for _ = 1, tonumber(take()) do
  local key = take()
  if redis.call('SADD', key, take()) == 1 then
    redis.call('HSET', setVersionsKey, key, version)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  redis.call('HINCRBY', key, take(), 1)
end
return 1
`;

const WRITE_BATCH_ARGUMENTS = 50_000;

const NO_INDEX_ENTRIES: IndexEntries = { zsets: [], sets: [], counters: [] };

const toStoredJob = (
  row: DumpJobRow,
  blockers: StateJobBlockerInfo[],
  hasDependents: boolean,
): StoredJob => ({
  id: row.id,
  typeName: row.typeName,
  chainId: row.chainId,
  chainIndex: row.chainIndex,
  status: row.status,
  createdAt: row.createdAt,
  input: row.input,
  scheduledAt: row.scheduledAt,
  completedAt: row.completedAt,
  completedBy: row.completedBy,
  continuedToId: row.continuedToId,
  output: row.output,
  attempt: row.attempt,
  lastAttemptError: row.lastAttemptError,
  lastAttemptAt: row.lastAttemptAt,
  attemptAt: row.attemptAt,
  attemptBy: row.attemptBy,
  attemptToken: row.attemptToken,
  traceContext: row.traceContext,
  chainStatus: row.chainStatus,
  chainCompletedAt: row.chainCompletedAt,
  deduplicationKey: row.chainDeduplicationKey,
  chainTraceContext: row.chainTraceContext,
  seq: nextSeq(new Date(row.createdAt)),
  hasDependents,
  blockers: blockers.map(({ blockedByChainId, index, traceContext }) => ({
    blockedByChainId,
    index,
    traceContext,
  })),
});

export const loadStateDump = async (
  stateProvider: RedisStateProvider,
  dump: StateDump,
  { offsetMs, keyPrefix = "{queuert}:" }: { offsetMs: number; keyPrefix?: string },
): Promise<void> => {
  const schema = createRedisSchema(keyPrefix);
  const { keys } = schema;
  const mapRow = createDumpRowMapper(dump, offsetMs);

  let records: string[] = [];
  let zsets: string[] = [];
  let sets: string[] = [];
  let counters: string[] = [];

  const flush = async () => {
    if (records.length === 0) return;
    await stateProvider.eval(
      WRITE_SCRIPT,
      [keys.sequence],
      [
        keys.setVersions,
        String(records.length / 3),
        ...records,
        String(zsets.length / 3),
        ...zsets,
        String(sets.length / 2),
        ...sets,
        String(counters.length / 2),
        ...counters,
      ],
    );
    records = [];
    zsets = [];
    sets = [];
    counters = [];
  };

  const write = async (key: string, record: unknown, entries: IndexEntries) => {
    const [data, opaque] = encodeRecord(record, opaqueRecordFields);
    records.push(key, data, opaque ?? "");
    for (const [indexKey, member, score] of entries.zsets) {
      zsets.push(indexKey, member, String(score));
    }
    for (const [indexKey, member] of entries.sets) sets.push(indexKey, member);
    for (const [indexKey, field] of entries.counters) counters.push(indexKey, field);
    if (records.length + zsets.length + sets.length + counters.length >= WRITE_BATCH_ARGUMENTS) {
      await flush();
    }
  };

  const blockersByJobId = Map.groupBy(dump.blockers, (blocker) => blocker.jobId);
  const referencedChainIds = new Set(dump.blockers.map((blocker) => blocker.blockedByChainId));
  for (const job of dump.jobs) {
    const stored = toStoredJob(
      mapRow.job(job),
      blockersByJobId.get(job.id) ?? [],
      job.chainIndex === 0 && referencedChainIds.has(job.id),
    );
    await write(keys.job(stored.id), stored, schema.jobIndexEntries(stored));
  }

  const deduplicatedChainIds = Map.groupBy(
    dump.chains
      .filter((chain) => chain.deduplicationKey !== null)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    (chain) => keys.deduplication(chain.typeName, chain.deduplicationKey!),
  );
  for (const [key, chains] of deduplicatedChainIds) {
    await write(
      key,
      chains.map((chain) => chain.id),
      NO_INDEX_ENTRIES,
    );
  }

  for (const worker of dump.workers) {
    const stored: StoredWorker = mapRow.worker(worker);
    await write(keys.worker(stored.id), stored, schema.workerIndexEntries(stored));
  }

  await flush();
};
