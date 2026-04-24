import {
  type DataType,
  type RuntimeType,
  type TypedSql,
  createTemplateApplier,
  extractColumnTypes,
  extractParamTypes,
  t,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  createSqliteSqlDefinitions,
  jobColumnsPrefixedSelect,
  jobColumnsSelect,
} from "../state-adapter/sql.js";
import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.js";

const isTypedSql = (v: unknown): v is TypedSql =>
  typeof v === "object" &&
  v !== null &&
  "sql" in v &&
  "params" in v &&
  "columns" in v &&
  "readOnly" in v;

const sqliteTypeMatchesRuntime = (sqliteType: string, runtime: RuntimeType): boolean => {
  const normalized = sqliteType.toUpperCase();
  switch (runtime) {
    case "string":
    case "string?":
    case "uuid":
    case "uuid?":
    case "json":
    case "json?":
    case "array":
    case "jsonArray":
    case "date?":
      return normalized === "TEXT";
    case "number":
    case "number?":
    case "boolean":
    case "boolean?":
      return normalized === "INTEGER";
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`sqliteTypeMatchesRuntime: unhandled RuntimeType ${_exhaustive as string}`);
    }
  }
};

// SQLite values come back as strings/numbers/nulls/Buffers. Map `typeof value` to the
// declared runtime type so we can verify columns whose `stmt.columns()[i].type` is null
// (expression-derived columns, aggregates, COALESCE, etc).
const runtimeValueMatchesRuntime = (value: unknown, runtime: RuntimeType): boolean => {
  if (value == null) {
    // Null is compatible with any nullable runtime (and non-nullables only surface null
    // when the caller explicitly accepts it); we can't disprove the declared type here.
    return true;
  }
  switch (runtime) {
    case "string":
    case "string?":
    case "uuid":
    case "uuid?":
    case "json":
    case "json?":
    case "array":
    case "jsonArray":
    case "date?":
      return typeof value === "string";
    case "number":
    case "number?":
      return typeof value === "number" || typeof value === "bigint";
    case "boolean":
    case "boolean?":
      return typeof value === "number" || typeof value === "bigint";
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`runtimeValueMatchesRuntime: unhandled RuntimeType ${_exhaustive as string}`);
    }
  }
};

const sampleForRuntime = (runtime: RuntimeType): unknown => {
  switch (runtime) {
    case "string":
      // Valid JSON array literal so SQL that passes the string into `json_each(?)` /
      // `json_extract(?, ...)` succeeds in the sample-binding pass. Valid as a plain
      // string filter too (just matches nothing on empty tables).
      return "[]";
    case "number":
      return 0;
    case "boolean":
      return 0;
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "json":
      return "null";
    case "array":
    case "jsonArray":
      return "[]";
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

// Count `?` positional parameters in the SQL, ignoring occurrences inside single-quoted
// string literals. Good enough for our SQL (no `--` comments contain `?`).
const countPlaceholders = (sqlText: string): number => {
  const stripped = sqlText.replace(/'(?:''|[^'])*'/g, "");
  return (stripped.match(/\?/g) ?? []).length;
};

type AdapterConfig = {
  label: string;
  tablePrefix: string;
  idType: string;
  idDataType: DataType<RuntimeType, string>;
};

const configs: AdapterConfig[] = [
  {
    label: "tablePrefix=queuert_",
    tablePrefix: "queuert_",
    idType: "TEXT",
    idDataType: t.string(),
  },
  {
    label: "tablePrefix=myapp_jobs_",
    tablePrefix: "myapp_jobs_",
    idType: "TEXT",
    idDataType: t.string(),
  },
];

const contractIt = it.extend<{ db: Database.Database }>({
  db: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const db = new Database(":memory:");
      db.pragma("journal_mode = WAL");
      db.pragma("auto_vacuum = INCREMENTAL");
      db.pragma("foreign_keys = ON");
      for (const cfg of configs) {
        const adapter = await createSqliteStateAdapter({
          stateProvider: createBetterSqlite3Provider({ db }),
          tablePrefix: cfg.tablePrefix,
          idType: cfg.idType,
        });
        await adapter.migrateToLatest();
      }
      await use(db);
      db.close();
    },
    { scope: "worker" },
  ],
});

