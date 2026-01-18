import { AsyncLocalStorage } from "node:async_hooks";
import { createQueuert, defineJobTypes, type JobAttemptMiddleware } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import winston from "winston";
import { createWinstonLog } from "./log.js";

// ============================================================
// Contextual Logging Setup with jobAttemptMiddlewares
// ============================================================

// 1. Create AsyncLocalStorage to hold job context during processing
type JobContext = {
  jobId: string;
  typeName: string;
  chainTypeName: string;
  attempt: number;
  workerId: string;
};

const jobContextStore = new AsyncLocalStorage<JobContext>();

// Helper to get current job context (for use anywhere in job processing)
export const getJobContext = () => jobContextStore.getStore();

// 2. Create custom format that automatically includes job context
const jobContextFormat = winston.format((info) => {
  const ctx = getJobContext();
  if (ctx) {
    // Add job context to log metadata
    info.jobAttempt = ctx;
  }
  return info;
});

// 3. Create Winston logger with job context format
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    jobContextFormat(), // Add job context to every log entry
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, type, error, job, ...meta }) => {
      // Format job context if present
      const jobStr = job
        ? ` [job:${(job as JobContext).typeName}#${(job as JobContext).attempt}]`
        : "";
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      const errorStr = error instanceof Error ? `\n${error.stack}` : "";
      const typeStr = typeof type === "string" ? ` [${type}]` : "";
      return `${String(timestamp)} [${level.toUpperCase()}]${typeStr}${jobStr} ${String(message)}${metaStr}${errorStr}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
  "might-fail": {
    entry: true;
    input: { shouldFail: boolean };
    output: { success: true };
  };
}>();

// 5. Create adapters and queuert with Winston logging
const stateAdapter = createInProcessStateAdapter();
const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  log: createWinstonLog(logger),
  jobTypeRegistry,
});

// 6. Create middleware that sets job context for the duration of job processing
const contextualLoggingMiddleware: JobAttemptMiddleware<
  typeof stateAdapter,
  (typeof jobTypeRegistry)["$definitions"]
> = async ({ job, workerId }, next) => {
  // Run the job processing within the AsyncLocalStorage context
  return jobContextStore.run(
    {
      jobId: job.id,
      typeName: job.typeName,
      chainTypeName: job.chainTypeName,
      attempt: job.attempt,
      workerId,
    },
    next,
  );
};

// 7. Create and start worker with the middleware
const worker = qrt
  .createWorker()
  .implementJobType({
    typeName: "greet",
    process: async ({ job, complete }) => {
      // This log automatically includes job context thanks to the custom format!
      logger.info("Starting to process greeting");

      return complete(async () => {
        logger.info("Generating greeting", { name: job.input.name });
        return { greeting: `Hello, ${job.input.name}!` };
      });
    },
  })
  .implementJobType({
    typeName: "might-fail",
    process: async ({ job, complete }) => {
      // Job context is automatically included in all logs
      logger.info("Processing might-fail job");

      if (job.input.shouldFail && job.attempt < 2) {
        logger.warn("About to throw simulated error");
        throw new Error("Simulated failure for demonstration");
      }

      return complete(async () => {
        logger.info("Job succeeded");
        return { success: true as const };
      });
    },
    retryConfig: { initialDelayMs: 100, maxDelayMs: 100 },
  });

// Start worker with the contextual logging middleware
const stopWorker = await worker.start({
  workerId: "worker-1",
  jobAttemptMiddlewares: [contextualLoggingMiddleware],
});

// 8. Run successful job
logger.info("--- Running successful job ---");
const successJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobChain({
        ...ctx,
        typeName: "greet",
        input: { name: "World" },
      }),
    ),
  ),
);

const successCompleted = await qrt.waitForJobChainCompletion(successJob, {
  timeoutMs: 5000,
});
logger.info("Successful job completed", { output: successCompleted.output });

// 9. Run job that fails then succeeds (demonstrates error logging with stack trace)
logger.info("--- Running job that fails first attempt ---");
const failThenSucceedJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobChain({
        ...ctx,
        typeName: "might-fail",
        input: { shouldFail: true },
      }),
    ),
  ),
);

const retryCompleted = await qrt.waitForJobChainCompletion(failThenSucceedJob, {
  timeoutMs: 5000,
});
logger.info("Retry job completed after failure", { output: retryCompleted.output });

// 10. Cleanup
await stopWorker();
