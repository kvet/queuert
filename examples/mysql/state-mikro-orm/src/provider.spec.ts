import { MikroORM } from "@mikro-orm/mysql";
import { createMysqlStateProviderConformanceCases } from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createMikroOrmMysqlStateProvider, type MikroOrmMysqlContext } from "./provider.ts";

let orm: MikroORM;
let stateProvider: ReturnType<typeof createMikroOrmMysqlStateProvider>;

beforeAll(async () => {
  const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
  orm = await MikroORM.init({
    entities: [],
    host: connectionOptions.host,
    port: connectionOptions.port,
    user: connectionOptions.user,
    password: connectionOptions.password,
    dbName: connectionOptions.database,
    discovery: { warnWhenNoEntities: false },
  });
  stateProvider = createMikroOrmMysqlStateProvider({ orm });
}, 120_000);

afterAll(async () => {
  await orm.close();
});

// #region conformance
describe("mysql/state-mikro-orm provider conformance", () => {
  const cases = createMysqlStateProviderConformanceCases({
    createStateProvider: async () => stateProvider,
    dialect: "mysql",
    withNonTransactionContext: async (fn) => fn({ em: orm.em.fork() }),
    withSavepoint: async (txCtx, fn) =>
      (txCtx as MikroOrmMysqlContext).em.transactional(async (em) => fn({ em })),
  });

  beforeAll(async () => {});

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("mysql/state-mikro-orm transaction binding", () => {
  test("throws for a context outside a MikroORM transaction", () => {
    expect(() => {
      stateProvider.onTransactionCommit({ em: orm.em.fork() }, () => {});
    }).toThrow("The context is not in a transaction opened through MikroORM");
  });
});
