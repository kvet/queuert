// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe } from "vitest";

import {
  createPgStateProviderConformanceContext,
  pgStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import {
  withPgPoolNonTransactionContext,
  withPgPoolSavepoint,
} from "../state-provider/state-provider.pg-pool.spec-helper.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

export type PgIsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

export const pgIsolationPoolOptions = (level: PgIsolationLevel): { options: string } => ({
  options: `-c default_transaction_isolation=${level.toLowerCase().replace(" ", "\\ ")}`,
});

export const definePgStateAdapterConformanceSuite = async ({
  level,
  callerId,
}: {
  level: PgIsolationLevel;
  callerId: string;
}): Promise<void> => {
  const pg = await acquirePostgres("postgres:14", callerId);

  const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({
      connectionString: pg.connectionString,
      idleTimeoutMillis: 0,
      ...pgIsolationPoolOptions(level),
    });
    onCleanup(async () => pool.end());
    return createPgStateProviderConformanceContext({
      createStateProvider: async () => createPgPoolProvider({ pool }),
      isolationLevel: level,
      withNonTransactionContext: withPgPoolNonTransactionContext(pool),
      withSavepoint: withPgPoolSavepoint,
    }).context;
  });

  const customOptionsIt = baseIt.extend(
    "conformance",
    { scope: "file" },
    async ({}, { onCleanup }) => {
      const pool = new Pool({
        connectionString: pg.connectionString,
        idleTimeoutMillis: 0,
        ...pgIsolationPoolOptions(level),
      });
      onCleanup(async () => pool.end());
      await pool.query("CREATE SCHEMA IF NOT EXISTS custom");
      return createPgStateProviderConformanceContext({
        createStateProvider: async () => createPgPoolProvider({ pool }),
        isolationLevel: level,
        withNonTransactionContext: withPgPoolNonTransactionContext(pool),
        withSavepoint: withPgPoolSavepoint,
        stateAdapterOptions: {
          schema: "custom",
          tablePrefix: "custom_",
          jobIdType: "text",
          workerIdType: "text",
          generateJobId: () => `job.${crypto.randomUUID()}`,
          generateWorkerId: () => `worker.${crypto.randomUUID()}`,
        },
      }).context;
    },
  );

  // NOTE: hack for vitest plugin
  baseIt("index");

  describe(`PostgreSQL State Provider Conformance, ${level}`, () => {
    conformanceTestSuite({ it, groups: pgStateProviderConformanceGroups });
  });

  describe(`PostgreSQL State Provider Conformance - Custom Options, ${level}`, () => {
    conformanceTestSuite({ it: customOptionsIt, groups: pgStateProviderConformanceGroups });
  });
};
