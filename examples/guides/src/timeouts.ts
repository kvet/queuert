import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * fetch-report --> output { data } (in time) | { timedOut: true } (after timeoutMs)
   */
  "fetch-report": {
    entry: true;
    input: { url: string; timeoutMs: number };
    output: { data: string } | { timedOut: true };
  };

  /*
   * rebuild-search-index (runs longer than the worker lease; the heartbeat keeps renewing it)
   */
  "rebuild-search-index": {
    entry: true;
    input: { indexName: string; durationMs: number };
    output: { rebuiltOnAttempt: number };
  };
}>();

const responseTimes: Record<string, number> = { "/reports/fast": 50, "/reports/slow": 1000 };
const fetchReport = async (url: string, options: { signal: AbortSignal }) => {
  await delay(responseTimes[url], undefined, options);
  return `report from ${url}`;
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

// #region lease-config
await using workerRunner = createWorkerRunner({
  client,
  leaseConfig: { durationMs: 1000, heartbeatMs: 300 },
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // #hide
      // #region cooperative-timeout
      "fetch-report": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const timeoutSignal = AbortSignal.timeout(job.input.timeoutMs);

          try {
            const data = await fetchReport(job.input.url, {
              signal: AbortSignal.any([job.signal, timeoutSignal]),
            });
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { data } }),
            );
          } catch (error) {
            if (!timeoutSignal.aborted) throw error;
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { timedOut: true } }),
            );
          }
        },
      },
      // #endregion
      // #endhide
      "rebuild-search-index": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await delay(job.input.durationMs);
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { rebuiltOnAttempt: job.attempt } }),
          );
        },
      },
    },
  }),
});
// #endregion
await workerRunner.start();

const [fastReport, slowReport] = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: [
      { typeName: "fetch-report", input: { url: "/reports/fast", timeoutMs: 500 } },
      { typeName: "fetch-report", input: { url: "/reports/slow", timeoutMs: 100 } },
    ],
  }),
);
assert.deepEqual((await client.awaitChain({ chain: fastReport, timeoutMs: 5000 })).output, {
  data: "report from /reports/fast",
});
assert.deepEqual((await client.awaitChain({ chain: slowReport, timeoutMs: 5000 })).output, {
  timedOut: true,
});

const rebuild = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "rebuild-search-index",
    input: { indexName: "products", durationMs: 3000 },
  }),
);
const rebuilt = await client.awaitChain({ chain: rebuild, timeoutMs: 10_000 });
assert.equal(rebuilt.output.rebuiltOnAttempt, 1);
