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

export const JOB_COUNT = 10_000;

export const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
}>();

export type BenchmarkStateAdapter = StateAdapter<any, any>;

export const parseConcurrency = (defaultValue = 10): number => {
  const flag = process.argv.find((a) => a.startsWith("--concurrency="));
  return flag ? parseInt(flag.split("=")[1], 10) : defaultValue;
};

export const formatNumber = (n: number): string => n.toLocaleString("en-US");

export const formatDuration = (ms: number): string => {
  if (ms < 1_000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
};

export const printHeader = (title: string): void => {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log(`║${title.padStart(35 + title.length / 2).padEnd(68)}║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");
};

export const runBenchmark = async ({
  stateAdapter,
  notifyAdapter,
  withTransaction,
  concurrency,
}: {
  stateAdapter: BenchmarkStateAdapter;
  notifyAdapter: NotifyAdapter;
  withTransaction: <T>(fn: (txCtx: Record<string, unknown>) => Promise<T>) => Promise<T>;
  concurrency: number;
}): Promise<void> => {
  const client: Client<any, any> = await createClient({
    stateAdapter,
    notifyAdapter,
    jobTypes,
  });

  const worker = await createInProcessWorker({
    client,
    concurrency,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ done: true as const })),
        },
      },
    }),
  });

  console.log(`\nConfiguration: ${formatNumber(JOB_COUNT)} jobs, concurrency ${concurrency}`);

  console.log(`\nPhase 1: Starting ${formatNumber(JOB_COUNT)} job chains...`);
  const startBegin = performance.now();
  const jobChains: { id: string }[] = [];

  const PROGRESS_STEP = Math.max(Math.floor(JOB_COUNT / 10), 1);

  for (let i = 0; i < JOB_COUNT; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "test-job",
          input: { index: i },
        }),
      ),
    );
    jobChains.push(jobChain);

    if ((i + 1) % PROGRESS_STEP === 0) {
      const elapsed = performance.now() - startBegin;
      const rate = (i + 1) / (elapsed / 1_000);
      console.log(
        `  ${formatNumber(i + 1).padStart(7)} started — ${formatDuration(elapsed)} — ${formatNumber(Math.round(rate))} chains/s`,
      );
    }
  }

  const startDuration = performance.now() - startBegin;
  const startRate = JOB_COUNT / (startDuration / 1_000);
  console.log(
    `\n  Start complete: ${formatDuration(startDuration)} — ${formatNumber(Math.round(startRate))} chains/s`,
  );

  console.log(`\nPhase 2: Processing ${formatNumber(JOB_COUNT)} jobs...`);
  const processBegin = performance.now();

  const stopWorker = await worker.start();

  const awaitPromises = jobChains.map(async (jobChain) =>
    client.awaitJobChain(jobChain, { timeoutMs: 600_000 }),
  );
  let completed = 0;

  for (const promise of awaitPromises) {
    await promise;
    completed++;
    if (completed % PROGRESS_STEP === 0) {
      const elapsed = performance.now() - processBegin;
      const rate = completed / (elapsed / 1_000);
      console.log(
        `  ${formatNumber(completed).padStart(7)} processed — ${formatDuration(elapsed)} — ${formatNumber(Math.round(rate))} jobs/s`,
      );
    }
  }

  const processDuration = performance.now() - processBegin;
  const processRate = JOB_COUNT / (processDuration / 1_000);

  console.log(
    `\n  Process complete: ${formatDuration(processDuration)} — ${formatNumber(Math.round(processRate))} jobs/s`,
  );

  await stopWorker();

  const totalDuration = startDuration + processDuration;
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  SUMMARY");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`  Total jobs:        ${formatNumber(JOB_COUNT)}`);
  console.log(`  Concurrency:       ${concurrency}`);
  console.log(
    `  Start phase:       ${formatDuration(startDuration).padStart(10)}  (${formatNumber(Math.round(startRate))} chains/s)`,
  );
  console.log(
    `  Process phase:     ${formatDuration(processDuration).padStart(10)}  (${formatNumber(Math.round(processRate))} jobs/s)`,
  );
  console.log(
    `  Total:             ${formatDuration(totalDuration).padStart(10)}  (${formatNumber(Math.round(JOB_COUNT / (totalDuration / 1_000)))} jobs/s end-to-end)`,
  );
};
