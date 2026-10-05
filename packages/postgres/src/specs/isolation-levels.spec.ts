import { setTimeout as sleep } from "node:timers/promises";

import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { extendWithResourceLeakDetection } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { type PgPoolStateAdapter, extendWithStatePg } from "./state-adapter.pg.spec-helper.js";

// The shared conformance suite cannot pick an isolation level: providers' `withTransaction`
// takes none. These specs open raw transactions with `BEGIN ISOLATION LEVEL ...` and hand the
// adapter a txCtx for that connection.

type IsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

const LOCK_BLOCK_OBSERVATION_MS = 100;
const WORKER_ID = "isolation-worker";

const it = extendWithResourceLeakDetection(
  extendWithStatePg(extendWithPostgres(baseIt, import.meta.url)),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
).extend<{ pool: Pool; adapter: PgPoolStateAdapter }>({
  pool: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString, max: 5 });
      await use(pool);
      await pool.end();
    },
    { scope: "test" },
  ],
  adapter: [
    async ({ pool, stateAdapter }, use) => {
      // oxlint-disable-next-line no-unused-expressions -- depending on the shared fixture runs the schema migration and per-test cleanup
      stateAdapter;
      await use(await createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }) }));
    },
    { scope: "test" },
  ],
});

const withIsolatedTransaction = async <T>(
  pool: Pool,
  isolationLevel: IsolationLevel,
  fn: (txCtx: PgPoolContext) => Promise<T>,
): Promise<T> => {
  const poolClient = await pool.connect();
  try {
    await poolClient.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await fn({ poolClient });
    await poolClient.query("COMMIT");
    return result;
  } catch (error) {
    await poolClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    poolClient.release();
  }
};

type Outcome<T> = { ok: true; value: T } | { ok: false; serializationFailure: true };

/** Settles a transaction, turning a serialization failure (SQLSTATE 40001) into an outcome. */
const settle = async <T>(promise: Promise<T>): Promise<Outcome<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    if ((error as { code?: string }).code === "40001") {
      return { ok: false, serializationFailure: true };
    }
    throw error;
  }
};

const retryOnSerializationFailure = async <T>(fn: () => Promise<T>): Promise<T> => {
  for (let tries = 0; ; tries++) {
    const outcome = await settle(fn());
    if (outcome.ok) return outcome.value;
    if (tries >= 5) throw new Error("serialization failures did not stop");
  }
};

const createSignal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** A two-job chain whose pending tail completes it, so the chain head is its own row. */
const setupBlockerChain = async (
  adapter: PgPoolStateAdapter,
  typeName: string,
): Promise<{ chainId: string; tailId: string }> => {
  const [chain] = await adapter.withTransaction(async (txCtx) =>
    adapter.createJobs({ txCtx, jobs: [{ typeName, input: null }] }),
  );
  const [continued] = await adapter.withTransaction(async (txCtx) =>
    adapter.continueJobs({
      txCtx,
      jobs: [{ typeName: `${typeName}:step`, input: null, continueFromId: chain.id }],
    }),
  );
  return { chainId: chain.id, tailId: continued!.continuation.id };
};

/** What core does when a new chain is blocked by `chainId`: blockers-first head write. */
const addDependent = async (
  adapter: PgPoolStateAdapter,
  txCtx: PgPoolContext,
  chainId: string,
  typeName: string,
): Promise<string> => {
  const [blockerChain] = await adapter.getChains({ txCtx, chainIds: [chainId], lock: "write" });
  expect(blockerChain).toBeDefined();
  const [dependent] = await adapter.createJobs({ txCtx, jobs: [{ typeName, input: null }] });
  await adapter.addJobsBlockers({
    txCtx,
    jobBlockers: [{ jobId: dependent.id, blockedByChainIds: [chainId] }],
  });
  return dependent.id;
};

/** What core does when a chain completes: complete the tail, then unblock dependents. */
const completeChain = async (
  adapter: PgPoolStateAdapter,
  txCtx: PgPoolContext,
  chainId: string,
  tailId: string,
): Promise<void> => {
  const [completed] = await adapter.completeJobs({
    txCtx,
    jobs: [{ jobId: tailId, output: null }],
  });
  expect(completed).toBeDefined();
  await adapter.unblockJobs({ txCtx, blockedByChainId: chainId });
};

const expectNoStrandedDependent = async (
  adapter: PgPoolStateAdapter,
  chainId: string,
  dependentId: string | undefined,
): Promise<void> => {
  const [chain] = await adapter.getChains({ chainIds: [chainId] });
  if (dependentId === undefined || chain!.status !== "completed") return;
  const [dependent] = await adapter.getJobs({ jobIds: [dependentId] });
  expect(dependent!.status).not.toBe("blocked");
};

const isolationLevels: IsolationLevel[] = ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"];

it("index");

