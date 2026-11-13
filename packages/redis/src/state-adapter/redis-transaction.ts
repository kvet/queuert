import { SchemaFencedError, type TxHooks } from "queuert";

import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

const TAKE_LUA = `
local cursor = 1
local function take()
  local value = ARGV[cursor]
  cursor = cursor + 1
  return value
end
`;

const READ_SCRIPT = `
${TAKE_LUA}
local allowed = {
  HGET = true, HMGET = true, HGETALL = true, ZRANGEBYSCORE = true, ZREVRANGEBYSCORE = true,
  ZCARD = true, ZCOUNT = true, ZSCORE = true, SMEMBERS = true, SCARD = true, SISMEMBER = true,
  GET = true
}
local out = {}
local index = 0
local total = #ARGV
while cursor <= total do
  local count = tonumber(take())
  local first = cursor
  local command = ARGV[first]
  cursor = cursor + count
  index = index + 1
  if command == 'LOCK' then
    local data = redis.call('HGET', ARGV[first + 1], 'd')
    if data and string.find(data, ARGV[first + 3], 1, true) then
      out[index] = redis.call('SET', ARGV[first + 2], ARGV[first + 4], 'NX', 'PX', ARGV[first + 5])
        and 1 or 0
    else
      out[index] = 0
    end
  elseif allowed[command] then
    out[index] = redis.call(unpack(ARGV, first, first + count - 1))
  else
    return redis.error_reply('queuert: ' .. tostring(command) .. ' is not a read command')
  end
end
out[index + 1] = redis.call('GET', KEYS[1]) or '0'
return out
`;

const CHECK_LUA = `
local lockToken = take()
for _ = 1, tonumber(take()) do
  local key = take()
  if redis.call('GET', key) == lockToken then
    redis.call('DEL', key)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  local field = take()
  local version = tonumber(take())
  if tonumber(redis.call('HGET', key, field) or '0') ~= version then
    return { 0, key, field }
  end
end
`;

const VALIDATE_SCRIPT = `
${TAKE_LUA}
${CHECK_LUA}
return 1
`;

export const FENCED_REPLY = "QUEUERT_SCHEMA_FENCED";

export const FENCE_LUA = (fenceKey: string, fenceVersion: string): string => `
if redis.call('SISMEMBER', ${fenceKey}, ${fenceVersion}) == 0 then
  return redis.error_reply('${FENCED_REPLY} the schema has no write fence of version ' .. ${fenceVersion})
end
`;

const COMMIT_SCRIPT = `
${TAKE_LUA}
local commitKey = take()
local commitTtlMs = take()
if redis.call('EXISTS', commitKey) == 1 then
  return 1
end
${CHECK_LUA}
local fenceKey = take()
local fenceVersion = take()
if fenceKey ~= '' then
  ${FENCE_LUA("fenceKey", "fenceVersion")}
end
local version = redis.call('INCR', KEYS[1])
local setVersionsKey = take()
for _ = 1, tonumber(take()) do
  local kind = take()
  local key = take()
  if kind == 'D' then
    redis.call('DEL', key)
  elseif kind == 'S' then
    redis.call('HSET', key, 'v', version, 'd', take())
    redis.call('HDEL', key, 'u')
  else
    local data = take()
    redis.call('HSET', key, 'v', version, 'd', data, 'u', take())
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  local member = take()
  redis.call('ZADD', key, take(), member)
end
for _ = 1, tonumber(take()) do
  local key = take()
  redis.call('ZREM', key, take())
end
local changedSets = {}
for _ = 1, tonumber(take()) do
  local key = take()
  if redis.call('SADD', key, take()) == 1 then
    changedSets[key] = true
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  if redis.call('SREM', key, take()) == 1 then
    changedSets[key] = true
  end
end
for setKey in pairs(changedSets) do
  if redis.call('SCARD', setKey) == 0 then
    redis.call('HDEL', setVersionsKey, setKey)
  else
    redis.call('HSET', setVersionsKey, setKey, version)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  local field = take()
  local count = redis.call('HINCRBY', key, field, take())
  if count <= 0 then
    redis.call('HDEL', key, field)
  end
end
redis.call('SET', commitKey, '1', 'PX', commitTtlMs)
return 1
`;

