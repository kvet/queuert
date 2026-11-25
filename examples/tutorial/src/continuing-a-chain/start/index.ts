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
    "provision-account": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          const accountId = `acc-${job.input.userId}`;
          console.log(`Provisioned ${accountId}`);
          return applyJobOutcome({ ...txCtx, output: { accountId } });
        });
      },
    },
    "send-welcome-email": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          console.log(`Sending a welcome email to ${job.input.accountId}`);
          return applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } });
        });
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "provision-account", input: { userId: "ada" } }),
);
const completed = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log("Chain completed with", completed.output);
