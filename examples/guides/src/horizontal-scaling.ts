import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
  omitProcessors,
  pickProcessors,
} from "queuert";

const jobTypes = defineJobTypes<{
  "images.resize": {
    entry: true;
    input: { imageId: string };
    continueWith: { typeName: "notifications.send-email" };
  };
  "images.transcode": {
    entry: true;
    input: { imageId: string };
    output: { transcodedAt: number };
  };
  "notifications.send-email": {
    input: { imageId: string };
    output: { sentAt: number };
  };
}>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

const handledBy: { workerId: string; typeName: string; imageId: string }[] = [];

// #region registry
const appProcessors = createProcessors({
  client,
  jobTypes,
  processors: {
    "images.resize": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        // #hide
        handledBy.push({
          workerId: job.attemptBy,
          typeName: job.typeName,
          imageId: job.input.imageId,
        });
        // #endhide
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({
            ...txCtx,
            continueWith: {
              typeName: "notifications.send-email",
              input: { imageId: job.input.imageId },
            },
          }),
        );
      },
    },
    "images.transcode": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        // #hide
        handledBy.push({
          workerId: job.attemptBy,
          typeName: job.typeName,
          imageId: job.input.imageId,
        });
        // #endhide
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { transcodedAt: Date.now() } }),
        );
      },
    },
    "notifications.send-email": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        // #hide
        handledBy.push({
          workerId: job.attemptBy,
          typeName: job.typeName,
          imageId: job.input.imageId,
        });
        // #endhide
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { sentAt: Date.now() } }),
        );
      },
    },
  },
});
// #endregion

{
  // #region identical
  const createWorker = (workerId: string) =>
    createWorkerRunner({
      client,
      workerId,
      concurrency: 10,
      processors: appProcessors,
    });

  await using workerA = createWorker("worker-a");
  await using workerB = createWorker("worker-b");
  await using workerC = createWorker("worker-c");
  // #endregion
  await Promise.all([workerA.start(), workerB.start(), workerC.start()]);

  const transcodeChains = await stateAdapter.withTransaction(async (txCtx) =>
    client.createChains({
      ...txCtx,
      items: [
        { typeName: "images.transcode", input: { imageId: "img-1" } },
        { typeName: "images.transcode", input: { imageId: "img-2" } },
      ],
    }),
  );
  await client.awaitChains({ chains: transcodeChains, timeoutMs: 5000 });

  assert.deepEqual(handledBy.map((entry) => entry.imageId).sort(), ["img-1", "img-2"]);
  for (const entry of handledBy) {
    assert.ok(["worker-a", "worker-b", "worker-c"].includes(entry.workerId));
  }
  handledBy.length = 0;
}

// #region split
const imageJobTypeNames = ["images.resize", "images.transcode"] as const;

await using imageWorkerRunner = createWorkerRunner({
  client,
  workerId: "image-worker",
  concurrency: 1,
  processors: pickProcessors(appProcessors, imageJobTypeNames),
});

await using defaultWorkerRunner = createWorkerRunner({
  client,
  workerId: "default-worker",
  concurrency: 100,
  processors: omitProcessors(appProcessors, imageJobTypeNames),
});
// #endregion

await imageWorkerRunner.start();
await defaultWorkerRunner.start();

const chains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: [
      { typeName: "images.resize", input: { imageId: "img-3" } },
      { typeName: "images.resize", input: { imageId: "img-4" } },
      { typeName: "images.transcode", input: { imageId: "img-5" } },
      { typeName: "images.transcode", input: { imageId: "img-6" } },
    ],
  }),
);
await client.awaitChains({ chains, timeoutMs: 5000 });

const expectedWorkerIds: Record<string, string> = {
  "images.resize": "image-worker",
  "images.transcode": "image-worker",
  "notifications.send-email": "default-worker",
};
assert.equal(handledBy.length, 6);
for (const entry of handledBy) {
  assert.equal(entry.workerId, expectedWorkerIds[entry.typeName], entry.typeName);
}
