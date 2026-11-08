import {
  type Client,
  type JobTypesDefinitions,
  type StateAdapter,
  type TxHooks,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
  withTxHooks,
} from "queuert";

export const jobTypes = defineJobTypes<{
  /*
   * Scenario 1 - Single Job:
   *   greet → "Hello, {name}!"
   */
  greet: { entry: true; input: { name: string }; output: { greeting: string } };

  /*
   * Scenario 2 - Continuations:
   *   order:validate → order:process → order:complete
   */
  "order:validate": {
    entry: true;
    input: { orderId: string };
    output: { orderId: string; validated: true };
    continueWith: { typeName: "order:process" };
  };
  "order:process": {
    input: { orderId: string; validated: true };
    output: { orderId: string; processed: true };
    continueWith: { typeName: "order:complete" };
  };
  "order:complete": {
    input: { orderId: string; processed: true };
    output: { orderId: string; status: "completed" };
  };

  /*
   * Scenario 3 - Blockers (fan-out):
   *   fetch-user -------+
   *                     +--> process-with-blockers
   *   fetch-permissions-+
   */
  "fetch-user": {
    entry: true;
    input: { userId: string };
    output: { userId: string; name: string };
  };
  "fetch-permissions": {
    entry: true;
    input: { userId: string };
    output: { userId: string; permissions: string[] };
  };
  "process-with-blockers": {
    entry: true;
    input: { taskId: string };
    output: { taskId: string; result: string };
    blockers: [{ typeName: "fetch-user" }, { typeName: "fetch-permissions" }];
  };

  /*
   * Scenario 4 - Retries:
   *   might-fail (attempt #1: fail) → (attempt #2: success)
   */
  "might-fail": { entry: true; input: { shouldFail: boolean }; output: { success: true } };

  /*
   * Scenario 5 - Scheduled Job:
   *   scheduled-report (scheduled 1 hour in the future — use "Run now" in the dashboard)
   */
  "scheduled-report": {
    entry: true;
    input: { reportType: string };
    output: { generatedAt: string };
  };

  /*
   * Scenario 6 - Long chain (pagination volume):
   *   count-step continues to itself until it reaches `total`, producing a single
   *   chain with many jobs — exercises the chain-detail job-list pagination.
   */
  "count-step": {
    entry: true;
    input: { n: number; total: number };
    output: { total: number };
    continueWith: { typeName: "count-step" };
  };

  /*
   * Scenario 7 - Blocker fan-in (pagination volume):
   *   one `signal` chain (left pending) blocks many `blocked-task` chains —
   *   exercises the chain-detail "Blocked jobs" pagination.
   */
  signal: {
    entry: true;
    input: { name: string };
    output: { fired: true };
  };
  "blocked-task": {
    entry: true;
    input: { index: number };
    output: { index: number; done: true };
    blockers: [{ typeName: "signal" }];
  };

  /*
   * Scenario 9 - Leftover workers:
   *   long-task never completes — each one stays `running` under a worker the
   *   populator leaves behind, so the Workers page has rows to show.
   */
  "long-task": {
    entry: true;
    input: { label: string };
    output: { done: true };
  };
}>();

const DASHBOARD_PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;
const LOST_LEASE_MS = 200;

/**
 * Generates UUID v4-shaped IDs from a seeded PRNG, so a populated database gets the same IDs on
 * every run. Pass it as the state adapter's `generateJobId` and `generateWorkerId`.
 */
export const createIdGenerator = (seed: number): (() => string) => {
  let state = seed;
  const nextWord = () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0).toString(16).padStart(8, "0");
  };
  return () => {
    const hex = nextWord() + nextWord() + nextWord() + nextWord();
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
};

const delay = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs every scenario against `client`, whichever state adapter it uses: the chains of 1-4 and 6
 * run to completion under a worker runner, 5 stays scheduled an hour ahead and 7 leaves its hub
 * pending with its dependents blocked, the bulk chains of 8 are left pending with no worker, and
 * 9 leaves two workers registered with a `long-task` running under each, one of them with its
 * lease already lost. `withTransaction` runs a callback in a transaction of `stateAdapter`.
 */
