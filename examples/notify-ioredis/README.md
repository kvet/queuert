# Redis Notify Adapter (ioredis)

This example demonstrates the Redis notify adapter with ioredis.

## What it demonstrates

- Redis pub/sub notifications via `@queuert/redis`
- Integration with ioredis client
- How to configure the RedisNotifyProvider for ioredis

## ioredis vs node-redis

The main differences when using ioredis:

1. **Auto-connection**: ioredis connects automatically, no need to call `connect()`
2. **Message events**: ioredis uses a single `'message'` event for all subscriptions, requiring you to track handlers per channel
3. **Eval signature**: ioredis uses `eval(script, numKeys, ...keys, ...args)` instead of `eval(script, { keys, arguments })`

## What it does

1. Starts Redis using testcontainers
2. Creates ioredis connections for commands and subscriptions
3. Sets up Queuert with Redis notify adapter and in-process state adapter
4. Starts a worker that processes `greet` jobs
5. Queues a job and waits for completion
6. Cleans up resources

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-notify-ioredis start
```
