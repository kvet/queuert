import { createMemoryStateAdapter } from "example-custom-state-memory/state-adapter";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { createMemoryNotifyAdapter } from "./notify-adapter.ts";

const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string };
    output: { reportId: string; rowCount: number };
  };
}>();

await using stateAdapter = createMemoryStateAdapter();

// #region setup
await using notifyAdapter = createMemoryNotifyAdapter();

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
// #endregion

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          await stateAdapter.withTransaction(async (ctx) =>
            applyJobOutcome({
              ...ctx,
              output: { reportId: `RPT-${Date.now()}`, rowCount: 42 },
            }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales" },
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

console.log("Done!");
