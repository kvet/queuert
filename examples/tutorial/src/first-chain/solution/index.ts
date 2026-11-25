import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };
}>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "send-welcome-email": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          console.log(`Sending a welcome email to ${job.input.userId}`);
          return applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } });
        });
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "send-welcome-email", input: { userId: "ada" } }),
);
const completed = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log("Chain completed with", completed.output);
