import { appendFile } from "node:fs/promises";

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

const WINDOW_MS = 2_000;
const CREATE_BATCH_SIZE = 100;
const SEED_COUNT = 40_000;
const SEED_BATCH_SIZE = 1_000;

const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
}>();

type BenchmarkContext = {
  client: Client<any, StateAdapter<any, any, any>>;
  withTransaction: StateAdapter<any, any, any>["withTransaction"];
};

type Measurement = { count: number; durationMs: number; drained: boolean };

const createChainsForWindow =
  (batchSize: number) =>
  async ({ client, withTransaction }: BenchmarkContext): Promise<Measurement> => {
    const begin = performance.now();
    let count = 0;
    while (performance.now() - begin < WINDOW_MS) {
      const start = count;
      await withTransactionHooks(async (transactionHooks) =>
        // oxlint-disable-next-line typescript/promise-function-async -- the callback returns a value in sync mode and a promise in async mode
        withTransaction((txCtx) =>
          batchSize === 1
            ? client.createChain({
                ...txCtx,
                transactionHooks,
                typeName: "test-job",
                input: { index: start },
              })
            : client.createChains({
                ...txCtx,
                transactionHooks,
                items: Array.from({ length: batchSize }, (_, offset) => ({
                  typeName: "test-job" as const,
                  input: { index: start + offset },
                })),
              }),
        ),
      );
      count += batchSize;
    }
    return { count, durationMs: performance.now() - begin, drained: false };
  };

const seedChains = async ({ client, withTransaction }: BenchmarkContext): Promise<void> => {
  for (let start = 0; start < SEED_COUNT; start += SEED_BATCH_SIZE) {
    const items = Array.from({ length: Math.min(SEED_BATCH_SIZE, SEED_COUNT - start) }, (_, i) => ({
      typeName: "test-job" as const,
      input: { index: start + i },
    }));
    await withTransactionHooks(async (transactionHooks) =>
      // oxlint-disable-next-line typescript/promise-function-async -- the callback returns a value in sync mode and a promise in async mode
      withTransaction((txCtx) => client.createChains({ ...txCtx, transactionHooks, items })),
    );
  }
};

const completeChainsForWindow =
  (concurrency: number) =>
  async (context: BenchmarkContext): Promise<Measurement> => {
    const { client, withTransaction } = context;
    await seedChains(context);

    let completed = 0;
    let begin = 0;
    let measurement: Measurement | undefined;
    const measured = Promise.withResolvers<void>();
    const finish = (now: number) => {
      if (measurement) return;
      measurement = {
        count: completed,
        durationMs: now - begin,
        drained: completed === SEED_COUNT,
      };
      measured.resolve();
    };

    const worker = createInProcessWorker({
      client,
      concurrency,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "test-job": {
            attemptHandler: async ({ complete }) => {
              const result = await withTransactionHooks(async (transactionHooks) =>
                // oxlint-disable-next-line typescript/promise-function-async -- the callback returns a value in sync mode and a promise in async mode
                withTransaction((txCtx) =>
                  complete({ ...txCtx, transactionHooks, output: { done: true } }),
                ),
              );
              completed++;
              const now = performance.now();
              if (completed === SEED_COUNT || now - begin >= WINDOW_MS) finish(now);
              return result;
            },
          },
        },
      }),
    });

    begin = performance.now();
    const stopWorker = await worker.start();
    const windowTimer = setTimeout(() => {
      finish(performance.now());
    }, WINDOW_MS);
    await measured.promise;
    clearTimeout(windowTimer);
    await stopWorker();
    return measurement!;
  };

type Scenario = {
  unit: "chains" | "jobs";
  run: (context: BenchmarkContext) => Promise<Measurement>;
};

const NOOP_CONCURRENCY_LEVELS = [1, 4, 16];

const scenarios: Record<string, Scenario> = {
  "create-single": { unit: "chains", run: createChainsForWindow(1) },
  "create-batched": { unit: "chains", run: createChainsForWindow(CREATE_BATCH_SIZE) },
  ...Object.fromEntries(
    NOOP_CONCURRENCY_LEVELS.map((concurrency): [string, Scenario] => [
      `complete-noop-${concurrency}`,
      { unit: "jobs", run: completeChainsForWindow(concurrency) },
    ]),
  ),
};

export const scenarioNames = Object.keys(scenarios);

export const summaryTables: { title: string; columns: { scenario: string; label: string }[] }[] = [
  {
    title: "Creation (chains/s)",
    columns: [
      { scenario: "create-single", label: "Single" },
      { scenario: "create-batched", label: `Batched (${CREATE_BATCH_SIZE})` },
    ],
  },
  {
    title: "Completion, no-op handler (jobs/s)",
    columns: NOOP_CONCURRENCY_LEVELS.map((concurrency) => ({
      scenario: `complete-noop-${concurrency}`,
      label: `x${concurrency}`,
    })),
  },
];

export type ScenarioResult = {
  scenario: string;
  count: number;
  durationMs: number;
  drained: boolean;
};

const formatNumber = (n: number): string => Math.round(n).toLocaleString("en-US");

const formatDuration = (ms: number): string =>
  ms < 1_000 ? `${ms.toFixed(0)}ms` : `${(ms / 1_000).toFixed(2)}s`;

export const formatRate = (count: number, ms: number): string => formatNumber(count / (ms / 1_000));

const parseScenarioName = (): string => {
  const name = process.argv.find((arg) => arg.startsWith("--scenario="))?.split("=")[1];
  if (name === undefined || !(name in scenarios)) {
    throw new Error(`Expected --scenario= with one of: ${scenarioNames.join(", ")}`);
  }
  return name;
};

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is not set; run benchmarks through src/index.ts`);
  }
  return value;
};

export const benchmarkNamespace = (): string =>
  `bench_${process.env.BENCHMARK_ISOLATION_ID ?? "local"}`;

export const runBenchmark = async ({
  title,
  stateAdapter,
  notifyAdapter,
}: {
  title: string;
  stateAdapter: StateAdapter<any, any, any>;
  notifyAdapter?: NotifyAdapter;
}): Promise<void> => {
  const name = parseScenarioName();
  const scenario = scenarios[name];
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  const context: BenchmarkContext = { client, withTransaction: stateAdapter.withTransaction };

  console.log(`\n${title} — ${name}`);
  const { count, durationMs, drained } = await scenario.run(context);
  const drainedSuffix = drained
    ? ` — queue of ${formatNumber(SEED_COUNT)} drained before the ${formatDuration(WINDOW_MS)} window ended`
    : "";
  console.log(
    `  Result: ${formatNumber(count)} ${scenario.unit} in ${formatDuration(durationMs)} — ${formatRate(count, durationMs)} ${scenario.unit}/s${drainedSuffix}`,
  );

  const resultFile = process.argv.find((arg) => arg.startsWith("--result-file="))?.split("=")[1];
  if (resultFile) {
    const result: ScenarioResult = { scenario: name, count, durationMs, drained };
    await appendFile(resultFile, `${JSON.stringify(result)}\n`);
  }

  await notifyAdapter?.close();
  await stateAdapter.close();
};