export type RedisStore = {
  provider: RedisStateProvider;
  sequenceKey: string;
  setVersionsKey: string;
  opaqueFields: string[];
  commitKeyPrefix: string;
  lock?: RedisStoreLock;
  fence?: RedisStoreFence;
};

export type RedisStoreFence = {
  key: string;
  version: number;
};

export const isFencedReply = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(FENCED_REPLY);

export const toSchemaFencedError = (error: unknown, version: number): unknown =>
  isFencedReply(error)
    ? new SchemaFencedError(
        `Write fenced: the schema has no write fence of version ${version}. A newer schema dropped it, or migrateToLatest() has not run yet`,
        { codeVersion: version, cause: error },
      )
    : error;

export type RedisStoreLock = {
  keyOf: (recordKey: string) => string;
  marker: string;
  ttlMs: number;
};

export const encodeRecord = (value: unknown, opaqueFields: string[]): [string, string | null] => {
  if (Array.isArray(value) || typeof value !== "object" || value === null) {
    return [JSON.stringify(value), null];
  }
  const system = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, fieldValue]) => fieldValue !== null,
    ),
  );
  const opaque: Record<string, unknown> = {};
  let hasOpaque = false;
  for (const field of opaqueFields) {
    if (field in system) {
      opaque[field] = system[field];
      delete system[field];
      hasOpaque = true;
    }
  }
  return [JSON.stringify(system), hasOpaque ? JSON.stringify(opaque) : null];
};

export const decodeRecord = (data: string, opaque: string | null | undefined): unknown =>
  opaque === null || opaque === undefined
    ? JSON.parse(data)
    : { ...JSON.parse(data), ...JSON.parse(opaque) };

type ReadOp = (string | number)[];

type RecordEntry = { version: number; value: unknown; readValue: unknown; written: boolean };

const commitMarkerTtlMs = 60_000;

export type ZsetMember = { member: string; score: number };

export type ZscanOptions = {
  direction: "asc" | "desc";
  min?: number;
  max?: number;
  after?: ZsetMember;
  batchSize: number;
};

export const compareZsetMembers = (a: ZsetMember, b: ZsetMember): number =>
  a.score !== b.score ? a.score - b.score : a.member < b.member ? -1 : a.member > b.member ? 1 : 0;

const parseZsetReply = (reply: unknown): ZsetMember[] => {
  const flat = reply as string[];
  const members: ZsetMember[] = [];
  for (let index = 0; index < flat.length; index += 2) {
    members.push({ member: flat[index], score: Number(flat[index + 1]) });
  }
  return members;
};

const scoreArgument = (score: number): string | number =>
  score === Infinity ? "+inf" : score === -Infinity ? "-inf" : score;

const cloneNested = <T>(map: Map<string, Map<string, T>>): Map<string, Map<string, T>> =>
  new Map([...map].map(([key, inner]) => [key, new Map(inner)]));

const getOrCreate = <T>(map: Map<string, Map<string, T>>, key: string): Map<string, T> => {
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  return inner;
};

export type RedisTransaction = {
  readonly tryNumber: number;
  isOpen: () => boolean;
};

