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

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
  onCleanup(async () => pool.end());
  return createPgStateProviderConformanceContext({
    createStateProvider: async () => createPgPoolProvider({ pool }),
    withNonTransactionContext: withPgPoolNonTransactionContext(pool),
    withSavepoint: withPgPoolSavepoint,
  });
});

const createIsolationLevelIt = (defaultTransactionIsolation: string) =>
  baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({
      connectionString: pg.connectionString,
      idleTimeoutMillis: 0,
      max: 5,
      options: `-c default_transaction_isolation=${defaultTransactionIsolation}`,
    });
    onCleanup(async () => pool.end());
    return createPgStateProviderConformanceContext({
      createStateProvider: async () => createPgPoolProvider({ pool }),
      withNonTransactionContext: withPgPoolNonTransactionContext(pool),
      withSavepoint: withPgPoolSavepoint,
    });
  });

const repeatableReadIt = createIsolationLevelIt("repeatable\\ read");
const serializableIt = createIsolationLevelIt("serializable");

const customOptionsIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => pool.end());
    await pool.query("CREATE SCHEMA IF NOT EXISTS custom");
    return createPgStateProviderConformanceContext({
      createStateProvider: async () => createPgPoolProvider({ pool }),
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
    });
  },
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL State Provider Conformance", () => {
  conformanceTestSuite({ it, groups: pgStateProviderConformanceGroups });
});

describe("PostgreSQL State Provider Conformance - REPEATABLE READ", () => {
  conformanceTestSuite({
    it: repeatableReadIt,
    groups: pgStateProviderConformanceGroups,
  });
});

describe("PostgreSQL State Provider Conformance - SERIALIZABLE", () => {
  conformanceTestSuite({
    it: serializableIt,
    groups: pgStateProviderConformanceGroups,
  });
});

describe("PostgreSQL State Provider Conformance - Custom Options", () => {
  conformanceTestSuite({ it: customOptionsIt, groups: pgStateProviderConformanceGroups });
});
