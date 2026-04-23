/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";

import {
  diffMemory,
  jobTypes,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("DASHBOARD");

const baseline = await measureBaseline();

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const [beforeDashboard, afterDashboard, dashboard] = await measureMemory(async () =>
  createDashboard({ client }),
);
console.log("\nAfter creating dashboard:");
diffMemory(beforeDashboard, afterDashboard);

const [beforeSetup, afterSetup, stopWorker] = await measureMemory(async () => {
  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
  });

  return worker.start();
});
console.log("\nAfter creating worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (ctx) =>
        client.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(client.awaitJobChain(jobChain, { timeoutMs: 5000 }));
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
