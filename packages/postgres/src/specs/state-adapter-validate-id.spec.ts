import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { type PgStateAdapter, createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url);

it("index");

describe("validateId", () => {
  const tablePrefix = "qrt_validate_";

  const makeAdapter = async (
    pool: Pool,
    options: { generateId?: () => string; validateId?: (id: string) => boolean },
  ) => {
    const stateProvider = createPgPoolProvider({ pool });
    const adapter = await createPgStateAdapter<PgPoolContext, string>({
      stateProvider,
      tablePrefix,
      idType: "text",
      ...options,
    });
    await adapter.migrateToLatest();
    return adapter;
  };

  const createJob = async (adapter: PgStateAdapter<PgPoolContext, string>, id?: string) =>
    adapter.withTransaction(async (txCtx) =>
      adapter.createChains({
        txCtx,
        jobs: [{ typeName: "t", id, chainTypeName: "t", input: null }],
      }),
    );

  it("rejects caller-supplied id that fails validateId", async ({ postgresConnectionString }) => {
    const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
    try {
      const adapter = await makeAdapter(pool, {
        generateId: () => `ok-${crypto.randomUUID()}`,
        validateId: (id) => id.startsWith("ok-"),
      });
      await expect(createJob(adapter, "bad-id")).rejects.toThrow(
        /Invalid job ID "bad-id" from caller/,
      );
    } finally {
      await pool.end();
    }
  });

  it("rejects generator output that fails validateId", async ({ postgresConnectionString }) => {
    const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
    try {
      const adapter = await makeAdapter(pool, {
        generateId: () => "wrong-format",
        validateId: (id) => id.startsWith("ok-"),
      });
      await expect(createJob(adapter)).rejects.toThrow(
        /Invalid job ID "wrong-format" from generator/,
      );
    } finally {
      await pool.end();
    }
  });

  it("accepts valid caller-supplied id", async ({ postgresConnectionString }) => {
    const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
    try {
      const adapter = await makeAdapter(pool, {
        generateId: () => `ok-${crypto.randomUUID()}`,
        validateId: (id) => id.startsWith("ok-"),
      });
      const [{ job }] = await createJob(adapter, "ok-custom");
      expect(job.id).toBe("ok-custom");
    } finally {
      await pool.end();
    }
  });
});

describe("PostgreSQL State Adapter Variance - With validateId", () => {
  const schema = "queuert_validateid";
  const generateId = () => `ok-${crypto.randomUUID()}`;
  const validateId = (id: string) => id.startsWith("ok-");
  const generateInvalidId = () => `bad-${crypto.randomUUID()}`;

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
    generateId: () => string;
    generateInvalidId: () => string;
  }>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await use(pool);
        await pool.end();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ pool }, use) => {
        const client = await pool.connect();
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        client.release();

        const stateProvider = createPgPoolProvider({ pool });
        const adapter = await createPgStateAdapter({
          stateProvider,
          schema,
          idType: "text",
          generateId,
          validateId,
        });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (txCtx: { $test: true }) => {
          const pgCtx = txCtx as unknown as PgPoolContext;
          await pgCtx.poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
        });
      },
      { scope: "test" },
    ],
    generateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use(generateId),
      { scope: "test" },
    ],
    generateInvalidId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use(generateInvalidId),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