describe("SQLite SQL contract", () => {
  for (const cfg of configs) {
    describe(cfg.label, () => {
      const defs = createSqliteSqlDefinitions(cfg.idDataType);
      const applyTemplate = createTemplateApplier(
        { table_prefix: cfg.tablePrefix, id_type: cfg.idType },
        { job_columns: jobColumnsSelect, job_columns_prefixed: jobColumnsPrefixedSelect },
      );

      const sqlCases = (Object.entries(defs) as [string, unknown][]).filter(
        (e): e is [string, TypedSql] => isTypedSql(e[1]),
      );

      for (const [key, typedSql] of sqlCases) {
        contractIt(key, ({ db }) => {
          const resolved = applyTemplate(typedSql);
          const declaredParamTypes = extractParamTypes(resolved.params);
          const declaredColumnTypes = extractColumnTypes(resolved.columns);
          const paramValues = resolved.params.map((p) => sampleForRuntime(p.type));

          const placeholderCount = countPlaceholders(resolved.sql);
          expect(
            placeholderCount,
            `${key}: declared ${Object.keys(declaredParamTypes).length} params but SQL contains ${placeholderCount} '?' placeholders`,
          ).toBe(Object.keys(declaredParamTypes).length);

          const stmt = db.prepare(resolved.sql);

          expect(
            stmt.readonly,
            `${key}: stmt.readonly is ${stmt.readonly}, declared readOnly is ${resolved.readOnly}`,
          ).toBe(resolved.readOnly);

          // Execute with sample params inside a SAVEPOINT we always roll back. Validates that:
          // (a) the declared param count matches what SQLite expects (better-sqlite3 throws
          //     on count mismatch), and (b) declared runtime types are bind-compatible.
          // We also harvest the first returned row (if any) to verify column types for
          // expression-derived columns where `stmt.columns()[i].type` is null.
          db.exec("SAVEPOINT contract");
          let firstRow: Record<string, unknown> | undefined;
          try {
            if (stmt.reader) {
              firstRow = stmt.get(...paramValues) as Record<string, unknown> | undefined;
            } else {
              stmt.run(...paramValues);
            }
          } finally {
            db.exec("ROLLBACK TO contract");
            db.exec("RELEASE contract");
          }

          if (Object.keys(declaredColumnTypes).length > 0) {
            const stmtColumns = stmt.columns();
            const actualNames = stmtColumns.map((c) => c.name);
            const declaredNames = Object.keys(declaredColumnTypes);
            expect([...actualNames].sort(), `${key}: column names mismatch`).toEqual(
              [...declaredNames].sort(),
            );
            expect(
              new Set(actualNames).size,
              `${key}: duplicate column names in result: ${actualNames.join(", ")}`,
            ).toBe(actualNames.length);

            const declaredTypeByName = new Map(stmtColumns.map((c) => [c.name, c.type]));
            for (const [name, runtime] of Object.entries(declaredColumnTypes)) {
              const sqliteType = declaredTypeByName.get(name);
              if (sqliteType != null) {
                expect(
                  sqliteTypeMatchesRuntime(sqliteType, runtime),
                  `${key} column '${name}': SQLite reports declared type '${sqliteType}', declared runtime '${runtime}'`,
                ).toBe(true);
                continue;
              }
              // Expression-derived column: fall back to runtime value inspection when a row
              // is available. Empty result sets leave the column unverified (acceptable —
              // these queries filter on params we can't meaningfully populate).
              if (firstRow && name in firstRow) {
                const value = firstRow[name];
                expect(
                  runtimeValueMatchesRuntime(value, runtime),
                  `${key} column '${name}': runtime value has typeof '${typeof value}', declared runtime '${runtime}'`,
                ).toBe(true);
              }
            }
          }
        });
      }
    });
  }
});
