import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { type RuntimeType } from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import { type StateAdapter } from "queuert";
import { extendWithResourceLeakDetection, stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

const isPreparableQuery = (sqlText: string): boolean => {
  const first = sqlText.trim().split(/\s+/)[0]?.toUpperCase();
  return (
    first === "SELECT" ||
    first === "INSERT" ||
    first === "UPDATE" ||
    first === "DELETE" ||
    first === "WITH" ||
    first === "MERGE" ||
    first === "VALUES"
  );
};

// VACUUM forbids transactions; SAVEPOINT/RELEASE/ROLLBACK TO need tx state we don't have.
const isInIsolationExecutable = (sqlText: string): boolean => {
  const trimmed = sqlText.trim();
  const first = trimmed.split(/\s+/)[0]?.toUpperCase();
  if (first === "VACUUM" || first === "CLUSTER" || first === "REINDEX") return false;
  if (first === "SAVEPOINT") return false;
  const head = trimmed.slice(0, 30).toUpperCase();
  if (head.startsWith("RELEASE SAVEPOINT")) return false;
  if (head.startsWith("ROLLBACK TO SAVEPOINT")) return false;
  return true;
};

const sampleForRuntime = (runtime: RuntimeType): unknown => {
  switch (runtime) {
    case "string":
      return "null";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "json":
      return null;
    case "array":
    case "jsonArray":
      return [];
    case "string?":
    case "number?":
    case "boolean?":
    case "uuid?":
    case "json?":
    case "date?":
      return null;
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`sampleForRuntime: unhandled RuntimeType ${_exhaustive as string}`);
    }
  }
};

const pgTypeMatchesRuntime = (
  pgType: string,
  runtime: RuntimeType,
  enumTypes: Set<string>,
): boolean => {
  const isArray = pgType.endsWith("[]");
  const base = isArray ? pgType.slice(0, -2) : pgType;

  switch (runtime) {
    case "string":
    case "string?":
      if (isArray) return false;
      return (
        ["text", "character varying", "varchar", "name", "uuid", "json", "jsonb"].includes(base) ||
        ["timestamp with time zone", "timestamp without time zone", "date"].includes(base) ||
        enumTypes.has(base)
      );
    case "number":
    case "number?":
      if (isArray) return false;
      return ["smallint", "integer", "bigint", "numeric", "real", "double precision"].includes(
        base,
      );
    case "boolean":
    case "boolean?":
      return !isArray && base === "boolean";
    case "uuid":
    case "uuid?":
      return !isArray && base === "uuid";
    case "json":
    case "json?":
      return !isArray && (base === "json" || base === "jsonb");
    case "array":
      return isArray;
    case "jsonArray":
      return isArray && (base === "json" || base === "jsonb");
    case "date?":
      return (
        !isArray &&
        ["timestamp with time zone", "timestamp without time zone", "date"].includes(base)
      );
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`pgTypeMatchesRuntime: unhandled RuntimeType ${_exhaustive as string}`);
    }
  }
};

