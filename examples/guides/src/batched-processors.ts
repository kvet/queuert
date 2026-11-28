import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * send-welcome-email (batches of up to 50, settled together)
   */
  "send-welcome-email": {
    entry: true;
    input: { userId: string };
    output: { messageId: string };
  };
  /*
   * sync-to-crm (batches of up to 20, each job settled on its own)
   */
  "sync-to-crm": {
    entry: true;
    input: { userId: string };
    output: { crmId: string };
  };
}>();

const emailAddresses = new Map([
  ["user-1", "ada@example.com"],
  ["user-2", "grace@example.com"],
  ["user-3", "throttled@example.com"],
  ["user-4", "bounced@example.com"],
]);
const batchSizes: number[] = [];
const emailService = {
  sendBatch: async (messages: { to: string }[]) =>
    messages.map(({ to }, index) =>
      to.startsWith("throttled")
        ? ({ status: "throttled" } as const)
        : to.startsWith("bounced")
          ? ({ status: "bounced", error: `${to} bounced` } as const)
          : ({ status: "sent", id: `message-${index}` } as const),
    ),
};
const crm = {
  upsertContact: async (userId: string, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
    if (userId === "user-3") throw new Error("CRM rejected user-3");
    return `crm-${userId}`;
  },
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    // #region shared-commit
    "send-welcome-email": {
      batchLimit: 50,
      batchAttemptHandler: async ({ jobs, applyJobOutcomes }) => {
        // #hide
        batchSizes.push(jobs.length);
        // #endhide
        const results = await emailService.sendBatch(
          jobs.map((job) => ({ to: emailAddresses.get(job.input.userId)! })),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcomes({
            ...txCtx,
            items: jobs.map((job, index) => {
              const result = results[index];
              return result.status === "sent"
                ? { job, output: { messageId: result.id } }
                : result.status === "throttled"
                  ? { job, reschedule: { afterMs: 60_000 }, reason: "throttled" }
                  : { job, fail: new Error(result.error) };
            }),
          }),
        );
      },
    },
    // #endregion
    // #region independent-jobs
    "sync-to-crm": {
      batchLimit: 20,
      batchAttemptHandler: async ({ jobs, applyJobOutcomes }) => {
        await Promise.allSettled(
          jobs.map(async (job) => {
            const outcome = await crm.upsertContact(job.input.userId, { signal: job.signal }).then(
              (crmId) => ({ output: { crmId } }),
              (error: unknown) => ({ fail: error }),
            );
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcomes({ ...txCtx, items: [{ job, ...outcome }] }),
            );
          }),
        );
      },
    },
    // #endregion
  },
});

const userIds = [...emailAddresses.keys()];
const [emailChains, crmChains] = await stateAdapter.withTransaction(async (txCtx) =>
  Promise.all([
    client.createChains({
      ...txCtx,
      items: userIds.map((userId) => ({
        typeName: "send-welcome-email" as const,
        input: { userId },
      })),
    }),
    client.createChains({
      ...txCtx,
      items: userIds.map((userId) => ({ typeName: "sync-to-crm" as const, input: { userId } })),
    }),
  ]),
);

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const sent = await client.awaitChains({ chains: emailChains.slice(0, 2), timeoutMs: 5000 });
assert.deepEqual(
  sent.map((chain) => chain.status),
  ["completed", "completed"],
);
assert.deepEqual(batchSizes, [4]);

const throttled = await client.getJob({ id: emailChains[2].id });
assert.equal(throttled?.status, "pending");
assert.equal(throttled?.lastRescheduleReason, "throttled");

const bounced = await client.getJob({ id: emailChains[3].id });
assert.equal(bounced?.consecutiveFailures, 1);
assert.ok(bounced?.lastAttemptError?.includes("bounced@example.com bounced"));

const synced = await client.awaitChains({
  chains: [crmChains[0], crmChains[1], crmChains[3]],
  timeoutMs: 5000,
});
assert.deepEqual(
  synced.map((chain) => chain.output),
  [{ crmId: "crm-user-1" }, { crmId: "crm-user-2" }, { crmId: "crm-user-4" }],
);

const rejected = await client.getJob({ id: crmChains[2].id });
assert.equal(rejected?.status, "pending");
assert.equal(rejected?.consecutiveFailures, 1);
assert.ok(rejected?.lastAttemptError?.includes("CRM rejected user-3"));
