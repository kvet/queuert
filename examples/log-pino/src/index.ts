import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";
import { createQueuert, defineJobTypes, type JobAttemptMiddleware } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { createPinoLog } from "./log.js";

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

// 2. Create Pino logger with mixin that automatically includes job context
const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
  // Pino mixin automatically adds job context to every log entry
  mixin: () => {
    const ctx = getJobContext();
    return ctx ? { jobAttempt: ctx } : {};
  },
});

// 3. Define job types
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

// 4. Create adapters and queuert with Pino logging
const stateAdapter = createInProcessStateAdapter();
const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  log: createPinoLog(logger),
  jobTypeRegistry,
});

// 5. Create middleware that sets job context for the duration of job processing
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

// 6. Create and start worker with the middleware
const worker = qrt
  .createWorker()
  .implementJobType({
    typeName: "greet",
    process: async ({ job, complete }) => {
      // This log automatically includes job context thanks to pino mixin!
      logger.info("Starting to process greeting");

      return complete(async () => {
        logger.info({ name: job.input.name }, "Generating greeting");
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

// 7. Run successful job
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
logger.info({ output: successCompleted.output }, "Successful job completed");

// 8. Run job that fails then succeeds (demonstrates error logging with stack trace)
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
logger.info({ output: retryCompleted.output }, "Retry job completed after failure");

// 9. Cleanup
await stopWorker();
