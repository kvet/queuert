import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  type DataType,
  type RuntimeType,
  type TypedSql,
  createTemplateApplier,
  extractColumnTypes,
  extractParamTypes,
  t,
} from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import { extendWithResourceLeakDetection } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createPgSqlDefinitions } from "../state-adapter/sql.js";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.js";

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
});

const isTypedSql = (v: unknown): v is TypedSql =>
  typeof v === "object" &&
  v !== null &&
  "sql" in v &&
  "params" in v &&
  "columns" in v &&
  "readOnly" in v;

// `PREPARE stmt AS <sql>` lets us introspect param types via `pg_prepared_statements`.
// Only DML / CTE-headed queries can be PREPAREd — DDL must be executed directly.
const isPreparableQuery = (sql: string): boolean => {
  const first = sql.trim().split(/\s+/)[0]?.toUpperCase();
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

const sampleForRuntime = (runtime: RuntimeType): unknown => {
  switch (runtime) {
    case "string":
      // JSON-valid literal ("null") so that SQL statements which cast a string
      // param to jsonb (e.g. `$N::jsonb`) succeed in the exec-for-fields pass.
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
      // `string` is used both as "JS string → PG text" and as the representation
      // for uuid, enum, and timestamp columns (pg driver returns string/Date, the
      // adapter normalizes via `new Date(...)`). `jsonb`/`json` accepted for params
      // where the SQL has an explicit `::jsonb` cast of a string value.
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

type AdapterConfig = {
  label: string;
  schema: string;
  tablePrefix: string;
  idType: string;
  idDataType: DataType<RuntimeType, string>;
  idNullableDataType: DataType<RuntimeType, string | null>;
};

const configs: AdapterConfig[] = [
  {
    label: "idType=uuid",
    schema: "public",
    tablePrefix: "qrt_uuid_",
    idType: "uuid",
    idDataType: t.uuid(),
    idNullableDataType: t["uuid?"](),
  },
  {
    label: "idType=text",
    schema: "public",
    tablePrefix: "qrt_text_",
    idType: "text",
    idDataType: t.string(),
    idNullableDataType: t["string?"](),
  },
];

const contractIt = it.extend<{
  client: Client;
  formatType: (oid: number) => string | undefined;
  enumTypes: Set<string>;
}>({
  client: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString });
      try {
        for (const cfg of configs) {
          const adapter = await createPgStateAdapter({
            stateProvider: createPgPoolProvider({ pool }),
            schema: cfg.schema,
            tablePrefix: cfg.tablePrefix,
            idType: cfg.idType,
          });
          await adapter.migrateToLatest();
        }
      } finally {
        await pool.end();
      }

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
    async ({ client }, use) => {
      const res = await client.query<{ oid: string; name: string }>(
        `SELECT oid::text AS oid, format_type(oid, NULL) AS name FROM pg_type`,
      );
      const map = new Map(res.rows.map((r) => [Number(r.oid), r.name]));
      await use((oid) => map.get(oid));
    },
    { scope: "worker" },
  ],
  enumTypes: [
    async ({ client }, use) => {
      const res = await client.query<{ name: string }>(
        `SELECT format_type(oid, NULL) AS name FROM pg_type WHERE typtype = 'e'`,
      );
      await use(new Set(res.rows.map((r) => r.name)));
    },
    { scope: "worker" },
  ],
});

describe("PostgreSQL SQL contract", () => {
  for (const cfg of configs) {
    describe(cfg.label, () => {
      const defs = createPgSqlDefinitions(cfg.idDataType, cfg.idNullableDataType);
      const applyTemplate = createTemplateApplier({
        schema: cfg.schema,
        table_prefix: cfg.tablePrefix,
        id_type: cfg.idType,
      });

      const sqlCases = (Object.entries(defs) as [string, unknown][]).filter(
        (e): e is [string, TypedSql] => isTypedSql(e[1]),
      );

      for (const [key, typedSql] of sqlCases) {
        contractIt(key, async ({ client, formatType, enumTypes }) => {
          const resolved = applyTemplate(typedSql);
          const declaredParamTypes = extractParamTypes(resolved.params);
          const declaredColumnTypes = extractColumnTypes(resolved.columns);
          const paramValues = resolved.params.map((p) => sampleForRuntime(p.type));

          if (isPreparableQuery(resolved.sql)) {
            const stmtName = "queuert_contract_stmt";
            await client.query(`PREPARE ${stmtName} AS ${resolved.sql}`);
            try {
              const introspect = await client.query<{ params: string[] | null }>(
                `SELECT parameter_types::regtype[]::text[] AS params
                   FROM pg_prepared_statements WHERE name = $1`,
                [stmtName],
              );
              const pgParams = introspect.rows[0]?.params ?? [];
              expect(
                pgParams.length,
                `${key}: declared ${Object.keys(declaredParamTypes).length} params but PG sees ${pgParams.length}`,
              ).toBe(Object.keys(declaredParamTypes).length);
              for (let i = 0; i < pgParams.length; i++) {
                const runtime = declaredParamTypes[i];
                expect(
                  pgTypeMatchesRuntime(pgParams[i], runtime, enumTypes),
                  `${key} param $${i + 1}: PG reports '${pgParams[i]}', declared runtime '${runtime}'`,
                ).toBe(true);
              }
            } finally {
              await client.query(`DEALLOCATE ${stmtName}`).catch(() => {});
            }
          }

          await client.query("BEGIN");
          let execFields: readonly { name: string; dataTypeID: number }[] = [];
          try {
            const result = await client.query({ text: resolved.sql, values: paramValues });
            execFields = result.fields ?? [];
          } finally {
            await client.query("ROLLBACK");
          }

          if (Object.keys(declaredColumnTypes).length > 0) {
            expect(
              execFields.length,
              `${key}: PG returned ${execFields.length} columns (${execFields.map((f) => f.name).join(", ")}), declared ${Object.keys(declaredColumnTypes).length}`,
            ).toBe(Object.keys(declaredColumnTypes).length);

            const seen = new Set<string>();
            for (const f of execFields) {
              expect(seen.has(f.name), `${key}: duplicate column name '${f.name}' in result`).toBe(
                false,
              );
              seen.add(f.name);
            }

            const actual = new Map(
              execFields.map((f) => [f.name, formatType(f.dataTypeID) ?? `oid:${f.dataTypeID}`]),
            );
            for (const [name, runtime] of Object.entries(declaredColumnTypes)) {
              const pgType = actual.get(name);
              expect(pgType, `${key} column '${name}': not found in PG result`).toBeDefined();
              expect(
                pgTypeMatchesRuntime(pgType!, runtime, enumTypes),
                `${key} column '${name}': PG reports '${pgType}', declared runtime '${runtime}'`,
              ).toBe(true);
            }
          }

          await client.query("BEGIN TRANSACTION READ ONLY");
          let roError: (Error & { code?: string }) | undefined;
          try {
            await client.query({ text: resolved.sql, values: paramValues });
          } catch (e) {
            roError = e as Error & { code?: string };
          } finally {
            await client.query("ROLLBACK").catch(() => {});
          }

          if (resolved.readOnly) {
            expect(
              roError,
              `${key} declared readOnly:true but failed in READ ONLY tx: ${roError?.message}`,
            ).toBeUndefined();
          } else {
            expect(
              roError,
              `${key} declared readOnly:false but succeeded in READ ONLY tx (no writes or row locking detected)`,
            ).toBeDefined();
            expect(
              roError?.code,
              `${key}: READ ONLY tx error had unexpected code '${roError?.code}' (${roError?.message})`,
            ).toBe("25006");
          }
        });
      }
    });
  }
});
