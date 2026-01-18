# Winston Logging Example

This example demonstrates how to integrate Queuert with Winston for structured logging, including **contextual logging** that automatically includes job context in all log entries.

## What it shows

1. Creating a custom `Log` adapter for Winston
2. Proper error handling in log metadata
3. Structured log output with job lifecycle events
4. **Contextual logging** using `jobAttemptMiddlewares` and `AsyncLocalStorage`

## Contextual Logging Pattern

The example demonstrates how to automatically include job context (job ID, type name, attempt number, worker ID) in every log entry during job processing:

```typescript
// 1. Create AsyncLocalStorage to hold job context
const jobContextStore = new AsyncLocalStorage<JobContext>();

// 2. Create custom Winston format that reads from AsyncLocalStorage
const jobContextFormat = winston.format((info) => {
  const ctx = jobContextStore.getStore();
  if (ctx) {
    info.jobAttempt = ctx;
  }
  return info;
});

// 3. Configure Winston logger with the format
const logger = winston.createLogger({
  format: winston.format.combine(
    jobContextFormat(),
    // ... other formats
  ),
});

// 4. Create middleware that sets context for job processing
const contextMiddleware: JobAttemptMiddleware<...> = async ({ job, workerId }, next) => {
  return jobContextStore.run(
    { jobId: job.id, typeName: job.typeName, attempt: job.attempt, workerId },
    next,
  );
};

// 5. Start worker with the middleware
await worker.start({
  workerId: 'worker-1',
  jobAttemptMiddlewares: [contextMiddleware],
});
```

Now any `logger.info()` call during job processing automatically includes job context.

## Key files

- `src/log.ts` - The Winston log adapter implementation
- `src/index.ts` - Demo with contextual logging setup

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/log-winston start
```
