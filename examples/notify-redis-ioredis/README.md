# Redis Notify Adapter (ioredis)

This example demonstrates the Redis notify adapter with ioredis.

## What it demonstrates

- Redis pub/sub notifications via `@queuert/redis`
- Integration with ioredis client
- Background job processing with `waitForJobChainCompletion`
- Main thread continues working while jobs process asynchronously

## ioredis vs node-redis

The main differences when using ioredis:

1. **Auto-connection**: ioredis connects automatically, no need to call `connect()`
2. **Message events**: ioredis uses a single `'message'` event for all subscriptions, requiring you to track handlers per channel
3. **Eval signature**: ioredis uses `eval(script, numKeys, ...keys, ...args)` instead of `eval(script, { keys, arguments })`

## What it does

1. Starts Redis using testcontainers
2. Creates ioredis connections for commands and subscriptions
3. Sets up Queuert with Redis notify adapter and SQLite state adapter
4. Starts a worker that processes `generate_report` jobs
5. Queues a report generation job
6. **Main thread continues with other work** while the job processes
7. Waits for the report to complete using `waitForJobChainCompletion`
8. Cleans up resources

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-notify-ioredis start
```

## Example output

```
[Main] Requesting sales report...
[Main] Report queued, continuing with other work...
[Main] Preparing email template...
[Worker] Generating sales report...
[Main] Loading recipient list...
[Main] Waiting for report to complete...
[Worker] Report generated with 985 rows
[Main] Report ready! ID: RPT-1234567890, Rows: 985
```

Notice how the main thread and worker interleave - the main thread continues preparing while the worker processes the report in the background.
