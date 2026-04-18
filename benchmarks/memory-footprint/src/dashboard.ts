/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  withTransactionHooks,
} from "queuert";

import {
  diffMemory,
  jobTypeRegistry,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("DASHBOARD");

const baseline = await measureBaseline();

const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

const [beforeDashboard, afterDashboard, dashboard] = await measureMemory(async () =>
  createDashboard({ client: qrtClient }),
);
console.log("\nAfter creating dashboard:");
diffMemory(beforeDashboard, afterDashboard);

const [beforeSetup, afterSetup, stopWorker] = await measureMemory(async () => {
  const qrtWorker = await createInProcessWorker({
    client: qrtClient,
    jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
      client: qrtClient,
      jobTypeRegistry,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
  });

  return qrtWorker.start();
});
console.log("\nAfter creating worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

// Exercise dashboard fetch to load assets
const [beforeFetch, afterFetch] = await measureMemory(async () => {
  await dashboard.fetch(new Request("http://localhost/api/chains"));
});
console.log("\nAfter first dashboard API request:");
diffMemory(beforeFetch, afterFetch);

await stopWorker();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["Dashboard:", afterDashboard.heapUsed - beforeDashboard.heapUsed],
  ["Worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
