import { appendFile } from "node:fs/promises";

import {
  type Client,
  type NotifyAdapter,
  type StateAdapter,
  type SyncNotifyAdapter,
  type SyncStateAdapter,
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

const noopAsync = async (): Promise<void> => {};
const listenNothing = async (): Promise<() => Promise<void>> => noopAsync;

export const noopNotifyAdapter: NotifyAdapter = {
  notifyJobsScheduled: noopAsync,
  listenJobScheduled: listenNothing,
  notifyChainsCompleted: noopAsync,
  listenChainCompleted: listenNothing,
  notifyJobAttemptsLost: noopAsync,
  listenJobAttemptLost: listenNothing,
  close: noopAsync,
  [Symbol.asyncDispose]: noopAsync,
};

const noop = (): void => {};

export const noopSyncNotifyAdapter: SyncNotifyAdapter = {
  sync: true,
  notifyJobsScheduled: noop,
  listenJobScheduled: () => noop,
  notifyChainsCompleted: noop,
  listenChainCompleted: () => noop,
  notifyJobAttemptsLost: noop,
  listenJobAttemptLost: () => noop,
  close: noop,
  [Symbol.dispose]: noop,
};

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
  client: Client<any, any>;
  createProcessors: typeof createProcessors;
  createWorkerRunner: typeof createWorkerRunner;
  transaction: <T>(fn: (txCtx: any, txHooks: any) => T | Promise<T>) => Promise<T>;
  onWindowStart: () => Promise<void>;
};

type Measurement = { count: number; durationMs: number; drained: boolean };

export type ServerStats = {
  reset: () => Promise<void>;
  usec: () => Promise<number>;
};

const createChainsForWindow =
  (batchSize: number) =>
  async ({ client, transaction, onWindowStart }: BenchmarkContext): Promise<Measurement> => {
    await onWindowStart();
    const begin = performance.now();
    let count = 0;
    while (performance.now() - begin < WINDOW_MS) {
      const start = count;
      // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
      await transaction<unknown>((txCtx, txHooks) =>
        batchSize === 1
          ? client.createChain({
              ...txCtx,
              txHooks,
              typeName: "test-job",
              input: { index: start },
            })
          : client.createChains({
              ...txCtx,
              txHooks,
              items: Array.from({ length: batchSize }, (_, offset) => ({
                typeName: "test-job" as const,
                input: { index: start + offset },
              })),
            }),
      );
      count += batchSize;
    }
    return { count, durationMs: performance.now() - begin, drained: false };
  };

const seedChains = async ({ client, transaction }: BenchmarkContext): Promise<void> => {
  for (let start = 0; start < SEED_COUNT; start += SEED_BATCH_SIZE) {
    const items = Array.from({ length: Math.min(SEED_BATCH_SIZE, SEED_COUNT - start) }, (_, i) => ({
      typeName: "test-job" as const,
      input: { index: start + i },
    }));
    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
    await transaction((txCtx, txHooks) => client.createChains({ ...txCtx, txHooks, items }));
  }
};

const completeChainsForWindow =
  (concurrency: number) =>
  async (context: BenchmarkContext): Promise<Measurement> => {
    const { client, createProcessors, createWorkerRunner, transaction, onWindowStart } = context;
    await seedChains(context);
    await onWindowStart();

    let completed = 0;
    let begin: number | undefined;
    let measurement: Measurement | undefined;
    const measured = Promise.withResolvers<void>();
    const finish = (now: number) => {
      if (measurement) return;
      measurement = {
        count: completed,
        durationMs: now - (begin ?? now),
        drained: completed === SEED_COUNT,
      };
      measured.resolve();
    };

    const workerRunner = createWorkerRunner({
      client,
      concurrency,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "test-job": {
            attemptHandler: async ({ complete }) => {
              const startedAt = (begin ??= performance.now());
              // oxlint-disable-next-line typescript/promise-function-async -- a sync client's complete returns a plain value
              const result = await transaction((txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { done: true } }),
              );
              completed++;
              const now = performance.now();
              if (completed === SEED_COUNT || now - startedAt >= WINDOW_MS) finish(now);
              return result;
            },
          },
        },
      }),
    });

    await workerRunner.start();
    const windowTimer = setTimeout(() => {
      finish(performance.now());
    }, WINDOW_MS);
    await measured.promise;
    clearTimeout(windowTimer);
    await workerRunner.close();
    return measurement!;
  };

