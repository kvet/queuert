import {
  type Client,
  type NotifyAdapter,
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

export const JOB_COUNT = 5_000;
export const BATCH_SIZE = 100;

export const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
  /*
   * Fan-in scenario:
   *   test-job (blocker) --+--> fan-in-job[0]
   *                        +--> fan-in-job[1]
   *                        +--> ... fan-in-job[JOB_COUNT - 1]
   */
  "fan-in-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
    blockers: [{ typeName: "test-job" }];
  };
}>();

export type BenchmarkStateAdapter = StateAdapter<any, any>;

export type CreateMode = "single" | "batched";
export type Scenario = "independent" | "fan-in";

const parseConcurrency = (defaultValue = 10): number => {
  const flag = process.argv.find((a) => a.startsWith("--concurrency="));
  return flag ? parseInt(flag.split("=")[1], 10) : defaultValue;
};

const parseScenario = (): Scenario => {
  const flag = process.argv.find((a) => a.startsWith("--scenario="));
  if (!flag) return "independent";
  const value = flag.split("=")[1];
  if (value !== "independent" && value !== "fan-in") {
    throw new Error(`Invalid --scenario=${value}, expected "independent" or "fan-in"`);
  }
  return value;
};

const parseCreateMode = (): CreateMode => {
  const flag = process.argv.find((a) => a.startsWith("--create-mode="));
  if (!flag) return "batched";
  const value = flag.split("=")[1];
  if (value !== "single" && value !== "batched") {
    throw new Error(`Invalid --create-mode=${value}, expected "single" or "batched"`);
  }
  return value;
};

export const formatNumber = (n: number): string => n.toLocaleString("en-US");

export const formatDuration = (ms: number): string => {
  if (ms < 1_000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
};

const printHeader = (title: string): void => {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log(`║${title.padStart(35 + title.length / 2).padEnd(68)}║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");
};

export const runBenchmark = async ({
  title,
  stateAdapter,
  notifyAdapter,
}: {
  title: string;
  stateAdapter: BenchmarkStateAdapter;
  notifyAdapter?: NotifyAdapter;
}): Promise<void> => {
  printHeader(title);
  const withTransaction = stateAdapter.withTransaction;
  const concurrency = parseConcurrency();
  const scenario = parseScenario();
  const createMode = parseCreateMode();
  const processCount = scenario === "fan-in" ? JOB_COUNT + 1 : JOB_COUNT;

  const client: Client<any, any> = await createClient({
    stateAdapter,
    notifyAdapter,
    jobTypes,
  });

  let completed = 0;
  let lastProgressMilestone = 0;
  const allDone = Promise.withResolvers<void>();
  let processBegin = 0;
  const PROGRESS_STEP = Math.max(Math.floor(JOB_COUNT / 10), 1);

  const onCompleted = () => {
    completed++;
    if (completed - lastProgressMilestone >= PROGRESS_STEP || completed === processCount) {
      lastProgressMilestone = completed;
      const elapsed = performance.now() - processBegin;
      const rate = completed / (elapsed / 1_000);
      console.log(
        `  ${formatNumber(completed).padStart(7)} processed — ${formatDuration(elapsed)} — ${formatNumber(Math.round(rate))} jobs/s`,
      );
    }
    if (completed === processCount) allDone.resolve();
    return { done: true as const };
  };

  const worker = await createInProcessWorker({
    client,
    concurrency,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "test-job": {
          attemptHandler: async ({ finish }) =>
            withTransactionHooks(async (transactionHooks) =>
              withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: onCompleted() }),
              ),
            ),
        },
        "fan-in-job": {
          attemptHandler: async ({ finish }) =>
            withTransactionHooks(async (transactionHooks) =>
              withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: onCompleted() }),
              ),
            ),
        },
      },
    }),
  });

  const createLabel =
    createMode === "single" ? "single" : `batched (size ${formatNumber(BATCH_SIZE)})`;
  console.log(
    `\nConfiguration: ${formatNumber(JOB_COUNT)} jobs, concurrency ${concurrency}, scenario ${scenario}, create ${createLabel}`,
  );

  // Fan-in: every dependent is created blocked on the same pending chain, so each
  // creation writes that chain's head row before inserting its own job.
  const blocker =
    scenario === "fan-in"
      ? await withTransactionHooks(async (transactionHooks) =>
          withTransaction(async (txCtx) =>
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "test-job",
              input: { index: -1 },
            }),
          ),
        )
      : undefined;
  const typeName = scenario === "fan-in" ? "fan-in-job" : "test-job";
  const blockerArgs = blocker ? { blockers: [blocker] } : {};

  console.log(
    `\nPhase 1: Creating ${formatNumber(JOB_COUNT)} chains (${createLabel}${blocker ? ", all blocked on one chain" : ""})...`,
  );
  const createBegin = performance.now();
  let lastCreateMilestone = 0;
  const reportCreateProgress = (count: number) => {
    if (count - lastCreateMilestone >= PROGRESS_STEP || count === JOB_COUNT) {
      lastCreateMilestone = count;
      const elapsed = performance.now() - createBegin;
      const rate = count / (elapsed / 1_000);
      console.log(
        `  ${formatNumber(count).padStart(7)} created — ${formatDuration(elapsed)} — ${formatNumber(Math.round(rate))} chains/s`,
      );
    }
  };

  if (createMode === "single") {
    for (let i = 0; i < JOB_COUNT; i++) {
      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName,
            input: { index: i },
            ...blockerArgs,
          }),
        ),
      );
      reportCreateProgress(i + 1);
    }
  } else {
    for (let i = 0; i < JOB_COUNT; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, JOB_COUNT);
      const items: { typeName: string; input: { index: number } }[] = [];
      for (let j = i; j < batchEnd; j++) {
        items.push({ typeName, input: { index: j }, ...blockerArgs });
      }
      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items,
          }),
        ),
      );
      reportCreateProgress(batchEnd);
    }
  }

  const createDuration = performance.now() - createBegin;
  const createRate = JOB_COUNT / (createDuration / 1_000);
  console.log(
    `\n  Create complete: ${formatDuration(createDuration)} — ${formatNumber(Math.round(createRate))} chains/s`,
  );

  console.log(`\nPhase 2: Processing ${formatNumber(processCount)} jobs...`);
  processBegin = performance.now();

  const stopWorker = await worker.start();
  await allDone.promise;

  const processDuration = performance.now() - processBegin;
  const processRate = processCount / (processDuration / 1_000);

  console.log(
    `\n  Process complete: ${formatDuration(processDuration)} — ${formatNumber(Math.round(processRate))} jobs/s`,
  );

  await stopWorker();

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  SUMMARY");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`  Total jobs:        ${formatNumber(processCount)}`);
  console.log(`  Concurrency:       ${concurrency}`);
  console.log(`  Scenario:          ${scenario}`);
  console.log(`  Create mode:       ${createLabel}`);
  console.log(
    `  Create phase:      ${formatDuration(createDuration).padStart(10)}  (${formatNumber(Math.round(createRate))} chains/s)`,
  );
  console.log(
    `  Process phase:     ${formatDuration(processDuration).padStart(10)}  (${formatNumber(Math.round(processRate))} jobs/s)`,
  );

  await notifyAdapter?.close();
  await stateAdapter.close();
};
