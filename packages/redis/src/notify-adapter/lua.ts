/**
 * Atomically sets a hint counter and publishes a notification.
 *
 * KEYS[1] = hint key (e.g., "queuert:job-hint:{hintId}")
 * KEYS[2] = channel (e.g., "queuert:job-scheduled:{typeName}")
 * ARGV[1] = count (number of jobs scheduled)
 * ARGV[2] = hintId (message to publish)
 */
export const SET_AND_PUBLISH_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', 60)
redis.call('PUBLISH', KEYS[2], ARGV[2])
`;

/**
 * Atomically decrements a hint counter if positive.
 * Used by workers to determine if they should query the database.
 *
 * KEYS[1] = hint key
 *
 * Returns:
 *   1 = success (worker should query DB)
 *   0 = hint exhausted (worker should skip)
 */
export const DECR_IF_POSITIVE_SCRIPT = `
local result = redis.call('DECR', KEYS[1])
if result >= 0 then
    return 1
end
redis.call('SET', KEYS[1], '0')
return 0
`;
