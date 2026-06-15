import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dummyProvider = {
  transactionConcurrency: "concurrent" as const,
  executeSql: async () => [],
  withTransaction: async <T>(fn: (ctx: any) => Promise<T>) => fn({}),
};

const it = extendWithPostgres(baseIt, import.meta.url);

it("index");

describe("SQL identifier validation", () => {
  const identifierInjectionCases: { label: string; value: string }[] = [
    { label: "SQL injection via semicolon", value: "public; DROP TABLE" },
    { label: "starts with a digit", value: "1bad" },
    { label: "contains dash", value: "my-prefix-" },
    { label: "contains space", value: "bad prefix" },
    { label: "contains quote", value: `foo'quote` },
    { label: "contains double-quote", value: `foo"quote` },
    { label: "contains backslash", value: "foo\\bar" },
    { label: "empty string", value: "" },
    { label: "SQL comment", value: "a -- comment" },
    { label: "block comment", value: "a /*x*/ b" },
  ];

  describe("rejects invalid schema", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, schema: value }),
        ).rejects.toThrow(/Invalid schema/);
      });
    }
  });

  describe("rejects invalid tablePrefix", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, tablePrefix: value }),
        ).rejects.toThrow(/Invalid tablePrefix/);
      });
    }
  });

  describe("rejects invalid idType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, idType: value }),
        ).rejects.toThrow(/Invalid idType/);
      });
    }
  });

  it("accepts valid schema and tablePrefix", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      schema: "my_schema",
      tablePrefix: "qrt_",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts default values", async () => {
    const adapter = await createPgStateAdapter({ stateProvider: dummyProvider });
    expect(adapter).toBeDefined();
  });

  it("accepts typical idType value", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      idType: "text",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts custom generateId", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      generateId: () => "custom-id",
    });
    expect(adapter).toBeDefined();
  });
});

describe("PostgreSQL State Adapter Variance - Custom Table Prefix", () => {
  const schema = "queuert";
  const tablePrefix = "myapp_";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
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
        const adapter = await createPgStateAdapter({ stateProvider, schema, tablePrefix });
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
  });

  conformanceIt("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { typeName: "t", chainId: undefined, chainIndex: 0, chainTypeName: "t", input: null },
        ],
      }),
    );
    expect(UUID_PATTERN.test(job.id)).toBe(true);
    expect(UUID_PATTERN.test(job.chainId)).toBe(true);
  });

  conformanceIt("creates tables with correct prefix", async ({ pool, stateAdapter: _ }) => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  conformanceIt(
    "pins autovacuum to a fixed dead-tuple threshold",
    async ({ pool, stateAdapter: _ }) => {
      const reloptionsFor = async (table: string): Promise<Record<string, string>> => {
        const result = await pool.query<{ reloptions: string[] | null }>(
          `SELECT c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
          [schema, table],
        );
        const reloptions = result.rows[0]?.reloptions ?? [];
        return Object.fromEntries(reloptions.map((opt) => opt.split("=") as [string, string]));
      };

      for (const table of [`${tablePrefix}job`, `${tablePrefix}job_blocker`]) {
        const options = await reloptionsFor(table);
        expect(options.autovacuum_vacuum_threshold).toBe("5000");
        expect(options.autovacuum_vacuum_scale_factor).toBe("0");
        expect(options.autovacuum_analyze_threshold).toBe("5000");
        expect(options.autovacuum_analyze_scale_factor).toBe("0");
        // carried over from the earlier vacuum_tuning migration via reloptions merge
        expect(options.autovacuum_vacuum_cost_delay).toBe("0");
      }

      // fillfactor is set only on the job table
      expect((await reloptionsFor(`${tablePrefix}job`)).fillfactor).toBe("75");
      expect((await reloptionsFor(`${tablePrefix}job_blocker`)).fillfactor).toBeUndefined();
    },
  );

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("PostgreSQL State Adapter Variance - Custom Schema", () => {
  const schema = "myapp_jobs";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
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
        const adapter = await createPgStateAdapter({ stateProvider, schema });
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
  });

  conformanceIt("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { typeName: "t", chainId: undefined, chainIndex: 0, chainTypeName: "t", input: null },
        ],
      }),
    );
    expect(UUID_PATTERN.test(job.id)).toBe(true);
    expect(UUID_PATTERN.test(job.chainId)).toBe(true);
  });

  conformanceIt("creates tables in correct schema", async ({ pool, stateAdapter: _ }) => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("PostgreSQL State Adapter Variance - Text ID Type", () => {
  const schema = "queuert_text_id";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
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
  });

  conformanceIt("generates text job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { typeName: "t", chainId: undefined, chainIndex: 0, chainTypeName: "t", input: null },
        ],
      }),
    );
    expect(typeof job.id).toBe("string");
    expect(job.id.length > 0).toBe(true);
  });

  conformanceIt("creates tables in correct schema", async ({ pool, stateAdapter: _ }) => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
