import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { decodeRecord, encodeRecord } from "./redis-transaction.ts";
import { type RedisSchema, opaqueRecordFields } from "./state-schema.redis.ts";

const SCAN_JOBS_SCRIPT = `
local result = redis.call('ZSCAN', ARGV[1], ARGV[2], 'COUNT', ARGV[3])
local reply = { result[1] }
for index = 1, #result[2], 2 do
  local key = ARGV[4] .. result[2][index]
  local fields = redis.call('HMGET', key, 'v', 'd', 'u')
  table.insert(reply, key)
  table.insert(reply, fields[1] or false)
  table.insert(reply, fields[2] or false)
  table.insert(reply, fields[3] or false)
end
return reply
`;

const WRITE_JOBS_SCRIPT = `
local version = redis.call('INCR', KEYS[1])
for index = 1, #ARGV, 4 do
  local key, scanned, data, opaque = ARGV[index], ARGV[index + 1], ARGV[index + 2], ARGV[index + 3]
  if redis.call('HGET', key, 'v') == scanned then
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
      for (let index = 0; index < fields.length; index += 4) {
        const [key, version, data, opaque] = fields.slice(index, index + 4);
        if (version === null || data === null) continue;
        const job = decodeRecord(data, opaque) as Record<string, unknown>;
        if ("consecutiveFailures" in job) continue;
        const [nextData, nextOpaque] = encodeRecord(
          { ...job, consecutiveFailures: (job.lastAttemptError ?? null) === null ? 0 : 1 },
          opaqueRecordFields,
        );
        writes.push(key!, version, nextData, nextOpaque ?? "");
      }
      if (writes.length > 0) {
        await stateProvider.eval(WRITE_JOBS_SCRIPT, [keys.sequence], writes);
      }
    } while (cursor !== "0");
  }
};