export type RedisStoreTransaction = RedisTransaction & {
  readonly txHooks: TxHooks | undefined;
  requireFence: () => void;
  getRecords: (
    keys: string[],
    options?: { validatedSets?: string[]; lock?: boolean },
  ) => Promise<unknown[]>;
  foreignLocks: (recordKeys: string[]) => Promise<boolean[]>;
  assumeAbsent: (keys: string[]) => void;
  putRecord: (key: string, value: unknown) => void;
  zadd: (key: string, member: string, score: number) => void;
  zrem: (key: string, member: string) => void;
  sadd: (key: string, member: string) => void;
  srem: (key: string, member: string) => void;
  incr: (key: string, field: string, delta: number) => void;
  zscan: (key: string, options: ZscanOptions) => AsyncGenerator<ZsetMember>;
  zlastMany: (keys: string[]) => Promise<(ZsetMember | undefined)[]>;
  zscoreMany: (key: string, members: string[]) => Promise<(number | undefined)[]>;
  zcard: (key: string) => Promise<number>;
  zcardMany: (keys: string[]) => Promise<number[]>;
  zcountMany: (requests: { key: string; min: number; max: number }[]) => Promise<number[]>;
  scardMany: (keys: string[]) => Promise<number[]>;
  counterValues: (key: string, fields: string[]) => Promise<number[]>;
  smembers: (key: string, options?: { validate?: boolean }) => Promise<string[]>;
  scard: (key: string) => Promise<number>;
  counterEntries: (key: string) => Promise<Map<string, number>>;
  snapshot: () => () => void;
  commit: () => Promise<boolean>;
  rollback: () => Promise<{ stale: boolean }>;
};

