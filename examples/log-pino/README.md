# Pino Logging Example

This example demonstrates how to integrate Queuert with Pino for structured logging, including **contextual logging** that automatically includes job context in all log entries.

## What it shows

1. Creating a custom `Log` adapter for Pino
2. Proper error serialization (using Pino's `err` property for stack traces)
3. Structured log output with job lifecycle events
4. **Contextual logging** using `jobAttemptMiddlewares` and `AsyncLocalStorage`

## Contextual Logging Pattern

The example demonstrates how to automatically include job context (job ID, type name, attempt number, worker ID) in every log entry during job processing:

```typescript
// 1. Create AsyncLocalStorage to hold job context
const jobContextStore = new AsyncLocalStorage<JobContext>();

// 2. Configure Pino with a mixin that reads from AsyncLocalStorage
const logger = pino({
  mixin: () => {
    const ctx = jobContextStore.getStore();
    return ctx ? { jobAttempt: ctx } : {};
  },
});

// 3. Create middleware that sets context for job processing
const contextMiddleware: JobAttemptMiddleware<...> = async ({ job, workerId }, next) => {
  return jobContextStore.run(
    { jobId: job.id, typeName: job.typeName, attempt: job.attempt, workerId },
    next,
  );
};

// 4. Start worker with the middleware
await worker.start({
  workerId: 'worker-1',
  jobAttemptMiddlewares: [contextMiddleware],
});
```

Now any `logger.info()` call during job processing automatically includes job context.

## Key files

- `src/log.ts` - The Pino log adapter implementation
- `src/index.ts` - Demo with contextual logging setup

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/log-pino start
```
