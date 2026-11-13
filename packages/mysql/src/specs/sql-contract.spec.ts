// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import type { RuntimeType } from "@queuert/typed-sql/sql";
import { type Pool, createPool } from "mysql2/promise";
import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import {
  withMysql2PoolNonTransactionContext,
  withMysql2PoolSavepoint,
} from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import {
  type Mysql2PoolProvider,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const valueMatchesRuntime = (value: unknown, runtime: RuntimeType): boolean => {
  if (runtime.endsWith("?") && value == null) return true;
  switch (runtime.replace("?", "")) {
    case "string":
    case "date":
      return typeof value === "string";
    case "number":
      return (
        typeof value === "number" ||
        (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
      );
    case "boolean":
      return typeof value === "boolean";
    case "uuid":
      return typeof value === "string" && UUID_PATTERN.test(value);
    case "json":
      return value !== undefined;
    default:
      return false;
  }
};

const findViolations = (
  { sql, params, paramTypes, columnTypes }: Parameters<Mysql2PoolProvider["executeSql"]>[0],
  rows: unknown[],
): string[] => {
  const statement = sql.trim().replace(/\s+/g, " ").slice(0, 120);
  const declaredColumns = Object.keys(columnTypes).sort();
  const returnsRows = /^\(*\s*(?:SELECT|WITH|VALUES|TABLE)\b|\bRETURNING\b/i.test(sql.trim());
  return [
    ...(Object.keys(paramTypes).length === params.length
      ? []
      : [`declares ${Object.keys(paramTypes).length} params, binds ${params.length}`]),
    ...params.flatMap((value, index) =>
      paramTypes[index] === undefined || valueMatchesRuntime(value, paramTypes[index])
        ? []
        : [`param ${index} ${JSON.stringify(value)} is not ${paramTypes[index]}`],
    ),
    ...(returnsRows === declaredColumns.length > 0
      ? []
      : [
          returnsRows
            ? "returns rows but declares no columns"
            : "declares columns but is no SELECT",
        ]),
    ...(rows as Record<string, unknown>[]).flatMap((row) => [
      ...(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(declaredColumns)
        ? []
        : [
            `returns columns ${Object.keys(row).sort().join(", ")}, declares ${declaredColumns.join(", ")}`,
          ]),
      ...Object.entries(columnTypes).flatMap(([name, runtime]) =>
        name in row && !valueMatchesRuntime(row[name], runtime)
          ? [`column ${name} ${JSON.stringify(row[name])} is not ${runtime}`]
          : [],
      ),
    ]),
  ].map((violation) => `${violation}: ${statement}`);
};

const createValidatingProvider = (pool: Pool, violations: Set<string>): Mysql2PoolProvider => {
  const inner = createMysql2PoolProvider({ pool });
  return {
    ...inner,
    executeSql: async (options) => {
      const rows = await inner.executeSql(options);
      for (const violation of findViolations(options, rows)) violations.add(violation);
      return rows;
    },
  };
};

const servers = [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
];
const acquired = await Promise.all(
  servers.map(async (server) => ({
    ...server,
    ...(await acquireMysql(server.image, `${import.meta.url}-${server.dialect}`)),
  })),
);

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect, connectionOptions } of acquired) {
  const violations = new Set<string>();
  const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    onCleanup(async () => pool.end());
    return createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createValidatingProvider(pool, violations),
      dialect,
      withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
      withSavepoint: withMysql2PoolSavepoint,
    });
  });

  describe(`${image} SQL contract`, () => {
    conformanceTestSuite({
      mode: "async",
      it,
      groups: [...stateAdapterBaseGroups, ...stateAdapterConcurrentTransactionGroups],
    });

    baseIt("every statement declares the types of its params and columns", () => {
      expect([...violations]).toEqual([]);
    });
  });
}
