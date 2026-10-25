import { expect, test } from "vitest";

import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";

test("async withTransaction rolls back when the callback rejects after awaiting", async () => {
  const stateAdapter = createInProcessStateAdapter();

  await expect(
    stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.createJobs({
        txCtx,
        jobs: [{ typeName: "t", id: crypto.randomUUID(), input: null }],
      });
      await Promise.resolve();
      throw new Error("roll back");
    }),
  ).rejects.toThrow("roll back");

  expect(await stateAdapter.listJobTypeNames({})).toEqual([]);
});

test("sync withTransaction refuses a callback that returns a promise", async () => {
  const stateAdapter = createInProcessStateAdapter({ mode: "sync" });

  expect(() => {
    void stateAdapter.withTransaction(async () => {
      await Promise.resolve();
    });
  }).toThrow("callbacks passed in sync mode must be synchronous");
});
