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
    "triage-ticket": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          return applyJobOutcome({
            ...txCtx,
            continueWith: job.input.urgent
              ? { typeName: "page-on-call", input: { ticketId: job.input.ticketId } }
              : { typeName: "queue-for-support", input: { ticketId: job.input.ticketId } },
          });
        });
      },
    },
    "page-on-call": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          console.log(`Paging on-call for ${job.input.ticketId}`);
          return applyJobOutcome({ ...txCtx, output: { handledBy: "on-call" } });
        });
      },
    },
    "queue-for-support": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          console.log(`Queued ${job.input.ticketId} for support`);
          return applyJobOutcome({ ...txCtx, output: { handledBy: "support" } });
        });
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

for (const ticket of [
  { ticketId: "t-1", urgent: true },
  { ticketId: "t-2", urgent: false },
]) {
  const chain = await stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({ ...txCtx, typeName: "triage-ticket", input: ticket }),
  );
  const completed = await client.awaitChain({ chain, timeoutMs: 5000 });
  console.log(`${ticket.ticketId} handled by`, completed.output);
}
