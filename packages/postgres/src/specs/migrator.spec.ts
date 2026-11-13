import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { acquirePostgres } from "@queuert/testcontainers";
import type { MigrationResult } from "@queuert/typed-sql/migrator";
import { Pool } from "pg";
import { it as baseIt, describe, expect, vi } from "vitest";

import {
  createApplicationPgMigrationStore,
  createPgMigrator,
} from "../migration-store/migration-store.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";
import { LEASE_TTL_MS, NEWER, createAppMigrations } from "./migrator.process.ts";

type Provider = PgStateProvider<PgPoolContext>;

const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "migrator.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

const query = async <T = Record<string, unknown>>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: false,
  }) as Promise<T[]>;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ALL = createAppMigrations(undefined as unknown as Provider).map((m) => m.name);

const appliedNames = async (provider: Provider, table = "public.migration"): Promise<string[]> =>
  (await query<{ name: string }>(provider, `SELECT name FROM ${table} ORDER BY name`)).map(
    (row) => row.name,
  );

const lockRows = async (provider: Provider): Promise<{ locked_by: string }[]> =>
  query(provider, "SELECT locked_by FROM public.migration_lock");

const invoiceState = async (provider: Provider): Promise<unknown> => ({
  invoices: await query(provider, "SELECT id, status FROM invoices ORDER BY id"),
  indexes: (
    await query<{ indexname: string }>(
      provider,
      "SELECT indexname FROM pg_indexes WHERE tablename = 'invoices' ORDER BY indexname",
    )
  ).map((row) => row.indexname),
});

const MIGRATED = {
  invoices: [1, 2, 3, 4, 5].map((id) => ({ id, status: "open" })),
  indexes: ["invoices_customer_idx", "invoices_pkey"],
};

const result = (overrides: Partial<MigrationResult>): MigrationResult => ({
  applied: [],
  skipped: [],
  reverted: [],
  unrecognized: [],
  ...overrides,
});

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("database", async ({}, { onCleanup }) => {
  const pg = await acquirePostgres("postgres:14", `pg-migration-store-${randomUUID()}`);
  const pool = new Pool({ connectionString: pg.connectionString });
  onCleanup(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });
  const notices: string[] = [];
  pool.on("connect", (client) => {
    client.on("notice", (notice) => notices.push(notice.message ?? ""));
  });
  return {
    connectionString: pg.connectionString,
    provider: createPgPoolProvider({ pool }),
    notices,
  };
});

