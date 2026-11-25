// #hide
import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

// #endhide
const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };
}>();

// #hide
await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });
// #endhide
const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "send-welcome-email": {
      attemptHandler: async ({ applyJobOutcome }) => {
        const sentAt = new Date().toISOString();
        await stateAdapter.withTransaction(async (txCtx) => {
          await applyJobOutcome({ ...txCtx, output: { sentAt } });
        });
      },
    },
  },
});
// #hide

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();
// #endhide

const input = { userId: "ada" };
const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "send-welcome-email", input }),
);
const { output } = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(output);