const validateInline = async (
  client: Client,
  args: {
    sql: string;
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  },
  formatType: (oid: number) => string | undefined,
  enumTypes: Set<string>,
): Promise<void> => {
  const { sql, paramTypes, columnTypes, readOnly } = args;
  const ctx = `\n  SQL: ${sql.slice(0, 160).replace(/\s+/g, " ")}${sql.length > 160 ? "..." : ""}`;
  const declaredParamCount = Object.keys(paramTypes).length;

  if (isPreparableQuery(sql)) {
    // Unique per call: a fixed name conflicts when concurrent ops share this client.
    const stmtName = `queuert_contract_stmt_${Math.random().toString(36).slice(2, 10)}`;
    await client.query(`PREPARE ${stmtName} AS ${sql}`);
    try {
      const introspect = await client.query<{ params: string[] | null }>(
        `SELECT parameter_types::regtype[]::text[] AS params
           FROM pg_prepared_statements WHERE name = $1`,
        [stmtName],
      );
      const pgParams = introspect.rows[0]?.params ?? [];
      expect(
        pgParams.length,
        `declared ${declaredParamCount} params but PG sees ${pgParams.length}${ctx}`,
      ).toBe(declaredParamCount);
      for (let i = 0; i < pgParams.length; i++) {
        const runtime = paramTypes[i];
        expect(
          pgTypeMatchesRuntime(pgParams[i], runtime, enumTypes),
          `param $${i + 1}: PG reports '${pgParams[i]}', declared runtime '${runtime}'${ctx}`,
        ).toBe(true);
      }
    } finally {
      await client.query(`DEALLOCATE ${stmtName}`).catch(() => {});
    }
  }

  if (!isInIsolationExecutable(sql)) return;

  const paramValues = Array.from({ length: declaredParamCount }, (_, i) =>
    sampleForRuntime(paramTypes[i]),
  );
  await client.query("BEGIN");
  let execFields: readonly { name: string; dataTypeID: number }[] = [];
  try {
    const result = await client.query({ text: sql, values: paramValues });
    execFields = result.fields ?? [];
  } finally {
    await client.query("ROLLBACK");
  }

  const declaredColumnNames = Object.keys(columnTypes);
  if (declaredColumnNames.length > 0) {
    expect(
      execFields.length,
      `PG returned ${execFields.length} columns (${execFields.map((f) => f.name).join(", ")}), declared ${declaredColumnNames.length}${ctx}`,
    ).toBe(declaredColumnNames.length);

    const seen = new Set<string>();
    for (const f of execFields) {
      expect(seen.has(f.name), `duplicate column name '${f.name}' in result${ctx}`).toBe(false);
      seen.add(f.name);
    }

    const actual = new Map(
      execFields.map((f) => [f.name, formatType(f.dataTypeID) ?? `oid:${f.dataTypeID}`]),
    );
    for (const [name, runtime] of Object.entries(columnTypes)) {
      const pgType = actual.get(name);
      expect(pgType, `column '${name}': not found in PG result${ctx}`).toBeDefined();
      expect(
        pgTypeMatchesRuntime(pgType!, runtime, enumTypes),
        `column '${name}': PG reports '${pgType}', declared runtime '${runtime}'${ctx}`,
      ).toBe(true);
    }
  }

  await client.query("BEGIN TRANSACTION READ ONLY");
  let roError: (Error & { code?: string }) | undefined;
  try {
    await client.query({ text: sql, values: paramValues });
  } catch (e) {
    roError = e as Error & { code?: string };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }

  if (readOnly) {
    expect(
      roError,
      `declared readOnly:true but failed in READ ONLY tx: ${roError?.message}${ctx}`,
    ).toBeUndefined();
  } else {
    expect(
      roError,
      `declared readOnly:false but succeeded in READ ONLY tx (no writes or row locking detected)${ctx}`,
    ).toBeDefined();
    expect(
      roError?.code,
      `READ ONLY tx error had unexpected code '${roError?.code}' (${roError?.message})${ctx}`,
    ).toBe("25006");
  }
};

const createValidatingProvider = (
  pool: Pool,
  validationClient: Client,
  formatType: (oid: number) => string | undefined,
  enumTypes: Set<string>,
): PgStateProvider<PgPoolContext> => {
  const inner = createPgPoolProvider({ pool });
  // Serialize: concurrent BEGINs on the shared validation connection would nest illegally.
  let validationQueue: Promise<unknown> = Promise.resolve();
  return {
    transactionConcurrency: inner.transactionConcurrency,
    withTransaction: inner.withTransaction,
    executeSql: async (args) => {
      const next = validationQueue.then(async () =>
        validateInline(validationClient, args, formatType, enumTypes),
      );
      validationQueue = next.catch(() => {});
      await next;
      return inner.executeSql(args);
    },
    close: inner.close,
  };
};

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
})
  .extend<{
    validationClient: Client;
    formatType: (oid: number) => string | undefined;
    enumTypes: Set<string>;
  }>({
    validationClient: [
      async ({ postgresConnectionString }, use) => {
        const setupPool = new Pool({ connectionString: postgresConnectionString });
        const setupAdapter = await createPgStateAdapter({
          stateProvider: createPgPoolProvider({ pool: setupPool }),
        });
        await setupAdapter.migrateToLatest();
        await setupPool.end();

        const client = new Client({ connectionString: postgresConnectionString });
        await client.connect();
        try {
          await use(client);
        } finally {
          await client.end();
        }
      },
      { scope: "worker" },
    ],
    formatType: [
      async ({ validationClient }, use) => {
        const res = await validationClient.query<{ oid: string; name: string }>(
          `SELECT oid::text AS oid, format_type(oid, NULL) AS name FROM pg_type`,
        );
        const map = new Map(res.rows.map((r) => [Number(r.oid), r.name]));
        await use((oid) => map.get(oid));
      },
      { scope: "worker" },
    ],
    enumTypes: [
      async ({ validationClient }, use) => {
        const res = await validationClient.query<{ name: string }>(
          `SELECT format_type(oid, NULL) AS name FROM pg_type WHERE typtype = 'e'`,
        );
        await use(new Set(res.rows.map((r) => r.name)));
      },
      { scope: "worker" },
    ],
  })
  .extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
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
      async ({ pool, validationClient, formatType, enumTypes }, use) => {
        const stateProvider = createValidatingProvider(
          pool,
          validationClient,
          formatType,
          enumTypes,
        );
        const adapter = await createPgStateAdapter({ stateProvider });
        // Conformance doesn't drive these — run them so their SQL hits the validator.
        await adapter.migrateToLatest();
        await adapter.truncate();
        await adapter.vacuum();
        await use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

describe("PostgreSQL SQL contract", () => {
  stateAdapterConformanceTestSuite({ it });
});
