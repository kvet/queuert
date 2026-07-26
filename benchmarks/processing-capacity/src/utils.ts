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
}>();

export type BenchmarkStateAdapter = StateAdapter<any, any>;

export type ProcessMode = "atomic" | "staged";
export type CreateMode = "single" | "batched";

export const defaultCreateModeFor = (processMode: ProcessMode): CreateMode =>
  processMode === "atomic" ? "batched" : "single";

const parseConcurrency = (defaultValue = 10): number => {
  const flag = process.argv.find((a) => a.startsWith("--concurrency="));
  return flag ? parseInt(flag.split("=")[1], 10) : defaultValue;
};

const parseProcessMode = (defaultValue: ProcessMode = "atomic"): ProcessMode => {
  const flag = process.argv.find((a) => a.startsWith("--process-mode="));
  if (!flag) return defaultValue;
  const value = flag.split("=")[1];
  if (value !== "atomic" && value !== "staged") {
    throw new Error(`Invalid --process-mode=${value}, expected "atomic" or "staged"`);
  }
  return value;
};

const parseCreateMode = (processMode: ProcessMode): CreateMode => {
  const flag = process.argv.find((a) => a.startsWith("--create-mode="));
  if (!flag) return defaultCreateModeFor(processMode);
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
  const processMode = parseProcessMode();
  const createMode = parseCreateMode(processMode);

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
    if (completed - lastProgressMilestone >= PROGRESS_STEP || completed === JOB_COUNT) {
      lastProgressMilestone = completed;
      const elapsed = performance.now() - processBegin;
      const rate = completed / (elapsed / 1_000);
      console.log(
        `  ${formatNumber(completed).padStart(7)} processed — ${formatDuration(elapsed)} — ${formatNumber(Math.round(rate))} jobs/s`,
      );
    }
    if (completed === JOB_COUNT) allDone.resolve();
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
          attemptHandler:
            processMode === "atomic"
              ? async ({ complete }) => complete(async () => onCompleted())
              : async ({ prepare, complete }) => {
                  await prepare({ mode: "staged" }, async () => undefined);
                  return complete(async () => onCompleted());
                },
        },
      },
    }),
  });

  const createLabel =
    createMode === "single" ? "single" : `batched (size ${formatNumber(BATCH_SIZE)})`;
  console.log(
    `\nConfiguration: ${formatNumber(JOB_COUNT)} jobs, concurrency ${concurrency}, process ${processMode}, create ${createLabel}`,
  );

  console.log(`\nPhase 1: Creating ${formatNumber(JOB_COUNT)} chains (${createLabel})...`);
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
            typeName: "test-job",
            input: { index: i },
          }),
        ),
      );
      reportCreateProgress(i + 1);
    }
  } else {
    for (let i = 0; i < JOB_COUNT; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, JOB_COUNT);
      const items: { typeName: "test-job"; input: { index: number } }[] = [];
      for (let j = i; j < batchEnd; j++) {
        items.push({ typeName: "test-job", input: { index: j } });
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

  console.log(`\nPhase 2: Processing ${formatNumber(JOB_COUNT)} jobs...`);
  processBegin = performance.now();

  const stopWorker = await worker.start();
  await allDone.promise;

  const processDuration = performance.now() - processBegin;
  const processRate = JOB_COUNT / (processDuration / 1_000);

  console.log(
    `\n  Process complete: ${formatDuration(processDuration)} — ${formatNumber(Math.round(processRate))} jobs/s`,
  );

  await stopWorker();

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  SUMMARY");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`  Total jobs:        ${formatNumber(JOB_COUNT)}`);
  console.log(`  Concurrency:       ${concurrency}`);
  console.log(`  Process mode:      ${processMode}`);
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
