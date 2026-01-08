import winston from "winston";
import {
  createQueuert,
  createInProcessStateAdapter,
  createInProcessNotifyAdapter,
  defineUnionJobTypes,
} from "queuert";
import { createWinstonLog } from "./log.js";

// 1. Create Winston logger with console transport
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, type, error, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      const errorStr = error instanceof Error ? `\n${error.stack}` : "";
      return `${String(timestamp)} [${level.toUpperCase()}] [${String(type)}] ${String(message)}${metaStr}${errorStr}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// 2. Define job types
const jobTypeDefinitions = defineUnionJobTypes<{
  greet: { input: { name: string }; output: { greeting: string } };
  "might-fail": { input: { shouldFail: boolean }; output: { success: true } };
}>();

// 3. Create adapters and queuert with Winston logging
const stateAdapter = createInProcessStateAdapter();
const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  log: createWinstonLog(logger),
  jobTypeDefinitions,
});

// 4. Create and start worker
const worker = qrt
  .createWorker()
  .implementJobType({
    typeName: "greet",
    process: async ({ job, complete }) => {
      return complete(async () => ({
        greeting: `Hello, ${job.input.name}!`,
      }));
    },
  })
  .implementJobType({
    typeName: "might-fail",
    process: async ({ job, complete }) => {
      if (job.input.shouldFail && job.attempt < 2) {
        // Throw an error on first attempt to demonstrate error logging
        throw new Error("Simulated failure for demonstration");
      }
      return complete(async () => ({ success: true as const }));
    },
    retryConfig: { initialDelayMs: 100, maxDelayMs: 100 },
  });

const stopWorker = await worker.start({ workerId: "worker-1" });

// 5. Run successful job
logger.info("--- Running successful job ---");
const successJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobSequence({
        ...ctx,
        typeName: "greet",
        input: { name: "World" },
      }),
    ),
  ),
);

const successCompleted = await qrt.waitForJobSequenceCompletion(successJob, {
  timeoutMs: 5000,
});
logger.info("Successful job completed", { output: successCompleted.output });

// 6. Run job that fails then succeeds (demonstrates error logging with stack trace)
logger.info("--- Running job that fails first attempt ---");
const failThenSucceedJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobSequence({
        ...ctx,
        typeName: "might-fail",
        input: { shouldFail: true },
      }),
    ),
  ),
);

const retryCompleted = await qrt.waitForJobSequenceCompletion(failThenSucceedJob, {
  timeoutMs: 5000,
});
logger.info("Retry job completed after failure", { output: retryCompleted.output });

// 7. Cleanup
await stopWorker();

process.exit(0);
