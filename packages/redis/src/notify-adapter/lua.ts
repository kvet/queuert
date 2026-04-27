/**
 * Adds `count` to the wake-hint counter for a typeName, refreshing the 60s TTL.
 * Composes additively across concurrent publishers.
 *
 * KEYS[1] = hint key (e.g., "queuert:hint:{typeName}")
 * ARGV[1] = count to add
 */
export const PROVIDE_WAKE_HINT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1])) or 0
redis.call('SET', KEYS[1], current + tonumber(ARGV[1]), 'EX', 60)
`;

/**
 * Atomically claims one slot of a wake-hint budget.
 *
 * KEYS[1] = hint key
 *
 * Returns:
 *   1 = caller should wake (slot claimed, OR hint key absent — graceful degradation)
 *   0 = budget exhausted (another consumer claimed all slots)
 */
export const CONSUME_WAKE_HINT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 1
end
local n = tonumber(current)
if n and n > 0 then
  redis.call('DECR', KEYS[1])
  return 1
end
return 0
`;
