import {
  type AttemptMiddleware,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
} from "queuert";
import winston from "winston";

import { createWinstonLog } from "./log.js";

// ============================================================
// Contextual Logging via logger injection (attemptMiddleware)
// ============================================================

type JobAttemptMeta = {
  jobId: string;
  typeName: string;
  chainTypeName: string;
  attempt: number;
  workerId: string;
};

// 1. Create Winston logger (no AsyncLocalStorage, no global format hook)
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, type, error, jobAttempt, ...meta }) => {
      const jobStr = jobAttempt
        ? ` [job:${(jobAttempt as JobAttemptMeta).typeName}#${(jobAttempt as JobAttemptMeta).attempt}]`
        : "";
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      const errorStr = error instanceof Error ? `\n${error.stack}` : "";
      const typeStr = typeof type === "string" ? ` [${type}]` : "";
      return `${String(timestamp)} [${level.toUpperCase()}]${typeStr}${jobStr} ${String(message)}${metaStr}${errorStr}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// 2. Define job types
const jobTypes = defineJobTypes<{
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

// 3. Create adapters and queuert client
const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();
const log = createWinstonLog(logger);

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypes,
});

// 4. Middleware that injects a child logger pre-bound to job context.
//    The handler receives `log` in its typed ctx — no AsyncLocalStorage, no mixin.
const loggerInjectionMiddleware: AttemptMiddleware<any, { log: winston.Logger }> = {
  wrapHandler: async ({ job, workerId, next }) =>
    next({
      log: logger.child({
        jobAttempt: {
          jobId: job.id,
          typeName: job.typeName,
          chainTypeName: job.chainTypeName,
          attempt: job.attempt,
          workerId,
        } satisfies JobAttemptMeta,
      }),
    }),
};

// 5. Create and start the worker with the middleware
const worker = await createInProcessWorker({
  client,
  workerId: "worker-1",
  processors: createProcessors({
    client,
    jobTypes,
    attemptMiddleware: [loggerInjectionMiddleware],
    processors: {
      greet: {
        attemptHandler: async ({ job, log, complete }) => {
          // `log` is already bound to this job's context
          log.info("Starting to process greeting");

          return complete(async () => {
            log.info("Generating greeting", { name: job.input.name });
            return { greeting: `Hello, ${job.input.name}!` };
          });
        },
      },
      "might-fail": {
        attemptHandler: async ({ job, log, complete }) => {
          log.info("Processing might-fail job");

          if (job.input.shouldFail && job.attempt < 2) {
            log.warn("About to throw simulated error");
            throw new Error("Simulated failure for demonstration");
          }

          return complete(async () => {
            log.info("Job succeeded");
            return { success: true as const };
          });
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },
    },
  }),
});

// Start worker
const stopWorker = await worker.start();

// 6. Run successful job
logger.info("--- Running successful job ---");
const successJob = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

const successCompleted = await client.awaitJobChain(successJob, {
  timeoutMs: 5000,
});
logger.info("Successful job completed", { output: successCompleted.output });

// 7. Run job that fails then succeeds (demonstrates error logging with stack trace)
logger.info("--- Running job that fails first attempt ---");
const failThenSucceedJob = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);

const retryCompleted = await client.awaitJobChain(failThenSucceedJob, {
  timeoutMs: 5000,
});
logger.info("Retry job completed after failure", { output: retryCompleted.output });

// 8. Cleanup
await stopWorker();
