// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { SchemaFencedError } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const { connectionOptions } = await acquireMysql("mysql:8.4", import.meta.url);

const it = baseIt.extend("connectionOptions", { scope: "file" }, async () => connectionOptions);

describe("createMysqlStateAdapter guards", () => {
  it("writes that change no row still throw SchemaFencedError once the fence is dropped", async () => {
    const fenced = await acquireMysql("mysql:8.4", `${import.meta.url}-fenced`);
    const pool = createPool(fenced.connectionOptions);
    try {
      const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
        stateProvider: createMysql2PoolProvider({ pool }),
        dialect: "mysql",
      });
      await stateAdapter.migrateToLatest();
      const typeName = `fenced-${randomUUID()}`;
      const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName,
              id: randomUUID(),
              input: null,
              deduplication: { key: "fenced", scope: "any" },
            },
          ],
        }),
      );
      const worker = await stateAdapter.startWorker({
        workerId: randomUUID(),
        typeNames: [`${typeName}-idle`],
        concurrency: 1,
        leaseMs: 60_000,
      });
      await pool.query("DROP TABLE queuert_schema_fence_v2");

      await expect(
        stateAdapter.startJobAttempts({
          batchLimits: { [`${typeName}-idle`]: 1 },
          workerId: worker.id,
          workerToken: worker.token,
          limit: 1,
        }),
      ).rejects.toThrow(SchemaFencedError);
      await expect(
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName,
                id: randomUUID(),
                input: null,
                deduplication: { key: "fenced", scope: "any" },
              },
            ],
          }),
        ),
      ).rejects.toThrow(SchemaFencedError);
      await expect(
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: randomUUID(), output: null }],
          }),
        ),
      ).rejects.toThrow(SchemaFencedError);
      await expect(
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: chain.id, blockedByChainIds: [randomUUID()] }],
          }),
        ),
      ).rejects.toThrow(SchemaFencedError);
      await expect(
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({ txCtx, blockedByChainId: chain.id }),
        ),
      ).rejects.toThrow(SchemaFencedError);
      await expect(
        stateAdapter.extendWorkerLease({
          workerId: worker.id,
          workerToken: randomUUID(),
          leaseMs: 60_000,
        }),
      ).rejects.toThrow(SchemaFencedError);
    } finally {
      await pool.end();
    }
  });

  it.for(["text", "varchar(0)", "varchar(256)", "char(36)"])(
    "rejects the jobIdType preset %s",
    (jobIdType, { connectionOptions }) => {
      const pool = createPool(connectionOptions);
      expect(() =>
        createMysqlStateAdapter({
          stateProvider: createMysql2PoolProvider({ pool }),
          dialect: "mysql",
          jobIdType: jobIdType as never,
        }),
      ).toThrow(`Invalid jobIdType: "${jobIdType}"`);
      void pool.end();
    },
  );
});
