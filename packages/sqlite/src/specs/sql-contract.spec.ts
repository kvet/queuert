import { type RuntimeType } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, expect, it } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

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

const runtimeValueMatchesRuntime = (value: unknown, runtime: RuntimeType): boolean => {
  if (value == null) return true;
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
    case "boolean":
    case "boolean?":
      return typeof value === "number" || typeof value === "bigint";
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`runtimeValueMatchesRuntime: unhandled RuntimeType ${_exhaustive as string}`);
    }
  }
};

const countPlaceholders = (sqlText: string): number => {
  const stripped = sqlText.replace(/'(?:''|[^'])*'/g, "");
  return (stripped.match(/\?/g) ?? []).length;
};

const validateAgainstDb = (
  db: Database.Database,
  args: {
    sql: string;
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  },
  rows: unknown[],
): void => {
  const { sql, paramTypes, columnTypes, readOnly } = args;
  const ctx = `\n  SQL: ${sql.slice(0, 160).replace(/\s+/g, " ")}${sql.length > 160 ? "..." : ""}`;

  const declaredParamCount = Object.keys(paramTypes).length;
  const placeholderCount = countPlaceholders(sql);
  expect(
    placeholderCount,
    `declared ${declaredParamCount} params but SQL contains ${placeholderCount} '?' placeholders${ctx}`,
  ).toBe(declaredParamCount);

  const stmt = db.prepare(sql);

  expect(
    stmt.readonly,
    `stmt.readonly is ${stmt.readonly}, declared readOnly is ${readOnly}${ctx}`,
  ).toBe(readOnly);

  const declaredColumnNames = Object.keys(columnTypes);
  if (declaredColumnNames.length === 0) return;

  const stmtColumns = stmt.columns();
  const actualNames = stmtColumns.map((c) => c.name);
  expect([...actualNames].sort(), `column names mismatch${ctx}`).toEqual(
    [...declaredColumnNames].sort(),
  );
  expect(
    new Set(actualNames).size,
    `duplicate column names in result: ${actualNames.join(", ")}${ctx}`,
  ).toBe(actualNames.length);

  const sampleRow = rows.length > 0 ? (rows[0] as Record<string, unknown>) : undefined;
  const declaredTypeByName = new Map(stmtColumns.map((c) => [c.name, c.type]));
  for (const [name, runtime] of Object.entries(columnTypes)) {
    const sqliteType = declaredTypeByName.get(name);
    if (sqliteType != null) {
      expect(
        sqliteTypeMatchesRuntime(sqliteType, runtime),
        `column '${name}': SQLite reports declared type '${sqliteType}', declared runtime '${runtime}'${ctx}`,
      ).toBe(true);
      continue;
    }
    // Expression-derived columns report null type; fall back to a real row when we have one.
    if (sampleRow && name in sampleRow) {
      const value = sampleRow[name];
      expect(
        runtimeValueMatchesRuntime(value, runtime),
        `column '${name}': runtime value has typeof '${typeof value}', declared runtime '${runtime}'${ctx}`,
      ).toBe(true);
    }
  }
};

const createValidatingProvider = (
  db: Database.Database,
): SqliteStateProvider<BetterSqlite3Context> => {
  const inner = createBetterSqlite3Provider({ db });
  return {
    transactionConcurrency: inner.transactionConcurrency,
    withTransaction: inner.withTransaction,
    executeSql: async (args) => {
      const rows = await inner.executeSql(args);
      validateAgainstDb(db, args, rows);
      return rows;
    },
    close: inner.close,
  };
};

describe("SQLite SQL contract", () => {
  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("auto_vacuum = INCREMENTAL");
        db.pragma("foreign_keys = ON");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createValidatingProvider(db);
        const adapter = await createSqliteStateAdapter({ stateProvider });
        await adapter.migrateToLatest();
        // Conformance doesn't drive these — run them so their SQL hits the validator.
        await adapter.vacuum();
        await adapter.truncate();
        await use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
