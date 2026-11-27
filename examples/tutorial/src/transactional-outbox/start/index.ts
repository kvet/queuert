import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { openDatabase } from "./db.ts";

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: string; email: string };
    output: { sentAt: string };
  };
}>();

await using db = await openDatabase();
const { stateAdapter, sql } = db;
const client = createClient({ stateAdapter, jobTypes });

await sql()`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)`;

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

const signUp = async (userId: string, email: string) => {
  await stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({ ...txCtx, typeName: "send-welcome-email", input: { userId, email } }),
  );
  await stateAdapter.withTransaction(async (txCtx) => {
    await sql(txCtx)`INSERT INTO users (id, email) VALUES (${userId}, ${email})`;
  });
};

for (const userId of ["ada", "ada-again"]) {
  try {
    await signUp(userId, "ada@example.com");
    console.log(`Signed up ${userId}`);
  } catch {
    console.log(`Sign-up of ${userId} failed: ada@example.com is taken`);
  }
}

const { items: chains } = await client.listChains({ typeName: "send-welcome-email" });
await client.awaitChains({ chains, timeoutMs: 5000 });
const users = await sql()`SELECT id FROM users ORDER BY id`;
console.log(`Users: ${users.map((user) => user.id).join(", ")}`);
