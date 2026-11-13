import { expect, it } from "vitest";

import { createRedisStateAdapter } from "./state-adapter.redis.ts";

const stateProvider = { eval: async () => null };

it("rejects a keyPrefix without a hash tag", () => {
  expect(() => createRedisStateAdapter({ stateProvider, keyPrefix: "queuert:" })).toThrow(
    /needs a non-empty hash tag/,
  );
  expect(() => createRedisStateAdapter({ stateProvider, keyPrefix: "{}:" })).toThrow(
    /needs a non-empty hash tag/,
  );
  expect(() => createRedisStateAdapter({ stateProvider, keyPrefix: "{}{queuert}:" })).toThrow(
    /needs a non-empty hash tag/,
  );
  expect(() => createRedisStateAdapter({ stateProvider, keyPrefix: "a{}{q}:" })).toThrow(
    /needs a non-empty hash tag/,
  );
});

it("accepts a keyPrefix with a hash tag", () => {
  expect(() => createRedisStateAdapter({ stateProvider, keyPrefix: "app:{jobs}:" })).not.toThrow();
  expect(() => createRedisStateAdapter({ stateProvider })).not.toThrow();
});

it("rejects a maxTransactionTries that is not a positive integer", () => {
  for (const maxTransactionTries of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => createRedisStateAdapter({ stateProvider, maxTransactionTries })).toThrow(
      /maxTransactionTries must be a positive integer/,
    );
  }
  expect(() => createRedisStateAdapter({ stateProvider, maxTransactionTries: 1 })).not.toThrow();
});

it("claims nothing and calls no script for a limit of 0", async () => {
  let calls = 0;
  const stateAdapter = createRedisStateAdapter({
    stateProvider: {
      eval: async () => {
        calls++;
        return null;
      },
    },
  });
  expect(
    await stateAdapter.startJobAttempts({
      workerId: "worker",
      workerToken: "token",
      typeNames: ["task"],
      limit: 0,
    }),
  ).toEqual([]);
  expect(calls).toBe(0);
});

it("passes a transaction context with no string keys that survives a spread", async () => {
  const stateAdapter = createRedisStateAdapter({ stateProvider });
  const spread = await stateAdapter.withTransaction(async (txCtx) => {
    expect(Object.keys(txCtx)).toEqual([]);
    expect(JSON.stringify(txCtx)).toBe("{}");
    expect(stateAdapter.isTransaction({ ...txCtx })).toBe(true);
    return { ...txCtx };
  });
  expect(stateAdapter.isTransaction(spread)).toBe(false);
});

it("treats a context without the adapter's transaction as outside a transaction", () => {
  const stateAdapter = createRedisStateAdapter({ stateProvider });
  const forged = { transaction: { tryNumber: 1, isOpen: () => true } };
  expect(stateAdapter.isTransaction(forged as never)).toBeFalsy();
  expect(() => {
    stateAdapter.onTransactionCommit(forged as never, () => {});
  }).toThrow(/has no Redis transaction/);
});