describe("createPgMigrator", () => {
  it(
    "applies every migration type and reverts them all, last first",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      const migrator = createPgMigrator({
        stateProvider: provider,
        migrations: [...createAppMigrations(provider), NEWER],
      });

      expect(await migrator.migrateToLatest()).toEqual(result({ applied: [...ALL, NEWER.name] }));
      expect(await invoiceState(provider)).toEqual(MIGRATED);
      expect(await query(provider, "SELECT kind FROM invoice_events")).toEqual([
        { kind: "payments" },
      ]);

      expect(await migrator.migrateTo(ALL[0])).toEqual(
        result({ skipped: [ALL[0]], reverted: [NEWER.name, ...ALL.slice(1).reverse()] }),
      );
      expect(await invoiceState(provider)).toEqual({ invoices: [], indexes: ["invoices_pkey"] });
      expect(await appliedNames(provider)).toEqual([ALL[0]]);
    },
  );

  it(
    "adopts the history of Kysely's migrator through a `before` script",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      for (const statement of [
        "CREATE TABLE kysely_migration (name varchar(255) PRIMARY KEY, timestamp varchar(255) NOT NULL)",
        "INSERT INTO kysely_migration VALUES ('create_invoices', '2026-01-01T00:00:00.000Z')",
        "CREATE TABLE invoices (id integer PRIMARY KEY, customer text NOT NULL, status text)",
        "CREATE TABLE invoice_events (invoice_id integer NOT NULL, kind text NOT NULL)",
      ]) {
        await query(provider, statement);
      }
      const migrator = createPgMigrator({
        stateProvider: provider,
        migrations: createAppMigrations(provider),
        before: async () => {
          await query(
            provider,
            "INSERT INTO migration (name) SELECT name FROM kysely_migration ON CONFLICT (name) DO NOTHING",
          );
        },
      });

      expect(await migrator.migrateToLatest()).toEqual(
        result({ skipped: [ALL[0]], applied: ALL.slice(1) }),
      );
      expect(await migrator.migrateToLatest()).toEqual(result({ skipped: ALL }));
      expect(await appliedNames(provider)).toEqual(ALL.toSorted());
    },
  );

  it(
    "creates the configured schema and its tables in it under the configured names",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      await createPgMigrator({
        stateProvider: provider,
        migrations: [
          {
            name: "create_invoices",
            up: async (txCtx) => void (await txCtx.poolClient.query("SELECT 1")),
            down: async () => {},
          },
        ],
        schema: "billing",
        migrationTableName: "schema_history",
        lockTableName: "schema_lease",
      }).migrateToLatest();

      expect(
        await query(
          provider,
          "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'billing' ORDER BY table_name, ordinal_position",
        ),
      ).toEqual([
        { table_name: "schema_history", column_name: "name", data_type: "text" },
        {
          table_name: "schema_history",
          column_name: "applied_at",
          data_type: "timestamp with time zone",
        },
        { table_name: "schema_lease", column_name: "id", data_type: "integer" },
        { table_name: "schema_lease", column_name: "locked_by", data_type: "text" },
        {
          table_name: "schema_lease",
          column_name: "locked_until",
          data_type: "timestamp with time zone",
        },
      ]);
      expect(await query(provider, "SELECT name FROM billing.schema_history")).toEqual([
        { name: "create_invoices" },
      ]);
    },
  );

  it(
    "boots without server notices once its schema and tables exist",
    { timeout: 120_000 },
    async ({ database: { provider, notices } }) => {
      const migrator = createPgMigrator({
        stateProvider: provider,
        migrations: createAppMigrations(provider),
        schema: "billing",
      });
      await migrator.migrateToLatest();
      notices.length = 0;

      expect(await migrator.migrateToLatest()).toEqual(result({ skipped: ALL }));
      expect(notices).toEqual([]);
    },
  );

  it(
    "names the failing migration and keeps the driver error as the cause",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      const failure = await createPgMigrator({
        stateProvider: provider,
        migrations: [
          {
            name: "create_invoices",
            up: async (txCtx) => void (await txCtx.poolClient.query("SELECT * FROM missing_table")),
            down: async () => {},
          },
        ],
      })
        .migrateToLatest()
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        message: 'Migration "create_invoices" failed: relation "missing_table" does not exist',
        cause: { code: "42P01" },
      });
    },
  );

  it("rejects a name that is not a plain SQL identifier", () => {
    const stateProvider = undefined as unknown as Provider;
    for (const option of ["schema", "migrationTableName", "lockTableName"]) {
      expect(() =>
        createPgMigrator({
          stateProvider,
          migrations: [],
          [option]: "invoices; DROP TABLE invoices",
        }),
      ).toThrow(new RegExp(`Invalid ${option}`));
    }
  });

  it("rejects a lease heartbeat that is not below a third of the lease TTL", () => {
    expect(() =>
      createPgMigrator({
        stateProvider: undefined as unknown as Provider,
        migrations: [],
        lock: { ttlMs: 10_000, heartbeatIntervalMs: 5_000 },
      }),
    ).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createPgMigrator: invalid configuration:",
          "  - lock.heartbeatIntervalMs must be below a third of lock.ttlMs (got 5000 and 10000)",
        ].join("\n"),
      }),
    );
  });

  it(
    "fences the lease by its owner, so an expired lease stays extendable until another owner claims it",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      const store = createApplicationPgMigrationStore({ stateProvider: provider });
      await store.initialize?.();
      const expire = async (): Promise<void> => {
        await query(
          provider,
          "UPDATE public.migration_lock SET locked_until = now() - interval '1 second'",
        );
      };

      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);
      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(false);

      await expire();
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);

      await expire();
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(true);
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(false);

      await store.releaseMigrationLock!("first");
      expect(await lockRows(provider)).toEqual([{ locked_by: "second" }]);
      await store.releaseMigrationLock!("second");
      expect(await lockRows(provider)).toEqual([]);
    },
  );
});

