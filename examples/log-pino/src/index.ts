import pino, { type Logger } from "pino";
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

import { createPinoLog } from "./log.js";

// ============================================================
// Contextual Logging via logger injection (attemptMiddleware)
// ============================================================

// 1. Create root Pino logger
const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
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
const log = createPinoLog(logger);

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypes,
});

// 4. Middleware that injects a child logger pre-bound to job context.
//    The handler receives `log` in its typed ctx — no AsyncLocalStorage, no mixin.
const loggerInjectionMiddleware: AttemptMiddleware<any, { log: Logger }> = {
  wrapHandler: async ({ job, workerId, next }) =>
    next({
      log: logger.child({
        jobAttempt: {
          jobId: job.id,
          typeName: job.typeName,
          chainTypeName: job.chainTypeName,
          attempt: job.attempt,
          workerId,
        },
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
            log.info({ name: job.input.name }, "Generating greeting");
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
const successChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

const successCompleted = await client.awaitChain(successChain, {
  timeoutMs: 5000,
});
logger.info({ output: successCompleted.output }, "Successful job completed");

// 7. Run job that fails then succeeds (demonstrates error logging with stack trace)
logger.info("--- Running job that fails first attempt ---");
const failThenSucceedChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);

const retryCompleted = await client.awaitChain(failThenSucceedChain, {
  timeoutMs: 5000,
});
logger.info({ output: retryCompleted.output }, "Retry job eventually succeeded");

// 8. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
