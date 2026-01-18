# Redis Notify Adapter (node-redis)

This example demonstrates the Redis notify adapter with node-redis.

## What it demonstrates

- Redis pub/sub notifications via `@queuert/redis`
- Integration with node-redis client
- How to configure the RedisNotifyProvider

## What it does

1. Starts Redis using testcontainers
2. Creates Redis connections for commands and subscriptions
3. Sets up Queuert with Redis notify adapter and in-process state adapter
4. Starts a worker that processes `greet` jobs
5. Queues a job and waits for completion
6. Cleans up resources

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-notify-redis start
```