describe("parallel deployments", () => {
  it(
    "applies the migrations exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 5 }, () => spawnDeployment(connectionString, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        result({ skipped: ALL }),
        result({ skipped: ALL }),
        result({ skipped: ALL }),
        result({ skipped: ALL }),
        result({ applied: ALL }),
      ]);
      expect(await appliedNames(provider)).toEqual(ALL.toSorted());
      expect(await invoiceState(provider)).toEqual(MIGRATED);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "keeps the lease past its TTL while the holder is busy, and the waiter skips the holder's work",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const holder = await startPaused(
        spawnDeployment(connectionString, "older", "before-migrating"),
      );
      const waiter = spawnDeployment(connectionString, "older");
      await waiter.waitFor("ready");
      waiter.go();

      await sleep(LEASE_TTL_MS * 2);
      expect(waiter.finished()).toBe(false);

      holder.go();
      expect(await holder.result()).toEqual(result({ applied: ALL }));
      expect(await waiter.result()).toEqual(result({ skipped: ALL }));
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration and takes over its lease once it expires",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const killed = await startPaused(
        spawnDeployment(connectionString, "older", "inside-migration"),
      );
      await killed.kill();

      expect(await appliedNames(provider)).toEqual([]);
      expect(await query(provider, "SELECT to_regclass('invoices') AS invoices")).toEqual([
        { invoices: null },
      ]);
      expect(await lockRows(provider)).toHaveLength(1);

      const startedAt = performance.now();
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        result({ applied: ALL }),
      ]);
      expect(performance.now() - startedAt).toBeGreaterThan(LEASE_TTL_MS / 2);
      expect(await invoiceState(provider)).toEqual(MIGRATED);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen before migrating once it resumes after another deployment migrated in its place",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "before-migrating"),
      );
      frozen.freeze();
      await sleep(LEASE_TTL_MS + 500);

      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        result({ applied: ALL }),
      ]);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await appliedNames(provider)).toEqual(ALL.toSorted());
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen mid-migration once it resumes, while the deployment that took over finishes the rest",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "inside-migration"),
      );
      frozen.freeze();
      const [{ locked_by: frozenOwner }] = await lockRows(provider);
      await sleep(LEASE_TTL_MS + 500);

      const takingOver = spawnDeployment(connectionString, "older");
      await takingOver.waitFor("ready");
      takingOver.go();
      await vi.waitFor(
        async () => {
          expect((await lockRows(provider))[0]?.locked_by).not.toBe(frozenOwner);
        },
        { timeout: 30_000, interval: 50 },
      );
      expect(takingOver.finished()).toBe(false);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await takingOver.result()).toEqual(
        result({ applied: ALL.slice(1), skipped: ALL.slice(0, 1) }),
      );
      expect(await invoiceState(provider)).toEqual(MIGRATED);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "lets an older and a newer deployment migrate side by side",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const [older, newer] = (await startTogether([
        spawnDeployment(connectionString, "older"),
        spawnDeployment(connectionString, "newer"),
      ])) as MigrationResult[];

      expect([...older.applied, ...newer.applied].toSorted()).toEqual(
        [...ALL, NEWER.name].toSorted(),
      );
      expect(newer.applied).toContain(NEWER.name);
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        result({ skipped: ALL, unrecognized: [NEWER.name] }),
      ]);
      expect(await appliedNames(provider)).toEqual([...ALL, NEWER.name].toSorted());
    },
  );
});
