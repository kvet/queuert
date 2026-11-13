// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { it as baseIt, describe } from "vitest";

import {
  createMysqlMigratorConformanceContext,
  mysqlMigratorConformanceGroups,
} from "../conformance/migrator-conformance.ts";
import { createMysql2PoolProvider } from "../state-provider/state-provider.mysql2-pool.ts";

const defineMysqlMigratorConformanceSuite = async ({
  image,
  callerId,
}: {
  image: string;
  callerId: string;
}): Promise<void> => {
  const { connectionOptions } = await acquireMysql(image, callerId);

  const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    onCleanup(async () => pool.end());
    return createMysqlMigratorConformanceContext({
      stateProvider: createMysql2PoolProvider({ pool }),
    });
  });

  describe(`${image} Migrator Conformance`, () => {
    conformanceTestSuite({ it, groups: mysqlMigratorConformanceGroups });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const image of ["mysql:8.4", "mariadb:11.4"]) {
  await defineMysqlMigratorConformanceSuite({ image, callerId: `${import.meta.url}-${image}` });
}
