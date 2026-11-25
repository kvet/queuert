import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
} from "queuert";

import { jobTypes } from "./job-types.ts";

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "sync-to-crm": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        console.log(`Syncing ${job.input.contactId} to the CRM, attempt ${job.attempt}`);
        if (job.attempt < 3) {
          throw new Error("The CRM is unavailable");
        }
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { crmId: `crm-${job.input.contactId}` } }),
        );
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "sync-to-crm", input: { contactId: "ada" } }),
);
try {
  const completed = await client.awaitChain({ chain, timeoutMs: 3000 });
  console.log("Chain completed with", completed.output);
} catch {
  console.log("The chain did not finish within 3 seconds");
}
