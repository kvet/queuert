// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { type PoolOptions, createPool } from "mysql2/promise";
import {
  stateAdapterGapLockFreeGroups,
  stateAdapterNonLockingReadGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createMysqlStateProviderConformanceContext,
  mysqlStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import {
  withMysql2PoolNonTransactionContext,
  withMysql2PoolSavepoint,
} from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import { createMysql2PoolProvider } from "../state-provider/state-provider.mysql2-pool.ts";

export type MysqlIsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

export const createMysqlIsolationPool = async (
  options: PoolOptions & { connectionLimit: number },
  level: MysqlIsolationLevel,
): Promise<ReturnType<typeof createPool>> => {
  const pool = createPool({ ...options, maxIdle: options.connectionLimit, idleTimeout: 3_600_000 });
  pool.on("connection", (connection) => {
    void connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
  });
  const connections = await Promise.all(
    Array.from({ length: options.connectionLimit }, async () => pool.getConnection()),
  );
  for (const connection of connections) {
    await connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
    connection.release();
  }
  return pool;
};

export const mysqlConformanceServers: { image: string; dialect: "mysql" | "mariadb" }[] = [
  { image: "mysql:8.4", dialect: "mysql" },
  { image: "mariadb:11.4", dialect: "mariadb" },
];

export const defineMysqlStateAdapterConformanceSuite = async ({
  level,
  callerId,
}: {
  level: MysqlIsolationLevel;
  callerId: string;
}): Promise<void> => {
  const skippedGroups = new Set<unknown>([
    ...(level === "READ COMMITTED" ? [] : stateAdapterGapLockFreeGroups),
    ...(level === "SERIALIZABLE" ? stateAdapterNonLockingReadGroups : []),
  ]);
  const groups = mysqlStateProviderConformanceGroups.filter((group) => !skippedGroups.has(group));

  // NOTE: hack for vitest plugin
  baseIt("index");

  for (const { image, dialect } of mysqlConformanceServers) {
    const { connectionOptions } = await acquireMysql(image, `${callerId}-${dialect}`);

    const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
      const pool = await createMysqlIsolationPool(
        { ...connectionOptions, connectionLimit: 20 },
        level,
      );
      onCleanup(async () => pool.end());
      return createMysqlStateProviderConformanceContext({
        createStateProvider: async () => createMysql2PoolProvider({ pool }),
        dialect,
        isolationLevel: level,
        withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
        withSavepoint: withMysql2PoolSavepoint,
      }).context;
    });

    const customOptionsIt = baseIt.extend(
      "conformance",
      { scope: "file" },
      async ({}, { onCleanup }) => {
        const pool = await createMysqlIsolationPool(
          { ...connectionOptions, connectionLimit: 20 },
          level,
        );
        onCleanup(async () => pool.end());
        return createMysqlStateProviderConformanceContext({
          createStateProvider: async () => createMysql2PoolProvider({ pool }),
          dialect,
          isolationLevel: level,
          withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
          withSavepoint: withMysql2PoolSavepoint,
          stateAdapterOptions: {
            tablePrefix: "custom_",
            jobIdType: "varchar(64)",
            workerIdType: "varchar(64)",
            generateJobId: () => `job.${crypto.randomUUID()}`,
            generateWorkerId: () => `worker.${crypto.randomUUID()}`,
          },
        }).context;
      },
    );

    describe(`${image} State Provider Conformance, ${level}`, () => {
      conformanceTestSuite({ it, groups });
    });

    describe(`${image} State Provider Conformance - Custom Options, ${level}`, () => {
      conformanceTestSuite({ it: customOptionsIt, groups });
    });
  }
};
