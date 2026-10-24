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

const CHAIN_COUNT = 5_000;
const BATCH_SIZE = 100;

const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { index: number };
    output: { done: true };
  };
}>();

type BenchmarkContext = {
  client: Client<any, any>;
  withTransaction: StateAdapter<any, any>["withTransaction"];
};

type Progress = (count: number) => void;

const createChainsOneByOne = async (
  { client, withTransaction }: BenchmarkContext,
  onProgress: Progress,
) => {
  for (let index = 0; index < CHAIN_COUNT; index++) {
    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "test-job", input: { index } }),
      ),
    );
    onProgress(index + 1);
  }
};

const createChainsInBatches = async (
  { client, withTransaction }: BenchmarkContext,
  onProgress: Progress,
) => {
  for (let start = 0; start < CHAIN_COUNT; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, CHAIN_COUNT);
    const items = Array.from({ length: end - start }, (_, offset) => ({
      typeName: "test-job" as const,
      input: { index: start + offset },
    }));
    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) => client.createChains({ ...txCtx, transactionHooks, items })),
    );
    onProgress(end);
  }
};

const completeChains =
  (concurrency: number) =>
  async (context: BenchmarkContext, onProgress: Progress): Promise<() => Promise<void>> => {
    const { client, withTransaction } = context;
    let completed = 0;
    const allCompleted = Promise.withResolvers<void>();

    const worker = await createInProcessWorker({
      client,
      concurrency,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "test-job": {
            attemptHandler: async ({ complete }) => {
              const result = await withTransactionHooks(async (transactionHooks) =>
                withTransaction(async (txCtx) =>
                  complete({ ...txCtx, transactionHooks, output: { done: true } }),
                ),
              );
              onProgress(++completed);
              if (completed === CHAIN_COUNT) allCompleted.resolve();
              return result;
            },
          },
        },
      }),
    });

    const stopWorker = await worker.start();
    await allCompleted.promise;
    return stopWorker;
  };

type Scenario = {
  unit: "chains" | "jobs";
  seed?: (context: BenchmarkContext) => Promise<void>;
  /** Resolves once the measured work is done, optionally with a teardown that runs untimed. */
  run: (context: BenchmarkContext, onProgress: Progress) => Promise<(() => Promise<void>) | void>;
};

const seedChains = async (context: BenchmarkContext) => createChainsInBatches(context, () => {});

const scenarios: Record<string, Scenario> = {
  "create-single": { unit: "chains", run: createChainsOneByOne },
  "create-batched": { unit: "chains", run: createChainsInBatches },
  "complete-concurrency-1": { unit: "jobs", seed: seedChains, run: completeChains(1) },
  "complete-concurrency-2": { unit: "jobs", seed: seedChains, run: completeChains(2) },
  "complete-concurrency-4": { unit: "jobs", seed: seedChains, run: completeChains(4) },
  "complete-concurrency-8": { unit: "jobs", seed: seedChains, run: completeChains(8) },
};

export const scenarioNames = Object.keys(scenarios);

const formatNumber = (n: number): string => Math.round(n).toLocaleString("en-US");

const formatDuration = (ms: number): string =>
  ms < 1_000 ? `${ms.toFixed(0)}ms` : `${(ms / 1_000).toFixed(2)}s`;

const formatRate = (count: number, ms: number): string => formatNumber(count / (ms / 1_000));

const parseScenarioName = (): string => {
  const name = process.argv.find((arg) => arg.startsWith("--scenario="))?.split("=")[1];
  if (name === undefined || !(name in scenarios)) {
    throw new Error(`Expected --scenario= with one of: ${scenarioNames.join(", ")}`);
  }
  return name;
};

const measure = async (scenario: Scenario, context: BenchmarkContext): Promise<number> => {
  const step = CHAIN_COUNT / 10;
  const begin = performance.now();
  const teardown = await scenario.run(context, (count) => {
    if (count % step !== 0) return;
    const elapsed = performance.now() - begin;
    console.log(
      `  ${formatNumber(count).padStart(7)} ${scenario.unit} — ${formatDuration(elapsed)} — ${formatRate(count, elapsed)} ${scenario.unit}/s`,
    );
  });
  const durationMs = performance.now() - begin;
  await teardown?.();
  return durationMs;
};

export const runBenchmark = async ({
  title,
  stateAdapter,
  notifyAdapter,
}: {
  title: string;
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter?: NotifyAdapter;
}): Promise<void> => {
  const name = parseScenarioName();
  const scenario = scenarios[name];
  const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
  const context: BenchmarkContext = { client, withTransaction: stateAdapter.withTransaction };

  console.log(`\n${title} — ${name}`);
  if (scenario.seed) {
    console.log(`  seeding ${formatNumber(CHAIN_COUNT)} chains (not measured)`);
    await scenario.seed(context);
  }
  const durationMs = await measure(scenario, context);
  console.log(
    `  Result: ${formatNumber(CHAIN_COUNT)} ${scenario.unit} in ${formatDuration(durationMs)} — ${formatRate(CHAIN_COUNT, durationMs)} ${scenario.unit}/s`,
  );

  await notifyAdapter?.close();
  await stateAdapter.close();
};
