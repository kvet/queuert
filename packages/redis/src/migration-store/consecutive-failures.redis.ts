import { decodeRecord, encodeRecord } from "../state-adapter/redis-transaction.ts";
import { type RedisSchema, opaqueRecordFields } from "../state-adapter/schema.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

const SCAN_JOBS_SCRIPT = `
local result = redis.call('ZSCAN', ARGV[1], ARGV[2], 'COUNT', ARGV[3])
local reply = { result[1] }
for index = 1, #result[2], 2 do
  local key = ARGV[4] .. result[2][index]
  local fields = redis.call('HMGET', key, 'd', 'u')
  table.insert(reply, key)
  table.insert(reply, fields[1] or false)
  table.insert(reply, fields[2] or false)
end
return reply
`;

const WRITE_JOBS_SCRIPT = `
local version = redis.call('INCR', KEYS[1])
for index = 1, #ARGV, 3 do
  local key, data, opaque = ARGV[index], ARGV[index + 1], ARGV[index + 2]
  if redis.call('EXISTS', key) == 1 then
    redis.call('HSET', key, 'v', version, 'd', data)
    if opaque == '' then
      redis.call('HDEL', key, 'u')
    else
      redis.call('HSET', key, 'u', opaque)
    end
  end
end
return 1
`;

const withConsecutiveFailures = (job: Record<string, unknown>): Record<string, unknown> =>
  "consecutiveFailures" in job
    ? job
    : { ...job, consecutiveFailures: (job.lastAttemptError ?? null) === null ? 0 : 1 };

export const rewriteConsecutiveFailures = async ({
  stateProvider,
  schema: { keys },
  assertLockHeld,
}: {
  stateProvider: RedisStateProvider;
  schema: RedisSchema;
  assertLockHeld: () => void;
}): Promise<void> => {
  const typeNames = (await stateProvider.eval(
    "return redis.call('HKEYS', KEYS[1])",
    [keys.jobTypeNames],
    [],
  )) as string[];
  for (const typeName of typeNames) {
    let cursor = "0";
    do {
      assertLockHeld();
      const [next, ...fields] = (await stateProvider.eval(
        SCAN_JOBS_SCRIPT,
        [keys.sequence],
        [keys.jobs("createdAt", "all", typeName), cursor, "500", keys.job("")],
      )) as (string | null)[];
      cursor = next!;
      const writes: string[] = [];
      for (let index = 0; index < fields.length; index += 3) {
        const [key, data, opaque] = fields.slice(index, index + 3);
        if (data === null) continue;
        const [nextData, nextOpaque] = encodeRecord(
          withConsecutiveFailures(decodeRecord(data, opaque) as Record<string, unknown>),
          opaqueRecordFields,
        );
        writes.push(key!, nextData, nextOpaque ?? "");
      }
      if (writes.length > 0) {
        await stateProvider.eval(WRITE_JOBS_SCRIPT, [keys.sequence], writes);
      }
    } while (cursor !== "0");
  }
};
