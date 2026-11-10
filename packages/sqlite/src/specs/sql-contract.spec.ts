import type { RuntimeType } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import type { StateConformanceFixture } from "queuert/conformance";
import { stateAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { describe, expect, it } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

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

type SqlArgs = {
  sql: string;
  paramTypes: Record<number, RuntimeType>;
  columnTypes: Record<string, RuntimeType>;
  readOnly: boolean;
};

const isPreparableQuery = (sqlText: string): boolean => {
  const first = sqlText.trim().split(/\s+/)[0]?.toUpperCase();
  return (
    first === "SELECT" ||
    first === "INSERT" ||
    first === "UPDATE" ||
    first === "DELETE" ||
    first === "WITH" ||
    first === "VALUES"
  );
};

const validateBeforeExecute = (
  db: Database.Database,
  args: SqlArgs,
): Database.Statement | undefined => {
  const { sql, paramTypes, readOnly } = args;
  if (!isPreparableQuery(sql)) return undefined;
  const ctx = `\n  SQL: ${sql.slice(0, 160).replace(/\s+/g, " ")}${sql.length > 160 ? "..." : ""}`;

  const isLockStatement = /^\s*UPDATE\s+\w+\s+SET\s+(\w+)\s*=\s*\1\s/.test(sql);
  const fencedWrites = sql.match(
    /\b(?:INSERT INTO|UPDATE)\s+queuert_(?:job|job_blocker|worker)\b/g,
  );
  if (fencedWrites !== null && !isLockStatement) {
    const fenceGuards = sql.match(
      /NOT EXISTS \(SELECT 1 FROM queuert_schema_fence_v\d+ WHERE 1 = 0\)/g,
    );
    expect(
      fenceGuards?.length ?? 0,
      `every write to job, job_blocker or worker must reference the write fence${ctx}`,
    ).toBe(fencedWrites.length);
  }

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

  return Object.keys(args.columnTypes).length > 0 ? stmt : undefined;
};

const validateAfterExecute = (stmt: Database.Statement, args: SqlArgs, rows: unknown[]): void => {
  const ctx = `\n  SQL: ${args.sql.slice(0, 160).replace(/\s+/g, " ")}${args.sql.length > 160 ? "..." : ""}`;
  const stmtColumns = stmt.columns();
  const actualNames = stmtColumns.map((c) => c.name);
  expect([...actualNames].sort(), `column names mismatch${ctx}`).toEqual(
    Object.keys(args.columnTypes).sort(),
  );
  expect(
    new Set(actualNames).size,
    `duplicate column names in result: ${actualNames.join(", ")}${ctx}`,
  ).toBe(actualNames.length);

  const sampleRow = rows.length > 0 ? (rows[0] as Record<string, unknown>) : undefined;
  const declaredTypeByName = new Map(stmtColumns.map((c) => [c.name, c.type]));
  for (const [name, runtime] of Object.entries(args.columnTypes)) {
    const sqliteType = declaredTypeByName.get(name);
    if (sqliteType != null) {
      expect(
        sqliteTypeMatchesRuntime(sqliteType, runtime),
        `column '${name}': SQLite reports declared type '${sqliteType}', declared runtime '${runtime}'${ctx}`,
      ).toBe(true);
      continue;
    }
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
    withTransaction: inner.withTransaction,
    isTransaction: inner.isTransaction,
    classifyError: inner.classifyError,
    executeSql: async (args) => {
      const stmt = validateBeforeExecute(db, args);
      const rows = await inner.executeSql(args);
      if (stmt) validateAfterExecute(stmt, args, rows);
      return rows;
    },
    close: inner.close,
  };
};

const contractIt = it.extend<ConformanceFixtures<StateConformanceFixture>>({
  conformance: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      const db = new Database(":memory:");
      await createSqliteStateAdapter({
        stateProvider: createBetterSqlite3Provider({ db }),
      }).migrateToLatest();
      const stateAdapter = createSqliteStateAdapter({
        stateProvider: createValidatingProvider(db),
      });
      await use({ stateAdapter, reset: async () => stateAdapter.truncate() });
      db.close();
    },
    { scope: "file" },
  ],
});

describe("SQLite SQL contract", () => {
  conformanceTestSuite({ it: contractIt, groups: stateAdapterBaseGroups });
});
