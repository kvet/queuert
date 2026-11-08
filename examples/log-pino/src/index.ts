import pino, { type Logger } from "pino";
import {
  type AttemptMiddleware,
  createClient,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createPinoLog } from "./log.ts";

// ============================================================
// Contextual Logging via logger injection (attemptMiddleware)
// ============================================================

// Create root Pino logger
const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

// Define job types
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

// Create adapters and queuert client
const stateAdapter = createInProcessStateAdapter();
// #region client
const log = createPinoLog(logger);

const client = createClient({
  stateAdapter,
  log,
  jobTypes,
});
// #endregion

// Middleware that injects a child logger pre-bound to job context.
// The handler receives `log` in its typed ctx — no AsyncLocalStorage, no mixin.
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

// Create and start the worker runner with the middleware
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    attemptMiddleware: [loggerInjectionMiddleware],
    processors: {
      greet: {
        attemptHandler: async ({ job, log, complete }) => {
          // `log` is already bound to this job's context
          log.info("Starting to process greeting");
          log.info({ name: job.input.name }, "Generating greeting");

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: { greeting: `Hello, ${job.input.name}!` },
              }),
            ),
          );
        },
      },
      "might-fail": {
        attemptHandler: async ({ job, log, complete }) => {
          log.info("Processing might-fail job");

          if (job.input.shouldFail && job.attempt < 2) {
            log.warn("About to throw simulated error");
            throw new Error("Simulated failure for demonstration");
          }

          log.info("Job succeeded");

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({ ...ctx, txHooks, output: { success: true as const } }),
            ),
          );
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },
    },
  }),
});

// Start worker runner
const stopWorkerRunner = await workerRunner.start();

// Run successful job
logger.info("--- Running successful job ---");
const successChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);
await client.awaitChain(successChain, { timeoutMs: 5000 });

// Run job that fails then succeeds (demonstrates error logging with stack trace)
logger.info("--- Running job that fails first attempt ---");
const failThenSucceedChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);
await client.awaitChain(failThenSucceedChain, { timeoutMs: 5000 });

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
