import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  type AttemptMiddleware,
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import winston from "winston";

import { createWinstonLog } from "./log.ts";

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

// Create Winston logger (no AsyncLocalStorage, no global format hook)
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
const db = new Database(":memory:");
const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();
// #region client
const log = createWinstonLog(logger);

const client = createClient({
  stateAdapter,
  log,
  jobTypes,
});
// #endregion

// Middleware that injects a child logger pre-bound to job context.
// The handler receives `log` in its typed ctx — no AsyncLocalStorage, no mixin.
const loggerInjectionMiddleware: AttemptMiddleware<typeof stateAdapter, { log: winston.Logger }> = {
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
          log.info("Generating greeting", { name: job.input.name });

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
db.close();