export const populateScenarios = async ({
  client,
  stateAdapter,
  withTransaction,
}: {
  client: Client<JobTypesDefinitions<typeof jobTypes>, StateAdapter<any, string, string>>;
  stateAdapter: StateAdapter<any, string, string>;
  withTransaction: <T>(fn: (ctx: object) => Promise<T>) => Promise<T>;
}) => {
  const transaction = async <T>(fn: (ctx: { txHooks: TxHooks }) => Promise<T>) =>
    withTxHooks(async (txHooks) => withTransaction(async (ctx) => fn({ ...ctx, txHooks })));

  const workerRunner = createWorkerRunner({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        greet: {
          attemptHandler: async ({ job, complete }) => {
            await delay(20);
            return transaction(async (ctx) =>
              complete({ ...ctx, output: { greeting: `Hello, ${job.input.name}!` } }),
            );
          },
        },

        "order:validate": {
          attemptHandler: async ({ job, complete }) => {
            await delay(50);
            return transaction(async (ctx) =>
              complete({
                ...ctx,
                continueWith: {
                  typeName: "order:process",
                  input: { orderId: job.input.orderId, validated: true },
                },
              }),
            );
          },
        },
        "order:process": {
          attemptHandler: async ({ job, complete }) => {
            await delay(100);
            return transaction(async (ctx) =>
              complete({
                ...ctx,
                continueWith: {
                  typeName: "order:complete",
                  input: { orderId: job.input.orderId, processed: true },
                },
              }),
            );
          },
        },
        "order:complete": {
          attemptHandler: async ({ job, complete }) => {
            await delay(30);
            return transaction(async (ctx) =>
              complete({ ...ctx, output: { orderId: job.input.orderId, status: "completed" } }),
            );
          },
        },

        "fetch-user": {
          attemptHandler: async ({ job, complete }) => {
            await delay(80);
            return transaction(async (ctx) =>
              complete({ ...ctx, output: { userId: job.input.userId, name: "Alice" } }),
            );
          },
        },
        "fetch-permissions": {
          attemptHandler: async ({ job, complete }) => {
            await delay(60);
            return transaction(async (ctx) =>
              complete({
                ...ctx,
                output: { userId: job.input.userId, permissions: ["read", "write"] },
              }),
            );
          },
        },
        "process-with-blockers": {
          attemptHandler: async ({ job, complete }) => {
            const [userBlocker, permBlocker] = job.blockers;
            await delay(40);
            return transaction(async (ctx) =>
              complete({
                ...ctx,
                output: {
                  taskId: job.input.taskId,
                  result: `${userBlocker.output.name} has ${permBlocker.output.permissions.join(", ")}`,
                },
              }),
            );
          },
        },

        "might-fail": {
          attemptHandler: async ({ job, complete }) => {
            if (job.input.shouldFail && job.attempt < 2) {
              throw new Error("Simulated failure");
            }
            return transaction(async (ctx) => complete({ ...ctx, output: { success: true } }));
          },
          backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
        },

        "scheduled-report": {
          attemptHandler: async ({ complete }) => {
            await delay(50);
            return transaction(async (ctx) =>
              complete({ ...ctx, output: { generatedAt: new Date().toISOString() } }),
            );
          },
        },

        "count-step": {
          attemptHandler: async ({ job, complete }) =>
            transaction(async (ctx) =>
              job.input.n >= job.input.total
                ? complete({ ...ctx, output: { total: job.input.total } })
                : complete({
                    ...ctx,
                    continueWith: {
                      typeName: "count-step",
                      input: { n: job.input.n + 1, total: job.input.total },
                    },
                  }),
            ),
        },

        signal: {
          attemptHandler: async ({ complete }) =>
            transaction(async (ctx) => complete({ ...ctx, output: { fired: true } })),
        },

        "blocked-task": {
          attemptHandler: async ({ job, complete }) =>
            transaction(async (ctx) =>
              complete({ ...ctx, output: { index: job.input.index, done: true } }),
            ),
        },
      },
    }),
  });

  const stopWorkerRunner = await workerRunner.start();

  // Scenario 1: Single Job
  const greetChain = await transaction(async (ctx) =>
    client.createChain({ ...ctx, typeName: "greet", input: { name: "World" } }),
  );
  await client.awaitChain(greetChain, { timeoutMs: 5000 });

  // Scenario 2: Continuations
  const orderChain = await transaction(async (ctx) =>
    client.createChain({ ...ctx, typeName: "order:validate", input: { orderId: "ORD-123" } }),
  );
  await client.awaitChain(orderChain, { timeoutMs: 5000 });

  // Scenario 3: Blockers (fan-out)
  const blockerChain = await transaction(async (ctx) =>
    client.createChain({
      ...ctx,
      typeName: "process-with-blockers",
      input: { taskId: "TASK-456" },
      blockers: await client.createChains({
        ...ctx,
        items: [
          { typeName: "fetch-user", input: { userId: "user-1" } },
          { typeName: "fetch-permissions", input: { userId: "user-1" } },
        ],
      }),
    }),
  );
  await client.awaitChain(blockerChain, { timeoutMs: 5000 });

  // Scenario 4: Retries
  const retryChain = await transaction(async (ctx) =>
    client.createChain({ ...ctx, typeName: "might-fail", input: { shouldFail: true } }),
  );
  await client.awaitChain(retryChain, { timeoutMs: 5000 });

  // Scenario 5: Scheduled Job (1 hour in the future — trigger it from the dashboard)
  await transaction(async (ctx) =>
    client.createChain({
      ...ctx,
      typeName: "scheduled-report",
      input: { reportType: "daily-summary" },
      schedule: { afterMs: HOUR_MS },
    }),
  );

  // Scenario 6: Long chain — one chain with many jobs (chain-detail job pagination)
  const longChain = await transaction(async (ctx) =>
    client.createChain({
      ...ctx,
      typeName: "count-step",
      input: { n: 1, total: DASHBOARD_PAGE_SIZE * 2 + 1 },
    }),
  );
  await client.awaitChain(longChain, { timeoutMs: 5000 });

  // Scenario 7: Blocker fan-in — one pending chain blocking many jobs (chain-detail "Blocked jobs" pagination)
  const hub = await transaction(async (ctx) =>
    client.createChain({
      ...ctx,
      typeName: "signal",
      input: { name: "release-gate" },
      // Scheduled far ahead so it never fires here — its dependents stay blocked.
      schedule: { afterMs: HOUR_MS },
    }),
  );
  await transaction(async (ctx) =>
    client.createChains({
      ...ctx,
      items: Array.from({ length: DASHBOARD_PAGE_SIZE * 2 + 1 }, (_, index) => ({
        typeName: "blocked-task",
        input: { index },
        blockers: [hub],
      })),
    }),
  );

  await stopWorkerRunner();

  // Scenario 8: Bulk volume — many root chains/jobs (chain-list + job-list pagination)
  await transaction(async (ctx) =>
    client.createChains({
      ...ctx,
      items: Array.from({ length: DASHBOARD_PAGE_SIZE * 2 + 1 }, (_, index) => ({
        typeName: "greet",
        input: { name: `User ${index + 1}` },
      })),
    }),
  );

  // Scenario 9: Leftover workers — worker rows with a job running under each and no worker runner
  // to renew their leases (Workers page, worker detail, lease-lost warning)
  const leaveWorkerRunning = async (options: { label: string; leaseMs: number }) => {
    await transaction(async (ctx) =>
      client.createChain({ ...ctx, typeName: "long-task", input: { label: options.label } }),
    );
    const workerId = stateAdapter.config.generateWorkerId();
    const worker = await stateAdapter.startWorker({
      workerId,
      typeNames: ["long-task"],
      concurrency: 1,
      leaseMs: options.leaseMs,
    });
    await stateAdapter.startJobAttempts({
      typeNames: ["long-task"],
      workerId,
      workerToken: worker.token,
      limit: 1,
    });
    return workerId;
  };
  const liveWorkerId = await leaveWorkerRunning({ label: "long-runner-live", leaseMs: HOUR_MS });
  await leaveWorkerRunning({ label: "long-runner-lost", leaseMs: LOST_LEASE_MS });
  await delay(LOST_LEASE_MS);

  return { orderChain, blockerChain, retryChain, liveWorkerId };
};
