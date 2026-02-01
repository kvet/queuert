import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPgPoolProvider } from "./state-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

it("index");

describe("PostgreSQL State Adapter Conformance - Default Config", () => {
  const schema = "queuert";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
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
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("PostgreSQL State Adapter Conformance - Custom Schema", () => {
  const schema = "myapp_jobs";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
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
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});

describe("PostgreSQL State Adapter Conformance - Text ID Type", () => {
  const schema = "queuert_text_id";

  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    validateId: (id: string) => boolean;
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
    validateId: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => use((id: string) => UUID_PATTERN.test(id)),
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt as any });
});
