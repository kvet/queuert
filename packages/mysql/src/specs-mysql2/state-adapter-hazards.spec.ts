// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { afterAll, it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const defineMysqlHazardsSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  const hostTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  afterAll(() => {
    process.env.TZ = hostTimeZone;
  });

  const { connectionOptions } = await acquireMysql(image, callerId);

  const it = baseIt.extend("adapter", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
    pool.on("connection", (connection) => {
      void connection.query("SET time_zone = '+05:00'");
    });
    onCleanup(async () => pool.end());
    const adapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
      stateProvider: createMysql2PoolProvider({ pool }),
      dialect,
    });
    await adapter.migrateToLatest();
    return adapter;
  });

  describe(`${image} correctness hazards`, () => {
    it("treats deduplication keys that differ in case, accent or trailing space as distinct", async ({
      adapter,
    }) => {
      const typeName = `dedup-${randomUUID()}`;
      const keys = ["alpha", "Alpha", "álpha", "alpha "];
      const created = [];
      for (const key of keys) {
        const [chain] = await adapter.withTransaction(async (txCtx) =>
          adapter.createJobs({
            txCtx,
            jobs: [
              { typeName, id: randomUUID(), input: null, deduplication: { key, scope: "any" } },
            ],
          }),
        );
        created.push(chain);
      }
      const [again] = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName,
              id: randomUUID(),
              input: null,
              deduplication: { key: "alpha", scope: "any" },
            },
          ],
        }),
      );

      expect(
        created.map(({ deduplicationKey, deduplicated }) => ({ deduplicationKey, deduplicated })),
      ).toEqual(keys.map((key) => ({ deduplicationKey: key, deduplicated: false })));
      expect(new Set(created.map(({ id }) => id)).size).toBe(keys.length);
      expect(again.id).toBe(created[0].id);
      expect(again.deduplicated).toBe(true);
    });

    it("treats type names that differ in case, accent or trailing space as distinct", async ({
      adapter,
    }) => {
      const base = `type-${randomUUID()}`;
      const typeNames = [base, base.toUpperCase(), `${base}é`, `${base}e`, `${base} `];
      await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: typeNames.map((typeName) => ({ typeName, id: randomUUID(), input: typeName })),
        }),
      );
      const worker = await adapter.startWorker({
        workerId: randomUUID(),
        typeNames: [base],
        concurrency: 1,
        leaseMs: 60_000,
      });

      const claimed = await adapter.startJobAttempts({
        typeNames: [base],
        workerId: worker.id,
        workerToken: worker.token,
        limit: 10,
      });

      expect(claimed.map((job) => job.typeName)).toEqual([base]);
      expect(await adapter.getJobTypeNames({})).toEqual(expect.arrayContaining(typeNames));
    });

    it("round-trips timestamps exactly under a non-UTC host and session time zone", async ({
      adapter,
    }) => {
      const scheduledAt = new Date("2031-07-15T23:30:45.123Z");
      const before = Date.now();
      const [chain] = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName: `time-${randomUUID()}`,
              id: randomUUID(),
              input: null,
              schedule: { at: scheduledAt },
            },
          ],
        }),
      );
      const [read] = await adapter.getChains({ chainIds: [chain.id] });

      expect(read?.head.scheduledAt).toEqual(scheduledAt);
      expect(Math.abs(read!.createdAt.getTime() - before)).toBeLessThan(5_000);
    });

    it("round-trips JSON null, absent values and non-ASCII text in inputs and outputs", async ({
      adapter,
    }) => {
      const typeName = `json-${randomUUID()}`;
      const inputs = [
        null,
        { value: null },
        [null, 1],
        "null",
        0,
        false,
        { nested: { empty: {} } },
        { text: "Ünïcödé — 日本語 🚀" },
      ];
      const chains = await adapter.withTransaction(async (txCtx) =>
        adapter.createJobs({
          txCtx,
          jobs: inputs.map((input) => ({ typeName, id: randomUUID(), input })),
        }),
      );
      const completed = await adapter.withTransaction(async (txCtx) =>
        adapter.completeJobs({
          txCtx,
          jobs: chains.map((chain, index) => ({ jobId: chain.id, output: inputs[index] })),
        }),
      );

      expect(chains.map((chain) => chain.head.input)).toEqual(inputs);
      expect(completed.map((job) => job?.output)).toEqual(inputs);
    });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlHazardsSuite({ image, dialect, callerId: `${import.meta.url}-${dialect}` });
}
