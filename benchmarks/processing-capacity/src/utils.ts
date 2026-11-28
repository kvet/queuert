import { appendFile } from "node:fs/promises";

import {
  type Client,
  type NotifyAdapter,
  type StateAdapter,
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

const WINDOW_MS = 2_000;
const CREATE_BATCH_SIZE = 100;
const COMPLETE_BATCH_LIMIT = 100;
const SEED_COUNT = 40_000;
const SEED_BATCH_SIZE = 1_000;
const CHAIN_LENGTH = 4;
const FAN_IN_WIDTH = 4;
const DELETE_BATCH_SIZE = 100;
const PROCESSING_CONCURRENCY = 4;

const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
  "step-job": {
    entry: true;
    input: { remaining: number };
    output: { done: true };
    continueWith: { typeName: "step-job" };
  };
  "leaf-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
  "aggregate-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
    blockers: [...{ typeName: "leaf-job" }[]];
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

const measureWorkerWindow = async (
  { client, createWorkerRunner, onWindowStart }: BenchmarkContext,
  {
    total,
    concurrency,
    processors,
  }: {
    total: number;
    concurrency: number;
    processors: (onSettled: (count: number) => void) => ReturnType<typeof createProcessors>;
  },
): Promise<Measurement> => {
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
      drained: completed === total,
    };
    measured.resolve();
  };

  const workerRunner = createWorkerRunner({
    client,
    concurrency,
    processors: processors((count) => {
      const startedAt = (begin ??= performance.now());
      completed += count;
      const now = performance.now();
      if (completed === total || now - startedAt >= WINDOW_MS) finish(now);
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

const completeChainsForWindow =
  (concurrency: number, batchLimit: number | undefined) =>
  async (context: BenchmarkContext): Promise<Measurement> => {
    const { transaction } = context;
    await seedChains(context);
    return measureWorkerWindow(context, {
      total: SEED_COUNT,
      concurrency,
      processors: (onSettled) =>
        batchLimit === undefined
          ? context.createProcessors({
              client: context.client,
              jobTypes,
              processors: {
                "test-job": {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's applyJobOutcome returns a plain value
                    await transaction((txCtx, txHooks) =>
                      applyJobOutcome({ ...txCtx, txHooks, output: { done: true } }),
                    );
                    onSettled(1);
                  },
                },
              },
            })
          : context.createProcessors({
              client: context.client,
              jobTypes,
              processors: {
                "test-job": {
                  batchLimit,
                  batchAttemptHandler: async ({ jobs, applyJobOutcomes }) => {
                    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's applyJobOutcomes returns a plain value
                    await transaction((txCtx, txHooks) =>
                      applyJobOutcomes({
                        ...txCtx,
                        txHooks,
                        items: jobs.map((job) => ({ job, output: { done: true as const } })),
                      }),
                    );
                    onSettled(jobs.length);
                  },
                },
              },
            }),
    });
  };

const continueChainsForWindow = async (context: BenchmarkContext): Promise<Measurement> => {
  const { client, transaction } = context;
  const chainCount = SEED_COUNT / CHAIN_LENGTH;
  for (let start = 0; start < chainCount; start += SEED_BATCH_SIZE) {
    const items = Array.from({ length: Math.min(SEED_BATCH_SIZE, chainCount - start) }, () => ({
      typeName: "step-job" as const,
      input: { remaining: CHAIN_LENGTH - 1 },
    }));
    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
    await transaction((txCtx, txHooks) => client.createChains({ ...txCtx, txHooks, items }));
  }
  return measureWorkerWindow(context, {
    total: SEED_COUNT,
    concurrency: PROCESSING_CONCURRENCY,
    processors: (onSettled) =>
      context.createProcessors({
        client: context.client,
        jobTypes,
        processors: {
          "step-job": {
            attemptHandler: async ({ job, applyJobOutcome }) => {
              // oxlint-disable-next-line typescript/promise-function-async -- a sync client's applyJobOutcome returns a plain value
              await transaction((txCtx, txHooks) =>
                job.input.remaining > 0
                  ? applyJobOutcome({
                      ...txCtx,
                      txHooks,
                      continueWith: {
                        typeName: "step-job",
                        input: { remaining: job.input.remaining - 1 },
                      },
                    })
                  : applyJobOutcome({ ...txCtx, txHooks, output: { done: true } }),
              );
              onSettled(1);
            },
          },
        },
      }),
  });
};

const fanInForWindow = async (context: BenchmarkContext): Promise<Measurement> => {
  const { client, transaction } = context;
  const groupCount = SEED_COUNT / (FAN_IN_WIDTH + 1);
  const groupsPerTransaction = SEED_BATCH_SIZE / (FAN_IN_WIDTH + 1);
  for (let start = 0; start < groupCount; start += groupsPerTransaction) {
    const groups = Math.min(groupsPerTransaction, groupCount - start);
    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
    const leaves = await transaction((txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: Array.from({ length: groups * FAN_IN_WIDTH }, (_, index) => ({
          typeName: "leaf-job" as const,
          input: { index },
        })),
      }),
    );
    // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
    await transaction((txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: Array.from({ length: groups }, (_, index) => ({
          typeName: "aggregate-job" as const,
          input: { index },
          blockers: leaves.slice(index * FAN_IN_WIDTH, (index + 1) * FAN_IN_WIDTH),
        })),
      }),
    );
  }
  return measureWorkerWindow(context, {
    total: SEED_COUNT,
    concurrency: PROCESSING_CONCURRENCY,
    processors: (onSettled) =>
      context.createProcessors({
        client: context.client,
        jobTypes,
        processors: {
          "leaf-job": {
            attemptHandler: async ({ applyJobOutcome }) => {
              // oxlint-disable-next-line typescript/promise-function-async -- a sync client's applyJobOutcome returns a plain value
              await transaction((txCtx, txHooks) =>
                applyJobOutcome({ ...txCtx, txHooks, output: { done: true } }),
              );
              onSettled(1);
            },
          },
          "aggregate-job": {
            attemptHandler: async ({ applyJobOutcome }) => {
              // oxlint-disable-next-line typescript/promise-function-async -- a sync client's applyJobOutcome returns a plain value
              await transaction((txCtx, txHooks) =>
                applyJobOutcome({ ...txCtx, txHooks, output: { done: true } }),
              );
              onSettled(1);
            },
          },
        },
      }),
  });
};

const deleteChainsForWindow =
  (batchSize: number) =>
  async (context: BenchmarkContext): Promise<Measurement> => {
    const { client, transaction, onWindowStart } = context;
    const chainIds: string[] = [];
    for (let start = 0; start < SEED_COUNT; start += SEED_BATCH_SIZE) {
      const items = Array.from(
        { length: Math.min(SEED_BATCH_SIZE, SEED_COUNT - start) },
        (_, i) => ({ typeName: "test-job" as const, input: { index: start + i } }),
      );
      // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
      const created = await transaction((txCtx, txHooks) =>
        client.createChains({ ...txCtx, txHooks, items }),
      );
      // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
      await transaction((txCtx, txHooks) =>
        client.applyJobOutcomes({
          ...txCtx,
          txHooks,
          items: created.map((chain) => ({
            job: { id: chain.id, typeName: "test-job" as const },
            output: { done: true as const },
          })),
        }),
      );
      chainIds.push(...created.map((chain) => chain.id));
    }

    await onWindowStart();
    const begin = performance.now();
    let count = 0;
    while (count < chainIds.length && performance.now() - begin < WINDOW_MS) {
      const ids = chainIds.slice(count, count + batchSize);
      // oxlint-disable-next-line typescript/promise-function-async -- a sync client's transaction rejects a promise
      await transaction((txCtx, txHooks) => client.deleteChains({ ...txCtx, txHooks, ids }));
      count += ids.length;
    }
    return {
      count,
      durationMs: performance.now() - begin,
      drained: count === chainIds.length,
    };
  };

type ScenarioSpec =
  | { kind: "create"; unit: "chains"; batchSize: number }
  | { kind: "complete"; unit: "jobs"; concurrency: number; batchLimit: number | undefined }
  | { kind: "continue"; unit: "jobs" }
  | { kind: "fan-in"; unit: "jobs" }
  | { kind: "delete"; unit: "chains"; batchSize: number };

const NOOP_CONCURRENCY_LEVELS = [1, 4, 16];

const scenarios: Record<string, ScenarioSpec> = {
  "create-single": { kind: "create", unit: "chains", batchSize: 1 },
  "create-batched": { kind: "create", unit: "chains", batchSize: CREATE_BATCH_SIZE },
  ...Object.fromEntries(
    NOOP_CONCURRENCY_LEVELS.map((concurrency): [string, ScenarioSpec] => [
      `complete-noop-${concurrency}`,
      { kind: "complete", unit: "jobs", concurrency, batchLimit: undefined },
    ]),
  ),
  ...Object.fromEntries(
    NOOP_CONCURRENCY_LEVELS.map((concurrency): [string, ScenarioSpec] => [
      `complete-batched-${concurrency}`,
      { kind: "complete", unit: "jobs", concurrency, batchLimit: COMPLETE_BATCH_LIMIT },
    ]),
  ),
  [`continue-${PROCESSING_CONCURRENCY}`]: { kind: "continue", unit: "jobs" },
  [`fan-in-${PROCESSING_CONCURRENCY}`]: { kind: "fan-in", unit: "jobs" },
  "delete-single": { kind: "delete", unit: "chains", batchSize: 1 },
  "delete-batched": { kind: "delete", unit: "chains", batchSize: DELETE_BATCH_SIZE },
};

const runQueuertScenario = async (
  spec: ScenarioSpec,
  context: BenchmarkContext,
): Promise<Measurement> => {
  switch (spec.kind) {
    case "create":
      return createChainsForWindow(spec.batchSize)(context);
    case "complete":
      return completeChainsForWindow(spec.concurrency, spec.batchLimit)(context);
    case "continue":
      return continueChainsForWindow(context);
    case "fan-in":
      return fanInForWindow(context);
    case "delete":
      return deleteChainsForWindow(spec.batchSize)(context);
  }
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
      label: concurrency === 1 ? "1 slot" : `${concurrency} slots`,
    })),
  },
  {
    title: `Completion, batched no-op handler (${COMPLETE_BATCH_LIMIT} per batch, jobs/s)`,
    columns: NOOP_CONCURRENCY_LEVELS.map((concurrency) => ({
      scenario: `complete-batched-${concurrency}`,
      label: concurrency === 1 ? "1 slot" : `${concurrency} slots`,
    })),
  },
  {
    title: `Chains with continuations and blockers (${PROCESSING_CONCURRENCY} slots, jobs/s)`,
    columns: [
      { scenario: `continue-${PROCESSING_CONCURRENCY}`, label: `${CHAIN_LENGTH}-job chains` },
      { scenario: `fan-in-${PROCESSING_CONCURRENCY}`, label: `Fan-in of ${FAN_IN_WIDTH}` },
    ],
  },
  {
    title: "Deletion of completed chains (chains/s)",
    columns: [
      { scenario: "delete-single", label: "Single" },
      { scenario: "delete-batched", label: `Batched (${DELETE_BATCH_SIZE})` },
    ],
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

const formatRate = (count: number, ms: number): string => formatNumber(count / (ms / 1_000));

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
    ? ` — all ${formatNumber(count)} seeded ${spec.unit} done before the ${formatDuration(WINDOW_MS)} window ended`
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
  stateAdapter: StateAdapter<any, any, any, "async">;
  notifyAdapter?: NotifyAdapter<"async" | "sync">;
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
  stateAdapter: StateAdapter<any, any, any, "sync">;
  notifyAdapter?: NotifyAdapter<"sync">;
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
