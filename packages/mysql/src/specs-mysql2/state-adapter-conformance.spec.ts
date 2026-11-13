// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { it as baseIt, describe } from "vitest";

import {
  createMysqlStateProviderConformanceContext,
  mysqlStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import {
  withMysql2PoolNonTransactionContext,
  withMysql2PoolSavepoint,
} from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import { createMysql2PoolProvider } from "../state-provider/state-provider.mysql2-pool.ts";

const defineMysqlStateAdapterConformanceSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  const { connectionOptions } = await acquireMysql(image, callerId);

  const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    onCleanup(async () => pool.end());
    return createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createMysql2PoolProvider({ pool }),
      dialect,
      withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
      withSavepoint: withMysql2PoolSavepoint,
    });
  });

  describe(`${image} State Provider Conformance`, () => {
    conformanceTestSuite({ mode: "async", it, groups: mysqlStateProviderConformanceGroups });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlStateAdapterConformanceSuite({
    image,
    dialect,
    callerId: `${import.meta.url}-${dialect}`,
  });
}