export const createRedisTransaction = (
  store: RedisStore,
  txHooks: TxHooks | undefined,
  tryNumber = 1,
): RedisStoreTransaction => {
  let settled = false;
  let fenceRequired = false;
  let readRounds = 0;
  let firstSequence: string | undefined;
  let sequenceChanged = false;
  let records = new Map<string, RecordEntry>();
  let setChecks = new Map<string, number>();
  let validatedSets = new Map<string, string[]>();
  let zsets = new Map<string, Map<string, number | null>>();
  let sets = new Map<string, Map<string, boolean>>();
  let counters = new Map<string, Map<string, number>>();
  const heldLocks = new Set<string>();
  const lockToken = crypto.randomUUID();

  const assertOpen = (): void => {
    if (settled) throw new Error("The Redis transaction already committed or rolled back");
  };

  const read = async (ops: ReadOp[]): Promise<unknown[]> => {
    assertOpen();
    readRounds++;
    const args: string[] = [];
    for (const op of ops) {
      args.push(String(op.length));
      for (const token of op) args.push(String(token));
    }
    const replies = (await store.provider.eval(
      READ_SCRIPT,
      [store.sequenceKey],
      args,
    )) as unknown[];
    const sequence = String(replies.pop());
    if (firstSequence === undefined) firstSequence = sequence;
    else if (sequence !== firstSequence) sequenceChanged = true;
    return replies;
  };

  const checkArgs = (withChecks: boolean): string[] => {
    const args = [lockToken, String(heldLocks.size)];
    for (const lockKey of heldLocks) args.push(lockKey);
    if (!withChecks) {
      args.push("0");
      return args;
    }
    args.push(String(records.size + setChecks.size));
    for (const [key, entry] of records) args.push(key, "v", String(entry.version));
    for (const [key, version] of setChecks) args.push(store.setVersionsKey, key, String(version));
    return args;
  };

  const releaseLocksQuietly = async (): Promise<void> => {
    if (heldLocks.size === 0) return;
    await validate(false).catch(() => undefined);
  };

  const hasWrites = (): boolean => {
    for (const entry of records.values()) if (entry.written) return true;
    return zsets.size > 0 || sets.size > 0 || counters.size > 0;
  };

  const validate = async (withChecks = true): Promise<boolean> => {
    const result = await store.provider.eval(
      VALIDATE_SCRIPT,
      [store.sequenceKey],
      checkArgs(withChecks),
    );
    return result === 1 || result === "1";
  };

  const recordValidatedSet = (key: string, reply: unknown, version: unknown): void => {
    if (setChecks.has(key)) return;
    setChecks.set(key, version === null || version === undefined ? 0 : Number(version));
    validatedSets.set(key, (reply as string[]).map(String));
  };

  const smembers = async (key: string, options?: { validate?: boolean }): Promise<string[]> => {
    let remote = options?.validate === true ? validatedSets.get(key) : undefined;
    if (remote === undefined) {
      const validateSet = options?.validate === true;
      const [reply, version] = await read([
        ["SMEMBERS", key],
        ...(validateSet ? [["HGET", store.setVersionsKey, key]] : []),
      ]);
      if (validateSet) recordValidatedSet(key, reply, version);
      remote = (reply as string[]).map(String);
    }
    const members = new Set(remote);
    for (const [member, present] of sets.get(key) ?? []) {
      if (present) members.add(member);
      else members.delete(member);
    }
    return [...members];
  };

  async function* zscan(key: string, options: ZscanOptions): AsyncGenerator<ZsetMember> {
    const { direction, after, batchSize } = options;
    const sign = direction === "asc" ? 1 : -1;
    let min = options.min ?? -Infinity;
    let max = options.max ?? Infinity;
    if (after !== undefined) {
      if (direction === "asc") min = Math.max(min, after.score);
      else max = Math.min(max, after.score);
    }
    const isAfterStart = (candidate: ZsetMember): boolean =>
      after === undefined || compareZsetMembers(candidate, after) * sign > 0;
    const overlay = zsets.get(key) ?? new Map<string, number | null>();
    const pending = [...overlay]
      .filter(
        (entry): entry is [string, number] =>
          entry[1] !== null && entry[1] >= min && entry[1] <= max,
      )
      .map(([member, score]) => ({ member, score }))
      .filter(isAfterStart)
      .toSorted((a, b) => compareZsetMembers(a, b) * sign);
    let pendingIndex = 0;
    let anchor = direction === "asc" ? min : max;
    let seenAtAnchor = 0;
    while (true) {
      const [reply] = await read(
        [
          direction === "asc"
            ? ["ZRANGEBYSCORE", key, scoreArgument(anchor), scoreArgument(max)]
            : ["ZREVRANGEBYSCORE", key, scoreArgument(anchor), scoreArgument(min)],
        ].map((op) => [...op, "WITHSCORES", "LIMIT", seenAtAnchor, batchSize]),
      );
      const batch = parseZsetReply(reply);
      const last = batch.at(-1);
      if (last !== undefined) {
        const atLast = batch.filter(({ score }) => score === last.score).length;
        seenAtAnchor = last.score === anchor ? seenAtAnchor + atLast : atLast;
        anchor = last.score;
      }
      for (const remote of batch) {
        if (overlay.has(remote.member) || !isAfterStart(remote)) continue;
        while (
          pendingIndex < pending.length &&
          compareZsetMembers(pending[pendingIndex], remote) * sign < 0
        ) {
          yield pending[pendingIndex++];
        }
        yield remote;
      }
      if (batch.length < batchSize) break;
    }
    while (pendingIndex < pending.length) yield pending[pendingIndex++];
  }

  const mergeOverlay = (
    key: string,
    remote: ZsetMember[],
    min: number,
    max: number,
  ): ZsetMember[] => {
    const overlay = zsets.get(key);
    if (!overlay || overlay.size === 0) return remote;
    const merged = remote.filter(({ member }) => !overlay.has(member));
    for (const [member, score] of overlay) {
      if (score !== null && score >= min && score <= max) merged.push({ member, score });
    }
    return merged.toSorted(compareZsetMembers);
  };

  const commitWrites = async (): Promise<boolean> => {
    if (!hasWrites()) {
      if (readRounds <= 1 || !sequenceChanged || (records.size === 0 && setChecks.size === 0)) {
        if (heldLocks.size > 0) await validate(false);
        return true;
      }
      return validate();
    }
    const args = [
      `${store.commitKeyPrefix}${lockToken}`,
      String(commitMarkerTtlMs),
      ...checkArgs(true),
    ];
    const { fence } = store;
    if (fenceRequired && fence !== undefined) args.push(fence.key, String(fence.version));
    else args.push("", "");
    args.push(store.setVersionsKey);
    const countAt = args.length;
    args.push("0");
    let recordCount = 0;
    for (const [key, entry] of records) {
      if (!entry.written) continue;
      recordCount++;
      if (entry.value === undefined) {
        args.push("D", key);
        continue;
      }
      const [data, opaque] = encodeRecord(entry.value, store.opaqueFields);
      if (opaque === null) args.push("S", key, data);
      else args.push("U", key, data, opaque);
    }
    args[countAt] = String(recordCount);
    const pushGrouped = <T>(
      map: Map<string, Map<string, T>>,
      include: (value: T) => boolean,
      entry: (key: string, member: string, value: T) => string[],
    ) => {
      const groupCountAt = args.length;
      args.push("0");
      let count = 0;
      for (const [key, inner] of map) {
        for (const [member, value] of inner) {
          if (!include(value)) continue;
          count++;
          for (const token of entry(key, member, value)) args.push(token);
        }
      }
      args[groupCountAt] = String(count);
    };
    pushGrouped(
      zsets,
      (score) => score !== null,
      (key, member, score) => [key, member, String(score)],
    );
    pushGrouped(
      zsets,
      (score) => score === null,
      (key, member) => [key, member],
    );
    pushGrouped(
      sets,
      (present) => present,
      (key, member) => [key, member],
    );
    pushGrouped(
      sets,
      (present) => !present,
      (key, member) => [key, member],
    );
    pushGrouped(
      counters,
      (delta) => delta !== 0,
      (key, field, delta) => [key, field, String(delta)],
    );
    const result = await store.provider.eval(COMMIT_SCRIPT, [store.sequenceKey], args);
    return result === 1 || result === "1";
  };

  return {
    txHooks,

    tryNumber,

    isOpen: () => !settled,

    requireFence: () => {
      assertOpen();
      fenceRequired = true;
    },

    assumeAbsent: (keys) => {
      assertOpen();
      for (const key of keys) {
        if (!records.has(key)) {
          records.set(key, { version: 0, value: undefined, readValue: undefined, written: false });
        }
      }
    },

    getRecords: async (keys, options) => {
      assertOpen();
      const missing = [...new Set(keys.filter((key) => !records.has(key)))];
      const prefetchedSets = [...new Set(options?.validatedSets ?? [])].filter(
        (key) => !setChecks.has(key),
      );
      const { lock } = store;
      const locking =
        options?.lock === true && lock !== undefined
          ? [...new Set(keys)]
              .map((key) => ({ key, lockKey: lock.keyOf(key) }))
              .filter(({ lockKey }) => !heldLocks.has(lockKey))
          : [];
      if (missing.length > 0 || prefetchedSets.length > 0 || locking.length > 0) {
        const replies = await read([
          ...missing.map((key) => ["HMGET", key, "v", "d", "u"]),
          ...prefetchedSets.flatMap((key) => [
            ["SMEMBERS", key],
            ["HGET", store.setVersionsKey, key],
          ]),
          ...locking.map(({ key, lockKey }) => [
            "LOCK",
            key,
            lockKey,
            lock!.marker,
            lockToken,
            lock!.ttlMs,
          ]),
        ]);
        const lockReplies = replies.slice(missing.length + prefetchedSets.length * 2);
        for (const [index, { lockKey }] of locking.entries()) {
          if (Number(lockReplies[index]) === 1) heldLocks.add(lockKey);
        }
        for (const [index, key] of prefetchedSets.entries()) {
          recordValidatedSet(
            key,
            replies[missing.length + index * 2],
            replies[missing.length + index * 2 + 1],
          );
        }
        for (const [index, key] of missing.entries()) {
          if (records.has(key)) continue;
          const [version, data, opaque] = replies[index] as [
            string | null,
            string | null,
            string | null,
          ];
          const value = data === null ? undefined : decodeRecord(data, opaque);
          records.set(key, {
            version: version === null ? 0 : Number(version),
            value,
            readValue: value,
            written: false,
          });
        }
      }
      return keys.map((key) => records.get(key)!.value);
    },

    foreignLocks: async (recordKeys) => {
      const { lock } = store;
      if (lock === undefined || recordKeys.length === 0) return recordKeys.map(() => false);
      const holders = await read(recordKeys.map((key) => ["GET", lock.keyOf(key)]));
      return holders.map(
        (holder) => holder !== null && holder !== undefined && holder !== lockToken,
      );
    },

    putRecord: (key, value) => {
      assertOpen();
      const entry = records.get(key);
      if (!entry) throw new Error(`Redis record ${key} must be read before it is written`);
      entry.value = value;
      entry.written = true;
    },

    zadd: (key, member, score) => {
      assertOpen();
      getOrCreate(zsets, key).set(member, score);
    },

    zrem: (key, member) => {
      assertOpen();
      getOrCreate(zsets, key).set(member, null);
    },

    sadd: (key, member) => {
      assertOpen();
      getOrCreate(sets, key).set(member, true);
    },

    srem: (key, member) => {
      assertOpen();
      getOrCreate(sets, key).set(member, false);
    },

    incr: (key, field, delta) => {
      assertOpen();
      const inner = getOrCreate(counters, key);
      inner.set(field, (inner.get(field) ?? 0) + delta);
    },

    zscan,

    zlastMany: async (keys) => {
      if (keys.length === 0) return [];
      const replies = await read(
        keys.map((key) => [
          "ZREVRANGEBYSCORE",
          key,
          "+inf",
          "-inf",
          "WITHSCORES",
          "LIMIT",
          0,
          1 + (zsets.get(key)?.size ?? 0),
        ]),
      );
      return keys.map((key, index) =>
        mergeOverlay(key, parseZsetReply(replies[index]), -Infinity, Infinity).at(-1),
      );
    },

    zscoreMany: async (key, members) => {
      if (members.length === 0) return [];
      const overlay = zsets.get(key);
      const remote = members.filter((member) => !overlay?.has(member));
      const replies =
        remote.length > 0 ? await read(remote.map((member) => ["ZSCORE", key, member])) : [];
      const scores = new Map<string, number | null>(overlay);
      for (const [index, member] of remote.entries()) {
        const reply = replies[index];
        scores.set(member, reply === null || reply === undefined ? null : Number(reply));
      }
      return members.map((member) => scores.get(member) ?? undefined);
    },

    zcard: async (key) => {
      const overlay = [...(zsets.get(key) ?? [])];
      const [count, ...scores] = await read([
        ["ZCARD", key],
        ...overlay.map(([member]) => ["ZSCORE", key, member]),
      ]);
      return overlay.reduce(
        (total, [, score], index) =>
          total + (score === null ? 0 : 1) - (scores[index] === null ? 0 : 1),
        Number(count),
      );
    },

    zcardMany: async (keys) => {
      if (keys.length === 0) return [];
      const overlays = keys.map((key) => [...(zsets.get(key) ?? [])]);
      const replies = await read(
        keys.flatMap((key, index) => [
          ["ZCARD", key],
          ...overlays[index].map(([member]) => ["ZSCORE", key, member]),
        ]),
      );
      let position = 0;
      return keys.map((_, index) => {
        let count = Number(replies[position++]);
        for (const [, score] of overlays[index]) {
          const existed = replies[position++] !== null;
          count += (score === null ? 0 : 1) - (existed ? 1 : 0);
        }
        return count;
      });
    },

    zcountMany: async (requests) => {
      if (requests.length === 0) return [];
      const overlays = requests.map(({ key }) => [...(zsets.get(key) ?? [])]);
      const replies = await read(
        requests.flatMap(({ key, min, max }, index) => [
          ["ZCOUNT", key, scoreArgument(min), scoreArgument(max)],
          ...overlays[index].map(([member]) => ["ZSCORE", key, member]),
        ]),
      );
      let position = 0;
      return requests.map(({ min, max }, index) => {
        let count = Number(replies[position++]);
        const inRange = (score: number | null) => score !== null && score >= min && score <= max;
        for (const [, score] of overlays[index]) {
          const reply = replies[position++];
          const remoteScore = reply === null || reply === undefined ? null : Number(reply);
          count += (inRange(score) ? 1 : 0) - (inRange(remoteScore) ? 1 : 0);
        }
        return count;
      });
    },

    scardMany: async (keys) => {
      if (keys.length === 0) return [];
      const overlays = keys.map((key) => [...(sets.get(key) ?? [])]);
      const replies = await read(
        keys.flatMap((key, index) => [
          ["SCARD", key],
          ...overlays[index].map(([member]) => ["SISMEMBER", key, member]),
        ]),
      );
      let position = 0;
      return keys.map((_, index) => {
        let count = Number(replies[position++]);
        for (const [, present] of overlays[index]) {
          count += (present ? 1 : 0) - Number(replies[position++]);
        }
        return count;
      });
    },

    counterValues: async (key, fields) => {
      if (fields.length === 0) return [];
      const [reply] = await read([["HMGET", key, ...fields]]);
      const deltas = counters.get(key);
      return (reply as (string | null)[]).map(
        (value, index) => Number(value ?? 0) + (deltas?.get(fields[index]) ?? 0),
      );
    },

    smembers,

    scard: async (key) => {
      const overlay = [...(sets.get(key) ?? [])];
      const [count, ...memberships] = await read([
        ["SCARD", key],
        ...overlay.map(([member]) => ["SISMEMBER", key, member]),
      ]);
      return overlay.reduce(
        (total, [, present], index) => total + (present ? 1 : 0) - Number(memberships[index]),
        Number(count),
      );
    },

    counterEntries: async (key) => {
      const [reply] = await read([["HGETALL", key]]);
      const flat = reply as string[];
      const counts = new Map<string, number>();
      for (let index = 0; index < flat.length; index += 2) {
        counts.set(flat[index], Number(flat[index + 1]));
      }
      for (const [field, delta] of counters.get(key) ?? []) {
        counts.set(field, (counts.get(field) ?? 0) + delta);
      }
      for (const [field, count] of counts) {
        if (count <= 0) counts.delete(field);
      }
      return counts;
    },

    snapshot: () => {
      assertOpen();
      const savedRecords = new Map([...records].map(([key, entry]) => [key, { ...entry }]));
      const savedZsets = cloneNested(zsets);
      const savedSets = cloneNested(sets);
      const savedCounters = cloneNested(counters);
      const savedFenceRequired = fenceRequired;
      return () => {
        fenceRequired = savedFenceRequired;
        for (const [key, entry] of records) {
          if (!savedRecords.has(key)) {
            savedRecords.set(key, { ...entry, value: entry.readValue, written: false });
          }
        }
        records = savedRecords;
        zsets = savedZsets;
        sets = savedSets;
        counters = savedCounters;
      };
    },

    commit: async () => {
      assertOpen();
      settled = true;
      try {
        return await commitWrites();
      } catch (error) {
        await releaseLocksQuietly();
        const { fence } = store;
        throw fence === undefined ? error : toSchemaFencedError(error, fence.version);
      }
    },

    rollback: async () => {
      if (settled) return { stale: false };
      settled = true;
      try {
        if (records.size === 0 && setChecks.size === 0) {
          if (heldLocks.size > 0) await validate(false);
          return { stale: false };
        }
        return { stale: !(await validate()) };
      } catch (error) {
        await releaseLocksQuietly();
        throw error;
      }
    },
  };
};

export type RedisStoreContext = { transaction: RedisStoreTransaction };
