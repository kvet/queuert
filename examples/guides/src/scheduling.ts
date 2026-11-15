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
   * send-reminder (starts at a given time; can be pushed back or run now)
   */
  "send-reminder": {
    entry: true;
    input: { userId: string; message: string };
    output: { sentAt: string };
  };

  /*
   * start-trial --(24 hours later)--> send-trial-follow-up
   */
  "start-trial": {
    entry: true;
    input: { userId: string };
    continueWith: { typeName: "send-trial-follow-up" };
  };
  "send-trial-follow-up": {
    input: { userId: string };
    output: { sentAt: string };
  };

  /*
   * call-rate-limited-api <--+ (reschedule while rate limited)
   *        |                 |
   *        +-----------------+
   *        v
   *   output { data }
   */
  "call-rate-limited-api": {
    entry: true;
    input: { endpoint: string };
    output: { data: string };
  };

  /*
   * daily-digest #1 --> creates daily-digest #2, scheduled a day later --> ...
   */
  "daily-digest": {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };
}>();

const subscribedUserIds = new Set(["user-1"]);
const sentEmails: string[] = [];

const rateLimitedResponses = new Set(["/reports"]);
const callApi = async (endpoint: string) => {
  if (rateLimitedResponses.delete(endpoint)) {
    return { status: 429, retryAfterMs: 50 } as const;
  }
  return { status: 200, data: `response from ${endpoint}` } as const;
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-reminder": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            sentEmails.push(job.input.message);
            return complete({ ...txCtx, output: { sentAt: new Date().toISOString() } });
          }),
      },
      // #region continue-with-schedule
      "start-trial": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({
              ...txCtx,
              continueWith: {
                typeName: "send-trial-follow-up",
                input: { userId: job.input.userId },
                schedule: { afterMs: 24 * 60 * 60 * 1000 },
              },
            }),
          ),
      },
      // #endregion
      "send-trial-follow-up": {
        attemptHandler: async ({ complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          ),
      },
      // #region reschedule-from-handler
      "call-rate-limited-api": {
        attemptHandler: async ({ job, complete }) => {
          const response = await callApi(job.input.endpoint);

          if (response.status === 429) {
            return stateAdapter.withTransaction(async (txCtx) =>
              complete({ ...txCtx, reschedule: { afterMs: response.retryAfterMs } }),
            );
          }

          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { data: response.data } }),
          );
        },
      },
      // #endregion
      // #region recurring
      "daily-digest": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            sentEmails.push(`digest for ${job.input.userId}`);

            const completedJob = await complete({
              ...txCtx,
              output: { sentAt: new Date().toISOString() },
            });

            if (subscribedUserIds.has(job.input.userId)) {
              await client.createChain({
                ...txCtx,
                typeName: "daily-digest",
                input: { userId: job.input.userId },
                schedule: { afterMs: 24 * 60 * 60 * 1000 },
              });
            }
            return completedJob;
          }),
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

// #region deferred-start
const reminder = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "send-reminder",
    input: { userId: "user-1", message: "Weekly standup" },
    schedule: { at: new Date(Date.now() + 60 * 60 * 1000) },
  }),
);
// #endregion

// #region push-back
const pushedBack = await stateAdapter.withTransaction(async (txCtx) =>
  client.rescheduleJob({ ...txCtx, id: reminder.id, schedule: { afterMs: 2 * 60 * 60 * 1000 } }),
);
// #endregion
assert.equal(pushedBack.status, "pending");
assert.ok(pushedBack.scheduledAt.getTime() > Date.now() + 60 * 60 * 1000);

// #region run-now
await stateAdapter.withTransaction(async (txCtx) =>
  client.rescheduleJob({ ...txCtx, id: reminder.id }),
);
// #endregion
await client.awaitChain(reminder, { timeoutMs: 5000 });
assert.deepEqual(sentEmails, ["Weekly standup"]);

const trial = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "start-trial", input: { userId: "user-1" } }),
);
const followUpIsScheduled = async () => {
  const followUp = await client.getChainTailJob({ chainId: trial.id });
  return followUp?.typeName === "send-trial-follow-up" && followUp.status === "pending";
};
while (!(await followUpIsScheduled())) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
const followUp = await client.getChainTailJob({ chainId: trial.id });
assert.ok(followUp!.scheduledAt.getTime() > Date.now() + 23 * 60 * 60 * 1000);

const apiCall = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "call-rate-limited-api",
    input: { endpoint: "/reports" },
  }),
);
const apiResult = await client.awaitChain(apiCall, { timeoutMs: 5000 });
assert.equal(apiResult.output.data, "response from /reports");

const firstDigest = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "daily-digest", input: { userId: "user-1" } }),
);
await client.awaitChain(firstDigest, { timeoutMs: 5000 });
const runningDigests = async () =>
  (await client.listChains({ typeName: "daily-digest", status: "running" })).items;
const [secondDigest] = await runningDigests();
assert.notEqual(secondDigest.id, firstDigest.id);

await stateAdapter.withTransaction(async (txCtx) => {
  subscribedUserIds.delete("user-1");
  await client.rescheduleJob({ ...txCtx, id: secondDigest.id });
});
await client.awaitChain(secondDigest, { timeoutMs: 5000 });
assert.deepEqual(await runningDigests(), []);
assert.deepEqual(sentEmails, ["Weekly standup", "digest for user-1", "digest for user-1"]);
