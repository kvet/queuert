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
    input: { userId: string; email: string };
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
          console.log(`Sending a welcome email to ${job.input.email}`);
          return applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } });
        });
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const users = new Map<string, string>();

const signUp = async (userId: string, email: string) =>
  stateAdapter.withTransaction(async (txCtx) => {
    users.set(userId, email);
    stateAdapter.onTransactionRollback(txCtx, () => {
      users.delete(userId);
    });
    const chain = await client.createChain({
      ...txCtx,
      typeName: "send-welcome-email",
      input: { userId, email },
    });
    if (!email.includes("@")) {
      throw new Error(`${email} is not an email address`);
    }
    return chain;
  });

try {
  const chain = await signUp("ada", "ada.example.com");
  const completed = await client.awaitChain({ chain, timeoutMs: 5000 });
  console.log("Chain completed with", completed.output);
} catch (error) {
  console.log(`Sign-up rolled back: ${String(error instanceof Error ? error.message : error)}`);
}
console.log(`Users saved: ${users.size}`);