describe.each(isolationLevels)("blocker race under %s", (isolationLevel) => {
  it("adder commits first: the completer unblocks the dependent or fails to serialize", async ({
    pool,
    adapter,
  }) => {
    const { chainId, tailId } = await setupBlockerChain(adapter, "iso-add-first");

    const added = createSignal();
    const adderGate = createSignal();
    const adderTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) => {
        const dependentId = await addDependent(adapter, txCtx, chainId, "iso-add-first:dep");
        added.resolve();
        await adderGate.promise;
        return dependentId;
      }),
    );
    await added.promise;
    const completerTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
        completeChain(adapter, txCtx, chainId, tailId),
      ),
    );
    await sleep(LOCK_BLOCK_OBSERVATION_MS);
    adderGate.resolve();

    const adder = await adderTx;
    const completer = await completerTx;
    expect(adder.ok || completer.ok).toBe(true);
    if (isolationLevel === "READ COMMITTED") {
      expect(adder.ok && completer.ok).toBe(true);
    }

    const dependentId = adder.ok ? adder.value : undefined;
    await expectNoStrandedDependent(adapter, chainId, dependentId);

    // Retrying the failed side, as a user must at this level, converges.
    const finalDependentId =
      dependentId ??
      (await retryOnSerializationFailure(async () =>
        withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
          addDependent(adapter, txCtx, chainId, "iso-add-first:dep"),
        ),
      ));
    if (!completer.ok) {
      await retryOnSerializationFailure(async () =>
        withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
          completeChain(adapter, txCtx, chainId, tailId),
        ),
      );
    }
    const [dependent] = await adapter.getJobs({ jobIds: [finalDependentId] });
    expect(dependent!.status).toBe("pending");
  });

  it("completer commits first: the dependent starts pending or the adder fails to serialize", async ({
    pool,
    adapter,
  }) => {
    const { chainId, tailId } = await setupBlockerChain(adapter, "iso-complete-first");

    const completed = createSignal();
    const completerGate = createSignal();
    const completerTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) => {
        await completeChain(adapter, txCtx, chainId, tailId);
        completed.resolve();
        await completerGate.promise;
      }),
    );
    await completed.promise;
    const adderTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
        addDependent(adapter, txCtx, chainId, "iso-complete-first:dep"),
      ),
    );
    await sleep(LOCK_BLOCK_OBSERVATION_MS);
    completerGate.resolve();

    const completer = await completerTx;
    const adder = await adderTx;
    expect(completer.ok).toBe(true);
    if (isolationLevel === "READ COMMITTED") {
      expect(adder.ok).toBe(true);
    }

    const dependentId = adder.ok ? adder.value : undefined;
    await expectNoStrandedDependent(adapter, chainId, dependentId);

    const finalDependentId =
      dependentId ??
      (await retryOnSerializationFailure(async () =>
        withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
          addDependent(adapter, txCtx, chainId, "iso-complete-first:dep"),
        ),
      ));
    const [dependent] = await adapter.getJobs({ jobIds: [finalDependentId] });
    expect(dependent!.status).toBe("pending");
  });
});

describe.each(isolationLevels)("fenced finish vs reclaim under %s", (isolationLevel) => {
  const setupExpiredAttempt = async (adapter: PgPoolStateAdapter, typeName: string) => {
    await adapter.withTransaction(async (txCtx) =>
      adapter.createJobs({ txCtx, jobs: [{ typeName, input: null }] }),
    );
    const acquired = await adapter.startJobAttempt({
      workerId: WORKER_ID,
      timeoutMsByTypeName: { [typeName]: 1 },
    });
    await sleep(10);
    return acquired!;
  };

  const finish = async (adapter: PgPoolStateAdapter, txCtx: PgPoolContext, jobId: string) => {
    const [completed] = await adapter.completeJobs({
      txCtx,
      completedBy: WORKER_ID,
      jobs: [{ jobId, output: { done: true }, fence: { attempt: 1, workerId: WORKER_ID } }],
    });
    return completed;
  };

  const reclaim = async (adapter: PgPoolStateAdapter, txCtx: PgPoolContext, typeName: string) =>
    adapter.reclaimExpiredJobAttempt({
      txCtx,
      typeNames: [typeName],
      lastAttemptError: "JobAttemptExpiredError: test",
    });

  it("finisher holds the row first: reclaim skips it", async ({ pool, adapter }) => {
    const typeName = "iso-finish-first";
    const job = await setupExpiredAttempt(adapter, typeName);

    const written = createSignal();
    const finisherGate = createSignal();
    const finisherTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) => {
        const completed = await finish(adapter, txCtx, job.id);
        written.resolve();
        await finisherGate.promise;
        return completed;
      }),
    );
    await written.promise;
    const reclaimer = await settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
        reclaim(adapter, txCtx, typeName),
      ),
    );
    finisherGate.resolve();
    const finisher = await finisherTx;

    const finished = finisher.ok && finisher.value !== undefined;
    const reclaimed = reclaimer.ok && reclaimer.value !== undefined;
    expect(finished && reclaimed).toBe(false);
    expect(finished).toBe(true);

    const [stored] = await adapter.getJobs({ jobIds: [job.id] });
    expect(stored!.status).toBe("completed");
  });

  it("reclaimer holds the row first: the fenced finish misses or fails to serialize", async ({
    pool,
    adapter,
  }) => {
    const typeName = "iso-reclaim-first";
    const job = await setupExpiredAttempt(adapter, typeName);

    const reclaimedSignal = createSignal();
    const reclaimerGate = createSignal();
    const reclaimerTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) => {
        const reclaimed = await reclaim(adapter, txCtx, typeName);
        reclaimedSignal.resolve();
        await reclaimerGate.promise;
        return reclaimed;
      }),
    );
    await reclaimedSignal.promise;
    const finisherTx = settle(
      withIsolatedTransaction(pool, isolationLevel, async (txCtx) =>
        finish(adapter, txCtx, job.id),
      ),
    );
    await sleep(LOCK_BLOCK_OBSERVATION_MS);
    reclaimerGate.resolve();
    const reclaimer = await reclaimerTx;
    const finisher = await finisherTx;

    const finished = finisher.ok && finisher.value !== undefined;
    const reclaimed = reclaimer.ok && reclaimer.value !== undefined;
    expect(finished && reclaimed).toBe(false);
    expect(reclaimed).toBe(true);

    const [stored] = await adapter.getJobs({ jobIds: [job.id] });
    expect(stored!.status).toBe("pending");
    expect(stored!.lastAttemptError).toBe("JobAttemptExpiredError: test");
  });
});
