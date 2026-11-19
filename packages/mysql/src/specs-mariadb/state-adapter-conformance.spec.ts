// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mariadb";
import { it as baseIt, describe } from "vitest";

import {
  createMysqlStateProviderConformanceContext,
  mysqlStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import {
  createMariadbPoolProvider,
  withMariadbPoolNonTransactionContext,
  withMariadbPoolSavepoint,
} from "../state-provider/state-provider.mariadb-pool.spec-helper.ts";

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
  const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({
      ...connectionOptions,
      connectionLimit: 20,
      allowPublicKeyRetrieval: true,
    });
    onCleanup(async () => pool.end());
    return createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createMariadbPoolProvider({ pool }),
      dialect,
      withNonTransactionContext: withMariadbPoolNonTransactionContext(pool),
      withSavepoint: withMariadbPoolSavepoint,
    });
  });

  describe(`${image} State Provider Conformance, pipelining mariadb connector`, () => {
    conformanceTestSuite({ it, groups: mysqlStateProviderConformanceGroups });
  });
}
