import { decodeRecord } from "../state-adapter/redis-transaction.ts";
import {
  type IndexEntries,
  type RedisSchema,
  indexKeyHeads,
} from "../state-adapter/schema.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

const SCAN_RECORDS_SCRIPT = `
local result = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3])
local reply = { result[1] }
for _, key in ipairs(result[2]) do
  local fields = redis.call('HMGET', key, 'd', 'u')
  table.insert(reply, fields[1] or false)
  table.insert(reply, fields[2] or false)
end
return reply
`;

const WRITE_SHADOWS_SCRIPT = `
local cursor = 1
local function take()
  local value = ARGV[cursor]
  cursor = cursor + 1
  return value
end
for _ = 1, tonumber(take()) do
  local key = take()
  local member = take()
  redis.call('ZADD', key, take(), member)
end
for _ = 1, tonumber(take()) do
  local key = take()
  redis.call('SADD', key, take())
end
for _ = 1, tonumber(take()) do
  local key = take()
  redis.call('HINCRBY', key, take(), 1)
end
return 1
`;

const DROP_SHADOWS_SCRIPT = `
local result = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3])
for _, key in ipairs(result[2]) do
  redis.call('UNLINK', key)
end
return result[1]
`;

const DROP_STALE_SCRIPT = `
local cursor, pattern, count, prefix, shadowPrefix, setVersionsKey =
  ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6]
local heads = {}
for index = 7, #ARGV, 2 do
  table.insert(heads, { exact = ARGV[index] == 'exact', text = prefix .. ARGV[index + 1] })
end
local function isIndexKey(key)
  for _, head in ipairs(heads) do
    if head.exact then
      if key == head.text then
        return true
      end
    elseif string.sub(key, 1, #head.text) == head.text then
      return true
    end
  end
  return false
end
local result = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', count)
for _, key in ipairs(result[2]) do
  if isIndexKey(key)
    and redis.call('EXISTS', shadowPrefix .. string.sub(key, #prefix + 1)) == 0 then
    redis.call('HDEL', setVersionsKey, key)
    redis.call('UNLINK', key)
  end
end
return result[1]
`;

const SWAP_SHADOWS_SCRIPT = `
local cursor, pattern, count, prefix, shadowPrefix, setVersionsKey =
  ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6]
local version = nil
local function sameSet(key, shadow)
  return redis.call('TYPE', key).ok == 'set'
    and redis.call('SCARD', key) == redis.call('SCARD', shadow)
    and #redis.call('SDIFF', shadow, key) == 0
end
local result = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', count)
for _, shadow in ipairs(result[2]) do
  local shadowType = redis.call('TYPE', shadow).ok
  if shadowType ~= 'none' then
    local key = prefix .. string.sub(shadow, #shadowPrefix + 1)
    if shadowType == 'set' then
      if not sameSet(key, shadow) or redis.call('HEXISTS', setVersionsKey, key) == 0 then
        version = version or redis.call('INCR', KEYS[1])
        redis.call('HSET', setVersionsKey, key, version)
      end
    end
    redis.call('UNLINK', key)
    redis.call('RENAME', shadow, key)
  end
end
return result[1]
`;

const DROP_STALE_SET_VERSIONS_SCRIPT = `
local result = redis.call('HSCAN', KEYS[2], ARGV[1], 'COUNT', ARGV[2])
local entries = result[2]
for index = 1, #entries, 2 do
  local key = entries[index]
  if redis.call('TYPE', key).ok ~= 'set' then
    redis.call('HDEL', KEYS[2], key)
  end
end
return result[1]
`;

const escapeGlob = (text: string): string => text.replaceAll(/[*?[\]\\]/g, "\\$&");

export const rebuildIndexes = async ({
  stateProvider,
  schema,
  assertLockHeld,
  batchSize = 500,
}: {
  stateProvider: RedisStateProvider;
  schema: RedisSchema;
  assertLockHeld: () => void;
  batchSize?: number;
}): Promise<void> => {
  const { keyPrefix, keys } = schema;
  const anchor = [keys.sequence];
  const shadowPrefix = keys.indexRebuild(keyPrefix);
  const count = String(batchSize);

  const scanAll = async (
    script: string,
    args: (cursor: string) => string[],
    scriptKeys: string[] = anchor,
  ): Promise<void> => {
    let cursor = "0";
    do {
      assertLockHeld();
      cursor = String(await stateProvider.eval(script, scriptKeys, args(cursor)));
    } while (cursor !== "0");
  };

  const shadowPattern = `${escapeGlob(shadowPrefix)}*`;
  await scanAll(DROP_SHADOWS_SCRIPT, (cursor) => [cursor, shadowPattern, count]);

  const buildShadows = async (
    pattern: string,
    entriesOf: (record: never) => IndexEntries,
  ): Promise<void> => {
    let cursor = "0";
    do {
      assertLockHeld();
      const [next, ...fields] = (await stateProvider.eval(SCAN_RECORDS_SCRIPT, anchor, [
        cursor,
        pattern,
        count,
      ])) as (string | null)[];
      cursor = String(next);
      const zsets: string[] = [];
      const sets: string[] = [];
      const counters: string[] = [];
      for (let index = 0; index < fields.length; index += 2) {
        const data = fields[index];
        if (data === null) continue;
        const entries = entriesOf(decodeRecord(data, fields[index + 1]) as never);
        for (const [key, member, score] of entries.zsets) {
          zsets.push(keys.indexRebuild(key), member, String(score));
        }
        for (const [key, member] of entries.sets) sets.push(keys.indexRebuild(key), member);
        for (const [key, field] of entries.counters) counters.push(keys.indexRebuild(key), field);
      }
      if (zsets.length + sets.length + counters.length > 0) {
        await stateProvider.eval(WRITE_SHADOWS_SCRIPT, anchor, [
          String(zsets.length / 3),
          ...zsets,
          String(sets.length / 2),
          ...sets,
          String(counters.length / 2),
          ...counters,
        ]);
      }
    } while (cursor !== "0");
  };

  const prefixPattern = escapeGlob(keyPrefix);
  await buildShadows(`${escapeGlob(keys.job(""))}*`, schema.jobIndexEntries);
  await buildShadows(`${escapeGlob(keys.worker(""))}*`, schema.workerIndexEntries);

  const headArgs = indexKeyHeads.flatMap(({ exact, head }) => [exact ? "exact" : "prefix", head]);
  await scanAll(DROP_STALE_SCRIPT, (cursor) => [
    cursor,
    `${prefixPattern}*`,
    count,
    keyPrefix,
    shadowPrefix,
    keys.setVersions,
    ...headArgs,
  ]);
  await scanAll(SWAP_SHADOWS_SCRIPT, (cursor) => [
    cursor,
    shadowPattern,
    count,
    keyPrefix,
    shadowPrefix,
    keys.setVersions,
  ]);

  await scanAll(DROP_STALE_SET_VERSIONS_SCRIPT, (cursor) => [cursor, count], [
    keys.sequence,
    keys.setVersions,
  ]);
};
