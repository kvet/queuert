import {
  createMysqlMigratorConformanceCases,
  createMysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselyMysqlStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("mysql/state-kysely provider conformance", () => {
  let db: Kysely<Database>;
  const cases = createMysqlStateProviderConformanceCases({
    createStateProvider: async () => createKyselyMysqlStateProvider({ db }),
    dialect: "mysql",
    withNonTransactionContext: async (fn) => fn({ db }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    db = new Kysely<Database>({
      dialect: new MysqlDialect({
        pool: createPool({ ...connectionOptions, connectionLimit: 20 }),
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("mysql/state-kysely migrator conformance", () => {
  let db: Kysely<Database>;
  const cases = createMysqlMigratorConformanceCases({
    createStateProvider: () => createKyselyMysqlStateProvider({ db }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    db = new Kysely<Database>({
      dialect: new MysqlDialect({
        pool: createPool({ ...connectionOptions, connectionLimit: 10 }),
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
