import { FENCE_LUA } from "./redis-transaction.ts";
import { indexTransitionLua, keyLua } from "./schema-lua.ts";
import { dueJobIdLua, placeholder, symbolicSchema } from "./schema.redis.ts";

const { keys } = symbolicSchema;

const claimIndexMovesLua = indexTransitionLua({
  definitions: symbolicSchema.jobIndexes,
  record: "job",
  changed: ["status", "attempt", "attemptAt", "attemptBy", "attemptToken"],
  nonNull: [
    "id",
    "typeName",
    "chainId",
    "chainIndex",
    "seq",
    "createdAt",
    "scheduledAt",
    "attemptAt",
    "attemptBy",
  ],
  before: { status: "pending", attemptAt: null, attemptBy: null },
  after: { status: "running" },
});

const keyOf = (build: (field: string) => string, variable: string): string =>
  keyLua(build(placeholder("value")), { value: variable });

export const CLAIM_SCRIPT: string = `
local args = cjson.decode(ARGV[1])
local prefix = args.prefix
local claimKey = ${keyOf(keys.claim, "args.attemptTokens[1]")}
local previous = redis.call('GET', claimKey)
if previous then
  return cjson.decode(previous)
end
${FENCE_LUA("args.fenceKey", "args.fenceVersion")}
local workerData = redis.call('HGET', ${keyOf(keys.worker, "args.workerId")}, 'd')
if not workerData then
  return {}
end
local worker = cjson.decode(workerData)
if worker.token ~= args.workerToken or worker.leaseUntil <= args.now then
  return {}
end

local candidates = {}
local pageSize = args.limit + args.lockedSlack
for _, typeName in ipairs(args.typeNames) do
  local dueKey = ${keyOf(keys.due, "typeName")}
  local found = 0
  local offset = 0
  while found < args.limit and offset < args.scanCap do
    local due = redis.call(
      'ZRANGEBYSCORE', dueKey, '-inf', args.now, 'WITHSCORES', 'LIMIT', offset, pageSize
    )
    for index = 1, #due, 2 do
      local member = due[index]
      local id = ${dueJobIdLua("member")}
      if redis.call('EXISTS', ${keyOf(keys.jobLock, "id")}) == 0 then
        table.insert(candidates, { member = member, id = id, score = tonumber(due[index + 1]) })
        found = found + 1
        if found >= args.limit then
          break
        end
      end
    end
    if #due < pageSize * 2 then
      break
    end
    offset = offset + pageSize
  end
end
table.sort(candidates, function(a, b)
  if a.score ~= b.score then
    return a.score < b.score
  end
  return a.member < b.member
end)

local version = nil
local claimed = {}
local claimedCount = 0
for index = 1, #candidates do
  if claimedCount >= args.limit then
    break
  end
  local id = candidates[index].id
  local jobKey = ${keyOf(keys.job, "id")}
  local data = redis.call('HGET', jobKey, 'd')
  if data then
    local job = cjson.decode(data)
    if job.status == 'pending' then
      version = version or redis.call('INCR', KEYS[1])
      job.status = 'running'
      job.attempt = job.attempt + 1
      job.attemptAt = args.now
      job.attemptBy = args.workerId
      claimedCount = claimedCount + 1
      job.attemptToken = args.attemptTokens[claimedCount]
      local encoded = cjson.encode(job)
      redis.call('HSET', jobKey, 'v', version, 'd', encoded)
${claimIndexMovesLua}
      table.insert(claimed, encoded)
      table.insert(claimed, redis.call('HGET', jobKey, 'u') or false)
      if job.chainId == id then
        table.insert(claimed, false)
        table.insert(claimed, false)
      else
        local headKey = ${keyOf(keys.job, "job.chainId")}
        table.insert(claimed, redis.call('HGET', headKey, 'd') or false)
        table.insert(claimed, redis.call('HGET', headKey, 'u') or false)
      end
    end
  end
end
if #claimed > 0 then
  redis.call('SET', claimKey, cjson.encode(claimed), 'PX', args.replayTtlMs)
end
return claimed
`;