type ScenarioSpec =
  | { kind: "create"; unit: "chains"; batchSize: number }
  | { kind: "complete"; unit: "jobs"; concurrency: number };

const NOOP_CONCURRENCY_LEVELS = [1, 4, 16];

const scenarios: Record<string, ScenarioSpec> = {
  "create-single": { kind: "create", unit: "chains", batchSize: 1 },
  "create-batched": { kind: "create", unit: "chains", batchSize: CREATE_BATCH_SIZE },
  ...Object.fromEntries(
    NOOP_CONCURRENCY_LEVELS.map((concurrency): [string, ScenarioSpec] => [
      `complete-noop-${concurrency}`,
      { kind: "complete", unit: "jobs", concurrency },
    ]),
  ),
};

const runQueuertScenario = async (
  spec: ScenarioSpec,
  context: BenchmarkContext,
): Promise<Measurement> =>
  spec.kind === "create"
    ? createChainsForWindow(spec.batchSize)(context)
    : completeChainsForWindow(spec.concurrency)(context);

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

const parseScenario = (): { name: string; spec: ScenarioSpec } => {
  const name = parseScenarioName();
  return { name, spec: scenarios[name] };
};

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

const runScenario = async ({
  title,
  serverStats,
  run,
}: {
  title: string;
  serverStats?: ServerStats;
  run: (spec: ScenarioSpec, onWindowStart: () => Promise<void>) => Promise<Measurement>;
}): Promise<void> => {
  const { name, spec } = parseScenario();
  console.log(`\n${title} — ${name}`);
  const { count, durationMs, drained } = await run(spec, async () => serverStats?.reset());
  const serverUsec = serverStats ? await serverStats.usec() : undefined;
  const drainedSuffix = drained
    ? ` — queue of ${formatNumber(SEED_COUNT)} drained before the ${formatDuration(WINDOW_MS)} window ended; timed from its first job`
    : "";
  console.log(
    `  Result: ${formatNumber(count)} ${spec.unit} in ${formatDuration(durationMs)} — ${formatRate(count, durationMs)} ${spec.unit}/s${drainedSuffix}`,
  );
  if (serverUsec !== undefined) {
    const unit = spec.unit === "chains" ? "chain" : "job";
    console.log(`  Server time: ${(serverUsec / Math.max(1, count)).toFixed(1)} µs/${unit}`);
  }

  const resultFile = process.argv.find((arg) => arg.startsWith("--result-file="))?.split("=")[1];
  if (resultFile) {
    const result: ScenarioResult = { scenario: name, count, durationMs, drained };
    await appendFile(resultFile, `${JSON.stringify(result)}\n`);
  }
};

export const runBenchmark = async ({
  title,
  stateAdapter,
  notifyAdapter,
  serverStats,
}: {
  title: string;
  stateAdapter: StateAdapter<any, any, any>;
  notifyAdapter?: NotifyAdapter;
  serverStats?: ServerStats;
}): Promise<void> => {
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  await runScenario({
    title,
    serverStats,
    run: async (spec, onWindowStart) =>
      runQueuertScenario(spec, {
        client,
        createProcessors,
        createWorkerRunner,
        transaction: async (fn) =>
          withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (txCtx) => fn(txCtx, txHooks)),
          ),
        onWindowStart,
      }),
  });
  await notifyAdapter?.close();
  await stateAdapter.close();
};

export const runSyncBenchmark = async ({
  title,
  stateAdapter,
  notifyAdapter,
}: {
  title: string;
  stateAdapter: SyncStateAdapter<any, any, any>;
  notifyAdapter?: SyncNotifyAdapter;
}): Promise<void> => {
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  await runScenario({
    title,
    run: async (spec, onWindowStart) =>
      runQueuertScenario(spec, {
        client,
        createProcessors,
        createWorkerRunner,
        transaction: async (fn) =>
          withTxHooks((txHooks) =>
            stateAdapter.withTransaction((txCtx) => fn(txCtx, txHooks) as never),
          ),
        onWindowStart,
      }),
  });
  notifyAdapter?.close();
  stateAdapter.close();
};
