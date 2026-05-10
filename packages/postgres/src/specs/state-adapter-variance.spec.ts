import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { migrations } from "../state-adapter/sql.js";
import { type PgStateAdapter, createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dummyProvider = {
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

  describe("rejects dangerous idDefault expressions", () => {
    const dangerousExpressions = [
      { label: "statement terminator", value: "1; DROP TABLE users" },
      { label: "SQL line comment", value: "1 -- comment" },
      { label: "block comment open", value: "1 /*" },
      { label: "block comment close", value: "1 */" },
      { label: "double-quote identifier", value: `"foo"` },
      { label: "backslash escape", value: "foo\\bar" },
    ];
    for (const { label, value } of dangerousExpressions) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, idDefault: value }),
        ).rejects.toThrow(/Invalid idDefault/);
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

  it("accepts idDefault with function call and single-quoted literal", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      idDefault: "nextval('my_seq')",
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
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
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
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
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
          idDefault: "gen_random_uuid()::text",
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
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
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

describe("Migrations", () => {
  const migrationIt = it.extend<{
    pool: Pool;
    stateAdapter: PgStateAdapter<PgPoolContext>;
  }>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await pool.query(
          "DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE",
        );
        await use(pool);
        await pool.end();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ pool }, use) => {
        const stateProvider = createPgPoolProvider({ pool });
        await use(await createPgStateAdapter({ stateProvider }));
      },
      { scope: "test" },
    ],
  });

  migrationIt("fresh install applies all migrations", async ({ stateAdapter }) => {
    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.name));
    expect(result.unrecognized).toEqual([]);
  });

  migrationIt("running twice is idempotent", async ({ stateAdapter }) => {
    const firstResult = await stateAdapter.migrateToLatest();
    expect(firstResult.applied.length).toBeGreaterThan(0);

    const secondResult = await stateAdapter.migrateToLatest();
    expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
    expect(secondResult.applied).toEqual([]);
    expect(secondResult.unrecognized).toEqual([]);
  });

  migrationIt("vacuum runs without error", async ({ stateAdapter }) => {
    await stateAdapter.migrateToLatest();
    await expect(stateAdapter.vacuum()).resolves.toBeUndefined();
  });

  migrationIt(
    "returns unknown migrations when database is ahead",
    async ({ stateAdapter, pool }) => {
      await stateAdapter.migrateToLatest();

      await pool.query(
        "INSERT INTO queuert_migration (name) VALUES ('20991231235959_future_migration')",
      );

      const result = await stateAdapter.migrateToLatest();

      expect(result.skipped).toEqual(migrations.map((m) => m.name));
      expect(result.applied).toEqual([]);
      expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);
    },
  );
});
